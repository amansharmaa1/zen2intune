import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseBundleXml } from '../src/parser/parseBundle.js';
import { normalizeBundle } from '../src/schema/normalize.js';
import { validateStructuredBundle, BUNDLE_SCHEMA_VERSION } from '../src/schema/bundleSchema.js';
import { validateAgainstSchema } from '../src/schema/jsonSchemaValidator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function structuredFromFixture(name) {
  return normalizeBundle(parseBundleXml(fixture(name)));
}

test('normalizes a well-formed, real-shaped bundle into schema-valid structured JSON', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');

  const { valid, errors } = validateStructuredBundle(structured);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);

  assert.equal(structured.schemaVersion, BUNDLE_SCHEMA_VERSION);
  assert.equal(structured.bundle.uid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(structured.bundle.name, 'Sample MSI App - Install');

  assert.equal(structured.conditions.length, 3);
  assert.ok(structured.conditions.every((c) => c.recognized === true));
  assert.deepEqual(
    structured.conditions.map((c) => c.reqType),
    ['RegKeyExistsReq', 'FileExistsReq', 'IPSegmentReq'],
  );
  // groupPath ancestry survives normalization unchanged.
  assert.deepEqual(structured.conditions[2].groupPath, [
    { conjunction: 'OR', index: 1 },
    { conjunction: 'AND', index: 0 },
  ]);

  assert.deepEqual(structured.dependencies, []);

  assert.equal(structured.actionSets.length, 6);
  const installSet = structured.actionSets.find((s) => s.stage === 'Install');
  assert.ok(installSet.recognized);
  const msiAction = installSet.actions.find((a) => a.kind === 'Install MSI Action');
  assert.ok(msiAction.recognized);
  assert.ok(msiAction.complete);
  assert.equal(msiAction.fields.fileName, 'ExampleApp-1.0.0-x64.msi');

  const undoInstallAction = structured.actionSets.find((s) => s.stage === 'Uninstall').actions[0];
  assert.equal(undoInstallAction.kind, 'Undo Install');
  assert.equal(undoInstallAction.recognized, true);
  // Recognized action kinds with no completeness criteria (nothing deeply
  // parsed for them) are vacuously complete - see normalize.js.
  assert.equal(undoInstallAction.complete, true);

  // Fully well-formed, fully recognized real-shaped bundle: nothing flagged.
  assert.deepEqual(structured.needsReview, []);
});

test('flags unrecognized requirement/action-set/action types as not-recognized, and surfaces needsReview, while remaining schema-valid', () => {
  const structured = structuredFromFixture('sample-bundle-unknown-constructs.xml');

  const { valid, errors } = validateStructuredBundle(structured);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);

  assert.equal(structured.conditions[0].reqType, 'RegistryValueVersionReq');
  assert.equal(structured.conditions[0].recognized, false);

  const actionSet = structured.actionSets[0];
  assert.equal(actionSet.stage, 'PreInstall');
  assert.equal(actionSet.recognized, false);

  const action = actionSet.actions[0];
  assert.equal(action.kind, 'Custom Legacy Action');
  assert.equal(action.recognized, false);
  assert.equal(action.complete, false); // unrecognized kinds are never marked complete

  const codes = structured.needsReview.map((item) => item.code);
  assert.ok(codes.includes('unknown_requirement_type'));
  assert.ok(codes.includes('unknown_action_set_type'));
  assert.ok(codes.includes('unknown_action_type'));
});

test('marks a known action kind incomplete when its required field is missing', () => {
  // Hand-built, real-vocabulary raw input (bypassing the XML layer) to
  // isolate normalize()'s completeness logic from the parser.
  const raw = {
    bundle: {
      uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null,
      description: null, primaryType: null, subType: null, category: null, version: null,
      displayName: null, creationDate: null,
    },
    requirements: [],
    dependencies: [],
    actionSets: [
      {
        id: 'set-0',
        type: 'Install',
        version: '1',
        modified: false,
        path: '/Bundle/ActionSets[0]',
        actions: [
          {
            id: 'action-0',
            name: 'Install MSI',
            type: 'Install MSI Action',
            enabled: true,
            continueOnFailure: false,
            linkedObjectIds: null,
            fields: { fileName: 'App.msi', installCmdLine: null, repairCmdLine: null, uninstallCmdLine: null, properties: [] },
            path: '/Bundle/ActionSets[0]/Actions[0]',
          },
        ],
      },
    ],
    warnings: [],
  };

  const structured = normalizeBundle(raw);
  const action = structured.actionSets[0].actions[0];
  assert.equal(action.recognized, true);
  assert.equal(action.complete, false); // installCmdLine is missing
});

test('validator rejects structurally invalid data with a descriptive error', () => {
  const badData = {
    schemaVersion: '2.0.0',
    bundle: { name: 'X' }, // missing required "uid" and other bundle fields
    conditions: [],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { valid, errors } = validateStructuredBundle(badData);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('uid')));
});

test('validator generic helper reports type mismatches with a path', () => {
  const schema = { type: 'object', required: ['count'], properties: { count: { type: 'number' } } };
  const errors = validateAgainstSchema(schema, { count: 'not-a-number' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /\$\.count/);
});
