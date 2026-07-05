// Vocabulary of ActionSet/Action/requirement-leaf type strings the parser
// recognizes.
//
// These are the UNION of what was actually observed across two real ZENworks
// bundle exports reconciled against this parser on 2026-07-04 (one script-based
// bundle, one MSI-install-based bundle) - real strings, not invented ones. See
// NEEDS_REVIEW.md ("Phase 1 - XML parser" > item 0) for the full reconciliation
// notes. They are still almost certainly incomplete - only two bundles were
// available. Treat any type not listed here as unknown and flag it rather than
// guessing at its meaning; expand these lists only when a real sample confirms
// a new value.

export const KNOWN_ACTION_SET_TYPES = Object.freeze([
  'Install',
  'Uninstall',
  'Verify',
  'Launch',
  'Terminate',
  'Distribution',
]);

export const KNOWN_ACTION_TYPES = Object.freeze([
  'Install MSI Action',
  'Run Script Action',
  'Display Message Action',
  'Terminate Action Prompt',
  'Terminate Action',
  'Verify Install',
  'Undo Install',
  'Distribute Action',
]);

export const KNOWN_REQUIREMENT_LEAF_TYPES = Object.freeze([
  'RegKeyExistsReq',
  'FileExistsReq',
  'IPSegmentReq',
]);

// No real bundle-to-bundle dependency reference construct was found in either
// sample (see NEEDS_REVIEW.md) - kept as an empty, documented placeholder
// rather than deleted, since the concept likely exists in ZENworks somewhere.
export const KNOWN_DEPENDENCY_TYPES = Object.freeze([]);
