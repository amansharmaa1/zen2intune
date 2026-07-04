import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseBundleXml } from '../src/parser/parseBundle.js';
import { BundleParseError } from '../src/parser/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('parses a well-formed bundle into metadata, requirements, dependencies, and action sets', () => {
  const xml = fixture('sample-bundle-basic.xml');
  const result = parseBundleXml(xml);

  assert.equal(result.bundle.name, 'Sample Application 1.0');
  assert.equal(result.bundle.guid, 'b1a2c3d4-1111-2222-3333-444455556666');
  assert.equal(result.bundle.type, 'Install');
  assert.equal(result.bundle.version, '1.0.0');

  assert.equal(result.requirements.length, 3);
  assert.deepEqual(
    result.requirements.map((r) => r.type),
    ['OperatingSystem', 'Architecture', 'FileExists'],
  );

  assert.equal(result.dependencies.length, 1);
  assert.equal(result.dependencies[0].name, 'Prerequisite Runtime');
  assert.equal(result.dependencies[0].required, true);

  assert.equal(result.actionSets.length, 2);
  const installSet = result.actionSets.find((s) => s.type === 'Install');
  assert.equal(installSet.actions.length, 2);

  const msiAction = installSet.actions[0];
  assert.equal(msiAction.type, 'InstallMsi');
  assert.equal(msiAction.order, 1);
  assert.deepEqual(msiAction.successCodes, [0, 3010]);
  assert.equal(msiAction.fields.path, '%ZENCACHE%\\SampleApp\\SampleApp.msi');

  const scriptAction = installSet.actions[1];
  assert.equal(scriptAction.type, 'RunScript');
  assert.equal(scriptAction.fields.scriptBody, 'echo post-install step');

  // Well-formed, fully recognized bundle should produce no warnings.
  assert.deepEqual(result.warnings, []);
});

test('throws BundleParseError on malformed XML instead of guessing', () => {
  const xml = fixture('sample-bundle-malformed.xml');
  assert.throws(() => parseBundleXml(xml), BundleParseError);
});

test('throws BundleParseError when required bundle metadata is missing', () => {
  const xml = fixture('sample-bundle-missing-metadata.xml');
  assert.throws(
    () => parseBundleXml(xml),
    (err) => {
      assert.ok(err instanceof BundleParseError);
      assert.match(err.message, /Guid/);
      return true;
    },
  );
});

test('flags unrecognized action/filter types and missing names as warnings, never guesses', () => {
  const xml = fixture('sample-bundle-unknown-constructs.xml');
  const result = parseBundleXml(xml);

  const codes = result.warnings.map((w) => w.code);
  assert.ok(codes.includes('unknown_requirement_type'));
  assert.ok(codes.includes('unknown_action_type'));
  assert.ok(codes.includes('dependency_missing_name'));

  // The unknown action type is preserved verbatim, not reinterpreted.
  const action = result.actionSets[0].actions[0];
  assert.equal(action.type, 'RegistrySweep');
});

test('rejects non-string/empty input', () => {
  assert.throws(() => parseBundleXml(''), BundleParseError);
  assert.throws(() => parseBundleXml(null), BundleParseError);
});
