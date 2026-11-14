// `ai1 okf visualize <bundle-dir>`: the bundle as one self-contained interactive HTML graph (viz.html).
// Concepts are nodes (coloured by `type`, sized by body length), markdown links and bundle-internal
// `sources` are edges; clicking a node opens its rendered markdown, v0.2 trust/lifecycle/provenance
// and its backlinks. The page is templates/okf-viz.html. Ported from okf_visualize.py (okf-skills, MIT).
//
// The default layout is force (cose) up to AUTO_COSE_MAX concepts, then the linear concentric layout:
// force cost grows roughly quadratically and freezes the page on large bundles. --layout always wins.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, basename, normalize, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOkfYaml, isYamlMapping, readOwnField, readOwnFieldOr, pythonText } from './okf-yaml.mjs';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { listMarkdownFiles, listLinkTargets, resolveExistingPrefix, isInsideDirectory, readBundleFileText } from './okf-validate.mjs';

const VIZ_TEMPLATE_PATH = fileURLToPath(new URL('../../templates/okf-viz.html', import.meta.url));
const RESERVED_FILE_NAMES = new Set(['index.md', 'log.md']);
// Force layout froze the page ~32 s at ~2k concepts (Chrome); linear layouts load it in under 2 s.
const AUTO_COSE_MAX = 1000;
// Above this the page is slow on any layout (23k concepts: ~27 s, ~650 MB) and reads as a hairball.
const SCALE_WARN = 5000;
const LAYOUT_NAMES = ['cose', 'concentric', 'breadthfirst', 'circle', 'grid'];

export const OKF_VISUALIZE_USAGE = 'ai1 okf visualize <bundle-dir> [-o viz.html] [-t "<title>"] [-l <source-url>] [--layout cose|concentric|breadthfirst|circle|grid] [--max-nodes N] [--og-image <url>]';

// Python truthiness of a YAML value, for the `a or b` fallbacks of the original.
function isTruthy(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (isYamlMapping(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

// JSON for an inline <script>: every `<` escaped, so a body with `</script>` or `<!--` cannot end it.
function jsonForScript(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

// The concept id a link or `sources[].resource` names, or null (external, asset, outside the bundle).
function resolveConceptId(target, filePath, resolvedBundle) {
  const targetPath = pythonText(target).split('#')[0];
  if (!targetPath.endsWith('.md')) return null;
  if (targetPath.startsWith('/')) return targetPath.replace(/^\/+/, '').slice(0, -3);
  const candidatePath = resolveExistingPrefix(join(dirname(filePath), targetPath));
  return isInsideDirectory(candidatePath, resolvedBundle) ? relative(resolvedBundle, candidatePath).split(sep).join('/').slice(0, -3) : null;
}

// §5.1 `sources`, flattened for display; `cid` when the source is a concept of this bundle (an edge).
function readSources(meta, filePath, resolvedBundle) {
  const sources = readOwnField(meta, 'sources');
  if (!Array.isArray(sources)) return [];
  return sources.filter(isYamlMapping).map((sourceEntry) => {
    const resource = pythonText(readOwnFieldOr(sourceEntry, 'resource', '')).trim();
    // An entry's own `usage_window` overrides the one written once next to `sources`.
    const usageWindow = readOwnFieldOr(sourceEntry, 'usage_window', readOwnField(meta, 'usage_window'));
    const titleValue = [readOwnField(sourceEntry, 'title'), readOwnField(sourceEntry, 'id')].find(isTruthy);
    const lastModified = readOwnField(sourceEntry, 'last_modified');
    return {
      title: titleValue === undefined ? resource : pythonText(titleValue),
      resource,
      cid: resource ? resolveConceptId(resource, filePath, resolvedBundle) : null,
      author: pythonText(readOwnFieldOr(sourceEntry, 'author', '')),
      usage_count: readOwnField(sourceEntry, 'usage_count') ?? null,
      usage_window: isYamlMapping(usageWindow) ? `${pythonText(readOwnFieldOr(usageWindow, 'from', '?'))}→${pythonText(readOwnFieldOr(usageWindow, 'to', '?'))}` : '',
      last_modified: isTruthy(lastModified) ? pythonText(lastModified) : '',
    };
  });
}

// §5.2 `generated` / `verified`, falling back to a v0.1 `timestamp` (§13.1).
function readTrust(meta) {
  const generated = readOwnField(meta, 'generated');
  const timestamp = readOwnField(meta, 'timestamp');
  let generatedEntry = null;
  if (isYamlMapping(generated)) generatedEntry = { by: pythonText(readOwnFieldOr(generated, 'by', '')), at: pythonText(readOwnFieldOr(generated, 'at', '')) };
  else if (isTruthy(timestamp)) generatedEntry = { by: '', at: pythonText(timestamp) };
  const verified = readOwnField(meta, 'verified');
  // A bare mapping is one verification event (§5.2).
  const verificationEntries = isYamlMapping(verified) ? [verified] : (Array.isArray(verified) ? verified : []);
  return {
    generated: generatedEntry,
    verified: verificationEntries.filter(isYamlMapping).map((verificationEntry) => ({ by: pythonText(readOwnFieldOr(verificationEntry, 'by', '')), at: pythonText(readOwnFieldOr(verificationEntry, 'at', '')) })),
  };
}

function readFrontmatterMeta(text) {
  const { frontmatterText, bodyText } = splitFrontmatter(text);
  if (frontmatterText === null) return { meta: {}, bodyText: text };
  let meta;
  try {
    meta = loadOkfYaml(frontmatterText) || {};
  } catch {
    meta = {};
  }
  return { meta: isYamlMapping(meta) ? meta : {}, bodyText };
}

// { nodes, edges } of the bundle's graph.
export function buildBundleGraph(bundleDirectory, writeWarning = (line) => process.stderr.write(`${line}\n`)) {
  const resolvedBundle = resolveExistingPrefix(bundleDirectory);
  const conceptFiles = listMarkdownFiles(bundleDirectory).filter(({ fileName }) => !RESERVED_FILE_NAMES.has(fileName));
  const conceptIds = new Set(conceptFiles.map(({ relativePath }) => relativePath.slice(0, -3)));
  const nodes = [];
  const edges = [];
  const seenEdges = new Set();
  for (const { filePath, relativePath, fileName } of conceptFiles) {
    const conceptId = relativePath.slice(0, -3);
    let text;
    try {
      text = readBundleFileText(filePath).replace(/^\uFEFF+/, '');
    } catch (readFailure) {
      writeWarning(`warning: skipping ${relativePath}: cannot read file: ${readFailure.message}`);
      conceptIds.delete(conceptId);
      continue;
    }
    const { meta, bodyText: rawBody } = readFrontmatterMeta(text);
    const bodyCharacters = [...rawBody.trim()];
    const { generated, verified } = readTrust(meta);
    const sources = readSources(meta, filePath, resolvedBundle);
    const tags = readOwnField(meta, 'tags');
    const staleAfter = readOwnField(meta, 'stale_after');
    nodes.push({
      id: conceptId,
      type: pythonText(readOwnFieldOr(meta, 'type', 'Untyped')),
      title: pythonText(readOwnFieldOr(meta, 'title', fileName.slice(0, -3))),
      description: pythonText(readOwnFieldOr(meta, 'description', '')),
      tags: Array.isArray(tags) ? tags : [],
      group: conceptId.includes('/') ? conceptId.split('/')[0] : '(root)',
      sz: Math.max(24, Math.min(70, 24 + Math.floor(bodyCharacters.length / 200))),
      status: pythonText(readOwnFieldOr(meta, 'status', '')),
      stale_after: isTruthy(staleAfter) ? pythonText(staleAfter) : '',
      generated,
      verified,
      sources,
      body: bodyCharacters.slice(0, 8000).join(''),
    });
    const linkTargets = [...listLinkTargets(bodyCharacters.join('')), ...sources.filter((source) => source.cid).map((source) => source.resource)];
    for (const linkTarget of linkTargets) {
      const targetId = resolveConceptId(linkTarget, filePath, resolvedBundle);
      const edgeKey = `${conceptId}\n${targetId}`;
      if (targetId && conceptIds.has(targetId) && targetId !== conceptId && !seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({ source: conceptId, target: targetId });
      }
    }
  }
  return { nodes, edges };
}

const escapeAttribute = (text) => (text || '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Path.name of Python for the path as given ('' for '.').
function pathName(givenPath) {
  const normalizedPath = normalize(givenPath).replace(/[\\/]+$/, '');
  return normalizedPath === '.' ? '' : basename(normalizedPath);
}

// Writes the page; returns { nodeCount, edgeCount } or throws when --max-nodes is exceeded.
export function renderBundleGraph(bundleDirectory, outputPath, { title, link, layout, ogImage, maxNodes } = {}, writeWarning = (line) => process.stderr.write(`${line}\n`)) {
  const { nodes, edges } = buildBundleGraph(bundleDirectory, writeWarning);
  if (maxNodes != null && nodes.length > maxNodes) throw new Error(`${nodes.length} concepts exceeds --max-nodes ${maxNodes}`);
  let initialLayout = layout;
  if (!initialLayout) {
    initialLayout = nodes.length <= AUTO_COSE_MAX ? 'cose' : 'concentric';
    if (initialLayout !== 'cose') writeWarning(`note: ${nodes.length} concepts > ${AUTO_COSE_MAX} — using the linear 'concentric' layout (force freezes the page at this size; pass --layout cose to override)`);
  }
  if (nodes.length > SCALE_WARN) writeWarning(`warning: ${nodes.length} concepts — the page will load slowly and read as a hairball; consider rendering a subtree, e.g. ai1 okf visualize ${bundleDirectory}/<subdir>`);
  const graphName = title || `${basename(dirname(resolve(bundleDirectory)))}/${pathName(bundleDirectory)}`;
  const substitutions = {
    __NAME__: graphName,
    __LINK__: link ? ` <a class="src" href="${link}" target="_blank" rel="noopener">source ↗</a>` : '',
    __LAYOUT__: initialLayout,
    __COSEMAX__: String(AUTO_COSE_MAX),
    __OGTITLE__: escapeAttribute(`OKF — ${graphName}`),
    __OGDESC__: escapeAttribute(`${nodes.length} concepts · interactive Open Knowledge Format knowledge graph`),
    __OGIMAGE__: ogImage ? `<meta property="og:image" content="${escapeAttribute(ogImage)}">\n<meta name="twitter:image" content="${escapeAttribute(ogImage)}">` : '',
    __N__: String(nodes.length),
    __E__: String(edges.length),
    __NODES__: jsonForScript(nodes),
    __EDGES__: jsonForScript(edges),
  };
  // One pass, longest marker first: substituted content (a body mentioning "__EDGES__") is never rescanned.
  const markerPattern = new RegExp(Object.keys(substitutions).sort((first, second) => second.length - first.length).join('|'), 'g');
  writeFileSync(outputPath, readFileSync(VIZ_TEMPLATE_PATH, 'utf8').replace(markerPattern, (marker) => substitutions[marker]));
  return { nodeCount: nodes.length, edgeCount: edges.length };
}

const OPTION_ALIASES = { '-o': '--out', '-t': '--title', '-l': '--link' };
const OPTIONS_WITH_VALUE = new Set(['--out', '--title', '--link', '--layout', '--max-nodes', '--og-image']);

// `ai1 okf visualize`: returns the exit code (0 rendered, 1 refused, 2 bad usage).
export function runOkfVisualizeCommand(visualizeArguments, writeOutput = console.log, writeError = console.error) {
  const options = {};
  let bundleDirectory;
  for (let argumentIndex = 0; argumentIndex < visualizeArguments.length; argumentIndex += 1) {
    const optionName = OPTION_ALIASES[visualizeArguments[argumentIndex]] || visualizeArguments[argumentIndex];
    if (OPTIONS_WITH_VALUE.has(optionName)) {
      options[optionName] = visualizeArguments[argumentIndex + 1];
      argumentIndex += 1;
    } else if (!optionName.startsWith('-') && bundleDirectory === undefined) bundleDirectory = optionName;
    else {
      writeError(`usage: ${OKF_VISUALIZE_USAGE}`);
      return 2;
    }
  }
  const maxNodes = options['--max-nodes'] === undefined ? null : Number.parseInt(options['--max-nodes'], 10);
  const hasMissingValue = [...OPTIONS_WITH_VALUE].some((optionName) => Object.hasOwn(options, optionName) && options[optionName] === undefined);
  if (!bundleDirectory || hasMissingValue || Number.isNaN(maxNodes) || (options['--layout'] && !LAYOUT_NAMES.includes(options['--layout']))) {
    writeError(`usage: ${OKF_VISUALIZE_USAGE}`);
    return 2;
  }
  let isDirectory = false;
  try { isDirectory = statSync(bundleDirectory).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) {
    writeError(`error: ${bundleDirectory} is not a directory`);
    return 2;
  }
  const outputPath = options['--out'] || join(bundleDirectory, 'viz.html');
  try {
    const { nodeCount, edgeCount } = renderBundleGraph(bundleDirectory, outputPath, {
      title: options['--title'], link: options['--link'], layout: options['--layout'], ogImage: options['--og-image'], maxNodes,
    }, writeError);
    writeOutput(`rendered ${nodeCount} concepts, ${edgeCount} links -> ${outputPath}`);
    return 0;
  } catch (renderFailure) {
    writeError(`error: ${renderFailure.message}`);
    return 1;
  }
}
