import { validateAgainstSchema } from './jsonSchemaValidator.js';

export const BUNDLE_SCHEMA_VERSION = '1.0.0';

// Canonical intermediate JSON representation of a parsed bundle - the contract
// between the deterministic parser (src/parser/) and everything downstream
// (Intune conversion in src/intune/, AI interpretation in src/ai/).
//
// Naming note: the XML/parser layer uses ZENworks-flavored terms ("Requirements"
// / "Filter"). This canonical schema renames that concept to "conditions" to
// match the vocabulary used in CLAUDE.md's project description ("install
// actions, scripts, conditions, dependencies"). "Scripts" are not a separate
// top-level array here - a script is just an action whose `kind` is
// "RunScript", living inside `actionSets[].actions`, same as any other action.
export const structuredBundleSchema = {
  type: 'object',
  required: ['schemaVersion', 'bundle', 'conditions', 'dependencies', 'actionSets', 'needsReview'],
  properties: {
    schemaVersion: { type: 'string' },
    bundle: {
      type: 'object',
      required: ['name', 'guid', 'type', 'version'],
      properties: {
        name: { type: 'string' },
        guid: { type: 'string' },
        type: { type: 'string' },
        version: { type: ['string', 'null'] },
      },
    },
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'operator', 'value', 'recognized', 'sourcePath'],
        properties: {
          kind: { type: ['string', 'null'] },
          operator: { type: ['string', 'null'] },
          value: { type: ['string', 'null'] },
          recognized: { type: 'boolean' },
          sourcePath: { type: 'string' },
        },
      },
    },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'name', 'guid', 'required', 'recognized', 'sourcePath'],
        properties: {
          kind: { type: ['string', 'null'] },
          name: { type: ['string', 'null'] },
          guid: { type: ['string', 'null'] },
          required: { type: 'boolean' },
          recognized: { type: 'boolean' },
          sourcePath: { type: 'string' },
        },
      },
    },
    actionSets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['stage', 'recognized', 'actions', 'sourcePath'],
        properties: {
          stage: { type: ['string', 'null'] },
          recognized: { type: 'boolean' },
          sourcePath: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              required: ['kind', 'order', 'successCodes', 'fields', 'recognized', 'complete', 'sourcePath'],
              properties: {
                kind: { type: ['string', 'null'] },
                order: { type: ['number', 'null'] },
                successCodes: { type: 'array', items: { type: 'number' } },
                fields: { type: 'object' },
                recognized: { type: 'boolean' },
                complete: { type: 'boolean' },
                sourcePath: { type: 'string' },
              },
            },
          },
        },
      },
    },
    needsReview: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'message', 'path', 'severity'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          path: { type: 'string' },
          severity: { type: 'string', enum: ['warning', 'error'] },
        },
      },
    },
  },
};

export function validateStructuredBundle(data) {
  const errors = validateAgainstSchema(structuredBundleSchema, data);
  return { valid: errors.length === 0, errors };
}
