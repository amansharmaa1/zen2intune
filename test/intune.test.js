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

test('converts a well-formed, real-shaped bundle: derives ready-made MSI command lines, flags the rest', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app, needsReview } = convertToIntunePackage(structured);

  assert.equal(app['@odata.type'], '#microsoft.graph.win32LobApp');
  assert.equal(app.displayName, 'Sample MSI App - Install');

  // Both install and uninstall command lines come from the SAME MSI action in
  // the Install ActionSet (msiexec prepended to the ready-made CmdLine
  // fragment) - the real Uninstall ActionSet's own action carries no data.
  assert.equal(
    app.installCommandLine,
    'msiexec /i "ExampleApp-1.0.0-x64.msi" /qn EXAMPLE_GROUP="Example Group" EXAMPLE_SERVER="example.invalid:443"',
  );
  assert.equal(app.uninstallCommandLine, 'msiexec /x "ExampleApp-1.0.0-x64.msi" /qn');

  const codes = codesOf(needsReview);

  // This fixture's requirement tree OR's together two alternative top-level
  // groups - no automatic rule conversion is attempted for any condition.
  assert.deepEqual(app.rules, []);
  assert.ok(codes.includes('requirement_tree_has_alternatives'));
  assert.ok(!codes.includes('no_inverse_file_system_rule'));
  assert.ok(!codes.includes('no_network_requirement_rule'));

  // Permanent, always-present gaps given current real-data field extraction.
  assert.ok(codes.includes('no_detection_rule_derivable'));
  assert.ok(codes.includes('architecture_signal_unavailable'));
  assert.ok(codes.includes('os_signal_unavailable'));
  assert.ok(codes.includes('no_return_codes_derivable'));
  assert.ok(codes.includes('install_experience_undetermined'));

  // Both ActionSets are present and the Install ActionSet has exactly one
  // usable action, so none of the "missing" signals should fire.
  assert.ok(!codes.includes('action_set_missing'));
  assert.ok(!codes.includes('uninstall_action_set_missing'));
  assert.ok(!codes.includes('no_command_line_candidate'));
  assert.ok(!codes.includes('dependency_not_convertible'));
});

test('never fabricates a command line or rule for unrecognized real-shaped constructs', () => {
  const structured = structuredFromFixture('sample-bundle-unknown-constructs.xml');
  const { app, needsReview } = convertToIntunePackage(structured);

  assert.equal(app.displayName, 'Legacy Tool');
  assert.equal(app.installCommandLine, undefined);
  assert.equal(app.uninstallCommandLine, undefined);
  assert.deepEqual(app.rules, []);

  const codes = codesOf(needsReview);
  assert.ok(codes.includes('action_set_missing')); // no "Install" ActionSet in this fixture at all
  assert.ok(codes.includes('uninstall_action_set_missing')); // nor "Uninstall"
  assert.ok(codes.includes('action_set_excluded_from_conversion')); // "PreInstall" is unrecognized
  assert.ok(codes.includes('condition_excluded_from_conversion')); // "RegistryValueVersionReq" is unrecognized
  assert.ok(!codes.includes('requirement_tree_has_alternatives')); // only one (unrecognized) condition - no ambiguity to flag
});

test('builds a registry requirement rule for a RegKeyExistsReq condition (verified: empty valueName checks key existence)', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [
      { reqType: 'RegKeyExistsReq', recognized: true, assertedValue: true, target: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\ExampleVendor\\Policy', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.deepEqual(app.rules, [
    {
      '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
      ruleType: 'requirement',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\ExampleVendor\\Policy',
      valueName: '',
      operationType: 'exists',
      operator: 'notConfigured',
    },
  ]);
  assert.ok(!codesOf(needsReview).includes('condition_value_undetermined'));
});

test('builds a doesNotExist registry rule when the condition asserts the key must be absent', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [
      { reqType: 'RegKeyExistsReq', recognized: true, assertedValue: false, target: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\ExampleVendor\\Uninstalled', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app } = convertToIntunePackage(structured);
  assert.equal(app.rules[0].operationType, 'doesNotExist');
});

test('builds a file-system requirement rule for an affirmative FileExistsReq condition, but flags the inverse case', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [
      { reqType: 'FileExistsReq', recognized: true, assertedValue: true, target: 'C:\\Tools\\agent.exe', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x0' },
      { reqType: 'FileExistsReq', recognized: true, assertedValue: false, target: 'C:\\Tools\\uninstalled.exe', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x1' },
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
  assert.ok(codesOf(needsReview).includes('no_inverse_file_system_rule'));
});

test('flags IPSegmentReq as unconvertible - no Intune requirement rule type covers network conditions', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [
      { reqType: 'IPSegmentReq', recognized: true, assertedValue: true, target: '203.0.113.0/24', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.deepEqual(app.rules, []);
  assert.ok(codesOf(needsReview).includes('no_network_requirement_rule'));
});

test('flags a condition with no boolean Value instead of guessing exists vs. doesNotExist', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [
      { reqType: 'RegKeyExistsReq', recognized: true, assertedValue: null, target: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\X', groupPath: [{ conjunction: 'AND', index: 0 }], sourcePath: '/x' },
    ],
    dependencies: [],
    actionSets: [],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.deepEqual(app.rules, []);
  assert.ok(codesOf(needsReview).includes('condition_value_undetermined'));
});

test('refuses to pick a command line when the Install ActionSet has multiple MSI candidate actions', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [],
    dependencies: [],
    actionSets: [
      {
        id: 'set-0',
        stage: 'Install',
        recognized: true,
        version: '1',
        modified: false,
        sourcePath: '/a',
        actions: [
          {
            id: 'a0', name: null, kind: 'Install MSI Action', recognized: true, complete: true,
            enabled: true, continueOnFailure: false, linkedObjectIds: null,
            fields: { fileName: 'a.msi', installCmdLine: '/i "a.msi" /qn', repairCmdLine: null, uninstallCmdLine: '/x "a.msi" /qn', properties: [] },
            sourcePath: '/a/0',
          },
          {
            id: 'a1', name: null, kind: 'Install MSI Action', recognized: true, complete: true,
            enabled: true, continueOnFailure: false, linkedObjectIds: null,
            fields: { fileName: 'b.msi', installCmdLine: '/i "b.msi" /qn', repairCmdLine: null, uninstallCmdLine: '/x "b.msi" /qn', properties: [] },
            sourcePath: '/a/1',
          },
        ],
      },
    ],
    needsReview: [],
  };

  const { app, needsReview } = convertToIntunePackage(structured);
  assert.equal(app.installCommandLine, undefined);
  assert.equal(app.uninstallCommandLine, undefined);
  assert.ok(codesOf(needsReview).includes('multiple_command_line_candidates'));
});

test('flags a dependency as unconvertible if the structured bundle ever carries one', () => {
  const structured = {
    schemaVersion: '2.0.0',
    bundle: { uid: 'x', name: 'X', internalName: null, parentUid: null, path: null, adminId: null, description: null, primaryType: null, subType: null, category: null, version: null, displayName: null, creationDate: null },
    conditions: [],
    dependencies: [{ note: 'shape not yet verified against real data - see NEEDS_REVIEW.md' }],
    actionSets: [],
    needsReview: [],
  };

  const { needsReview } = convertToIntunePackage(structured);
  assert.ok(codesOf(needsReview).includes('dependency_not_convertible'));
});

test('throws on a structurally invalid input instead of producing a partial guess', () => {
  assert.throws(() => convertToIntunePackage({ not: 'a structured bundle' }));
});

// --- MSI-derived detection rule / msiInformation (options.msiProductInfo) ---

const fakeMsiProductInfo = Object.freeze({
  productCode: '{11111111-2222-3333-4444-555555555555}',
  productVersion: '1.0.0',
  productName: 'Synthetic Test App',
  manufacturer: 'Synthetic Vendor',
  upgradeCode: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
  allUsers: '1',
});

test('emits a ProductCode detection rule, msiInformation, publisher, and fileName/setupFilePath when msiProductInfo is supplied', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app, needsReview } = convertToIntunePackage(structured, { msiProductInfo: fakeMsiProductInfo });

  const detectionRules = app.rules.filter((r) => r.ruleType === 'detection');
  assert.deepEqual(detectionRules, [
    {
      '@odata.type': '#microsoft.graph.win32LobAppProductCodeRule',
      ruleType: 'detection',
      productCode: '{11111111-2222-3333-4444-555555555555}',
      productVersionOperator: 'notConfigured',
    },
  ]);

  assert.deepEqual(app.msiInformation, {
    '@odata.type': '#microsoft.graph.win32LobAppMsiInformation',
    productCode: '{11111111-2222-3333-4444-555555555555}',
    productVersion: '1.0.0',
    upgradeCode: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
    productName: 'Synthetic Test App',
    publisher: 'Synthetic Vendor',
    packageType: 'perMachine', // ALLUSERS=1 => per-machine, per Microsoft's ALLUSERS doc
  });

  assert.equal(app.publisher, 'Synthetic Vendor');
  assert.equal(app.fileName, 'ExampleApp-1.0.0-x64.msi');
  assert.equal(app.setupFilePath, 'ExampleApp-1.0.0-x64.msi');

  const codes = codesOf(needsReview);
  assert.ok(!codes.includes('no_detection_rule_derivable'));
  assert.ok(!codes.includes('msi_package_type_undetermined'));
});

test('maps an MSI with no ALLUSERS property to perUser (documented default context)', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app } = convertToIntunePackage(structured, {
    msiProductInfo: { ...fakeMsiProductInfo, allUsers: null },
  });
  assert.equal(app.msiInformation.packageType, 'perUser');
});

test('flags ALLUSERS=2 instead of guessing a packageType', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app, needsReview } = convertToIntunePackage(structured, {
    msiProductInfo: { ...fakeMsiProductInfo, allUsers: '2' },
  });
  assert.equal(app.msiInformation.packageType, undefined);
  assert.ok(codesOf(needsReview).includes('msi_package_type_undetermined'));
});

test('omits optional msiInformation fields the MSI does not carry, rather than inventing them', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  const { app } = convertToIntunePackage(structured, {
    msiProductInfo: {
      productCode: '{11111111-2222-3333-4444-555555555555}',
      productVersion: null,
      productName: null,
      manufacturer: null,
      upgradeCode: null,
      allUsers: '1',
    },
  });
  assert.deepEqual(app.msiInformation, {
    '@odata.type': '#microsoft.graph.win32LobAppMsiInformation',
    productCode: '{11111111-2222-3333-4444-555555555555}',
    packageType: 'perMachine',
  });
  assert.equal(app.publisher, undefined);
});

test('throws when msiProductInfo carries a malformed productCode instead of emitting a broken rule', () => {
  const structured = structuredFromFixture('sample-bundle-basic.xml');
  assert.throws(() =>
    convertToIntunePackage(structured, { msiProductInfo: { ...fakeMsiProductInfo, productCode: 'not-a-guid' } }),
  );
});
