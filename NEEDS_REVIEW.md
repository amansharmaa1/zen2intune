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

## Phase 3 - Intune conversion engine

All Graph field names, resource types (`@odata.type` values), and enum members used
in `src/intune/graphEnums.js` and `src/intune/convertBundle.js` were checked against
Microsoft Learn documentation (`win32LobApp`, `win32LobAppRule` and its four concrete
subtypes, `win32LobAppInstallExperience`, `win32LobAppReturnCode`,
`win32LobAppMsiInformation`, `windowsArchitecture`) on 2026-07-04, not recalled from
memory alone. See the doc URLs in `src/intune/graphEnums.js`'s comments.

What this phase deliberately does **not** produce, and why - all surfaced as
`needsReview` entries on the conversion output rather than guessed at:

- **No detection rule is ever generated.** Intune's detection rule types
  (`win32LobAppProductCodeRule`, `win32LobAppRegistryRule`,
  `win32LobAppFileSystemRule`, `win32LobAppPowerShellScriptRule`) all need data our
  structured schema doesn't carry (e.g. an MSI product code - Phase 1's parser never
  captured one, since the synthetic schema's `InstallMsi` action only has a source
  file path, not a product code). Every conversion always emits an empty `rules`
  detection set plus a `no_detection_rule_derivable` review item. This is a real gap
  that needs either a Phase 1 schema extension (once a real ZENworks sample confirms
  whether product codes are actually present in real exports) or a human/AI-supplied
  detection rule.
- **`minimumSupportedWindowsRelease` is never set.** Graph documents this as a plain
  string with a single example (`Windows11_23H2`) and no published enumeration of
  valid values, so there's no verified way to map a ZENworks `OperatingSystem`
  condition value (e.g. `"Windows10"`) onto it. Always flagged when that condition
  exists.
- **`installExperience` (`runAsAccount`, `deviceRestartBehavior`) is never set.**
  Nothing in the structured schema carries a run-as-context or restart-behavior
  signal. Always flagged.
- **Dependencies are never converted.** Graph models app-to-app dependencies as a
  separate `mobileAppDependency`-style relationship on the app resource, not a
  `win32LobApp` property (confirmed by its absence from the full property list this
  phase fetched from Microsoft Learn) - that relationship API was out of scope here.
  Always flagged when the bundle has dependencies.
- **A `FileExists` condition using ZENworks' `notExists` operator has no direct
  target.** `win32LobAppFileSystemRule`'s `operationType` enum has `exists` but no
  `doesNotExist` (registry rules do have `doesNotExist`; file system rules don't -
  this asymmetry is real, per the docs, not an oversight on my part to fix). Flagged
  rather than inverted via a guess.
- **A stage with zero or more than one command-line-capable action never produces a
  command line.** Intune's win32LobApp model has exactly one `installCommandLine` and
  one `uninstallCommandLine`; when a ZENworks ActionSet has more than one action that
  could plausibly run something, this project does not guess which one (or what
  combined order) belongs in that single string.
- **`RunScript` and `InstallFiles` actions never produce a command line.** A
  `RunScript` action's body is inline text, not a file on disk to invoke, and turning
  it into a real command line means packaging it as a script file first (not
  implemented). `InstallFiles` is a copy operation with no natural single executable
  to invoke.
- No PowerShell cmdlets of any kind (Graph SDK or otherwise) are generated or
  referenced anywhere in this codebase - the engine only produces the JSON payload,
  not automation scripts.
- No live calls were made against a real Microsoft Graph endpoint or Intune tenant -
  only the JSON shape was checked against documentation. Before real use, create the
  app in a test tenant (Graph Explorer or an SDK) and confirm the payload is accepted,
  and manually fill every field this phase left out.

## Phase 4 - AI interpretation layer

- `src/ai/anthropicProvider.js` calls the real `@anthropic-ai/sdk` Node SDK
  (`^0.110.0`) - it has **not been exercised against the live Anthropic API**
  in this environment. There is no `ANTHROPIC_API_KEY` or CLI-managed OAuth
  profile configured here, and spending a user's API credits without explicit
  request would be inappropriate. Tests cover prompt construction and
  response-parsing logic directly, plus the full request/response plumbing
  through an injected fake SDK client (see `test/ai.test.js`) - the only thing
  not exercised is an actual network round trip to Anthropic's servers.
- **The "not configured" detection is a string match on the SDK's current
  error wording, verified empirically, not a documented error type.** I
  initially assumed (incorrectly, from memory) that `new Anthropic()` throws
  synchronously when no credentials are found. I verified this directly by
  running it in this sandboxed environment (which genuinely has no
  credentials) and found it does *not* throw at construction - `apiKey` is
  just left `null`. The actual failure happens client-side (no network call)
  inside `messages.create()`, as a plain `Error` (not a subclass of
  `Anthropic.AuthenticationError` or `Anthropic.AnthropicError`) with the
  message "Could not resolve authentication method...". `interpretBundle`
  matches on that substring to raise `AiProviderNotConfiguredError`. If a
  future SDK upgrade changes that wording, detection silently stops working -
  the underlying error still propagates (nothing is swallowed), it just won't
  be relabeled with the friendlier error type. Re-verify this string against
  the installed SDK version if `@anthropic-ai/sdk` is upgraded.
- `isConfigured()` is explicitly documented as a **best-effort hint only** -
  it checks `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` env vars and cannot
  see a CLI-managed OAuth profile or Workload Identity Federation credentials.
  Do not treat a `false` from it as proof that `interpretBundle` will fail.
- Before relying on this layer for real bundles: set `ANTHROPIC_API_KEY` and
  run a real end-to-end call against a handful of representative structured
  bundles, then spot-check the model's suggested mappings - the model can
  still be wrong or uncertain, which is why its output is a *suggestion*
  (`suggestedMapping` + `confidence` + `rationale`) rather than a direct
  write into the Intune output. Nothing in the current codebase actually
  wires `interpretBundle`'s output into `src/intune/convertBundle.js` yet -
  that integration (annotating a structured bundle before conversion, per the
  architecture's stage order) was not built in this pass.
- Model default is `claude-opus-4-8`, overridable via `ZEN2INTUNE_AI_MODEL` -
  no specific model has been requested or locked in for this project, so this
  follows the general default for new Claude-powered application code.
- No prompt-injection hardening has been done beyond basic structural
  separation (the structured bundle is passed as a clearly delimited JSON
  block in the user turn, not concatenated into free-form instruction text,
  and the system prompt explicitly tells the model not to invent new
  needsReview items). If bundle content ever originates from an untrusted
  source, review this before production use.

## General

- No real ZENworks bundle data, hostnames, or environment paths were used anywhere in
  this repository - all fixtures are synthetic and clearly labeled as such in-file.
