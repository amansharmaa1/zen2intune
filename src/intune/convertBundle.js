import path from 'node:path';
import { validateStructuredBundle } from '../schema/bundleSchema.js';
import { MSI_GUID_PATTERN } from '../msi/readMsiProductInfo.js';

// Deterministic Intune Win32 app conversion engine.
//
// Rewritten on 2026-07-04 to consume the *real* ZENworks-shaped structured
// bundle (see NEEDS_REVIEW.md, "Phase 1 - XML parser" item 0 and "Phase 2/3 -
// rewritten for real data" below), replacing an earlier version built against
// an invented Phase 1 shape. Extended on 2026-07-05 with a ProductCode-based
// detection rule + msiInformation, fed by MSI Property-table data read from
// the actual installer binary (src/msi/readMsiProductInfo.js) - the bundle
// XML itself carries no ProductCode anywhere.
//
// Graph schema re-verified against Microsoft Learn (v1.0) on 2026-07-05:
//   win32LobApp (rules / msiInformation / setupFilePath / fileName):
//     https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobapp?view=graph-rest-1.0
//   win32LobAppRule (base; ruleType: detection | requirement):
//     https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobapprule?view=graph-rest-1.0
//   win32LobAppProductCodeRule ("This rule is not supported as a requirement
//   rule" - i.e. detection-only):
//     https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappproductcoderule?view=graph-rest-1.0
//   win32LobAppMsiInformation:
//     https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappmsiinformation?view=graph-rest-1.0
// Note: there is no v1.0 type named "win32LobAppDetectionRule" - on v1.0,
// detection rules are win32LobAppRule subtypes with ruleType "detection".
// The separate win32LobAppDetection hierarchy (win32LobAppProductCodeDetection
// etc.) is beta-only; this project targets v1.0 as Microsoft recommends.
//
// This module performs NO inference and calls NO AI - it only fills in a Graph
// win32LobApp field when the mapping is either (a) a direct, unambiguous copy of
// already-known data, or (b) based on a fact verified against Microsoft Learn
// documentation. Every field it cannot confidently derive is left out of the
// output and explained in the returned `needsReview` list instead of being
// guessed at - per CLAUDE.md.
//
// Known, deliberate gaps (see NEEDS_REVIEW.md for the full explanation):
//   - A detection rule is produced ONLY when the caller supplies
//     options.msiProductInfo (read from the real MSI binary). Without it,
//     nothing in the bundle XML deterministically maps to any of Intune's
//     detection rule types - flagged, never guessed.
//   - applicableArchitectures / minimumSupportedWindowsRelease are never set:
//     none of the three real requirement leaf types observed (RegKeyExistsReq,
//     FileExistsReq, IPSegmentReq) conveys architecture or OS-version
//     information. Always flagged.
//   - installExperience (runAsAccount / deviceRestartBehavior) is never set:
//     nothing in the structured schema carries this signal.
//   - returnCodes is never set: no explicit success/return-code construct
//     exists anywhere in real ZENworks bundle exports (see NEEDS_REVIEW.md) -
//     there is no data source for this field at all right now. Always flagged.
//   - A requirement tree that OR's together more than one top-level condition
//     group is not converted at all: Graph's `rules` array has no verified way
//     to express "any one of these alternative groups" - only a flat, implicitly
//     AND'd list.

function makeReviewItem(code, message, path_, stage) {
  return { code, message, path: path_, severity: 'warning', stage };
}

// --- Command line derivation -------------------------------------------------
//
// Real ZENworks "Install MSI Action" data carries three ready-made command-line
// fragments (Install/Repair/Uninstall), each already including its own /i, /f,
// or /x switch - see NEEDS_REVIEW.md. Both installCommandLine and
// uninstallCommandLine are derived from the *same* MSI action, found within the
// "Install" ActionSet - the real "Uninstall" ActionSet's own action ("Undo
// Install") carries no data of its own in either reconciled sample.

function findMsiInstallAction(installSet, needsReview) {
  if (!installSet) return null; // already flagged by the caller's actionSet-presence check
  if (!installSet.recognized) return null; // already flagged as action_set_excluded_from_conversion

  const candidates = installSet.actions.filter((a) => a.recognized && a.kind === 'Install MSI Action');
  const others = installSet.actions.filter((a) => !candidates.includes(a));
  for (const action of others) {
    needsReview.push(makeReviewItem(
      'action_excluded_from_conversion',
      `Install action of kind "${action.kind}" is not an MSI install action and was excluded from command-line derivation.`,
      action.sourcePath,
      'conversion',
    ));
  }

  if (candidates.length === 0) {
    needsReview.push(makeReviewItem(
      'no_command_line_candidate',
      'No "Install MSI Action" was found in the Install ActionSet; installCommandLine/uninstallCommandLine could not be derived (e.g. this may be a script-only bundle with no MSI - see NEEDS_REVIEW.md).',
      installSet.sourcePath,
      'conversion',
    ));
    return null;
  }

  if (candidates.length > 1) {
    needsReview.push(makeReviewItem(
      'multiple_command_line_candidates',
      `Install ActionSet has ${candidates.length} MSI install actions; Intune supports exactly one install command line, so none was auto-selected.`,
      installSet.sourcePath,
      'conversion',
    ));
    return null;
  }

  return candidates[0];
}

function buildMsiCommandLines(msiAction, needsReview) {
  const result = {};
  if (!msiAction) return result;

  if (msiAction.fields.installCmdLine) {
    result.installCommandLine = `msiexec ${msiAction.fields.installCmdLine}`;
  } else {
    needsReview.push(makeReviewItem(
      'install_command_line_not_derivable',
      'The MSI install action has no Install/CmdLine; installCommandLine could not be derived.',
      msiAction.sourcePath,
      'conversion',
    ));
  }

  if (msiAction.fields.uninstallCmdLine) {
    result.uninstallCommandLine = `msiexec ${msiAction.fields.uninstallCmdLine}`;
  } else {
    needsReview.push(makeReviewItem(
      'uninstall_command_line_not_derivable',
      'The MSI install action has no Uninstall/CmdLine; uninstallCommandLine could not be derived.',
      msiAction.sourcePath,
      'conversion',
    ));
  }

  return result;
}

// --- Requirement rules --------------------------------------------------------
//
// Real requirements are a recursive AND/OR tree, flattened to leaves each
// carrying a `groupPath` ancestry (see src/schema/normalize.js). Graph's
// `rules` array is a flat list with no verified way to express "any one of
// these alternative groups" - only automatically convert when every condition
// belongs to the same single top-level group (no OR-of-groups ambiguity).

function conditionGroupTopIndices(conditions) {
  return new Set(
    conditions
      .filter((c) => Array.isArray(c.groupPath) && c.groupPath.length > 0)
      .map((c) => c.groupPath[0].index),
  );
}

function buildRegistryRule(condition, needsReview) {
  if (condition.assertedValue === null) {
    needsReview.push(makeReviewItem(
      'condition_value_undetermined',
      `RegKeyExistsReq condition (target "${condition.target}") has no boolean Value to assert - cannot determine exists vs. doesNotExist.`,
      condition.sourcePath,
      'conversion',
    ));
    return null;
  }
  // Verified via Microsoft Learn ("Add, Assign, and Monitor a Win32 App"):
  // an empty valueName means the rule checks the registry *key's* existence,
  // not a specific value under it - exactly what RegKeyExistsReq checks.
  return {
    '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
    ruleType: 'requirement',
    keyPath: condition.target,
    valueName: '',
    operationType: condition.assertedValue ? 'exists' : 'doesNotExist',
    operator: 'notConfigured',
  };
}

function buildFileSystemRule(condition, needsReview) {
  if (condition.assertedValue === true) {
    const target = condition.target ?? '';
    return {
      '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
      ruleType: 'requirement',
      path: path.win32.dirname(target),
      fileOrFolderName: path.win32.basename(target),
      operationType: 'exists',
      operator: 'notConfigured',
    };
  }
  if (condition.assertedValue === false) {
    needsReview.push(makeReviewItem(
      'no_inverse_file_system_rule',
      `FileExistsReq condition asserts the target ("${condition.target}") must NOT exist, but Graph's win32LobAppFileSystemRule operationType has no "doesNotExist" option (only registry rules do) - there is no direct equivalent.`,
      condition.sourcePath,
      'conversion',
    ));
    return null;
  }
  needsReview.push(makeReviewItem(
    'condition_value_undetermined',
    `FileExistsReq condition (target "${condition.target}") has no boolean Value to assert.`,
    condition.sourcePath,
    'conversion',
  ));
  return null;
}

function buildRequirementRules(conditions, needsReview) {
  for (const condition of conditions) {
    if (!condition.recognized) {
      needsReview.push(makeReviewItem(
        'condition_excluded_from_conversion',
        `Condition of type "${condition.reqType}" was not recognized upstream and was not used in conversion.`,
        condition.sourcePath,
        'conversion',
      ));
    }
  }

  const recognizedConditions = conditions.filter((c) => c.recognized);
  const topIndices = conditionGroupTopIndices(recognizedConditions);
  if (topIndices.size > 1) {
    needsReview.push(makeReviewItem(
      'requirement_tree_has_alternatives',
      `The requirement tree OR's together ${topIndices.size} alternative condition groups; Graph's requirementRules are implicitly AND'd with no verified way to express OR-of-groups, so no automatic rule conversion was attempted for any condition.`,
      '/conditions',
      'conversion',
    ));
    return [];
  }

  const rules = [];
  for (const condition of recognizedConditions) {
    let rule = null;
    if (condition.reqType === 'RegKeyExistsReq') {
      rule = buildRegistryRule(condition, needsReview);
    } else if (condition.reqType === 'FileExistsReq') {
      rule = buildFileSystemRule(condition, needsReview);
    } else if (condition.reqType === 'IPSegmentReq') {
      needsReview.push(makeReviewItem(
        'no_network_requirement_rule',
        `IPSegmentReq condition (target "${condition.target}") has no Intune win32LobAppRule equivalent - none of the four verified rule types (file system, registry, product code, PowerShell script) support network/IP-based conditions.`,
        condition.sourcePath,
        'conversion',
      ));
    }
    if (rule) rules.push(rule);
  }
  return rules;
}

// --- MSI-derived detection rule and msiInformation ----------------------------
//
// Fed by options.msiProductInfo, which src/msi/readMsiProductInfo.js reads
// from the actual MSI binary's Property table (the only non-fabricated source
// for a ProductCode - the bundle XML has none). Shapes verified on Microsoft
// Learn 2026-07-05; URLs in the module header.

function buildProductCodeDetectionRule(msiProductInfo) {
  // win32LobAppProductCodeRule is detection-only per its v1.0 doc page.
  // productVersionOperator "notConfigured" = detect the product at any
  // version (matching Intune's default when no version check is configured).
  return {
    '@odata.type': '#microsoft.graph.win32LobAppProductCodeRule',
    ruleType: 'detection',
    productCode: msiProductInfo.productCode,
    productVersionOperator: 'notConfigured',
  };
}

function buildMsiInformation(msiProductInfo, needsReview) {
  const msiInformation = {
    '@odata.type': '#microsoft.graph.win32LobAppMsiInformation',
    productCode: msiProductInfo.productCode,
  };
  if (msiProductInfo.productVersion) msiInformation.productVersion = msiProductInfo.productVersion;
  if (msiProductInfo.upgradeCode) msiInformation.upgradeCode = msiProductInfo.upgradeCode;
  if (msiProductInfo.productName) msiInformation.productName = msiProductInfo.productName;
  // The MSI Property table's Manufacturer is the product's publisher -> Graph
  // msiInformation.publisher ("The MSI publisher").
  if (msiProductInfo.manufacturer) msiInformation.publisher = msiProductInfo.manufacturer;

  // packageType from the MSI ALLUSERS property, per its documented semantics
  // (https://learn.microsoft.com/windows/win32/msi/allusers): unset = per-user
  // context, "1" = per-machine context. ALLUSERS=2 (or any other value) means
  // the context is decided at install time by user privileges/OS - that does
  // not deterministically map to one of Graph's perMachine/perUser/dualPurpose
  // values, so it's flagged instead of guessed.
  if (msiProductInfo.allUsers === '1') {
    msiInformation.packageType = 'perMachine';
  } else if (msiProductInfo.allUsers === null || msiProductInfo.allUsers === undefined) {
    msiInformation.packageType = 'perUser';
  } else {
    needsReview.push(makeReviewItem(
      'msi_package_type_undetermined',
      `The MSI's ALLUSERS property is "${msiProductInfo.allUsers}", which defers the per-machine/per-user decision to install time (privileges/OS-dependent per Microsoft's ALLUSERS documentation) - msiInformation.packageType was left unset rather than guessed.`,
      '/msiInformation/packageType',
      'conversion',
    ));
  }

  return msiInformation;
}

/**
 * Converts a Phase 2 structured bundle (real ZENworks shape) into a
 * best-effort Intune win32LobApp JSON payload plus a needsReview list.
 *
 * options.msiProductInfo (optional): the result of readMsiProductInfo() run
 * against the bundle's actual MSI installer. When present, it powers the
 * ProductCode detection rule, msiInformation, and the app-level publisher.
 * When absent, no detection rule can be derived and that is flagged.
 *
 * Never throws for real-world content gaps (those become needsReview
 * entries); only throws if an input itself is invalid (schema-invalid
 * structured bundle, malformed productCode), which is a caller/integration
 * bug rather than a data gap.
 */
export function convertToIntunePackage(structuredBundle, options = {}) {
  const { valid, errors } = validateStructuredBundle(structuredBundle);
  if (!valid) {
    throw new Error(`convertToIntunePackage: input is not a valid structured bundle: ${errors.join('; ')}`);
  }

  const msiProductInfo = options.msiProductInfo ?? null;
  if (msiProductInfo && !MSI_GUID_PATTERN.test(msiProductInfo.productCode ?? '')) {
    throw new Error(
      'convertToIntunePackage: options.msiProductInfo.productCode is not a braced GUID - refusing to build a detection rule from it',
    );
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
  if (!installSet) {
    needsReview.push(makeReviewItem(
      'action_set_missing',
      'No "Install" ActionSet was found in this bundle; installCommandLine/uninstallCommandLine could not be derived.',
      '/actionSets',
      'conversion',
    ));
  }
  if (!uninstallSet) {
    needsReview.push(makeReviewItem(
      'uninstall_action_set_missing',
      'No "Uninstall" ActionSet was found in this bundle - this cannot confirm ZENworks was configured to support uninstall, independent of whether an uninstallCommandLine was derived from the Install MSI action.',
      '/actionSets',
      'conversion',
    ));
  }

  const msiAction = findMsiInstallAction(installSet, needsReview);
  Object.assign(app, buildMsiCommandLines(msiAction, needsReview));

  // fileName ("the name of the main Lob application file") and setupFilePath
  // ("the relative path of the setup file in the encrypted Win32LobApp
  // package", example value is itself a bare .msi name) both come from the
  // MSIData FileName attribute - the one place the bundle XML names the
  // installer file. Doc URLs in the module header.
  if (msiAction?.fields.fileName) {
    app.fileName = msiAction.fields.fileName;
    app.setupFilePath = msiAction.fields.fileName;
  }

  const requirementRules = buildRequirementRules(structuredBundle.conditions, needsReview);

  const detectionRules = [];
  if (msiProductInfo) {
    detectionRules.push(buildProductCodeDetectionRule(msiProductInfo));
    app.msiInformation = buildMsiInformation(msiProductInfo, needsReview);
    // mobileApp.publisher <- the MSI's Manufacturer property (same source as
    // msiInformation.publisher above).
    if (msiProductInfo.manufacturer) app.publisher = msiProductInfo.manufacturer;
  } else {
    needsReview.push(makeReviewItem(
      'no_detection_rule_derivable',
      'No detection rule was generated: the bundle XML carries no ProductCode (MSIData has FileName/Locale/PackageName/Vendor/Version attributes only), and nothing else in the structured schema deterministically maps to a detection rule type. Supply options.msiProductInfo (read from the actual MSI via src/msi/readMsiProductInfo.js, e.g. through the export-directory pipeline) to generate a win32LobAppProductCodeRule, or add a detection rule manually. Intune requires at least one detection rule per Win32 app.',
      '/rules',
      'conversion',
    ));
  }

  app.rules = [...detectionRules, ...requirementRules];

  needsReview.push(makeReviewItem(
    'architecture_signal_unavailable',
    'applicableArchitectures was not set: none of the real requirement leaf types observed (RegKeyExistsReq, FileExistsReq, IPSegmentReq) conveys Windows architecture information.',
    '/applicableArchitectures',
    'conversion',
  ));

  needsReview.push(makeReviewItem(
    'os_signal_unavailable',
    'minimumSupportedWindowsRelease was not set: none of the real requirement leaf types observed conveys an OS version/release requirement.',
    '/minimumSupportedWindowsRelease',
    'conversion',
  ));

  needsReview.push(makeReviewItem(
    'no_return_codes_derivable',
    'returnCodes was not set: no explicit success/return-code construct exists anywhere in real ZENworks bundle exports (see NEEDS_REVIEW.md) - there is no verified data source for this field. Set manually if the installer needs non-default return code handling.',
    '/returnCodes',
    'conversion',
  ));

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
