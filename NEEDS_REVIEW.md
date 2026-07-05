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

**Downstream impact - RESOLVED on 2026-07-04 (follow-up pass).** The paragraph that
used to be here described `normalize.js`/`convertBundle.js` as deliberately left
unmodified against the old invented shape, with a `LEGACY_KNOWN_*` compatibility shim
so their pre-existing tests kept passing. That has since been superseded: both modules
were rewritten to consume the real Phase 1 shape, the `LEGACY_KNOWN_*` exports and the
aliased import were removed, and `test/schema.test.js`/`test/intune.test.js` now run
the real-shaped fixtures end-to-end again. See "Phase 2 - Structured JSON schema" and
"Phase 3 - Intune conversion engine" below for what actually works now.

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

**Rewritten on 2026-07-04 to consume the real Phase 1 shape.** `bundleSchema.js` and
`normalize.js` now match `src/parser/parseBundle.js`'s real field names (`uid`,
`reqType`, `groupPath`, `assertedValue`, `target`, action `kind` values like
`"Install MSI Action"`, etc.) instead of the earlier invented ones. `BUNDLE_SCHEMA_VERSION`
was bumped from `1.0.0` to `2.0.0` since the shape isn't backward compatible.
`test/schema.test.js` runs the real fixtures end-to-end through
`parseBundleXml` -> `normalizeBundle` again (not hand-built legacy-shaped objects).

No new external/unverifiable facts were introduced in this rewrite - it's a pure,
deterministic restructuring of Phase 1's (now real) output plus flagging against the
same known-type vocabulary the parser uses. Design decisions worth knowing about (not
uncertainties, just choices - see inline comments where noted):

- The validator in `src/schema/jsonSchemaValidator.js` supports only a small subset
  of JSON Schema (`type`, `required`, `properties`, `items`, `enum`). It's sufficient
  for this project's own schema but is not a general-purpose validator - don't reuse
  it for arbitrary external JSON Schema documents without extending it first.
- An action's `complete` flag is `true` when either (a) it's a *recognized* kind with
  all of that kind's required fields present (`REQUIRED_FIELDS_BY_ACTION_KIND` covers
  only `"Install MSI Action"` and `"Run Script Action"`, the two kinds this project
  deeply parses fields for), or (b) it's a *recognized* kind with no completeness
  criteria at all (e.g. `"Verify Install"`, `"Undo Install"`, `"Terminate Action"` -
  real ZENworks action types whose `Data` isn't deeply parsed, so there's nothing to
  check and nothing known to be missing). **This is a behavior change from the
  pre-reconciliation version**, which defaulted an action with no map entry to
  `complete: false`; that no longer made sense once "no map entry" started meaning
  "a real, recognized type we just don't extract fields for" rather than "a fictitious
  type." An *unrecognized* kind is always `complete: false` regardless - completeness
  of a construct we don't understand at all still isn't derivable.
- `conditions[].groupPath` (the AND/OR ancestry of each flattened requirement leaf) is
  passed through from Phase 1 unchanged - normalize.js does no logic with it itself,
  it's `convertBundle.js` (Phase 3) that reads it to decide whether a bundle's
  requirement tree is simple enough to convert automatically.
- `dependencies` is passed through as an untransformed array (currently always empty -
  see "Phase 1" item 0) rather than mapped into a specific shape, since no real
  dependency construct has been observed to shape a mapping against.

## Content pipeline and MSI-derived detection rule (added 2026-07-05)

The single biggest gap - no detection rule - is now closed **for MSI-based bundles
whose export includes the installer binary**, without fabricating anything:

- **Where the ProductCode comes from.** The bundle XML carries no ProductCode
  anywhere (re-confirmed against both real exports). The only non-fabricated source
  is the MSI binary itself: `src/msi/readMsiProductInfo.js` reads the MSI's Property
  table **read-only** via the Windows Installer COM automation interface
  (`WindowsInstaller.Installer` / msi.dll), extracting ProductCode, ProductVersion,
  ProductName, Manufacturer, UpgradeCode, and ALLUSERS. Every API call used
  (Installer.OpenDatabase with msiOpenDatabaseModeReadOnly=0, Database.OpenView,
  View.Execute/Fetch, Record.StringData) was verified against Microsoft Learn on
  2026-07-05 - doc URLs are cited in `src/msi/readMsiProductInfo.ps1`'s header.
  A missing or non-GUID ProductCode raises `MsiReadError`; nothing is repaired or
  invented.
- **How the MSI file is located.** `src/parser/parseActionContentInfo.js` parses the
  export's `_ActionContentInfo.xml` sidecar (no namespaces, unlike the main XML),
  which maps the Install ActionSet's "Install MSI Action" to a `ContentFilePath`
  relative to the export directory. `src/pipeline/convertBundleExport.js` composes
  the whole flow for an export directory: main XML -> normalize -> sidecar -> MSI
  read -> convert. Sidecar paths that escape the export directory are refused
  (`content_path_escapes_export_directory`); a missing sidecar/content file or a
  failed read degrades to a flag (`content_sidecar_missing` / `content_file_missing`
  / `msi_read_failed`), never a guess.
- **What the conversion now emits when MSI properties are available**
  (`options.msiProductInfo` on `convertToIntunePackage`): a
  `win32LobAppProductCodeRule` with `ruleType: "detection"` (detection-only per its
  v1.0 doc page; re-verified 2026-07-05 - note there is **no v1.0 type named
  `win32LobAppDetectionRule`**; the `win32LobAppDetection` hierarchy is beta-only,
  and this project targets v1.0 as Microsoft recommends), plus `msiInformation`
  (productCode / productVersion / upgradeCode / productName / publisher <-
  Manufacturer), app-level `publisher`, and `fileName`/`setupFilePath` from the
  MSIData FileName attribute. `packageType` maps from the MSI's ALLUSERS property
  per its documented semantics (unset -> perUser, "1" -> perMachine); ALLUSERS=2
  defers the decision to install time, so it's flagged
  (`msi_package_type_undetermined`), not guessed as `dualPurpose`.
- **Verified end-to-end against the real MSI bundle export on 2026-07-05** (values
  redacted, nothing copied into the repo): the pipeline produced a payload with a
  valid-GUID ProductCode detection rule, msiexec install/uninstall command lines,
  fileName/setupFilePath, publisher, and msiInformation with packageType
  perMachine. The script-only real bundle degrades to flags (no detection source
  exists for it), with no crash.
- **Still true / still flagged:**
  - MSI reading is **Windows-only** (COM/msi.dll); on other platforms the pipeline
    flags `msi_read_failed` and produces no detection rule.
  - Script-only bundles have **no detection-rule source at all** - flagged
    (`no_detection_rule_derivable`), to be resolved by a human or the Phase 4 AI
    layer's *suggestion*.
  - `msiInformation.requiresReboot` is never set - no verified signal for it (the
    bundle's `REBOOT=Suppress` MSI property is a suppression instruction, not a
    statement that the product requires a reboot).
  - "Valid payload" here means schema-shaped per the v1.0 docs with a real detection
    rule - it has **not** been validated against a live Intune tenant (requires
    tenant access; see "stop and report" note in the task log). Graph's Create
    win32LobApp doc does not mark which request-body properties are mandatory, so
    tenant-side validation remains the final arbiter.
  - The tests' synthetic MSI is created by `test/helpers/createSyntheticMsi.ps1`
    (Property table only, fake values) - real COM round-trip, no real installer
    used or committed. On non-Windows CI these tests skip rather than silently pass.

## Phase 3 - Intune conversion engine

**Addendum 2026-07-05:** the "No detection rule is ever generated" bullet below is
superseded by the "Content pipeline" section above - a ProductCode detection rule
IS now generated when the export directory contains the MSI binary. The "no
PowerShell" bullet is also amended: the conversion *output* still contains no
PowerShell, but the repo now ships two small PowerShell bridge scripts
(`src/msi/readMsiProductInfo.ps1`, `test/helpers/createSyntheticMsi.ps1`) whose
cmdlets are standard built-ins (`New-Object`, `Test-Path`, `ConvertTo-Json`) plus
the documented Windows Installer COM automation interface.

**Rewritten on 2026-07-04 to consume the real Phase 2 shape.** `convertBundle.js` was
rebuilt against real ZENworks data instead of the earlier invented shape. What
changed, and what actually works end-to-end against the real-shaped sample fixtures
now (verified by `test/intune.test.js`):

- **`installCommandLine` and `uninstallCommandLine` are both derived from the single
  `"Install MSI Action"` found in the bundle's `"Install"` ActionSet**, by prepending
  `msiexec ` to its already-complete `installCmdLine` / `uninstallCmdLine` fragments
  (each already includes its own `/i`/`/x` switch - see "Phase 1" item 0). This
  replaced the old `Path`+`Arguments`+switch-injection-with-duplicate-detection logic,
  which no longer applied to any real field. Both commands come from the *same*
  action deliberately: the real `"Uninstall"` ActionSet's own action (`"Undo
  Install"`) carries no data of its own in either reconciled sample - ZENworks
  appears to reuse the Install action's own MSI uninstall command rather than storing
  a separate one. If the Install ActionSet has zero or more than one MSI action, or is
  missing entirely, neither command line is set and this is flagged
  (`no_command_line_candidate` / `multiple_command_line_candidates` /
  `action_set_missing`) rather than guessed.
- **Requirement rules are derived from the flattened, `groupPath`-annotated condition
  list**, but only when every recognized condition shares the same single top-level
  group (i.e. the tree has no OR'd alternative groups at the root). If it does
  (`groupPath[0].index` takes more than one distinct value across conditions), no
  automatic rule conversion is attempted for *any* condition, and this is flagged
  (`requirement_tree_has_alternatives`) - Graph's `rules` array has no verified way to
  express "any one of these alternative condition groups," only a flat, implicitly
  AND'd list, so silently flattening away real OR logic would misrepresent it.
  - `RegKeyExistsReq` -> `win32LobAppRegistryRule` (`operationType: 'exists'` or
    `'doesNotExist'` depending on the leaf's asserted boolean value), with
    `keyPath` = the leaf's target and **`valueName: ''`**. This mapping is now
    considered verified, not just plausible: Microsoft's own "Add, Assign, and
    Monitor a Win32 App in Microsoft Intune" guide states "[Value name:] If this
    value is empty, the detection will happen on the key" - i.e. an empty `valueName`
    means "check the key's existence," which is exactly what `RegKeyExistsReq` means.
    Checked via Microsoft Learn on 2026-07-04, not assumed.
  - `FileExistsReq` -> `win32LobAppFileSystemRule` (`operationType: 'exists'`), but
    **only when the leaf asserts the file must exist** (`assertedValue === true`).
    When it asserts the file must *not* exist, this is flagged
    (`no_inverse_file_system_rule`) rather than inverted - `win32LobAppFileSystemRule`
    has no `doesNotExist` operation type (confirmed via Microsoft Learn; only
    registry rules have that asymmetry-breaking option).
  - `IPSegmentReq` has no Intune requirement rule equivalent at all and is always
    flagged (`no_network_requirement_rule`) - none of the four verified
    `win32LobAppRule` subtypes (file system, registry, product code, PowerShell
    script) cover network/IP-based conditions.
  - A leaf with no parseable boolean `Value` (`assertedValue: null`) is flagged
    (`condition_value_undetermined`) rather than guessed either way.
- **`returnCodes` is now permanently unset and always flagged** (`no_return_codes_derivable`).
  The old `buildReturnCodes()` function was deleted entirely, along with its
  `RETURN_CODE_TYPE`/`MSI_REBOOT_REQUIRED_EXIT_CODE` usage - there is no
  `successCodes`-like construct anywhere in real ZENworks data to build it from (see
  "Phase 1" item 0). `graphEnums.js` itself was left untouched (still an accurate,
  Microsoft-Learn-verified reference for `win32LobAppReturnCode`'s enum, in case a
  return-code data source is identified later), it's just no longer imported here.
- **`applicableArchitectures` and `minimumSupportedWindowsRelease` are now permanently
  unset and always flagged** (`architecture_signal_unavailable` / `os_signal_unavailable`).
  The old `buildApplicableArchitectures`/`flagOperatingSystemCondition` functions
  (which looked for `Architecture`/`OperatingSystem` condition kinds) were deleted -
  none of the three real requirement leaf types observed (`RegKeyExistsReq`,
  `FileExistsReq`, `IPSegmentReq`) carries architecture or OS-version information.
  If ZENworks conveys this some other way (a different requirement leaf type not yet
  observed, or a mechanism outside `SysReqs` entirely), it hasn't been identified.
- **No detection rule is ever generated** (`no_detection_rule_derivable`, unchanged
  from before, now with an updated, real-data-accurate explanation): `MSIData` carries
  `FileName`/`Locale`/`PackageName`/`Vendor`/`Version` attributes but confirmed **no
  `ProductCode`** in either real sample, so nothing deterministically maps to any of
  Intune's four verified detection rule types.
- **`installExperience` (`runAsAccount`, `deviceRestartBehavior`) is still never set**
  and always flagged (`install_experience_undetermined`) - nothing in the structured
  schema carries a run-as-context or restart-behavior signal. (ZENworks' MSI actions
  do carry an `Impersonate`/`Impersonation` block with values like
  `DYNAMIC_ADMIN_USER`, and script actions carry a `runAs` field with values like
  `"System"` - deriving `installExperience` from these was considered but not
  implemented in this pass: `DYNAMIC_ADMIN_USER` in particular doesn't map confidently
  to Intune's `system`/`user` enum without guessing, and scoping a narrow,
  script-only mapping felt like more unverified surface area than this task asked
  for. Flagged here as a candidate follow-up rather than fabricated.)
- **Dependencies are still never converted** (`dependency_not_convertible`) - this
  never fires today since Phase 1 always returns an empty `dependencies` array, but
  the check is kept (harmless) in case that changes. Graph models app-to-app
  dependencies as a separate `mobileAppDependency`-style relationship on the app
  resource, not a `win32LobApp` property (confirmed by its absence from the full
  property list fetched from Microsoft Learn during the original Phase 3 build) -
  that relationship API remains out of scope.
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
