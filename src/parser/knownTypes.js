// Vocabulary of action/filter/dependency "type" values the parser recognizes.
//
// IMPORTANT: This vocabulary is a best-effort approximation authored for this
// project, based on the general concepts described in CLAUDE.md (install actions,
// scripts, conditions, dependencies). It has NOT been verified against a real
// ZENworks bundle export or official Micro Focus/OpenText ZENworks documentation.
// See NEEDS_REVIEW.md. Treat any type not listed here as unknown and flag it
// rather than guessing at its meaning.

export const KNOWN_ACTION_TYPES = Object.freeze([
  'InstallMsi',
  'RunScript',
  'LaunchExecutable',
  'InstallFiles',
]);

export const KNOWN_REQUIREMENT_FILTER_TYPES = Object.freeze([
  'OperatingSystem',
  'Architecture',
  'FileExists',
  'RegistryValue',
]);

export const KNOWN_DEPENDENCY_TYPES = Object.freeze([
  'Bundle',
]);

export const KNOWN_ACTION_SET_TYPES = Object.freeze([
  'Install',
  'Uninstall',
]);
