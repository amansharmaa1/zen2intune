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

test('parses a well-formed, real-shaped bundle into metadata, requirements, and action sets', () => {
  const xml = fixture('sample-bundle-basic.xml');
  const result = parseBundleXml(xml);

  assert.equal(result.bundle.uid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(result.bundle.name, 'Sample MSI App - Install');
  assert.equal(result.bundle.subType, 'Windows Bundle');
  assert.equal(result.bundle.category, 'msi');
  assert.equal(result.bundle.version, '5');

  // Requirements: a recursive OR-of-AND-groups tree, flattened to leaves with
  // their full group ancestry preserved (not discarded).
  assert.equal(result.requirements.length, 3);
  assert.deepEqual(
    result.requirements.map((r) => r.reqType),
    ['RegKeyExistsReq', 'FileExistsReq', 'IPSegmentReq'],
  );
  assert.deepEqual(result.requirements[0].groupPath, [
    { conjunction: 'OR', index: 0 },
    { conjunction: 'AND', index: 0 },
  ]);
  assert.deepEqual(result.requirements[2].groupPath, [
    { conjunction: 'OR', index: 1 },
    { conjunction: 'AND', index: 0 },
  ]);
  assert.equal(result.requirements[1].assertedValue, false);
  assert.equal(result.requirements[1].target, 'C:\\Program Files\\ExampleVendor\\ExampleApp\\exampleapp.exe');

  assert.deepEqual(result.dependencies, []);

  // ActionSets are flat siblings, not nested under one wrapper.
  assert.equal(result.actionSets.length, 6);
  assert.deepEqual(
    result.actionSets.map((s) => s.type),
    ['Uninstall', 'Verify', 'Launch', 'Install', 'Terminate', 'Distribution'],
  );

  const launchSet = result.actionSets.find((s) => s.type === 'Launch');
  assert.deepEqual(launchSet.actions, []); // present as an ActionSet, but carries no Actions

  const installSet = result.actionSets.find((s) => s.type === 'Install');
  assert.equal(installSet.actions.length, 1);
  const msiAction = installSet.actions[0];
  assert.equal(msiAction.type, 'Install MSI Action');
  assert.equal(msiAction.linkedObjectIds, '1111111111111111111111111111111f');
  assert.equal(msiAction.fields.fileName, 'ExampleApp-1.0.0-x64.msi');
  assert.match(msiAction.fields.installCmdLine, /^\/i "ExampleApp-1\.0\.0-x64\.msi" \/qn/);
  assert.match(msiAction.fields.uninstallCmdLine, /^\/x "ExampleApp-1\.0\.0-x64\.msi" \/qn/);
  assert.deepEqual(msiAction.fields.properties, ['ALLUSERS=1', 'REBOOT=Suppress']);

  const uninstallSet = result.actionSets.find((s) => s.type === 'Uninstall');
  assert.equal(uninstallSet.actions[0].type, 'Undo Install');
  assert.deepEqual(uninstallSet.actions[0].fields, {}); // not a deeply-parsed action type

  // Fully well-formed, fully recognized real-shaped bundle: nothing to flag.
  assert.deepEqual(result.warnings, []);
});

test('extracts Run Script Action fields from a script-based action', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns1:Bundle xmlns:ns1="http://novell.com/zenworks/datamodel/objects/bundles">
  <ns2:UID xmlns:ns2="http://novell.com/zenworks/datamodel/objects">44444444444444444444444444444444</ns2:UID>
  <ns2:Name xmlns:ns2="http://novell.com/zenworks/datamodel/objects">Script Bundle</ns2:Name>
  <ns2:ActionSets xmlns:ns2="http://novell.com/zenworks/datamodel/objects/actions">
    <Id>45555555555555555555555555555555</Id>
    <Type>Launch</Type>
    <Actions>
      <Id>46666666666666666666666666666666</Id>
      <Name>Run Script</Name>
      <Type>Run Script Action</Type>
      <Data>
        <ns3:RunScriptActionHandlerData xmlns:ns3="http://www.novell.com/ZENworks/Actions">
          <Exec maxTimeToWait="0" terminateProgram="false">
            <ns4:Script xmlns:ns4="http://www.novell.com/ZENworks/Controls" extension=".ps1">Write-Output "example"</ns4:Script>
            <ns4:ProgramExecutor xmlns:ns4="http://www.novell.com/ZENworks/Controls" arguments="-ExecutionPolicy Bypass" path="%WINDIR%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" />
            <ns4:AdvancedSettings xmlns:ns4="http://www.novell.com/ZENworks/Controls">
              <Priority>AboveNormal</Priority>
              <RunAs>System</RunAs>
            </ns4:AdvancedSettings>
          </Exec>
        </ns3:RunScriptActionHandlerData>
      </Data>
      <ContinueOnFailure>false</ContinueOnFailure>
      <Enabled>true</Enabled>
      <actionUniqueId>47777777777777777777777777777777</actionUniqueId>
    </Actions>
  </ns2:ActionSets>
</ns1:Bundle>`;

  const result = parseBundleXml(xml);
  const action = result.actionSets[0].actions[0];
  assert.equal(action.type, 'Run Script Action');
  assert.equal(action.fields.scriptBody, 'Write-Output "example"');
  assert.equal(action.fields.scriptExtension, '.ps1');
  assert.equal(action.fields.executorPath, '%WINDIR%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(action.fields.executorArguments, '-ExecutionPolicy Bypass');
  assert.equal(action.fields.runAs, 'System');
  assert.deepEqual(result.warnings, []);
});

test('throws BundleParseError on malformed XML instead of guessing', () => {
  const xml = fixture('sample-bundle-malformed.xml');
  assert.throws(() => parseBundleXml(xml), BundleParseError);
});

test('throws BundleParseError when required bundle identity is missing', () => {
  const xml = fixture('sample-bundle-missing-metadata.xml');
  assert.throws(
    () => parseBundleXml(xml),
    (err) => {
      assert.ok(err instanceof BundleParseError);
      assert.match(err.message, /UID/);
      return true;
    },
  );
});

test('flags unrecognized requirement/action-set/action types as warnings, never guesses', () => {
  const xml = fixture('sample-bundle-unknown-constructs.xml');
  const result = parseBundleXml(xml);

  const codes = result.warnings.map((w) => w.code);
  assert.ok(codes.includes('unknown_requirement_type'));
  assert.ok(codes.includes('unknown_action_set_type'));
  assert.ok(codes.includes('unknown_action_type'));

  // Unknown types are preserved verbatim, not reinterpreted.
  assert.equal(result.requirements[0].reqType, 'RegistryValueVersionReq');
  assert.equal(result.actionSets[0].type, 'PreInstall');
  assert.equal(result.actionSets[0].actions[0].type, 'Custom Legacy Action');
});

test('rejects non-string/empty input', () => {
  assert.throws(() => parseBundleXml(''), BundleParseError);
  assert.throws(() => parseBundleXml(null), BundleParseError);
});
