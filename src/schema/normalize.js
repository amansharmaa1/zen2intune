import {
  KNOWN_ACTION_TYPES,
  KNOWN_REQUIREMENT_LEAF_TYPES,
  KNOWN_ACTION_SET_TYPES,
} from '../parser/knownTypes.js';
import { BUNDLE_SCHEMA_VERSION } from './bundleSchema.js';

// Fields that must be present for a *recognized* action kind to be considered
// complete. Only the two action kinds this project deeply extracts fields for
// have an entry - see src/parser/parseBundle.js. A recognized kind with no
// entry here (e.g. "Verify Install", "Undo Install", "Terminate Action" -
// real ZENworks action types this project doesn't deeply parse Data for) is
// treated as complete: there's nothing we check for it, so nothing is known
// to be missing. This is different from an *unrecognized* kind, which is
// always incomplete (see below) - completeness of a construct we don't
// understand at all isn't derivable.
const REQUIRED_FIELDS_BY_ACTION_KIND = {
  'Install MSI Action': ['installCmdLine'],
  'Run Script Action': ['scriptBody'],
};

function isActionComplete(kind, fields) {
  const required = REQUIRED_FIELDS_BY_ACTION_KIND[kind];
  if (!required) return true;
  return required.every((fieldName) => Boolean(fields[fieldName]));
}

/**
 * Maps Phase 1's raw parser output (real ZENworks bundle shape - see
 * NEEDS_REVIEW.md "Phase 1 - XML parser" item 0) into the canonical structured
 * JSON shape defined in bundleSchema.js. Purely mechanical restructuring plus
 * recognized/complete flagging against the same known-type vocabulary the
 * parser uses - no inference, no AI, nothing that isn't directly derivable
 * from the input.
 */
export function normalizeBundle(rawParsed) {
  const { bundle, requirements, dependencies, actionSets, warnings } = rawParsed;

  const conditions = requirements.map((requirement) => ({
    reqType: requirement.reqType,
    recognized: requirement.reqType !== null && KNOWN_REQUIREMENT_LEAF_TYPES.includes(requirement.reqType),
    assertedValue: requirement.assertedValue,
    target: requirement.target,
    groupPath: requirement.groupPath,
    sourcePath: requirement.path,
  }));

  // Always empty today - no real bundle-to-bundle dependency reference
  // construct has been observed (see NEEDS_REVIEW.md), so there's no known
  // shape to map. Passed through unchanged rather than transformed.
  const normalizedDependencies = dependencies;

  const normalizedActionSets = actionSets.map((actionSet) => ({
    id: actionSet.id,
    stage: actionSet.type,
    recognized: actionSet.type !== null && KNOWN_ACTION_SET_TYPES.includes(actionSet.type),
    version: actionSet.version,
    modified: actionSet.modified,
    sourcePath: actionSet.path,
    actions: actionSet.actions.map((action) => {
      const recognized = action.type !== null && KNOWN_ACTION_TYPES.includes(action.type);
      return {
        id: action.id,
        name: action.name,
        kind: action.type,
        recognized,
        complete: recognized && isActionComplete(action.type, action.fields),
        enabled: action.enabled,
        continueOnFailure: action.continueOnFailure,
        linkedObjectIds: action.linkedObjectIds,
        fields: action.fields,
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
