import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseActionContentInfo } from '../src/parser/parseActionContentInfo.js';
import { BundleParseError } from '../src/parser/errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

test('parses a real-shaped _ActionContentInfo.xml sidecar into content entries', () => {
  const { entries, warnings } = parseActionContentInfo(fixture('sample-actioncontentinfo.xml'));

  assert.deepEqual(warnings, []);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], {
    actionSetType: 'Install',
    actionName: 'Install MSI',
    actionType: 'Install MSI Action',
    actionIndex: '1',
    contentFilePath: 'Sample MSI App - Install_content/1111111111111111111111111111111f/ExampleApp-1.0.0-x64.msi',
  });
});

test('throws BundleParseError on malformed sidecar XML', () => {
  assert.throws(() => parseActionContentInfo('<ActionInformation><unclosed>'), BundleParseError);
});

test('throws BundleParseError when the ActionInformation root is missing', () => {
  assert.throws(() => parseActionContentInfo('<SomethingElse/>'), BundleParseError);
});

test('warns instead of guessing when an action carries no content path', () => {
  const xml = `<ActionInformation>
    <ActionSet type="Install">
      <Action name="No Content" type="Install MSI Action" index="1" />
    </ActionSet>
  </ActionInformation>`;

  const { entries, warnings } = parseActionContentInfo(xml);
  assert.deepEqual(entries, []);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'content_action_has_no_path');
});

test('rejects non-string/empty input', () => {
  assert.throws(() => parseActionContentInfo(''), BundleParseError);
  assert.throws(() => parseActionContentInfo(null), BundleParseError);
});
