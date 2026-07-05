import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { BundleParseError } from './errors.js';

// Parses the `<BundleName>_ActionContentInfo.xml` sidecar file that
// accompanies a real ZENworks bundle export. Observed structure (reconciled
// against a real export on 2026-07-05 - see NEEDS_REVIEW.md):
//
//   <ActionInformation>
//     <ActionSet type="Install">
//       <Action name="..." type="Install MSI Action" index="1">
//         <Content>
//           <ContentFilePath ...attrs...>relative/path/to/installer.msi</ContentFilePath>
//         </Content>
//       </Action>
//     </ActionSet>
//   </ActionInformation>
//
// The ContentFilePath text is a path RELATIVE TO THE EXPORT DIRECTORY (the
// directory holding the main bundle XML), pointing into the export's
// `<BundleName>_content/<hash>/` folder. Unlike the main bundle XML, this
// sidecar carries no XML namespaces.

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  trimValues: true,
};

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node === undefined || node === null) return null;
  if (typeof node === 'object') {
    if ('#text' in node) return String(node['#text']).trim();
    return null;
  }
  return String(node).trim();
}

function attrOf(node, attrName) {
  const value = node?.[`@_${attrName}`];
  return value === undefined ? null : value;
}

/**
 * Deterministically parses an _ActionContentInfo.xml sidecar string into a
 * flat list of content entries:
 *   { actionSetType, actionName, actionType, actionIndex, contentFilePath }
 * Throws BundleParseError on malformed XML or a missing root; missing
 * per-entry fields surface in `warnings` rather than being guessed at.
 */
export function parseActionContentInfo(xmlString) {
  if (typeof xmlString !== 'string' || xmlString.trim().length === 0) {
    throw new BundleParseError('Input XML is empty or not a string');
  }

  const validation = XMLValidator.validate(xmlString);
  if (validation !== true) {
    const { code, msg, line, col } = validation.err ?? {};
    throw new BundleParseError(
      `Malformed XML: ${msg ?? 'unknown error'} (code ${code ?? 'n/a'}, line ${line ?? '?'}, col ${col ?? '?'})`,
    );
  }

  const parser = new XMLParser(parserOptions);
  let doc;
  try {
    doc = parser.parse(xmlString, true);
  } catch (err) {
    throw new BundleParseError(`Failed to parse XML: ${err.message}`);
  }

  const root = doc.ActionInformation;
  if (!root || typeof root !== 'object') {
    throw new BundleParseError('Missing root <ActionInformation> element', { path: '/ActionInformation' });
  }

  const warnings = [];
  const entries = [];

  asArray(root.ActionSet).forEach((actionSet, setIndex) => {
    const setPath = `/ActionInformation/ActionSet[${setIndex}]`;
    const actionSetType = attrOf(actionSet, 'type');
    if (!actionSetType) {
      warnings.push({ code: 'content_action_set_missing_type', message: 'ActionSet is missing a type attribute', path: setPath });
    }

    asArray(actionSet.Action).forEach((action, actionIndex) => {
      const actionPath = `${setPath}/Action[${actionIndex}]`;
      const contentPaths = asArray(action.Content).flatMap((content) => asArray(content.ContentFilePath));

      if (contentPaths.length === 0) {
        warnings.push({ code: 'content_action_has_no_path', message: 'Action has no Content/ContentFilePath entries', path: actionPath });
        return;
      }

      contentPaths.forEach((contentFilePath, pathIndex) => {
        const filePath = textOf(contentFilePath);
        if (!filePath) {
          warnings.push({
            code: 'content_path_empty',
            message: 'ContentFilePath element has no path text',
            path: `${actionPath}/Content/ContentFilePath[${pathIndex}]`,
          });
          return;
        }
        entries.push({
          actionSetType,
          actionName: attrOf(action, 'name'),
          actionType: attrOf(action, 'type'),
          actionIndex: attrOf(action, 'index'),
          contentFilePath: filePath,
        });
      });
    });
  });

  return { entries, warnings };
}
