// Enum member lists verified against Microsoft Graph API (v1.0) documentation via
// Microsoft Learn on 2026-07-04. Every list below has a doc URL - do not add or
// change a value without checking the linked page first (CLAUDE.md coding rule:
// never fabricate Graph API fields).

// https://learn.microsoft.com/graph/api/resources/intune-apps-windowsarchitecture
export const WINDOWS_ARCHITECTURE = Object.freeze(['none', 'x86', 'x64', 'arm', 'neutral']);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobapprule
export const RULE_TYPE = Object.freeze(['detection', 'requirement']);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappruleoperator
// (shared by registry, file system, product-code-version, and script rules)
export const RULE_OPERATOR = Object.freeze([
  'notConfigured',
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
]);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappregistryrule
// Note: registry rules DO support a "doesNotExist" check.
export const REGISTRY_RULE_OPERATION_TYPE = Object.freeze([
  'notConfigured',
  'exists',
  'doesNotExist',
  'string',
  'integer',
  'version',
]);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappfilesystemrule
// Note: unlike registry rules, file system rules have NO "doesNotExist" option -
// only an affirmative "exists" check plus date/version/size comparisons.
export const FILE_SYSTEM_RULE_OPERATION_TYPE = Object.freeze([
  'notConfigured',
  'exists',
  'modifiedDate',
  'createdDate',
  'version',
  'sizeInMB',
]);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappreturncode
export const RETURN_CODE_TYPE = Object.freeze(['failed', 'success', 'softReboot', 'hardReboot', 'retry']);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappinstallexperience
export const RESTART_BEHAVIOR = Object.freeze(['basedOnReturnCode', 'allow', 'suppress', 'force']);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappinstallexperience
export const RUN_AS_ACCOUNT = Object.freeze(['system', 'user']);

// https://learn.microsoft.com/graph/api/resources/intune-apps-win32lobappmsiinformation
export const MSI_PACKAGE_TYPE = Object.freeze(['perMachine', 'perUser', 'dualPurpose']);

// ERROR_SUCCESS_REBOOT_REQUIRED - a standard Windows Installer exit code
// (documented by Microsoft as part of Windows Installer error codes, independent
// of Intune), conventionally meaning "installed successfully, reboot needed."
// Used to decide between the Graph "success" and "softReboot" return code types.
export const MSI_REBOOT_REQUIRED_EXIT_CODE = 3010;
