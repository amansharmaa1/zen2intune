# Needs Review

Items flagged during development that require human verification before this project
is used against real data or a real Intune tenant. Nothing here has been silently
guessed at in the code - each item is either explicitly unimplemented, gated behind a
condition that isn't met yet, or based on an assumption called out below. This file is
updated at the end of each phase with only what's actually true of the code at that
point.

## Phase 1 - XML parser

### 0. RECONCILED AGAINST TWO REAL ZENworks BUNDLE EXPORTS (2026-07-04)

**Update superseding items 1-2 below.** Two real ZENworks bundle exports were made
available locally (outside this repo) for structure comparison only - one
PowerShell-script-based bundle, one MSI-install-based bundle (a third-party security
agent installer). Per instruction, no real file, filename, product name, or field
*value* (hostnames, domains, usernames, IPs, license keys, file paths) was copied into
this repo or is reproduced below - only field *names* and *shapes*, illustrated with
invented placeholder values.

**The original synthetic schema (item 1, preserved below for history) was wrong in
almost every structural particular.** `parseBundle.js` and `knownTypes.js` have been
rewritten to match what was actually observed. Summary of what matched vs. didn't:

**What matched (conceptually, not structurally):**
- A `<Bundle>`-rooted document containing bundle identity, requirement/condition
  logic, and one or more sets of actions - the high-level concepts in CLAUDE.md's
  project description held up.
- "Install" and "Uninstall" exist as real action-grouping type names, among others.
- An MSI-based install action and a script-based install action both exist as real,
  distinct concepts.

**What didn't match (this is most of it):**
- **Namespaces everywhere.** Real exports wrap nearly every element in `nsN:` prefixes
  tied to `novell.com` XML namespace URIs, with the prefix-to-URI mapping changing
  by section (e.g. `ns2` means one namespace under bundle metadata and a different one
  under `ActionSets`). The parser now configures `fast-xml-parser` with
  `removeNSPrefix: true` and matches on local element names only, rather than trying
  to track exact namespace URIs - verified empirically against a synthetic (non-real)
  namespaced XML snippet before relying on it.
- **No flat `<Requirements><Filter type="..." operator="..." value="..."/></Requirements>`
  list exists.** Real requirement logic (`SysReqs`) is a **recursive boolean tree**:
  a root conjunction (`AND`/`OR`) wraps `Req` nodes, each either another nested group
  (`Req Type="GroupReq"` with its own conjunction and child `Req`s) or a leaf check
  (e.g. `Req Type="RegKeyExistsReq"` / `"FileExistsReq"` / `"IPSegmentReq"`, each
  holding a boolean `Value` and a target `Name` - e.g. conceptually
  `<RegKeyExistsReq><Value>true</Value><Name>HKLM:\Some\Key</Name></RegKeyExistsReq>`
  means "this key must exist"). There is no "operator" concept at all - just a
  boolean assertion per leaf. The parser now walks this recursively and flattens it
  to a list of leaf conditions, each annotated with a `groupPath` (its full ancestry
  of `{conjunction, index}` steps) so the AND/OR structure is preserved, not
  discarded, even though the leaf list itself stays a flat array.
- **ActionSets are repeated sibling elements directly under `<Bundle>`**, not nested
  inside one wrapping `<ActionSets>` parent as assumed. Six real `ActionSet` type
  values were observed: `Install`, `Uninstall`, `Verify`, `Launch`, `Terminate`,
  `Distribution` (vs. the two, `Install`/`Uninstall`, previously assumed).
- **Individual actions are `<Actions>` elements** (plural tag, singular meaning),
  repeated under an ActionSet, each with `Id`/`Name`/`Type`/`Data`/`ContinueOnFailure`/
  `Enabled`/`actionUniqueId` as **child elements**, not attributes. Eight real action
  `Type` string values were observed: `Install MSI Action`, `Run Script Action`,
  `Display Message Action`, `Terminate Action Prompt`, `Terminate Action`,
  `Verify Install`, `Undo Install`, `Distribute Action` - none of which resemble the
  invented `InstallMsi`/`RunScript`/`LaunchExecutable`/`InstallFiles` vocabulary.
- **No `<SuccessCodes>` construct exists anywhere.** Neither sample's actions carry
  anything resembling a configurable list of acceptable exit codes. This invalidates
  Phase 3's entire `buildReturnCodes()` premise (see the Phase 3 addendum below) -
  there is currently no known real data source for Intune `returnCodes`.
  `ContinueOnFailure` and `reqsFailAction` appear to be ZENworks' actual pass/fail
  model instead, which is a different paradigm, not an equivalent field to remap.
- **An MSI install action does not carry a single `<Path>`+`<Arguments>` pair.** It
  carries a `MSIData` element with attributes for file/package metadata, and three
  **separate, already-fully-formed command-line fragments** as child elements - one
  each for install, repair, and uninstall (e.g. conceptually
  `<Install><CmdLine> /i "App.msi" /qn PROPERTY=value</CmdLine></Install>`,
  `<Repair><CmdLine> /f "App.msi" /qn</CmdLine></Repair>`,
  `<Uninstall><CmdLine> /x "App.msi" /qn</CmdLine></Uninstall>`) - each already
  including the `/i`/`/f`/`/x` switch. This actually *simplifies* future Intune
  command-line derivation (just prepend `msiexec`) compared to the old
  switch-injection-with-duplicate-detection logic, once that logic is rewritten - see
  the Phase 3 addendum.
- **The actual installer file is not referenced inline by path.** The action instead
  carries a `LinkedObjectIDs` reference (an opaque ID), and a **separate sidecar file**
  (named `<BundleName>_ActionContentInfo.xml`, sitting next to the main bundle XML)
  maps ActionSet type + action name/type/index to a relative `ContentFilePath` inside
  a same-named `_content/<hash>/` folder holding the actual installer. This is a
  multi-file mechanism the parser's single-XML-string interface does not read at all
  right now (see "Not yet implemented" below). The MSI's plain filename (e.g.
  `App.msi`) *is* available inline as an attribute on `MSIData`, independent of the
  sidecar file, and the parser does extract that.
- **Bundle identity/metadata is a ~30-field object**, not `{name, guid, type, version}`.
  There is no bundle-level "Type" meaning Install/Uninstall at all - that's an
  ActionSet-level concept, not a bundle-level one. The closest bundle-level "kind"
  fields are `PrimaryType` (e.g. "Bundle"), `SubType` (e.g. "Windows Bundle"), and an
  optional `Category` (present on the MSI-based sample, e.g. "msi"; absent on the
  script-based one). The bundle's own `Version`/`Revision` fields are ZENworks'
  internal edit/revision counters (small integers), **not a software version string**
  - a real software version, if present at all, would live on an MSI action's own
  `Version` attribute instead. The GUID-like identifier is `UID` (a 32-character hex
  string with no dashes), not `Guid`.
- **No dependency-on-another-bundle construct was found in either sample.** The only
  hit for "Dependencies" in either file was an unrelated boolean flag,
  `IgnoreChainedDependencies`, inside an Uninstall action-set's behavior settings -
  not a list of dependency references. Whatever real construct ZENworks uses for
  bundle-to-bundle dependencies (if any - it's plausible this is a separate
  association not captured in a single bundle's own export XML) remains unverified.
  The parser now always returns an empty `dependencies` array with this caveat, rather
  than keeping the previously-invented `<Dependencies><Dependency type="..."></Dependencies>`
  shape.
- A bundle-level `<Data>` element holds a **string containing escaped/embedded XML**
  (a second, nested XML document as text, covering UI-facing settings like
  "always show icon", a contact name/phone/email, and force-run-order behavior). The
  parser does not parse this nested XML-in-a-string in this pass (would need a second
  parse call) - flagged as unimplemented, not something guessed at.
- A `.properties` sidecar file (Java-properties-style `key=value` lines) also
  accompanies each exported bundle. Not parsed - out of scope for a single-XML-string
  parser interface, and nothing observed in it looked essential to migration.

**Not yet implemented / explicitly out of scope for this pass** (all flagged rather
than guessed at):
- Resolving the `_ActionContentInfo.xml` sidecar + `_content/<hash>/` folder to get a
  full installer path (only the bare filename is captured, from the inline `MSIData`
  attribute).
- Deep field extraction for action types other than `Install MSI Action` and
  `Run Script Action` (i.e. `Display Message Action`, `Terminate Action Prompt`,
  `Terminate Action`, `Verify Install`, `Undo Install`, `Distribute Action`) - these
  are recognized (matched against the known-type vocabulary) but their `Data` isn't
  deeply parsed into structured fields, since none of them carry install/uninstall
  mechanics relevant to Intune conversion.
- Parsing the bundle-level `Data` (nested XML-in-a-string) blob.
- Only two bundles were available (one script-only, one MSI-only) - the requirement
  leaf types (`RegKeyExistsReq`, `FileExistsReq`, `IPSegmentReq`), action types, and
  action-set types listed above are everything *observed*, almost certainly not
  everything that *exists*. Deeper requirement-tree nesting beyond two levels
  (root conjunction -> group conjunction -> leaves) is handled generically by the
  parser's recursive walker (the grammar is evidently recursive - a `GroupReq` can
  contain another `Req`, which could itself be a `GroupReq`) but was never actually
  observed beyond two levels in these two samples.

**Downstream impact - Phase 2 and Phase 3 source code now target a stale shape.**
Rewriting Phase 1 to be honest about the real structure necessarily changes its output
shape substantially (real field names, a leaf-list-with-`groupPath` for conditions
instead of a flat filter list, no `successCodes`, action `fields` keyed by real
action-type-specific names instead of the invented `path`/`arguments`/`scriptBody`
convention). Per the scope of this task, **`src/schema/normalize.js` and
`src/intune/convertBundle.js` were deliberately left unmodified** - they still expect
the old invented Phase 1 shape. One compatibility shim *was* required, discovered only
by actually running the suite (first attempt: aliasing the old export name directly to
the new real vocabulary - this loaded, but silently broke every "recognized" check,
since real strings like `"Install MSI Action"` don't match legacy-shaped test data
using invented strings like `"InstallMsi"`, which is what `normalize.js`'s own
pre-existing tests are built around). The actual fix: `knownTypes.js` now exports the
real vocabulary under its own honest names (`KNOWN_ACTION_TYPES`, etc., used by
`parseBundle.js` and its tests) **plus** a separate, clearly-labeled set of
`LEGACY_KNOWN_*` constants holding the original invented vocabulary verbatim.
`normalize.js`'s import statement (and only that one statement - `import {
LEGACY_KNOWN_ACTION_TYPES as KNOWN_ACTION_TYPES, ... }`) now pulls from the legacy
set via aliasing, so every line of its actual logic is unchanged, byte-for-byte, and
it keeps meaning exactly what it always meant for its own (pre-reconciliation) tests.
Concretely, today:
- `normalize.js`'s `REQUIRED_FIELDS_BY_ACTION_KIND` map has no entries matching real
  action type strings (`"Install MSI Action"`, etc.), so every real action is
  permanently `complete: false` even when `recognized: true`. This doesn't crash
  anything - Phase 3 just always finds zero command-line candidates for real data and
  flags `no_command_line_candidate` for every stage.
- `convertBundle.js`'s condition lookups (`kind === 'Architecture'`, `'OperatingSystem'`,
  `'FileExists'`) will never match real leaf `reqType` values (`RegKeyExistsReq`,
  `FileExistsReq`, `IPSegmentReq`) or the new `target`/`assertedValue` field names, so
  applicable-architecture and file-system-requirement-rule derivation silently find
  nothing to do against real data (again, no crash - just no output, which is honest
  given the mismatch, not a bug being papered over).
- Because `test/schema.test.js` and `test/intune.test.js` previously ran the shared
  Phase 1 fixtures through the real pipeline as an integration test, and those
  fixtures are now real-shaped, their two fixture-dependent tests each were converted
  to use hand-built raw objects shaped like the *old* Phase 1 contract instead - this
  keeps them passing and still exercising `normalize.js`/`convertBundle.js`'s actual
  logic, but it means **those tests no longer prove anything about real-world data
  flowing all the way through the pipeline.** Only Phase 1's own tests now exercise
  the real-shaped fixtures end-to-end through `parseBundleXml`.
- **Recommended next step:** update `normalize.js` and `convertBundle.js` to consume
  the new Phase 1 shape (in particular: rewrite `buildCommandLineForAction` to prepend
  `msiexec ` to the now-ready-made `installCmdLine`/`uninstallCmdLine` values rather
  than reconstructing them from `Path`+`Arguments`; drop the `successCodes`-based
  `buildReturnCodes` premise entirely, since no real data source for it exists; walk
  the new `groupPath`-annotated condition list instead of doing flat `.find()` calls).
  This was not done in this pass since it wasn't requested and is a substantial
  design task in its own right.

### 1. (Historical) The original schema was a synthetic approximation, not verified

Preserved for history. Before the real-bundle reconciliation above, `parseBundle.js`
and `knownTypes.js` were written against a schema invented for development purposes -
element names like `<Bundle>`, `<ActionSets>`, `<ActionSet type="...">`,
`<Action type="...">`, `<Requirements><Filter type="...">`, and
`<Dependencies><Dependency type="...">` were a plausible-looking guess based on the
general concepts in CLAUDE.md, not real field names. This has now been superseded by
item 0 above.

### 2. Known type vocabularies are now real-observed, but still not exhaustive

`KNOWN_ACTION_TYPES`, `KNOWN_ACTION_SET_TYPES`, `KNOWN_REQUIREMENT_LEAF_TYPES` in
`src/parser/knownTypes.js` are now the union of everything observed across the two
real bundle exports described above (2026-07-04) - real strings, not invented ones.
They are still almost certainly incomplete (only two bundles, of two different kinds,
were available). The parser continues to degrade safely on anything not in these
lists (flag as `unknown_*_type`, pass the raw value through unchanged) rather than
fail or guess - expand these lists as more real samples become available.

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

**Addendum (2026-07-04, after real-bundle reconciliation):** the premises below about
`successCodes` and `Path`+`Arguments`-based MSI command-line construction are now
known to not match real ZENworks data - see "Phase 1 - XML parser" item 0 above for
what real data actually looks like and exactly what's now stale here. This section is
left as originally written (accurate to what Phase 3 was built against) rather than
rewritten, since updating `convertBundle.js` itself was out of scope for this pass.

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
