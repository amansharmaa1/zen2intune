# Zen2Intune AI Migration Assistant

Zen2Intune helps you migrate application packages from **ZENworks** (Micro Focus /
OpenText's device management product) to **Microsoft Intune**. You give it a ZENworks
bundle export (an XML file), and it produces a draft Intune Win32 app package
(install/uninstall commands, requirement rules, and related fields) as JSON.

**This output is a starting point, not a finished, deployment-ready package.** Some
fields cannot be filled in automatically from what ZENworks exports and are left
blank with an explanation instead of a guess. For MSI-based bundles whose export
includes the installer file, the tool now reads the MSI itself and generates a
product-code **detection rule** automatically (Windows only); for script-based
bundles you must still add a detection rule by hand. See
[NEEDS_REVIEW.md](NEEDS_REVIEW.md) for the full, current list of what's automatic
and what you'll need to fill in by hand.

## What this tool does not do (yet)

- It does **not** upload anything to a live Intune tenant. It only produces a JSON
  package on your machine - you still create the app in Intune yourself (e.g. via the
  Microsoft Intune admin center or Graph Explorer).
- It does **not** generate or run any PowerShell automation for deployment. (It does
  use two small built-in PowerShell scripts internally, on Windows only, to read
  MSI file properties.)
- It does **not** generate detection rules for **script-based** bundles - only for
  MSI-based bundles whose export directory contains the actual `.msi` file. In every
  other case you'll need to add at least one detection rule yourself before the app
  can be deployed.

## Prerequisites

- **Node.js version 20 or later.**
- No account or subscription is required to use the parsing/conversion phases. The
  optional AI interpretation step requires an Anthropic API key (see below).

## Installing

From the project folder, install dependencies:

```sh
npm install
```

## The quick path: convert a whole export directory

If you have a full ZENworks bundle export directory (the folder containing the
bundle's `.xml`, its `_ActionContentInfo.xml` sidecar, and its `_content` folder
with the installer), one call runs the entire pipeline - including reading the MSI's
product code for the detection rule (Windows only):

```js
import { writeFileSync } from 'node:fs';
import { convertBundleExportDirectory } from './src/pipeline/convertBundleExport.js';

const { app, needsReview } = await convertBundleExportDirectory(
  'C:\\path\\to\\Bundles\\My App Bundle',
);

writeFileSync('intune-app.json', JSON.stringify(app, null, 2));
writeFileSync('needs-review.json', JSON.stringify(needsReview, null, 2));
```

Always read `needs-review.json` afterwards - it lists everything that could not be
derived and still needs your attention.

## The step-by-step path: four phases

There is currently no packaged command-line tool - each phase is a small function you
call from a short Node.js script. This section shows exactly how.

### Phase 1: Parse a ZENworks bundle export

Reads a ZENworks bundle export XML file and pulls out its install actions, scripts,
conditions, and dependencies into a plain JavaScript object.

```js
import { readFileSync } from 'node:fs';
import { parseBundleXml } from './src/parser/parseBundle.js';

const xml = readFileSync('my-bundle-export.xml', 'utf8');
const rawBundle = parseBundleXml(xml);
```

If the XML is malformed or missing required fields, `parseBundleXml` throws an error
rather than guessing - fix the input and re-run.

### Phase 2: Build the structured JSON

Takes Phase 1's output and turns it into the tool's canonical, validated
representation of the bundle.

```js
import { normalizeBundle } from './src/schema/normalize.js';

const structuredBundle = normalizeBundle(rawBundle);
```

### Phase 3: Convert to an Intune Win32 app package

Takes the structured bundle and produces a draft Intune app package, plus a list of
items that need your attention (`needsReview`).

```js
import { convertToIntunePackage } from './src/intune/convertBundle.js';

const { app, needsReview } = convertToIntunePackage(structuredBundle);

console.log(JSON.stringify(app, null, 2));
console.log(`${needsReview.length} item(s) need manual review.`);
```

Putting phases 1-3 together into one script and writing the result to a file:

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBundleXml } from './src/parser/parseBundle.js';
import { normalizeBundle } from './src/schema/normalize.js';
import { convertToIntunePackage } from './src/intune/convertBundle.js';

const xml = readFileSync('my-bundle-export.xml', 'utf8');
const { app, needsReview } = convertToIntunePackage(normalizeBundle(parseBundleXml(xml)));

writeFileSync('intune-app.json', JSON.stringify(app, null, 2));
writeFileSync('needs-review.json', JSON.stringify(needsReview, null, 2));
```

### Phase 4 (optional): AI interpretation

For items flagged in `needsReview`, this step asks an AI model (Claude) for a
suggested resolution and a confidence level - it's a suggestion for you to check, not
an automatic fix.

**This step requires an Anthropic API key.** Set it as an environment variable before
running your script:

```sh
export ANTHROPIC_API_KEY=your-key-here
```

Then:

```js
import { interpretBundle } from './src/ai/anthropicProvider.js';

const { annotations } = await interpretBundle(structuredBundle);
console.log(annotations);
```

If `ANTHROPIC_API_KEY` isn't set, this throws an `AiProviderNotConfiguredError`
instead of returning a made-up answer. This step makes a real call to Anthropic's API,
which is billed to your account.

## Running the test suite

```sh
npm test
```

This runs all tests using Node's built-in test runner. To run a single test file:

```sh
node --test test/parser.test.js
```

## Known limitations

This project maintains a running, detailed log of what's verified, what's flagged for
manual review, and what hasn't been implemented yet, in
**[NEEDS_REVIEW.md](NEEDS_REVIEW.md)**. Read it before relying on this tool's output -
it's kept up to date and is more specific than anything summarized here.

## A note on real data

Never commit real ZENworks bundle exports (or any file derived from your actual
environment) to this repository - only synthetic, fake-valued sample data belongs
here.
