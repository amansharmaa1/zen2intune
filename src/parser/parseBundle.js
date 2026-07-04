import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BundleParseError } from './errors.js';
import {
  KNOWN_ACTION_SET_TYPES,
  KNOWN_ACTION_TYPES,
  KNOWN_REQUIREMENT_LEAF_TYPES,
} from './knownTypes.js';

// removeNSPrefix: real ZENworks exports wrap nearly every element in ns1:/ns2:
// namespace prefixes whose URI mapping changes by section of the document.
// Stripping prefixes and matching on local element names only was verified
// empirically (against a synthetic, non-real namespaced XML snippet) to behave
// as expected with this library version - see NEEDS_REVIEW.md.
const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  trimValues: true,
  removeNSPrefix: true,
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node === undefined || node === null) return null;
  if (typeof node === 'object') {
    if ('#text' in node) return String(node['#text']).trim();
    return null;
  }
  return String(node).trim();
}

function attrOf(node, attrName) {
  const value = node?.[`@_${attrName}`];
  return value === undefined ? null : value;
}

function boolOf(node) {
  const text = textOf(node);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return null;
}

/**
 * Deterministically parses a real-shaped ZENworks bundle export XML string
 * (reconciled against two real exports on 2026-07-04 - see NEEDS_REVIEW.md)
 * into raw extracted data. Performs no interpretation: unrecognized
 * types/fields are passed through and flagged in `warnings`, never guessed
 * at. Structurally fatal problems (invalid XML, missing bundle identity)
 * throw a BundleParseError instead of producing a partial/best-guess
 * structure.
 */
export function parseBundleXml(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.trim().length === 0) {
    throw new BundleParseError('Input XML is empty or not a string');
  }

  const validation = XMLValidator.validate(xmlString);
  if (validation !== true) {
    const { code, msg, line, col } = validation.err ?? {};
    throw new BundleParseError(
      `Malformed XML: ${msg ?? 'unknown error'} (code ${code ?? 'n/a'}, line ${line ?? '?'}, col ${col ?? '?'})`,
    );
  }

  const parser = new XMLParser(parserOptions);
  let doc;
  try {
    doc = parser.parse(xmlString, true);
  } catch (err) {
    throw new BundleParseError(`Failed to parse XML: ${err.message}`);
  }

  const root = doc.Bundle;
  if (!root || typeof root !== 'object') {
    throw new BundleParseError('Missing root <Bundle> element', { path: '/Bundle' });
  }

  const warnings = [];

  const bundle = parseBundleMetadata(root);
  const requirements = parseRequirements(root, warnings);
  // No real bundle-to-bundle dependency reference construct was found in
  // either reconciled sample - see NEEDS_REVIEW.md. Always empty for now.
  const dependencies = [];
  const actionSets = parseActionSets(root, warnings);

  return { bundle, requirements, dependencies, actionSets, warnings };
}

function parseBundleMetadata(root) {
  const uid = textOf(root.UID);
  const name = textOf(root.Name);

  const missing = [];
  if (!uid) missing.push('UID');
  if (!name) missing.push('Name');
  if (missing.length > 0) {
    throw new BundleParseError(
      `Bundle is missing required field(s): ${missing.join(', ')}`,
      { path: '/Bundle' },
    );
  }

  return {
    uid,
    name,
    internalName: textOf(root.InternalName),
    parentUid: textOf(root.ParentUID),
    path: textOf(root.Path),
    adminId: textOf(root.AdminID),
    description: textOf(root.Description),
    primaryType: textOf(root.PrimaryType),
    subType: textOf(root.SubType),
    category: textOf(root.Category),
    // ZENworks' own edit/revision counter - NOT a software version string.
    // A real software version, if present, lives on an MSI action's own
    // Version attribute instead. See NEEDS_REVIEW.md.
    version: textOf(root.Version),
    displayName: textOf(root.DisplayName),
    creationDate: textOf(root.CreationDate),
  };
}

// Requirements (SysReqs) are a recursive boolean tree: a root conjunction
// (AND/OR) wraps Req nodes, each either a nested GroupReq (its own
// conjunction + child Reqs) or a leaf check (a Type, a boolean Value, and a
// target Name - e.g. a registry key path, CIDR block, or file path). There is
// no "operator" concept - just a boolean assertion per leaf. This walks the
// tree and flattens it into a list of leaves, each carrying its full
// ancestry (`groupPath`) of {conjunction, index} steps so the AND/OR
// structure is preserved rather than discarded.
function parseRequirements(root, warnings) {
  const sysReqsRoot = root.SysReqs?.SysReqs;
  if (!sysReqsRoot) return [];

  const rootConjunction = attrOf(sysReqsRoot, 'Conjunction');
  const leaves = [];
  asArray(sysReqsRoot.Req).forEach((reqNode, index) => {
    walkReqNode(
      reqNode,
      [{ conjunction: rootConjunction, index }],
      `/Bundle/SysReqs/SysReqs/Req[${index}]`,
      warnings,
      leaves,
    );
  });
  return leaves;
}

function walkReqNode(reqNode, groupPath, path, warnings, leaves) {
  const reqType = attrOf(reqNode, 'Type');

  if (!reqType) {
    warnings.push({ code: 'req_missing_type', message: 'Req element is missing a Type attribute', path });
    return;
  }

  if (reqType === 'GroupReq') {
    const groupData = reqNode.Data?.GroupReq;
    if (!groupData) {
      warnings.push({ code: 'group_req_missing_data', message: 'GroupReq has no Data/GroupReq child', path });
      return;
    }
    const conjunction = attrOf(groupData, 'Conjunction');
    asArray(groupData.Req).forEach((child, index) => {
      walkReqNode(
        child,
        [...groupPath, { conjunction, index }],
        `${path}/Data/GroupReq/Req[${index}]`,
        warnings,
        leaves,
      );
    });
    return;
  }

  const leafData = reqNode.Data?.[reqType];
  if (!leafData) {
    warnings.push({
      code: 'req_missing_data',
      message: `Req of type "${reqType}" has no matching Data/${reqType} child`,
      path,
    });
    return;
  }

  if (!KNOWN_REQUIREMENT_LEAF_TYPES.includes(reqType)) {
    warnings.push({
      code: 'unknown_requirement_type',
      message: `Unrecognized requirement type "${reqType}" - not mapped, needs review`,
      path,
    });
  }

  leaves.push({
    groupPath,
    reqType,
    assertedValue: boolOf(leafData.Value),
    target: textOf(leafData.Name),
    path,
  });
}

// ActionSets are repeated sibling elements directly under <Bundle> (not
// nested inside one wrapping parent). Individual actions are <Actions>
// elements (plural tag, singular meaning) repeated under an ActionSet.
function parseActionSets(root, warnings) {
  return asArray(root.ActionSets).map((set, index) => {
    const path = `/Bundle/ActionSets[${index}]`;
    const type = textOf(set.Type);

    if (!type) {
      warnings.push({ code: 'action_set_missing_type', message: 'ActionSet is missing a Type element', path });
    } else if (!KNOWN_ACTION_SET_TYPES.includes(type)) {
      warnings.push({
        code: 'unknown_action_set_type',
        message: `Unrecognized ActionSet type "${type}" - not mapped, needs review`,
        path,
      });
    }

    const actions = asArray(set.Actions).map((action, actionIndex) =>
      parseAction(action, `${path}/Actions[${actionIndex}]`, warnings),
    );

    return {
      id: textOf(set.Id),
      type,
      version: textOf(set.Version),
      modified: boolOf(set.Modified),
      actions,
      path,
    };
  });
}

// Field extraction is only implemented for the two action types that carry
// install/uninstall mechanics relevant to Intune conversion. Other real
// action types (Display Message Action, Terminate Action(Prompt), Verify
// Install, Undo Install, Distribute Action) are recognized against the known
// vocabulary but their Data isn't deeply parsed - see NEEDS_REVIEW.md.
function extractMsiFields(actionData) {
  const msiData = actionData?.MSIData;
  if (!msiData) return {};
  return {
    fileName: attrOf(msiData, 'FileName'),
    installCmdLine: textOf(msiData.Install?.CmdLine),
    repairCmdLine: textOf(msiData.Repair?.CmdLine),
    uninstallCmdLine: textOf(msiData.Uninstall?.CmdLine),
    properties: asArray(msiData.Properties).map((p) => textOf(p)).filter((p) => p !== null),
  };
}

function extractScriptFields(actionData) {
  const exec = actionData?.RunScriptActionHandlerData?.Exec;
  if (!exec) return {};
  return {
    scriptBody: textOf(exec.Script),
    scriptExtension: attrOf(exec.Script, 'extension'),
    executorPath: attrOf(exec.ProgramExecutor, 'path'),
    executorArguments: attrOf(exec.ProgramExecutor, 'arguments'),
    runAs: textOf(exec.AdvancedSettings?.RunAs),
  };
}

const FIELD_EXTRACTORS_BY_ACTION_TYPE = {
  'Install MSI Action': extractMsiFields,
  'Run Script Action': extractScriptFields,
};

function parseAction(actionNode, path, warnings) {
  const type = textOf(actionNode.Type);

  if (!type) {
    warnings.push({ code: 'action_missing_type', message: 'Action is missing a Type element', path });
  } else if (!KNOWN_ACTION_TYPES.includes(type)) {
    warnings.push({
      code: 'unknown_action_type',
      message: `Unrecognized action type "${type}" - not mapped, needs review`,
      path,
    });
  }

  const extractor = type ? FIELD_EXTRACTORS_BY_ACTION_TYPE[type] : null;
  const fields = extractor ? extractor(actionNode.Data) : {};

  if (type === 'Install MSI Action' && !fields.installCmdLine) {
    warnings.push({ code: 'action_missing_expected_field', message: 'Install MSI Action has no Install/CmdLine', path });
  }
  if (type === 'Run Script Action' && !fields.scriptBody) {
    warnings.push({ code: 'action_missing_expected_field', message: 'Run Script Action has no Script body', path });
  }

  return {
    id: textOf(actionNode.Id),
    name: textOf(actionNode.Name),
    type,
    enabled: boolOf(actionNode.Enabled),
    continueOnFailure: boolOf(actionNode.ContinueOnFailure),
    linkedObjectIds: textOf(actionNode.LinkedObjectIDs),
    fields,
    path,
  };
}
