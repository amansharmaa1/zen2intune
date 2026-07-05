import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

import { convertBundleExportDirectory, BundleExportError } from '../src/pipeline/convertBundleExport.js';
import { tryCreateSyntheticMsi, SYNTHETIC_MSI_PROPS } from './helpers/syntheticMsi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

// Assembles a synthetic export directory shaped like a real ZENworks export:
//   <name>.xml, <name>_ActionContentInfo.xml, <name>_content/<hash>/<file>
// using the (synthetic, fake-valued) fixtures. The MSI binary itself is only
// created in the Windows-gated end-to-end test.
const BUNDLE_BASE = 'Sample MSI App - Install';
const MSI_REL_PATH = `${BUNDLE_BASE}_content/1111111111111111111111111111111f/ExampleApp-1.0.0-x64.msi`;

async function makeExportDir({ withSidecar = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zen2intune-export-'));
  await copyFile(path.join(FIXTURES, 'sample-bundle-basic.xml'), path.join(dir, `${BUNDLE_BASE}.xml`));
  if (withSidecar) {
    await copyFile(
      path.join(FIXTURES, 'sample-actioncontentinfo.xml'),
      path.join(dir, `${BUNDLE_BASE}${SIDECAR_NAME_SUFFIX}`),
    );
  }
  return dir;
}
const SIDECAR_NAME_SUFFIX = '_ActionContentInfo.xml';

function codesOf(needsReview) {
  return needsReview.map((r) => r.code);
}

test('end to end: export directory with a (synthetic) MSI produces a payload with a working ProductCode detection rule', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Creating/reading the synthetic MSI requires Windows Installer COM');
    return;
  }
  const dir = await makeExportDir();
  try {
    const msiPath = path.join(dir, MSI_REL_PATH);
    await mkdir(path.dirname(msiPath), { recursive: true });
    if (!(await tryCreateSyntheticMsi(msiPath))) {
      t.skip('Could not create a synthetic MSI (Windows Installer COM unavailable?)');
      return;
    }

    const { app, needsReview, msiProductInfo } = await convertBundleExportDirectory(dir);

    assert.equal(msiProductInfo.productCode, SYNTHETIC_MSI_PROPS.ProductCode);

    // The full, deployment-relevant core of the payload is present.
    assert.equal(app['@odata.type'], '#microsoft.graph.win32LobApp');
    assert.equal(app.displayName, 'Sample MSI App - Install');
    assert.match(app.installCommandLine, /^msiexec \/i /);
    assert.match(app.uninstallCommandLine, /^msiexec \/x /);
    assert.equal(app.fileName, 'ExampleApp-1.0.0-x64.msi');
    assert.equal(app.setupFilePath, 'ExampleApp-1.0.0-x64.msi');
    assert.equal(app.publisher, SYNTHETIC_MSI_PROPS.Manufacturer);

    const detectionRules = app.rules.filter((r) => r.ruleType === 'detection');
    assert.equal(detectionRules.length, 1);
    assert.equal(detectionRules[0]['@odata.type'], '#microsoft.graph.win32LobAppProductCodeRule');
    assert.equal(detectionRules[0].productCode, SYNTHETIC_MSI_PROPS.ProductCode);

    assert.equal(app.msiInformation.productCode, SYNTHETIC_MSI_PROPS.ProductCode);
    assert.equal(app.msiInformation.packageType, 'perMachine');

    const codes = codesOf(needsReview);
    assert.ok(!codes.includes('no_detection_rule_derivable'));
    assert.ok(!codes.includes('content_file_missing'));
    assert.ok(!codes.includes('msi_read_failed'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('flags a sidecar whose content file is missing, and still converts the rest (no detection rule)', async () => {
  const dir = await makeExportDir(); // sidecar present, but no _content folder created
  try {
    const { app, needsReview, msiProductInfo } = await convertBundleExportDirectory(dir);

    assert.equal(msiProductInfo, null);
    assert.match(app.installCommandLine, /^msiexec \/i /);
    assert.deepEqual(app.rules.filter((r) => r.ruleType === 'detection'), []);

    const codes = codesOf(needsReview);
    assert.ok(codes.includes('content_file_missing'));
    assert.ok(codes.includes('no_detection_rule_derivable'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('flags a missing sidecar entirely, and still converts the rest', async () => {
  const dir = await makeExportDir({ withSidecar: false });
  try {
    const { app, needsReview, msiProductInfo } = await convertBundleExportDirectory(dir);

    assert.equal(msiProductInfo, null);
    assert.match(app.installCommandLine, /^msiexec \/i /);

    const codes = codesOf(needsReview);
    assert.ok(codes.includes('content_sidecar_missing'));
    assert.ok(codes.includes('no_detection_rule_derivable'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refuses a sidecar content path that escapes the export directory', async () => {
  const dir = await makeExportDir({ withSidecar: false });
  try {
    const sidecar = (await readFile(path.join(FIXTURES, 'sample-actioncontentinfo.xml'), 'utf8'))
      .replace(/<ContentFilePath([^>]*)>[^<]*<\/ContentFilePath>/, '<ContentFilePath$1>../../outside.msi</ContentFilePath>');
    await writeFile(path.join(dir, `${BUNDLE_BASE}${SIDECAR_NAME_SUFFIX}`), sidecar);

    const { needsReview, msiProductInfo } = await convertBundleExportDirectory(dir);
    assert.equal(msiProductInfo, null);
    assert.ok(codesOf(needsReview).includes('content_path_escapes_export_directory'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('throws BundleExportError when the directory has no bundle XML, or an ambiguous set of them', async () => {
  const emptyDir = await mkdtemp(path.join(tmpdir(), 'zen2intune-export-'));
  try {
    await assert.rejects(() => convertBundleExportDirectory(emptyDir), BundleExportError);

    await copyFile(path.join(FIXTURES, 'sample-bundle-basic.xml'), path.join(emptyDir, 'one.xml'));
    await copyFile(path.join(FIXTURES, 'sample-bundle-basic.xml'), path.join(emptyDir, 'two.xml'));
    await assert.rejects(() => convertBundleExportDirectory(emptyDir), BundleExportError);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
});
