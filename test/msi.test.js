import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { readMsiProductInfo, MsiReadError, MSI_GUID_PATTERN } from '../src/msi/readMsiProductInfo.js';
import { tryCreateSyntheticMsi, SYNTHETIC_MSI_PROPS } from './helpers/syntheticMsi.js';

// These tests exercise the real Windows Installer COM path against a
// SYNTHETIC MSI created on the fly (fake values only - no real installer is
// used or committed). On non-Windows platforms, or if the COM interface is
// unavailable, they skip with a reason instead of failing - which also means
// a skip here is a signal the module is untestable in that environment, not
// that it works there.

test('reads identity properties back from a synthetic MSI', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Installer COM is only available on Windows');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'zen2intune-msi-'));
  try {
    const msiPath = path.join(dir, 'synthetic.msi');
    if (!(await tryCreateSyntheticMsi(msiPath))) {
      t.skip('Could not create a synthetic MSI (Windows Installer COM unavailable?)');
      return;
    }

    const info = await readMsiProductInfo(msiPath);
    assert.equal(info.productCode, SYNTHETIC_MSI_PROPS.ProductCode);
    assert.equal(info.upgradeCode, SYNTHETIC_MSI_PROPS.UpgradeCode);
    assert.equal(info.productVersion, '1.0.0');
    assert.equal(info.productName, 'Synthetic Test App');
    assert.equal(info.manufacturer, 'Synthetic Vendor');
    assert.equal(info.allUsers, '1');
    assert.match(info.productCode, MSI_GUID_PATTERN);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('throws MsiReadError when the MSI lacks a well-formed ProductCode', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Installer COM is only available on Windows');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'zen2intune-msi-'));
  try {
    const msiPath = path.join(dir, 'no-productcode.msi');
    const created = await tryCreateSyntheticMsi(msiPath, {
      ProductName: 'App With No ProductCode',
      ProductVersion: '1.0.0',
    });
    if (!created) {
      t.skip('Could not create a synthetic MSI (Windows Installer COM unavailable?)');
      return;
    }

    await assert.rejects(() => readMsiProductInfo(msiPath), MsiReadError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('throws MsiReadError for a missing file', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Installer COM is only available on Windows');
    return;
  }
  await assert.rejects(
    () => readMsiProductInfo(path.join(tmpdir(), 'zen2intune-does-not-exist.msi')),
    MsiReadError,
  );
});

test('throws MsiReadError for a file that is not an MSI database', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows Installer COM is only available on Windows');
    return;
  }
  const dir = await mkdtemp(path.join(tmpdir(), 'zen2intune-msi-'));
  try {
    const fakePath = path.join(dir, 'not-really.msi');
    await writeFile(fakePath, 'this is just text, not a compound file');
    await assert.rejects(() => readMsiProductInfo(fakePath), MsiReadError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
