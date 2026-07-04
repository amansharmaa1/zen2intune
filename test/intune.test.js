import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseBundleXml } from '../src/parser/parseBundle.js';
import { normalizeBundle } from '../src/schema/normalize.js';
import { convertToIntunePackage } from '../src/intune/convertBundle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

function structuredFromFixture(name) {
  return normalizeBundle(parseBundleXml(fixture(name)));
}

function codesOf(needsReview) {
  return needsReview.map((r) => r.code);
}

test('converts a well-formed bundle: derives what it can, flags the rest', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app, needsReview } = convertToIntunePackage(structured);

  assert.equal(app['@odata.type'], '#microsoft.graph.win32LobApp');
  assert.equal(app.displayName, 'Sample Application 1.0');

  // Exactly one command-line-capable action per stage -> deterministic derivation.
  assert.equal(app.installCommandLine, 'msiexec /i "%ZENCACHE%\\SampleApp\\SampleApp.msi" /qn REBOOT=ReallySuppress');
  assert.equal(app.uninstallCommandLine, 'msiexec /x "%ZENCACHE%\\SampleApp\\SampleApp.msi" /x /qn');

  // Architecture condition value "x64" matches the verified windowsArchitecture enum.
  assert.equal(app.applicableArchitectures, 'x64');

  // 0 stays "success"; 3010 is the well-known MSI reboot-required code.
  assert.deepEqual(app.returnCodes, [
    { '@odata.type': '#microsoft.graph.win32LobAppReturnCode', returnCode: 0, type: 'success' },
    { '@odata.type': '#microsoft.graph.win32LobAppReturnCode', returnCode: 3010, type: 'softReboot' },
  ]);

  // No product code / registry / script signal exists anywhere in our schema,
  // so a detection rule can never be derived - this must always be flagged.
  assert.deepEqual(app.rules, []);
  const codes = codesOf(needsReview);
  assert.ok(codes.includes('no_detection_rule_derivable'));

  // The RunScript install action can't become a command line on its own.
  assert.ok(codes.includes('action_excluded_from_conversion'));

  // The uninstall action's own Arguments ("/x /qn") duplicate the "/x" the
  // generator adds based on stage - this must be surfaced, not silently doubled.
  assert.ok(codes.includes('command_line_needs_verification'));

  // OperatingSystem condition exists but has no verified target mapping.
  assert.ok(codes.includes('os_condition_needs_manual_mapping'));

  // FileExists condition uses "notExists", which file system rules can't express.
  assert.ok(codes.includes('no_inverse_file_system_rule'));

  // The bundle has a dependency, which win32LobApp has no property for.
  assert.ok(codes.includes('dependency_not_convertible'));

  // Nothing in the schema indicates run-as/restart behavior.
  assert.ok(codes.includes('install_experience_undetermined'));
});

test('never fabricates a command line, architecture, or rule for unrecognized constructs', () => {
  const structured = structuredFromFixture('sample-bundle-unknown-constructs.xml');
  const { app, needsReview } = convertToIntunePackage(structured);

  assert.equal(app.displayName, 'Legacy Tool');
  assert.equal(app.installCommandLine, undefined);
  assert.equal(app.uninstallCommandLine, undefined);
  assert.equal(app.applicableArchitectures, undefined);
  assert.equal(app.returnCodes, undefined);
  assert.deepEqual(app.rules, []);

  const codes = codesOf(needsReview);
  assert.ok(codes.includes('action_excluded_from_conversion')); // RegistrySweep
  assert.ok(codes.includes('no_command_line_candidate')); // Install set has no usable action
  assert.ok(codes.includes('action_set_missing')); // no Uninstall set at all
  assert.ok(codes.includes('dependency_not_convertible'));
});

test('flags an unmappable architecture value instead of guessing', () => {
  const structured = {
    schemaVersion: '1.0.0',
    bundle: { name: 'Arm App', guid: 'g', type: 'Install', version: null },
    conditions: [
      { kind: 'Architecture', operator: 'equals', value: 'ARM64', recognized: true, sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.equal(app.applicableArchitectures, undefined);
  assert.ok(codesOf(needsReview).includes('architecture_not_mappable'));
});

test('builds a file-system requirement rule for an affirmative FileExists condition', () => {
  const structured = {
    schemaVersion: '1.0.0',
    bundle: { name: 'X', guid: 'g', type: 'Install', version: null },
    conditions: [
      { kind: 'FileExists', operator: 'exists', value: 'C:\\Tools\\agent.exe', recognized: true, sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.deepEqual(app.rules, [
    {
      '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
      ruleType: 'requirement',
      path: 'C:\\Tools',
      fileOrFolderName: 'agent.exe',
      operationType: 'exists',
      operator: 'notConfigured',
    },
  ]);
  assert.ok(!codesOf(needsReview).includes('no_inverse_file_system_rule'));
});

test('refuses to pick a command line when a stage has multiple candidate actions', () => {
  const structured = {
    schemaVersion: '1.0.0',
    bundle: { name: 'X', guid: 'g', type: 'Install', version: null },
    conditions: [],
    dependencies: [],
    actionSets: [
      {
        stage: 'Install',
        recognized: true,
        sourcePath: '/a',
        actions: [
          {
            kind: 'InstallMsi', order: 1, successCodes: [0], recognized: true, complete: true, sourcePath: '/a/0',
            fields: { path: 'a.msi', arguments: null, workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
          },
          {
            kind: 'InstallMsi', order: 2, successCodes: [0], recognized: true, complete: true, sourcePath: '/a/1',
            fields: { path: 'b.msi', arguments: null, workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
          },
        ],
      },
    ],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.equal(app.installCommandLine, undefined);
  assert.ok(codesOf(needsReview).includes('multiple_command_line_candidates'));
});

test('throws on a structurally invalid input instead of producing a partial guess', () => {
  assert.throws(() => convertToIntunePackage({ not: 'a structured bundle' }));
});
