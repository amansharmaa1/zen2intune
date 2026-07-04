// NOTE: this deliberately imports the LEGACY_* (fictitious, pre-2026-07-04)
// vocabulary constants, not the real ones src/parser/parseBundle.js now uses -
// this module was not updated in the real-bundle reconciliation and still
// targets the original invented Phase 1 shape. See NEEDS_REVIEW.md
// ("Phase 1 - XML parser" item 0) and the comment above the LEGACY_* exports
// in knownTypes.js.
import {
  LEGACY_KNOWN_ACTION_TYPES as KNOWN_ACTION_TYPES,
  LEGACY_KNOWN_REQUIREMENT_FILTER_TYPES as KNOWN_REQUIREMENT_FILTER_TYPES,
  LEGACY_KNOWN_DEPENDENCY_TYPES as KNOWN_DEPENDENCY_TYPES,
  LEGACY_KNOWN_ACTION_SET_TYPES as KNOWN_ACTION_SET_TYPES,
} from '../parser/knownTypes.js';
import { BUNDLE_SCHEMA_VERSION } from './bundleSchema.js';

// Fields that must be present for a *recognized* action kind to be considered
// complete. Unrecognized kinds are never marked complete - completeness of an
// action type we don't understand isn't ours to guess at (see CLAUDE.md).
const REQUIRED_FIELDS_BY_ACTION_KIND = {
  InstallMsi: ['path'],
  RunScript: ['scriptBody'],
  LaunchExecutable: ['path'],
  InstallFiles: ['sourcePath', 'destinationPath'],
};

function isActionComplete(kind, fields) {
  const required = REQUIRED_FIELDS_BY_ACTION_KIND[kind];
  if (!required) return false;
  return required.every((fieldName) => Boolean(fields[fieldName]));
}

/**
 * Maps Phase 1's raw parser output into the canonical structured JSON shape
 * defined in bundleSchema.js. Purely mechanical restructuring plus recognized/
 * complete flagging against the same known-type vocabulary the parser uses -
 * no inference, no AI, nothing that isn't directly derivable from the input.
 */
export function normalizeBundle(rawParsed) {
  const { bundle, requirements, dependencies, actionSets, warnings } = rawParsed;

  const conditions = requirements.map((requirement) => ({
    kind: requirement.type,
    operator: requirement.operator,
    value: requirement.value,
    recognized: requirement.type !== null && KNOWN_REQUIREMENT_FILTER_TYPES.includes(requirement.type),
    sourcePath: requirement.path,
  }));

  const normalizedDependencies = dependencies.map((dependency) => ({
    kind: dependency.type,
    name: dependency.name,
    guid: dependency.guid,
    required: dependency.required,
    recognized: dependency.type !== null && KNOWN_DEPENDENCY_TYPES.includes(dependency.type),
    sourcePath: dependency.path,
  }));

  const normalizedActionSets = actionSets.map((actionSet) => ({
    stage: actionSet.type,
    recognized: actionSet.type !== null && KNOWN_ACTION_SET_TYPES.includes(actionSet.type),
    sourcePath: actionSet.path,
    actions: actionSet.actions.map((action) => {
      const recognized = action.type !== null && KNOWN_ACTION_TYPES.includes(action.type);
      return {
        kind: action.type,
        order: action.order,
        successCodes: action.successCodes,
        fields: action.fields,
        recognized,
        complete: recognized && isActionComplete(action.type, action.fields),
        sourcePath: action.path,
      };
    }),
  }));

  const needsReview = warnings.map((warning) => ({
    code: warning.code,
    message: warning.message,
    path: warning.path,
    severity: 'warning',
  }));

  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    bundle,
    conditions,
    dependencies: normalizedDependencies,
    actionSets: normalizedActionSets,
    needsReview,
  };
}
