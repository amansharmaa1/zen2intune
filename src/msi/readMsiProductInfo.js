import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

// Reads an MSI file's identity properties (ProductCode etc.) from its
// Property table, read-only, via the Windows Installer automation interface
// (see the doc citations in readMsiProductInfo.ps1). This is deterministic
// extraction of ground truth from the installer binary itself - the ZENworks
// bundle XML does NOT carry a ProductCode anywhere (verified against real
// exports, see NEEDS_REVIEW.md), so the MSI file is the only non-fabricated
// source for an Intune win32LobAppProductCodeRule detection rule.
//
// Windows-only by nature: the Windows Installer COM automation interface
// (WindowsInstaller.Installer, msi.dll) has no cross-platform equivalent
// shipped here. On other platforms this throws MsiReadError rather than
// pretending; callers surface that as a needsReview item.

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'readMsiProductInfo.ps1');

// Standard MSI ProductCode/UpgradeCode form: a braced, hyphenated GUID.
export const MSI_GUID_PATTERN = /^\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}$/;

export class MsiReadError extends Error {
  constructor(message, { cause } = {}) {
    super(message);
    this.name = 'MsiReadError';
    if (cause) this.cause = cause;
  }
}

function nonEmptyOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Reads { productCode, productVersion, productName, manufacturer,
 * upgradeCode, allUsers } from an MSI file's Property table. Throws
 * MsiReadError when the platform can't do it, the file can't be read, or the
 * ProductCode is missing/malformed - it never fabricates or repairs a value.
 */
export async function readMsiProductInfo(msiPath) {
  if (process.platform !== 'win32') {
    throw new MsiReadError(
      'Reading MSI properties requires the Windows Installer COM automation interface (msi.dll), which is only available on Windows.',
    );
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
      {
        env: { ...process.env, ZEN2INTUNE_MSI_PATH: msiPath },
        timeout: 60_000,
        windowsHide: true,
      },
    ));
  } catch (err) {
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
    throw new MsiReadError(
      `Failed to read MSI properties from "${msiPath}"${stderr ? `: ${stderr}` : ''}`,
      { cause: err },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new MsiReadError('MSI property reader returned unparseable output', { cause: err });
  }

  const productCode = nonEmptyOrNull(parsed.productCode);
  if (!productCode || !MSI_GUID_PATTERN.test(productCode)) {
    throw new MsiReadError(
      `MSI Property table has no well-formed ProductCode (got ${productCode === null ? 'nothing' : 'a non-GUID value'}) - refusing to produce a detection rule from it.`,
    );
  }

  const upgradeCode = nonEmptyOrNull(parsed.upgradeCode);

  return {
    productCode,
    productVersion: nonEmptyOrNull(parsed.productVersion),
    productName: nonEmptyOrNull(parsed.productName),
    manufacturer: nonEmptyOrNull(parsed.manufacturer),
    // UpgradeCode is optional in an MSI; pass through only when well-formed,
    // since a malformed one would be rejected by Graph anyway.
    upgradeCode: upgradeCode && MSI_GUID_PATTERN.test(upgradeCode) ? upgradeCode : null,
    allUsers: nonEmptyOrNull(parsed.allUsers),
  };
}
