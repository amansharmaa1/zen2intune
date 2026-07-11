# Known Limitations

This page summarizes what Zen2Intune does **not** yet do, so you know what to check
before trusting its output. It's a plain-language summary; the full technical
reasoning, decision history, and Microsoft documentation citations behind each item
live in [NEEDS_REVIEW.md](../NEEDS_REVIEW.md).

If you hit a limitation that isn't listed here, or you have a real ZENworks bundle
shape that breaks the tool, please [open an issue](../../issues) — that's exactly
the kind of real-world data point this project needs to improve on.

## Detection rules

- **Detection rules are only generated for MSI-based bundles**, and only when the
  export directory includes the actual `.msi` installer file alongside the bundle
  XML. The tool reads the MSI's own product code directly from the installer binary
  — the ZENworks bundle XML never contains it.
- **Script-based bundles (PowerShell-driven installs) get no detection rule at
  all.** ZENworks bundle exports carry no data that reliably maps to any of Intune's
  detection rule types for a script-based install. You'll need to add a detection
  rule (file, registry, or script-based) yourself.
- Reading MSI properties requires the Windows Installer component and only works on
  Windows. On other platforms, MSI-based bundles fall back to no detection rule,
  same as script-based ones.

## Conversion scope

- **One bundle at a time.** There's no bulk/batch mode — you point the tool at one
  bundle export directory and get one output payload. Converting many bundles means
  running it once per bundle yourself.
- **Requirement rules are skipped when ZENworks' conditions branch into multiple
  alternative groups** (i.e. "install if A is true, OR if B and C are true"). Intune
  doesn't have a verified way to express that kind of either/or logic in a
  requirement rule list, so rather than guess at a simplification, the tool leaves
  requirement rules out entirely for that bundle and flags it.
- **A "this file must not exist" ZENworks condition has no Intune equivalent.**
  Intune's file-existence check only supports "must exist," not the inverse, so
  these conditions are flagged for manual handling rather than silently dropped or
  inverted.
- **Network/IP-range conditions have no Intune equivalent** and are always flagged.

## Fields left blank

These fields have no reliable source in ZENworks bundle data, so the tool leaves
them unset rather than guessing a value:

- Windows architecture (`applicableArchitectures`)
- Minimum supported Windows version (`minimumSupportedWindowsRelease`)
- Custom return codes (`returnCodes`)
- Install context / restart behavior (`installExperience`)
- App-to-app dependencies (Intune models these differently than ZENworks does, and
  that mapping isn't implemented)

## Data trust

- The tool's recognized ZENworks action and requirement types were built from a
  small number of real bundle exports. Bundle types it hasn't seen yet will be
  flagged as unrecognized (and safely skipped) rather than silently misconverted —
  but that also means legitimate, uncommon ZENworks constructs may currently produce
  more manual-review items than they should.
- Output has been checked against Microsoft's published Graph API schema, but **has
  not been validated by actually creating an app in a live Intune tenant.** Treat the
  JSON as a strong draft, not a guaranteed-accepted payload.
- The optional AI interpretation step (see the README) produces *suggestions*, not
  automatic fixes — it has not been exercised end-to-end against a live bundle in
  this project's own testing.
