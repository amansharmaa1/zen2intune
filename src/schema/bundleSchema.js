import { validateAgainstSchema } from './jsonSchemaValidator.js';

// Bumped from 1.0.0: this schema was rewritten on 2026-07-04 to match real
// ZENworks bundle export structure (see NEEDS_REVIEW.md, "Phase 1 - XML
// parser" item 0) instead of an earlier invented approximation - the shape
// below is not backward compatible with anything built against 1.0.0.
export const BUNDLE_SCHEMA_VERSION = '2.0.0';

// Canonical intermediate JSON representation of a parsed bundle - the contract
// between the deterministic parser (src/parser/) and everything downstream
// (Intune conversion in src/intune/, AI interpretation in src/ai/).
//
// Field names here intentionally mirror the real ZENworks export vocabulary
// (UID, reqType, groupPath, etc.) rather than a renamed/invented one - see
// src/parser/parseBundle.js and NEEDS_REVIEW.md for what was actually
// observed in real bundle exports.
export const structuredBundleSchema = {
  type: 'object',
  required: ['schemaVersion', 'bundle', 'conditions', 'dependencies', 'actionSets', 'needsReview'],
  properties: {
    schemaVersion: { type: 'string' },
    bundle: {
      type: 'object',
      required: [
        'uid', 'name', 'internalName', 'parentUid', 'path', 'adminId', 'description',
        'primaryType', 'subType', 'category', 'version', 'displayName', 'creationDate',
      ],
      properties: {
        uid: { type: 'string' },
        name: { type: 'string' },
        internalName: { type: ['string', 'null'] },
        parentUid: { type: ['string', 'null'] },
        path: { type: ['string', 'null'] },
        adminId: { type: ['string', 'null'] },
        description: { type: ['string', 'null'] },
        primaryType: { type: ['string', 'null'] },
        subType: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
        // ZENworks' own edit/revision counter - NOT a software version string.
        version: { type: ['string', 'null'] },
        displayName: { type: ['string', 'null'] },
        creationDate: { type: ['string', 'null'] },
      },
    },
    // Flattened leaves of the real recursive AND/OR requirement tree (SysReqs).
    // `groupPath` preserves each leaf's full ancestry of {conjunction, index}
    // steps so the tree structure isn't discarded by flattening - see
    // src/parser/parseBundle.js's walkReqNode.
    conditions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reqType', 'recognized', 'assertedValue', 'target', 'groupPath', 'sourcePath'],
        properties: {
          reqType: { type: ['string', 'null'] },
          recognized: { type: 'boolean' },
          assertedValue: { type: ['boolean', 'null'] },
          target: { type: ['string', 'null'] },
          groupPath: {
            type: 'array',
            items: {
              type: 'object',
              required: ['conjunction', 'index'],
              properties: {
                conjunction: { type: ['string', 'null'] },
                index: { type: 'number' },
              },
            },
          },
          sourcePath: { type: 'string' },
        },
      },
    },
    // Always empty today - no real bundle-to-bundle dependency reference
    // construct was found in either reconciled sample. No `items` shape is
    // asserted since nothing real has been observed to shape it against -
    // see NEEDS_REVIEW.md.
    dependencies: {
      type: 'array',
    },
    actionSets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'stage', 'recognized', 'version', 'modified', 'actions', 'sourcePath'],
        properties: {
          id: { type: ['string', 'null'] },
          stage: { type: ['string', 'null'] },
          recognized: { type: 'boolean' },
          version: { type: ['string', 'null'] },
          modified: { type: ['boolean', 'null'] },
          sourcePath: { type: 'string' },
          actions: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'id', 'name', 'kind', 'recognized', 'complete', 'enabled',
                'continueOnFailure', 'linkedObjectIds', 'fields', 'sourcePath',
              ],
              properties: {
                id: { type: ['string', 'null'] },
                name: { type: ['string', 'null'] },
                kind: { type: ['string', 'null'] },
                recognized: { type: 'boolean' },
                complete: { type: 'boolean' },
                enabled: { type: ['boolean', 'null'] },
                continueOnFailure: { type: ['boolean', 'null'] },
                linkedObjectIds: { type: ['string', 'null'] },
                fields: { type: 'object' },
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
