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

test('normalizes a well-formed bundle into schema-valid structured JSON', () => {
  const raw = parseBundleXml(fixture('sample-bundle-basic.xml'));
  const structured = normalizeBundle(raw);

  const { valid, errors } = validateStructuredBundle(structured);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);

  assert.equal(structured.schemaVersion, BUNDLE_SCHEMA_VERSION);
  assert.equal(structured.bundle.name, 'Sample Application 1.0');

  assert.equal(structured.conditions.length, 3);
  assert.ok(structured.conditions.every((c) => c.recognized === true));

  assert.equal(structured.dependencies.length, 1);
  assert.equal(structured.dependencies[0].recognized, true);

  const installSet = structured.actionSets.find((s) => s.stage === 'Install');
  assert.ok(installSet.recognized);
  assert.ok(installSet.actions.every((a) => a.recognized && a.complete));

  // A fully well-formed, fully recognized bundle should have nothing to review.
  assert.deepEqual(structured.needsReview, []);
});

test('flags unrecognized conditions/dependencies/actions as not-recognized, and surfaces needsReview, while remaining schema-valid', () => {
  const raw = parseBundleXml(fixture('sample-bundle-unknown-constructs.xml'));
  const structured = normalizeBundle(raw);

  const { valid, errors } = validateStructuredBundle(structured);
  assert.deepEqual(errors, []);
  assert.equal(valid, true);

  assert.equal(structured.conditions[0].kind, 'CustomZenAppFingerprint');
  assert.equal(structured.conditions[0].recognized, false);

  assert.equal(structured.dependencies[0].name, null);
  assert.equal(structured.dependencies[0].recognized, true); // type "Bundle" is known; only name is missing

  const action = structured.actionSets[0].actions[0];
  assert.equal(action.kind, 'RegistrySweep');
  assert.equal(action.recognized, false);
  assert.equal(action.complete, false); // unrecognized kinds are never marked complete

  assert.ok(structured.needsReview.length > 0);
  assert.ok(structured.needsReview.some((item) => item.code === 'unknown_action_type'));
});

test('marks a known action kind incomplete when a required field is missing', () => {
  // Deterministic, hand-built raw input (bypassing the XML layer) to isolate
  // normalize()'s completeness logic from the parser.
  const raw = {
    bundle: { name: 'X', guid: 'g', type: 'Install', version: null },
    requirements: [],
    dependencies: [],
    actionSets: [
      {
        type: 'Install',
        path: '/Bundle/ActionSets/ActionSet[0]',
        actions: [
          {
            type: 'InstallMsi',
            order: 1,
            successCodes: [0],
            fields: { path: null, arguments: null, workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
            path: '/Bundle/ActionSets/ActionSet[0]/Action[0]',
          },
        ],
      },
    ],
    warnings: [],
  };

  const structured = normalizeBundle(raw);
  const action = structured.actionSets[0].actions[0];
  assert.equal(action.recognized, true);
  assert.equal(action.complete, false);
});

test('validator rejects structurally invalid data with a descriptive error', () => {
  const badData = {
    schemaVersion: '1.0.0',
    bundle: { name: 'X', type: 'Install', version: null }, // missing required "guid"
    conditions: [],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { valid, errors } = validateStructuredBundle(badData);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('guid')));
});

test('validator generic helper reports type mismatches with a path', () => {
  const schema = { type: 'object', required: ['count'], properties: { count: { type: 'number' } } };
  const errors = validateAgainstSchema(schema, { count: 'not-a-number' });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /\$\.count/);
});
