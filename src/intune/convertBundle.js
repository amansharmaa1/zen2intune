import path from 'node:path';
import { validateStructuredBundle } from '../schema/bundleSchema.js';
import {
  WINDOWS_ARCHITECTURE,
  RETURN_CODE_TYPE,
  MSI_REBOOT_REQUIRED_EXIT_CODE,
} from './graphEnums.js';

// Deterministic Intune Win32 app conversion engine.
//
// This module performs NO inference and calls NO AI - it only fills in a Graph
// win32LobApp field when the mapping is either (a) a direct, unambiguous copy of
// already-known data, or (b) based on an external, independently-verifiable
// convention (e.g. the MSI 3010 reboot-required exit code). Every field it
// cannot confidently derive is left out of the output and explained in the
// returned `needsReview` list instead of being guessed at - per CLAUDE.md.
//
// Known, deliberate gaps (see NEEDS_REVIEW.md for the full explanation):
//   - No detection rule can ever be produced yet: our structured schema has no
//     field (e.g. an MSI product code) that deterministically maps to any of
//     Intune's detection rule types. Intune requires at least one detection
//     rule for a real app, so this always surfaces as a needsReview item.
//   - minimumSupportedWindowsRelease is never set: Graph documents it as a
//     free-form string with only one example value and no published enumeration,
//     so there's no verified ZENworks-value -> Graph-value mapping to apply.
//   - installExperience (runAsAccount / deviceRestartBehavior) is never set:
//     nothing in the structured schema carries this signal.

function makeReviewItem(code, message, path_, stage) {
  return { code, message, path: path_, severity: 'warning', stage };
}

function buildCommandLineForAction(action) {
  const f = action.fields;
  switch (action.kind) {
    case 'InstallMsi': {
      if (!f.path) return { commandLine: null, issue: 'InstallMsi action has no <Path> to build a command line from.' };
      const switchFlag = action.stageSwitch; // '/i' | '/x', set by caller based on stage
      const parts = ['msiexec', switchFlag, `"${f.path}"`];
      if (f.arguments) parts.push(f.arguments);
      const commandLine = parts.join(' ');
      const suspiciousSwitch = f.arguments && new RegExp(`(^|\\s)${switchFlag.replace('/', '\\/')}(\\s|$)`, 'i').test(f.arguments);
      return {
        commandLine,
        issue: suspiciousSwitch
          ? `Arguments ("${f.arguments}") already appear to contain the "${switchFlag}" switch that was also added by the generator - verify the generated command line isn't duplicating it.`
          : null,
      };
    }
    case 'LaunchExecutable': {
      if (!f.path) return { commandLine: null, issue: 'LaunchExecutable action has no <Path> to build a command line from.' };
      const parts = [`"${f.path}"`];
      if (f.arguments) parts.push(f.arguments);
      return { commandLine: parts.join(' '), issue: null };
    }
    case 'RunScript':
      return {
        commandLine: null,
        issue: 'RunScript actions carry an inline script body, not a file path; packaging the script as a file and building an invocation command line (e.g. via powershell.exe/cmd.exe) was not implemented.',
      };
    case 'InstallFiles':
      return {
        commandLine: null,
        issue: 'InstallFiles actions copy files and have no natural single command-line equivalent.',
      };
    default:
      return { commandLine: null, issue: `Unrecognized action kind "${action.kind}" - cannot build a command line.` };
  }
}

// Action kinds this converter knows how to turn into a single command line.
// RunScript (inline script body, no file to invoke) and InstallFiles (a copy,
// not an executable) are deliberately excluded - see buildCommandLineForAction.
const COMMAND_LINE_CAPABLE_KINDS = new Set(['InstallMsi', 'LaunchExecutable']);

function buildStageCommandLine(actionSet, stageLabel, switchFlag, needsReview) {
  if (!actionSet) return null;

  const candidates = actionSet.actions.filter(
    (a) => a.recognized && a.complete && COMMAND_LINE_CAPABLE_KINDS.has(a.kind),
  );
  const skipped = actionSet.actions.filter((a) => !candidates.includes(a));
  for (const action of skipped) {
    needsReview.push(makeReviewItem(
      'action_excluded_from_conversion',
      `${stageLabel} action of kind "${action.kind}" was not recognized/complete or has no supported command-line form, and was excluded from ${stageLabel.toLowerCase()}CommandLine derivation.`,
      action.sourcePath,
      'conversion',
    ));
  }

  if (candidates.length === 0) {
    needsReview.push(makeReviewItem(
      'no_command_line_candidate',
      `No usable action found to derive ${stageLabel.toLowerCase()}CommandLine for ActionSet "${actionSet.stage}".`,
      actionSet.sourcePath,
      'conversion',
    ));
    return null;
  }

  if (candidates.length > 1) {
    needsReview.push(makeReviewItem(
      'multiple_command_line_candidates',
      `ActionSet "${actionSet.stage}" has ${candidates.length} actions; Intune Win32 apps support exactly one ${stageLabel.toLowerCase()} command line, so none was auto-selected. Combine them manually (e.g. a wrapper script) or pick the primary action.`,
      actionSet.sourcePath,
      'conversion',
    ));
    return null;
  }

  const action = candidates[0];
  const { commandLine, issue } = buildCommandLineForAction({ ...action, stageSwitch: switchFlag });
  if (issue) {
    needsReview.push(makeReviewItem(
      commandLine ? 'command_line_needs_verification' : 'command_line_not_derivable',
      issue,
      action.sourcePath,
      'conversion',
    ));
  }
  return commandLine;
}

function buildApplicableArchitectures(conditions, needsReview) {
  const archCondition = conditions.find((c) => c.kind === 'Architecture');
  if (!archCondition) return undefined;

  if (!archCondition.recognized) {
    needsReview.push(makeReviewItem(
      'condition_excluded_from_conversion',
      `Architecture-like condition "${archCondition.kind}" was not recognized upstream and was not used to set applicableArchitectures.`,
      archCondition.sourcePath,
      'conversion',
    ));
    return undefined;
  }

  const value = (archCondition.value ?? '').trim().toLowerCase();
  const match = WINDOWS_ARCHITECTURE.find((v) => v.toLowerCase() === value);
  if (!match) {
    needsReview.push(makeReviewItem(
      'architecture_not_mappable',
      `Architecture condition value "${archCondition.value}" does not match a known windowsArchitecture value (${WINDOWS_ARCHITECTURE.join(', ')}); applicableArchitectures left unset.`,
      archCondition.sourcePath,
      'conversion',
    ));
    return undefined;
  }
  return match;
}

function flagOperatingSystemCondition(conditions, needsReview) {
  const osCondition = conditions.find((c) => c.kind === 'OperatingSystem');
  if (!osCondition) return;
  needsReview.push(makeReviewItem(
    'os_condition_needs_manual_mapping',
    `OperatingSystem condition (value "${osCondition.value}") has no verified mapping to Graph's minimumSupportedWindowsRelease string format (Microsoft's docs give only one example value, "Windows11_23H2", with no published full enumeration). Set this field manually.`,
    osCondition.sourcePath,
    'conversion',
  ));
}

function buildFileSystemRequirementRules(conditions, needsReview) {
  const rules = [];
  for (const condition of conditions) {
    if (condition.kind !== 'FileExists') continue;

    if (!condition.recognized) continue; // already flagged upstream

    if (condition.operator === 'exists') {
      const fullPath = condition.value ?? '';
      rules.push({
        '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
        ruleType: 'requirement',
        path: path.win32.dirname(fullPath),
        fileOrFolderName: path.win32.basename(fullPath),
        operationType: 'exists',
        operator: 'notConfigured',
      });
    } else if (condition.operator === 'notExists') {
      needsReview.push(makeReviewItem(
        'no_inverse_file_system_rule',
        `FileExists condition uses operator "notExists" (value "${condition.value}"), but Graph's win32LobAppFileSystemRule operationType has no "doesNotExist" option (only registry rules do) - there is no direct equivalent. Needs a manual/alternate approach.`,
        condition.sourcePath,
        'conversion',
      ));
    } else {
      needsReview.push(makeReviewItem(
        'unrecognized_condition_operator',
        `FileExists condition has operator "${condition.operator}", which this converter doesn't know how to map.`,
        condition.sourcePath,
        'conversion',
      ));
    }
  }
  return rules;
}

function buildReturnCodes(actionSets) {
  const codes = new Set();
  for (const actionSet of actionSets) {
    for (const action of actionSet.actions) {
      for (const code of action.successCodes) codes.add(code);
    }
  }
  return [...codes].sort((a, b) => a - b).map((code) => ({
    '@odata.type': '#microsoft.graph.win32LobAppReturnCode',
    returnCode: code,
    type: code === MSI_REBOOT_REQUIRED_EXIT_CODE ? 'softReboot' : 'success',
  }));
}

/**
 * Converts a Phase 2 structured bundle into a best-effort Intune win32LobApp
 * JSON payload plus a needsReview list. Never throws for real-world content
 * gaps (those become needsReview entries); only throws if the input itself
 * isn't a schema-valid structured bundle, which is a caller/integration bug.
 */
export function convertToIntunePackage(structuredBundle) {
  const { valid, errors } = validateStructuredBundle(structuredBundle);
  if (!valid) {
    throw new Error(`convertToIntunePackage: input is not a valid structured bundle: ${errors.join('; ')}`);
  }

  const needsReview = structuredBundle.needsReview.map((item) => ({ ...item, stage: 'parsing' }));

  const app = {
    '@odata.type': '#microsoft.graph.win32LobApp',
    displayName: structuredBundle.bundle.name,
  };

  const installSet = structuredBundle.actionSets.find((s) => s.stage === 'Install');
  const uninstallSet = structuredBundle.actionSets.find((s) => s.stage === 'Uninstall');
  for (const set of structuredBundle.actionSets) {
    if (!set.recognized) {
      needsReview.push(makeReviewItem(
        'action_set_excluded_from_conversion',
        `ActionSet with stage "${set.stage}" was not recognized upstream and was not used in conversion.`,
        set.sourcePath,
        'conversion',
      ));
    }
  }
  for (const [set, stageLabel] of [[installSet, 'Install'], [uninstallSet, 'Uninstall']]) {
    if (!set) {
      needsReview.push(makeReviewItem(
        'action_set_missing',
        `No "${stageLabel}" ActionSet was found in this bundle; ${stageLabel.toLowerCase()}CommandLine could not be derived.`,
        '/actionSets',
        'conversion',
      ));
    }
  }

  const installCommandLine = buildStageCommandLine(
    installSet?.recognized ? installSet : null, 'Install', '/i', needsReview,
  );
  if (installCommandLine) app.installCommandLine = installCommandLine;

  const uninstallCommandLine = buildStageCommandLine(
    uninstallSet?.recognized ? uninstallSet : null, 'Uninstall', '/x', needsReview,
  );
  if (uninstallCommandLine) app.uninstallCommandLine = uninstallCommandLine;

  const applicableArchitectures = buildApplicableArchitectures(structuredBundle.conditions, needsReview);
  if (applicableArchitectures) app.applicableArchitectures = applicableArchitectures;

  flagOperatingSystemCondition(structuredBundle.conditions, needsReview);

  const requirementRules = buildFileSystemRequirementRules(structuredBundle.conditions, needsReview);
  app.rules = requirementRules; // detection rules always absent for now - see module comment

  needsReview.push(makeReviewItem(
    'no_detection_rule_derivable',
    'No detection rule was generated: the structured schema has no field (e.g. an MSI product code) that deterministically maps to a Win32LobAppFileSystemRule, Win32LobAppRegistryRule, Win32LobAppProductCodeRule, or Win32LobAppPowerShellScriptRule. Intune requires at least one detection rule - add one manually (or via the Phase 4 AI layer\'s suggestion) before creating this app.',
    '/rules',
    'conversion',
  ));

  const returnCodes = buildReturnCodes(structuredBundle.actionSets);
  if (returnCodes.length > 0) app.returnCodes = returnCodes;

  if (structuredBundle.dependencies.length > 0) {
    needsReview.push(makeReviewItem(
      'dependency_not_convertible',
      `Bundle has ${structuredBundle.dependencies.length} dependency/dependencies. Graph models app-to-app dependencies as a separate mobileAppDependency relationship, not a win32LobApp property, and that relationship API was not implemented here.`,
      '/dependencies',
      'conversion',
    ));
  }

  needsReview.push(makeReviewItem(
    'install_experience_undetermined',
    'installExperience (runAsAccount, deviceRestartBehavior) was not set: nothing in the structured schema indicates run-as context or restart behavior. Set this manually.',
    '/installExperience',
    'conversion',
  ));

  return { app, needsReview };
}

// Re-exported for tests/consumers that want to sanity-check a hand-built
// returnCodes entry's `type` against the verified enum without re-deriving it.
export const KNOWN_RETURN_CODE_TYPES = RETURN_CODE_TYPE;
