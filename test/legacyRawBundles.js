// Shared test helper - NOT a fixture file (no XML, this is hand-built JS data).
//
// These builders intentionally produce the *pre-2026-07-04* Phase 1 output
// shape (invented action/requirement vocabulary: InstallMsi, RunScript,
// OperatingSystem/Architecture/FileExists conditions, a flat Bundle-style
// dependency list). Phase 1's real parser (src/parser/parseBundle.js) was
// rewritten to match real ZENworks exports on 2026-07-04 and no longer
// produces this shape - see NEEDS_REVIEW.md ("Phase 1 - XML parser" item 0).
// src/schema/normalize.js and src/intune/convertBundle.js were NOT updated to
// match the new real shape (out of scope for that reconciliation pass), so
// schema.test.js and intune.test.js use these builders to keep exercising
// normalize.js/convertBundle.js's actual, current logic against the shape
// they still expect, instead of test/fixtures/*.xml (which are now
// real-shaped and would produce a different, currently-unhandled raw shape).

export function legacyRawBasicBundle() {
  return {
    bundle: { name: 'Sample Application 1.0', guid: 'b1a2c3d4-1111-2222-3333-444455556666', type: 'Install', version: '1.0.0' },
    requirements: [
      { type: 'OperatingSystem', operator: 'greaterOrEqual', value: 'Windows10', path: '/Bundle/Requirements/Filter[0]' },
      { type: 'Architecture', operator: 'equals', value: 'x64', path: '/Bundle/Requirements/Filter[1]' },
      { type: 'FileExists', operator: 'notExists', value: 'C:\\Program Files\\SampleApp\\app.exe', path: '/Bundle/Requirements/Filter[2]' },
    ],
    dependencies: [
      { type: 'Bundle', name: 'Prerequisite Runtime', guid: 'e5f6a7b8-0000-1111-2222-333344445555', required: true, path: '/Bundle/Dependencies/Dependency[0]' },
    ],
    actionSets: [
      {
        type: 'Install',
        path: '/Bundle/ActionSets/ActionSet[0]',
        actions: [
          {
            type: 'InstallMsi',
            order: 1,
            successCodes: [0, 3010],
            fields: { path: '%ZENCACHE%\\SampleApp\\SampleApp.msi', arguments: '/qn REBOOT=ReallySuppress', workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
            path: '/Bundle/ActionSets/ActionSet[0]/Action[0]',
          },
          {
            type: 'RunScript',
            order: 2,
            successCodes: [0],
            fields: { path: null, arguments: null, workingDirectory: null, scriptType: 'Batch', scriptBody: 'echo post-install step', sourcePath: null, destinationPath: null },
            path: '/Bundle/ActionSets/ActionSet[0]/Action[1]',
          },
        ],
      },
      {
        type: 'Uninstall',
        path: '/Bundle/ActionSets/ActionSet[1]',
        actions: [
          {
            type: 'InstallMsi',
            order: 1,
            successCodes: [0, 3010],
            fields: { path: '%ZENCACHE%\\SampleApp\\SampleApp.msi', arguments: '/x /qn', workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
            path: '/Bundle/ActionSets/ActionSet[1]/Action[0]',
          },
        ],
      },
    ],
    warnings: [],
  };
}

export function legacyRawUnknownConstructsBundle() {
  return {
    bundle: { name: 'Legacy Tool', guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', type: 'Install', version: null },
    requirements: [
      { type: 'CustomZenAppFingerprint', operator: 'equals', value: 'unknown-to-us', path: '/Bundle/Requirements/Filter[0]' },
    ],
    dependencies: [
      { type: 'Bundle', name: null, guid: 'ffffffff-0000-1111-2222-333333333333', required: false, path: '/Bundle/Dependencies/Dependency[0]' },
    ],
    actionSets: [
      {
        type: 'Install',
        path: '/Bundle/ActionSets/ActionSet[0]',
        actions: [
          {
            type: 'RegistrySweep',
            order: 1,
            successCodes: [],
            fields: { path: 'HKLM\\Software\\LegacyTool', arguments: null, workingDirectory: null, scriptType: null, scriptBody: null, sourcePath: null, destinationPath: null },
            path: '/Bundle/ActionSets/ActionSet[0]/Action[0]',
          },
        ],
      },
    ],
    warnings: [
      { code: 'unknown_requirement_type', message: 'Unrecognized requirement filter type "CustomZenAppFingerprint" - not mapped, needs review', path: '/Bundle/Requirements/Filter[0]' },
      { code: 'dependency_missing_name', message: 'Dependency is missing a name attribute', path: '/Bundle/Dependencies/Dependency[0]' },
      { code: 'unknown_action_type', message: 'Unrecognized action type "RegistrySweep" - not mapped, needs review', path: '/Bundle/ActionSets/ActionSet[0]/Action[0]' },
    ],
  };
}
