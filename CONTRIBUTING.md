# Contributing to Zen2Intune

Thanks for considering a contribution. This document covers how to get set up, the
testing discipline this project follows, and one hard rule about real data.

## Getting set up

```sh
npm install
npm test
```

Node.js 20 or later is required (see `engines` in `package.json`).

Run a single test file while iterating:

```sh
node --test test/parser.test.js
```

## The testing discipline

Every source file under `src/` has a corresponding test file under `test/`, and the
project works in verified increments: **a change isn't done until `npm test` passes.**
When you add or change behavior:

1. Write or update the test(s) first, or alongside the change — not after.
2. Run `npm test` and make sure the full suite is green before opening a PR, not just
   the file you touched.
3. If you're fixing a bug found against real ZENworks data, add a synthetic
   (fake-valued) fixture that reproduces the *shape* of the problem — see
   [Real ZENworks data](#real-zenworks-data-must-never-be-committed) below.
4. If you deliberately leave a field unmapped because there's no verified source for
   it, don't fabricate a plausible-looking value — flag it (see the next section) and
   add a note to [NEEDS_REVIEW.md](NEEDS_REVIEW.md) explaining why.

### Don't guess at ZENworks or Intune schema fields

This project's core rule: if a field, cmdlet, or API shape isn't verified against
real documentation (or real, redacted sample data), don't invent one that merely
looks plausible. When something can't be derived with confidence, surface it in the
tool's `needsReview` output instead of silently choosing an interpretation. Cite the
documentation you verified something against (a Microsoft Learn URL, for example) in
a code comment near the field it justifies.

## Real ZENworks data must never be committed

**No real ZENworks bundle exports, MSI files, hostnames, license keys, or any data
derived from a real environment may ever be committed to this repository** — not in
`test/fixtures/`, not in a script, not in a commit message, not anywhere. Only
synthetic, fake-valued sample data belongs here.

If you're fixing an issue found against a real bundle:

- Reproduce the *structure* with invented values (fake GUIDs, `example.invalid`
  hostnames, placeholder paths) in a new or updated fixture under `test/fixtures/`.
- Never paste real field values (product keys, internal hostnames, IP ranges,
  usernames) into an issue, PR description, commit message, or code comment — describe
  the shape, not the content.
- Check `.gitignore` before adding anything that might contain local bundle data;
  it already excludes common local-testing paths and generated output files
  (`output.json`, `intune-app.json`, `needs-review.json`, `*.msi`), but a new pattern
  of local file is your responsibility to keep out of `git add`.

## Project structure

See the top of [NEEDS_REVIEW.md](NEEDS_REVIEW.md) and the module-level comments in
`src/` for how the pieces fit together (parse → normalize → convert, plus the MSI
reader and export-directory pipeline). [docs/known-limitations.md](docs/known-limitations.md)
is the user-facing summary of what's intentionally not implemented yet — that's a
good source of ideas for a first contribution.

## Reporting bugs / limitations

Please open an issue rather than a PR if you're not sure a fix is correct — a real
(redacted/reshaped) example of a ZENworks construct the tool mishandles is the most
useful thing you can attach.
