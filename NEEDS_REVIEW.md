# Needs Review

Items flagged during development that require human verification before this project
is used against real data or a real Intune tenant. Nothing here has been silently
guessed at in the code - each item is either explicitly unimplemented, gated behind a
condition that isn't met yet, or based on an assumption called out below. This file is
updated at the end of each phase with only what's actually true of the code at that
point.

## Phase 1 - XML parser

### 1. The ZENworks bundle XML schema is a synthetic approximation, not verified

**This is the single most important item in this file.** `src/parser/parseBundle.js`
and `src/parser/knownTypes.js` are written against a schema I (Claude) designed myself
for development purposes - element names like `<Bundle>`, `<ActionSets>`,
`<ActionSet type="...">`, `<Action type="...">`, `<Requirements><Filter type="...">`,
and `<Dependencies><Dependency type="...">` are a **plausible approximation** based on
the general concepts described in CLAUDE.md (install actions, scripts, conditions,
dependencies), not field names taken from a real ZENworks bundle export or official
Micro Focus/OpenText ZENworks documentation.

I did not have access to a real ZENworks export sample or official schema
documentation, and fabricating exact tag/attribute names and presenting them as
verified would violate the project's core coding rule against fabricating technical
specifics.

**Before running this parser against any real ZENworks bundle export:**
- Obtain at least one real bundle export XML (e.g. via `zman bundle-export-bundle` or
  ZCC's export function) and compare its actual structure against
  `test/fixtures/sample-bundle-basic.xml`.
- Update `src/parser/parseBundle.js` and `src/parser/knownTypes.js` to match the real
  element/attribute names, and regenerate fixtures accordingly.
- The overall parser *shape* (deterministic extraction, fail-loudly on malformed/missing
  data, flag-not-guess on unrecognized constructs) should still be a reasonable
  starting structure even if concrete tag names need to change.

### 2. Known type vocabularies are illustrative, not exhaustive

`KNOWN_ACTION_TYPES`, `KNOWN_REQUIREMENT_FILTER_TYPES`, and `KNOWN_DEPENDENCY_TYPES`
in `src/parser/knownTypes.js` cover a small illustrative set (`InstallMsi`,
`RunScript`, `LaunchExecutable`, `InstallFiles`, etc.). Real ZENworks bundles almost
certainly use additional action/filter/dependency types not in this list. The parser
is designed to degrade safely (flag as `unknown_*_type` warning, pass the raw type
through unchanged) rather than fail, but the vocabulary should be expanded once real
samples are available.

## Phase 2 - Structured JSON schema

No new external/unverifiable facts were introduced in this phase - it's a pure,
deterministic restructuring of Phase 1's output plus flagging against the same known-
type vocabulary the parser already uses. Two design decisions worth knowing about
(not uncertainties, just choices - see inline comments where noted):

- The validator in `src/schema/jsonSchemaValidator.js` supports only a small subset
  of JSON Schema (`type`, `required`, `properties`, `items`, `enum`). It's sufficient
  for this project's own schema but is not a general-purpose validator - don't reuse
  it for arbitrary external JSON Schema documents without extending it first.
- An action's `complete` flag is only ever `true` for a *recognized* action kind with
  all of that kind's required fields present (see `REQUIRED_FIELDS_BY_ACTION_KIND` in
  `src/schema/normalize.js`). Unrecognized kinds are always `complete: false` since
  completeness of a construct we don't understand isn't derivable - it shows up in
  `needsReview` instead.

## General

- No real ZENworks bundle data, hostnames, or environment paths were used anywhere in
  this repository - all fixtures are synthetic and clearly labeled as such in-file.
