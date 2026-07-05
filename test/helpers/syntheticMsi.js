import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'createSyntheticMsi.ps1');

// Entirely fake, test-only values (GUIDs deliberately implausible).
export const SYNTHETIC_MSI_PROPS = Object.freeze({
  ProductCode: '{11111111-2222-3333-4444-555555555555}',
  UpgradeCode: '{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}',
  ProductVersion: '1.0.0',
  ProductName: 'Synthetic Test App',
  Manufacturer: 'Synthetic Vendor',
  ALLUSERS: '1',
});

/**
 * Creates a minimal synthetic .msi (Property table only, fake values) at
 * msiPath. Returns true on success, false when the environment can't do it
 * (non-Windows, or Windows Installer COM unavailable) - callers should skip
 * their test in that case rather than fail it.
 */
export async function tryCreateSyntheticMsi(msiPath, props = SYNTHETIC_MSI_PROPS) {
  if (process.platform !== 'win32') return false;
  try {
    await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH],
      {
        env: {
          ...process.env,
          ZEN2INTUNE_TEST_MSI_PATH: msiPath,
          ZEN2INTUNE_TEST_MSI_PROPS: JSON.stringify(props),
        },
        timeout: 60_000,
        windowsHide: true,
      },
    );
    return true;
  } catch {
    return false;
  }
}
