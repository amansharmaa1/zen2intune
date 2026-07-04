import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BundleParseError } from './errors.js';
import {
  KNOWN_ACTION_TYPES,
  KNOWN_REQUIREMENT_FILTER_TYPES,
  KNOWN_DEPENDENCY_TYPES,
  KNOWN_ACTION_SET_TYPES,
} from './knownTypes.js';

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  trimValues: true,
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

/**
 * Deterministically parses a ZENworks-style bundle export XML string into raw
 * extracted data (bundle metadata, requirements, dependencies, action sets).
 *
 * This function performs no interpretation or inference: unrecognized
 * types/fields are passed through and flagged in `warnings`, never guessed at.
 * Structurally fatal problems (invalid XML, missing required elements) throw
 * a BundleParseError instead of producing a partial/best-guess structure.
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
  const dependencies = parseDependencies(root, warnings);
  const actionSets = parseActionSets(root, warnings);

  return { bundle, requirements, dependencies, actionSets, warnings };
}

function parseBundleMetadata(root) {
  const name = textOf(root.Name);
  const guid = textOf(root.Guid);
  const type = textOf(root.Type);
  const version = textOf(root.Version);

  const missing = [];
  if (!name) missing.push('Name');
  if (!guid) missing.push('Guid');
  if (!type) missing.push('Type');
  if (missing.length > 0) {
    throw new BundleParseError(
      `Bundle is missing required field(s): ${missing.join(', ')}`,
      { path: '/Bundle' },
    );
  }

  return { name, guid, type, version: version ?? null };
}

function parseRequirements(root, warnings) {
  const filters = asArray(root.Requirements?.Filter);

  return filters.map((filter, index) => {
    const path = `/Bundle/Requirements/Filter[${index}]`;
    const type = attrOf(filter, 'type');
    const operator = attrOf(filter, 'operator');
    const value = attrOf(filter, 'value');

    if (!type) {
      warnings.push({
        code: 'requirement_missing_type',
        message: 'Requirement filter is missing a type attribute',
        path,
      });
    } else if (!KNOWN_REQUIREMENT_FILTER_TYPES.includes(type)) {
      warnings.push({
        code: 'unknown_requirement_type',
        message: `Unrecognized requirement filter type "${type}" - not mapped, needs review`,
        path,
      });
    }

    return { type, operator, value, path };
  });
}

function parseDependencies(root, warnings) {
  const deps = asArray(root.Dependencies?.Dependency);

  return deps.map((dep, index) => {
    const path = `/Bundle/Dependencies/Dependency[${index}]`;
    const type = attrOf(dep, 'type');
    const name = attrOf(dep, 'name');
    const guid = attrOf(dep, 'guid');
    const requiredAttr = attrOf(dep, 'required');
    const required = requiredAttr === true || requiredAttr === 'true';

    if (!type) {
      warnings.push({
        code: 'dependency_missing_type',
        message: 'Dependency is missing a type attribute',
        path,
      });
    } else if (!KNOWN_DEPENDENCY_TYPES.includes(type)) {
      warnings.push({
        code: 'unknown_dependency_type',
        message: `Unrecognized dependency type "${type}" - not mapped, needs review`,
        path,
      });
    }

    if (!name) {
      warnings.push({
        code: 'dependency_missing_name',
        message: 'Dependency is missing a name attribute',
        path,
      });
    }

    return { type, name, guid, required, path };
  });
}

function parseActionSets(root, warnings) {
  const sets = asArray(root.ActionSets?.ActionSet);

  return sets.map((set, setIndex) => {
    const setPath = `/Bundle/ActionSets/ActionSet[${setIndex}]`;
    const type = attrOf(set, 'type');

    if (!type) {
      warnings.push({
        code: 'action_set_missing_type',
        message: 'ActionSet is missing a type attribute',
        path: setPath,
      });
    } else if (!KNOWN_ACTION_SET_TYPES.includes(type)) {
      warnings.push({
        code: 'unknown_action_set_type',
        message: `Unrecognized ActionSet type "${type}" - not mapped, needs review`,
        path: setPath,
      });
    }

    const actions = asArray(set.Action).map((action, actionIndex) =>
      parseAction(action, `${setPath}/Action[${actionIndex}]`, warnings),
    );

    return { type, actions, path: setPath };
  });
}

function parseAction(action, path, warnings) {
  const type = attrOf(action, 'type');
  const orderAttr = attrOf(action, 'order');
  const order = orderAttr !== null ? Number(orderAttr) : null;

  if (!type) {
    warnings.push({
      code: 'action_missing_type',
      message: 'Action is missing a type attribute',
      path,
    });
  } else if (!KNOWN_ACTION_TYPES.includes(type)) {
    warnings.push({
      code: 'unknown_action_type',
      message: `Unrecognized action type "${type}" - not mapped, needs review`,
      path,
    });
  }

  const successCodesText = textOf(action.SuccessCodes);
  const successCodes = successCodesText
    ? successCodesText.split(',').map((s) => s.trim()).filter(Boolean).map(Number)
    : [];

  const fields = {
    path: textOf(action.Path),
    arguments: textOf(action.Arguments),
    workingDirectory: textOf(action.WorkingDirectory),
    scriptType: textOf(action.ScriptType),
    scriptBody: textOf(action.ScriptBody),
    sourcePath: textOf(action.SourcePath),
    destinationPath: textOf(action.DestinationPath),
  };

  if (type === 'InstallMsi' && !fields.path) {
    warnings.push({ code: 'action_missing_expected_field', message: 'InstallMsi action has no <Path>', path });
  }
  if (type === 'RunScript' && !fields.scriptBody) {
    warnings.push({ code: 'action_missing_expected_field', message: 'RunScript action has no <ScriptBody>', path });
  }
  if (type === 'LaunchExecutable' && !fields.path) {
    warnings.push({ code: 'action_missing_expected_field', message: 'LaunchExecutable action has no <Path>', path });
  }
  if (type === 'InstallFiles' && (!fields.sourcePath || !fields.destinationPath)) {
    warnings.push({
      code: 'action_missing_expected_field',
      message: 'InstallFiles action is missing <SourcePath> or <DestinationPath>',
      path,
    });
  }

  return { type, order, successCodes, fields, path };
}
