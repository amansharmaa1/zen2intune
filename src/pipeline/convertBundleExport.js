import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

import { parseBundleXml } from '../parser/parseBundle.js';
import { parseActionContentInfo } from '../parser/parseActionContentInfo.js';
import { normalizeBundle } from '../schema/normalize.js';
import { convertToIntunePackage } from '../intune/convertBundle.js';
import { readMsiProductInfo, MsiReadError } from '../msi/readMsiProductInfo.js';

// End-to-end converter for a real ZENworks bundle EXPORT DIRECTORY, i.e. the
// folder that holds (observed layout, reconciled against real exports - see
// NEEDS_REVIEW.md):
//   <BundleName>.xml                      - the bundle export itself
//   <BundleName>.properties               - Java-properties sidecar (ignored)
//   <BundleName>_ActionContentInfo.xml    - content sidecar (optional)
//   <BundleName>_content/<hash>/<file>    - the actual installer binary(ies)
//
// Composes the deterministic stages: parse XML -> normalize -> (resolve MSI
// via sidecar + read its Property table) -> convert. Everything that can't be
// resolved becomes a needsReview item (stage "content-resolution") rather
// than a guess; only structural impossibilities (no/ambiguous main XML) throw.

const SIDECAR_SUFFIX = '_ActionContentInfo.xml';

export class BundleExportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BundleExportError';
  }
}

function reviewItem(code, message, path_) {
  return { code, message, path: path_, severity: 'warning', stage: 'content-resolution' };
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

// Finds the single MSI content entry for the Install ActionSet, or explains
// (via review items) why there isn't exactly one.
function selectMsiContentEntry(entries, sidecarName, pipelineReview) {
  const msiEntries = entries.filter(
    (e) => e.actionSetType === 'Install' && e.actionType === 'Install MSI Action',
  );
  if (msiEntries.length === 0) {
    pipelineReview.push(reviewItem(
      'content_sidecar_has_no_msi_entry',
      `${sidecarName} has no Install/"Install MSI Action" content entry - no installer file to read a ProductCode from.`,
      `/${sidecarName}`,
    ));
    return null;
  }
  if (msiEntries.length > 1) {
    pipelineReview.push(reviewItem(
      'content_sidecar_ambiguous_msi_entries',
      `${sidecarName} lists ${msiEntries.length} Install MSI content entries; refusing to pick one.`,
      `/${sidecarName}`,
    ));
    return null;
  }
  return msiEntries[0];
}

export async function convertBundleExportDirectory(bundleDir) {
  const dirEntries = await readdir(bundleDir);

  const mainXmlNames = dirEntries.filter(
    (name) => name.toLowerCase().endsWith('.xml') && !name.toLowerCase().endsWith(SIDECAR_SUFFIX.toLowerCase()),
  );
  if (mainXmlNames.length === 0) {
    throw new BundleExportError(`No bundle XML found in ${bundleDir}`);
  }
  if (mainXmlNames.length > 1) {
    throw new BundleExportError(
      `Found ${mainXmlNames.length} candidate bundle XML files in ${bundleDir} - expected exactly one (a ZENworks export directory holds a single bundle).`,
    );
  }
  const mainXmlName = mainXmlNames[0];

  const rawParsed = parseBundleXml(await readFile(path.join(bundleDir, mainXmlName), 'utf8'));
  const structuredBundle = normalizeBundle(rawParsed);

  const pipelineReview = [];
  let msiProductInfo = null;

  const sidecarName = mainXmlName.slice(0, -'.xml'.length) + SIDECAR_SUFFIX;
  if (!dirEntries.includes(sidecarName)) {
    pipelineReview.push(reviewItem(
      'content_sidecar_missing',
      `No ${sidecarName} sidecar found next to the bundle XML - cannot locate the installer binary, so no MSI properties (and no ProductCode detection rule) can be derived.`,
      `/${sidecarName}`,
    ));
  } else {
    const sidecar = parseActionContentInfo(await readFile(path.join(bundleDir, sidecarName), 'utf8'));
    for (const warning of sidecar.warnings) {
      pipelineReview.push(reviewItem(warning.code, warning.message, warning.path));
    }

    const msiEntry = selectMsiContentEntry(sidecar.entries, sidecarName, pipelineReview);
    if (msiEntry) {
      // The sidecar's ContentFilePath is relative to the export directory.
      // Resolve it and refuse anything that escapes the directory - the
      // sidecar is input data, not trusted configuration.
      const msiPath = path.resolve(bundleDir, msiEntry.contentFilePath);
      const containedIn = path.resolve(bundleDir) + path.sep;
      if (!msiPath.startsWith(containedIn)) {
        pipelineReview.push(reviewItem(
          'content_path_escapes_export_directory',
          `${sidecarName} points at a content path outside the export directory - refusing to read it.`,
          `/${sidecarName}`,
        ));
      } else if (!(await fileExists(msiPath))) {
        pipelineReview.push(reviewItem(
          'content_file_missing',
          `The content file referenced by ${sidecarName} does not exist under the export directory (expected at the sidecar's relative path) - no MSI properties can be read.`,
          `/${sidecarName}`,
        ));
      } else {
        try {
          msiProductInfo = await readMsiProductInfo(msiPath);
        } catch (err) {
          if (!(err instanceof MsiReadError)) throw err;
          pipelineReview.push(reviewItem(
            'msi_read_failed',
            `Reading the MSI's Property table failed, so no ProductCode detection rule was generated: ${err.message}`,
            `/${sidecarName}`,
          ));
        }
      }
    }
  }

  const { app, needsReview } = convertToIntunePackage(structuredBundle, { msiProductInfo });
  return {
    app,
    needsReview: [...needsReview, ...pipelineReview],
    structuredBundle,
    msiProductInfo,
  };
}
