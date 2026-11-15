// Deterministic conformance checker for Open Knowledge Format (OKF) v0.2, `ai1 okf validate`.
// Ported from the Python toolkit inherited from okf-skills (MIT), with the same checks and messages.
//
// The §11 conformance rules:
//   1. Every non-reserved `.md` file contains a parseable YAML frontmatter block.
//   2. Every frontmatter block contains a non-empty `type` field.
//   3. Reserved filenames (`index.md`, `log.md`) follow §8 / §9 when present.
// Rules 1 and 2 are errors (the bundle is non-conformant). Everything else the spec marks as soft
// guidance is a warning, fatal only with --strict / --max-warnings. Broken cross-links are NOT errors:
// the spec requires consumers to tolerate them (§6.1).
//
// v0.1 bundles still validate: the two superseded constructs (`timestamp`, a body `# Citations` list)
// are warnings pointing at their v0.2 replacements (`generated.at`, `sources`) (§13.1). --migrate does
// that rewrite in place, textually, so --strict has a door and not just a wall.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { loadOkfYaml, isYamlMapping, readOwnField, readOwnFieldOr, pythonText, strippedPythonText } from './okf-yaml.mjs';
import { splitFrontmatter, splitLines } from '../core/frontmatter.mjs';

export const OKF_VERSION = '0.2';
// `resource` is left out: the spec (§4.1) says it is absent for concepts about abstract ideas.
const RECOMMENDED_FIELDS = ['title', 'description', 'tags'];
const STATUS_VALUES = ['deprecated', 'draft', 'stable'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// RFC 3339, as the spec writes `generated.at`, `verified[].at`, `stale_after`, `sources[].last_modified`
// and `usage_window`. A date-only value is tolerated; a space instead of `T` too (PyYAML printed it so).
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:[Zz]|[+-]\d{2}:?\d{2})?)?$/;
// §7 actor shapes, reused by §5.1 for `sources[].author`. The `<prefix>:<id>` family is open, so this is
// not a whitelist: it catches a near-miss of `human:` (e.g. `Human:dana`), which §5.3 keys trust tiers
// off and would otherwise silently read as an agent.
const ACTOR_SHAPE_PATTERN = /^(?:[^\s:/]+:\S+|\S+\/\S+)$/;
const ACTOR_HUMANISH_PATTERN = /^(?:human|process)(?![A-Za-z0-9_])/i;
const FENCE_PATTERN = /^(```|~~~)/;
// [text](target), not images ![...](...)
const LINK_PATTERN = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CITATIONS_PATTERN = /^#{1,6}[ \t]+Citations[ \t]*$/m;
// A footnote reference; the definition line `[^id]: ...` matches too, harmlessly (same label).
const FOOTNOTE_PATTERN = /\[\^([^\]\s]+)\]/g;
// CommonMark has no footnotes inside code: a fence opens with 3+ backticks or tildes (up to 3 spaces in)
// and closes on a run of the same char at least as long; a code span closes on a backtick run of exactly
// its opening length and never crosses a blank line.
const FENCE_RUN_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN_PATTERN = /(?<!`)(`+)(?!`)((?:(?!\n[ \t]*\n).)+?)(?<!`)\1(?!`)/gs;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//;

// --migrate only. `timestamp` is a top-level key (§4.1): anchored at column 0.
const TIMESTAMP_LINE_PATTERN = /^timestamp:[ \t]*(.+?)[ \t]*$/m;
const HEADING_PATTERN = /^#{1,6}[ \t]/m;
// Like LINK_PATTERN plus the link text: a citation with a title attribute must not be dropped.
const MARKDOWN_LINK_PATTERN = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const OKF_VERSION_LINE_PATTERN = /^(okf_version:[ \t]*)["']?0\.1["']?[ \t]*$/m;
const CITATION_MARKER_PATTERN = /^\s*(?:[-*+]|\[\d+\]|\d+[.)])\s+/;
// Who wrote content before `generated` existed is not recoverable; a `human:` actor would fake a review.
export const MIGRATE_ACTOR = 'process:okf-migrate';

function createReport() {
  const report = { errors: [], warnings: [], concepts: 0, indexes: 0, logs: 0 };
  report.error = (relativePath, message) => report.errors.push(`${relativePath}: ${message}`);
  report.warn = (relativePath, message) => report.warnings.push(`${relativePath}: ${message}`);
  return report;
}

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

// A bundle file as text with `\n` line endings (Python's universal newlines, as the toolkit read it).
// Throws when it is not UTF-8.
export function readBundleFileText(filePath) {
  return STRICT_UTF8_DECODER.decode(readFileSync(filePath)).replace(/\r\n?/g, '\n');
}

// A file as UTF-8 text without BOM, or null after reporting it: a bad file is a per-file error.
function readBundleText(filePath, relativePath, report) {
  try {
    return readBundleFileText(filePath).replace(/^\uFEFF+/, '');
  } catch (readFailure) {
    report.error(relativePath, `cannot read file: ${readFailure.message}`);
    return null;
  }
}

export function isInsideDirectory(candidatePath, directoryPath) {
  const relativeToDirectory = relative(directoryPath, candidatePath);
  return relativeToDirectory === '' || (!relativeToDirectory.startsWith('..') && !relativeToDirectory.startsWith(sep) && !/^[a-zA-Z]:/.test(relativeToDirectory));
}

// Path.resolve() of Python: symlinks resolved for the part of the path that exists.
export function resolveExistingPrefix(targetPath) {
  const absolutePath = resolve(targetPath);
  try {
    return realpathSync(absolutePath);
  } catch {
    const parentPath = dirname(absolutePath);
    return parentPath === absolutePath ? absolutePath : join(resolveExistingPrefix(parentPath), absolutePath.slice(parentPath.length + 1));
  }
}

// §10.2 - the Attested Computation contract and its path-valued fields (§6.2). Only bundle-relative
// targets are resolved: a target outside the bundle is legitimate and unverifiable from here.
function checkComputation(meta, filePath, bundleDirectory, relativePath, report) {
  if (!strippedPythonText(readOwnFieldOr(meta, 'runtime', ''))) report.warn(relativePath, '§10.2 an Attested Computation concept requires `runtime`');
  const pathFields = [['computation', readOwnField(meta, 'computation')]];
  for (const blockName of ['executor', 'attester']) {
    const block = readOwnField(meta, blockName);
    if (isYamlMapping(block)) pathFields.push([`${blockName}.resource`, readOwnField(block, 'resource')]);
  }
  for (const [fieldWhere, fieldTarget] of pathFields) {
    if (fieldTarget == null) continue;
    const target = strippedPythonText(fieldTarget);
    if (!target || URL_SCHEME_PATTERN.test(target) || target.startsWith('mailto:')) continue;
    const candidatePath = target.startsWith('/') ? join(bundleDirectory, target.replace(/^\/+/, '')) : join(dirname(filePath), target);
    const isInside = isInsideDirectory(resolveExistingPrefix(candidatePath), resolveExistingPrefix(bundleDirectory));
    if (isInside && !existsSync(candidatePath)) report.warn(relativePath, `§6.2 \`${fieldWhere}\` points at \`${target}\`, which does not exist`);
  }
}

function checkConcept(filePath, relativePath, bundleDirectory, report) {
  report.concepts += 1;
  const text = readBundleText(filePath, relativePath, report);
  if (text === null) return;
  const { frontmatterText, bodyText } = splitFrontmatter(text);
  if (frontmatterText === null) {
    report.error(relativePath, '§11.1 no parseable YAML frontmatter block (every non-reserved `.md` in a bundle is a concept: add frontmatter with a `type` field, or move the file outside the bundle)');
    return;
  }
  let meta;
  try {
    meta = loadOkfYaml(frontmatterText);
  } catch (yamlFailure) {
    report.error(relativePath, `§11.1 frontmatter is not valid YAML: ${yamlFailure.message}`.replaceAll('\n', ' '));
    return;
  }
  if (!isYamlMapping(meta)) {
    report.error(relativePath, '§11.1 frontmatter must be a YAML mapping');
    return;
  }
  const typeValue = readOwnField(meta, 'type');
  const hasType = typeof typeValue === 'string' && typeValue.trim() !== '';
  if (!hasType) report.error(relativePath, '§11.2 missing or empty required `type` field');
  for (const fieldName of RECOMMENDED_FIELDS) {
    if (!Object.hasOwn(meta, fieldName)) report.warn(relativePath, `recommended field \`${fieldName}\` is absent (§4.1)`);
  }
  checkTrust(meta, relativePath, report);
  checkLifecycle(meta, relativePath, report);
  checkSources(meta, bodyText, relativePath, report);
  if (hasType && typeValue.trim() === 'Attested Computation') checkComputation(meta, filePath, bundleDirectory, relativePath, report);
}

// §7 - the actor convention shared by `generated.by`, `verified[].by` and `sources[].author`.
function checkActor(actorValue, fieldWhere, relativePath, report) {
  const actor = strippedPythonText(actorValue);
  if (!actor) return;
  if (ACTOR_HUMANISH_PATTERN.test(actor) && !actor.startsWith('human:') && !actor.startsWith('process:')) {
    report.warn(relativePath, `§7 \`${fieldWhere}\` \`${actor}\` is a near-miss of \`human:\`/\`process:\` — §5.3 keys trust tiers off that exact lowercase prefix, so this silently reads as an agent`);
  } else if (!ACTOR_SHAPE_PATTERN.test(actor)) {
    report.warn(relativePath, `§7 \`${fieldWhere}\` \`${actor}\` matches no actor shape (\`human:<id>\`, \`process:<id>\`, or \`<producer>/<version>\`)`);
  }
}

// §5.2 - `at` values are RFC 3339; a date-only value is tolerated.
// A recorded moment (`generated.at`, `verified.at`) cannot be later than now: a time written by hand
// ahead of the clock would make the concept look fresher than it is. A few minutes of clock skew pass.
const FUTURE_TOLERANCE_MILLISECONDS = 5 * 60 * 1000;

function instantMilliseconds(instantValue) {
  if (instantValue instanceof Date) return instantValue.getTime();
  return Date.parse(strippedPythonText(instantValue));
}

function checkInstant(instantValue, fieldWhere, relativePath, report, { notInFuture = false } = {}) {
  if (instantValue != null && !RFC3339_PATTERN.test(strippedPythonText(instantValue))) {
    report.warn(relativePath, `§5.2 \`${fieldWhere}\` \`${pythonText(instantValue)}\` is not an RFC 3339 timestamp`);
    return;
  }
  if (instantValue != null && notInFuture && instantMilliseconds(instantValue) > Date.now() + FUTURE_TOLERANCE_MILLISECONDS) {
    report.warn(relativePath, `\`${fieldWhere}\` \`${pythonText(instantValue)}\` is later than now: write the real time (\`date -u +%Y-%m-%dT%H:%M:%SZ\`)`);
  }
}

// §5.2 - `generated` / `verified`, with the v0.1 `timestamp` fallback.
function checkTrust(meta, relativePath, report) {
  const generated = readOwnField(meta, 'generated');
  if (generated == null) {
    if (Object.hasOwn(meta, 'timestamp')) report.warn(relativePath, 'legacy v0.1 `timestamp`: v0.2 records the last content change as `generated: {by, at}` (§13.1)');
    else report.warn(relativePath, 'recommended field `generated` is absent (§5.2)');
  } else if (!isYamlMapping(generated)) {
    report.warn(relativePath, '§5.2 `generated` must be a mapping with `by` and `at`');
  } else if (!strippedPythonText(readOwnFieldOr(generated, 'by', ''))) {
    report.warn(relativePath, '§5.2 `generated.by` is required within `generated`');
  } else {
    checkActor(generated.by, 'generated.by', relativePath, report);
    checkInstant(readOwnField(generated, 'at'), 'generated.at', relativePath, report, { notInFuture: true });
  }

  const verified = readOwnField(meta, 'verified');
  if (verified == null) return;
  // A bare mapping is one verification event: consumers MUST read it as a one-element list (§5.2).
  const verificationEntries = isYamlMapping(verified) ? [verified] : verified;
  if (!Array.isArray(verificationEntries)) {
    report.warn(relativePath, '§5.2 `verified` must be a `{by, at}` mapping or a list of them');
    return;
  }
  verificationEntries.forEach((verificationEntry, entryIndex) => {
    if (!(isYamlMapping(verificationEntry) && strippedPythonText(readOwnFieldOr(verificationEntry, 'by', '')))) {
      report.warn(relativePath, '§5.2 every `verified` entry needs a `by` actor');
      return;
    }
    checkActor(verificationEntry.by, `verified[${entryIndex}].by`, relativePath, report);
    checkInstant(readOwnField(verificationEntry, 'at'), `verified[${entryIndex}].at`, relativePath, report, { notInFuture: true });
  });
}

// §5.4 / §5.5 - `status` and `stale_after`.
function checkLifecycle(meta, relativePath, report) {
  const status = readOwnField(meta, 'status');
  if (status != null && !(typeof status === 'string' && STATUS_VALUES.includes(status))) {
    report.warn(relativePath, `§5.4 unknown \`status\` \`${pythonText(status)}\` (expected ${STATUS_VALUES.join('|')})`);
  }
  const staleAfter = readOwnField(meta, 'stale_after');
  if (staleAfter != null && !RFC3339_PATTERN.test(pythonText(staleAfter))) {
    report.warn(relativePath, `§5.5 \`stale_after\` \`${pythonText(staleAfter)}\` is not an ISO 8601 datetime (a bare date is tolerated)`);
  }
}

// §5.1 - a `usage_window` is a `{from, to}` pair of ISO 8601 datetimes.
function checkUsageWindow(usageWindow, fieldWhere, relativePath, report) {
  if (usageWindow == null) return;
  if (!isYamlMapping(usageWindow)) {
    report.warn(relativePath, `§5.1 \`${fieldWhere}\` \`usage_window\` must be a \`{from, to}\` mapping`);
    return;
  }
  for (const windowBound of ['from', 'to']) {
    const boundValue = readOwnField(usageWindow, windowBound);
    if (boundValue == null) report.warn(relativePath, `§5.1 \`${fieldWhere}\` \`usage_window\` is missing \`${windowBound}\``);
    else if (!RFC3339_PATTERN.test(pythonText(boundValue))) {
      report.warn(relativePath, `§5.1 \`${fieldWhere}\` \`usage_window.${windowBound}\` \`${pythonText(boundValue)}\` is not an ISO 8601 datetime (a bare date is tolerated)`);
    }
  }
}

// The body without fenced blocks and inline code spans.
export function stripMarkdownCode(bodyText) {
  const keptLines = [];
  let openFence = '';
  for (const line of splitLines(bodyText)) {
    const fenceMatch = FENCE_RUN_PATTERN.exec(line);
    if (openFence) {
      if (fenceMatch && fenceMatch[1][0] === openFence[0] && fenceMatch[1].length >= openFence.length && !line.slice(fenceMatch[0].length).trim()) openFence = '';
      continue;
    }
    if (fenceMatch && !(fenceMatch[1][0] === '`' && line.slice(fenceMatch[0].length).includes('`'))) {
      openFence = fenceMatch[1];
      continue;
    }
    keptLines.push(line);
  }
  return keptLines.join('\n').replace(CODE_SPAN_PATTERN, '');
}

// §5.1 - the `sources` provenance family and its footnote join keys.
function checkSources(meta, bodyText, relativePath, report) {
  if (CITATIONS_PATTERN.test(bodyText)) report.warn(relativePath, 'legacy v0.1 `# Citations` body list: v0.2 records provenance in the `sources` frontmatter (§13.1)');
  const sources = readOwnField(meta, 'sources');
  if (sources == null) return;
  if (!Array.isArray(sources)) {
    report.warn(relativePath, '§5.1 `sources` must be a list of entries');
    return;
  }
  const sourceIds = new Set();
  sources.forEach((sourceEntry, sourceIndex) => {
    if (!isYamlMapping(sourceEntry)) {
      report.warn(relativePath, `§5.1 \`sources[${sourceIndex}]\` must be a mapping`);
      return;
    }
    if (!strippedPythonText(readOwnFieldOr(sourceEntry, 'resource', ''))) report.warn(relativePath, `§5.1 \`sources[${sourceIndex}]\` is missing the required \`resource\``);
    if (Object.hasOwn(sourceEntry, 'id')) sourceIds.add(pythonText(sourceEntry.id));
    // ai1 extension: `role: evidence` cites a file as proof without the concept describing it (file map).
    if (readOwnField(sourceEntry, 'role') != null && pythonText(sourceEntry.role) !== 'evidence') {
      report.warn(relativePath, `\`sources[${sourceIndex}].role\` \`${pythonText(sourceEntry.role)}\` is not \`evidence\` (the only role ai1 reads; omit it otherwise)`);
    }
    if (readOwnField(sourceEntry, 'author') != null) checkActor(sourceEntry.author, `sources[${sourceIndex}].author`, relativePath, report);
    // `usage_count` is framed by a `usage_window`, a sibling of `sources` or overridden on the entry.
    const usageWindow = readOwnFieldOr(sourceEntry, 'usage_window', readOwnField(meta, 'usage_window'));
    if (readOwnField(sourceEntry, 'usage_count') != null && usageWindow == null) {
      report.warn(relativePath, `§5.1 \`sources[${sourceIndex}].usage_count\` has no \`usage_window\` framing it (a sibling of \`sources\`, or on the entry)`);
    }
    checkUsageWindow(usageWindow, `sources[${sourceIndex}]`, relativePath, report);
    const lastModified = readOwnField(sourceEntry, 'last_modified');
    if (lastModified != null && !RFC3339_PATTERN.test(pythonText(lastModified))) {
      report.warn(relativePath, `§5.1 \`sources[${sourceIndex}].last_modified\` \`${pythonText(lastModified)}\` is not an ISO 8601 datetime (a bare date is tolerated)`);
    }
  });
  // Attribution joins on the label (§5.1); a regex class in a code span is not a footnote.
  const footnoteLabels = new Set([...stripMarkdownCode(bodyText).matchAll(FOOTNOTE_PATTERN)].map((footnoteMatch) => footnoteMatch[1]));
  for (const footnoteLabel of [...footnoteLabels].filter((label) => !sourceIds.has(label)).sort()) {
    report.warn(relativePath, `§5.1 footnote \`[^${footnoteLabel}]\` matches no \`sources[].id\``);
  }
}

function pythonSortedRepr(values) {
  return `[${[...values].sort().map((value) => `'${value}'`).join(', ')}]`;
}

function checkIndex(filePath, relativePath, isRootIndex, report) {
  report.indexes += 1;
  const text = readBundleText(filePath, relativePath, report);
  if (text === null) return;
  const { frontmatterText } = splitFrontmatter(text);
  if (frontmatterText === null) return;
  if (!isRootIndex) {
    report.warn(relativePath, '§8 index.md should contain no frontmatter');
    return;
  }
  let meta;
  try {
    meta = loadOkfYaml(frontmatterText) || {};
  } catch {
    report.warn(relativePath, '§12 root index.md frontmatter is not valid YAML');
    meta = {};
  }
  // `upkeep` and `recursive` ride along (upstream's Stop hook read them here); §11 forbids rejecting
  // a bundle for unknown keys.
  const frontmatterKeys = isYamlMapping(meta) ? Object.keys(meta) : [];
  const extraKeys = frontmatterKeys.filter((key) => !['okf_version', 'upkeep', 'recursive'].includes(key));
  if (extraKeys.length) report.warn(relativePath, `§12 root index.md frontmatter may only carry \`okf_version\`, \`upkeep\`, \`recursive\` (found ${pythonSortedRepr(extraKeys)})`);
  const declaredVersion = readOwnField(meta, 'okf_version');
  if (declaredVersion != null && pythonText(declaredVersion) !== OKF_VERSION) {
    report.warn(relativePath, `§12 bundle declares \`okf_version: "${pythonText(declaredVersion)}"\`; checked against v${OKF_VERSION}`);
  }
}

function checkLog(filePath, relativePath, report) {
  report.logs += 1;
  const text = readBundleText(filePath, relativePath, report);
  if (text === null) return;
  if (splitFrontmatter(text).frontmatterText !== null) report.warn(relativePath, '§9 log.md should contain no frontmatter');
  for (const line of splitLines(text)) {
    if (!line.startsWith('## ')) continue;
    const heading = line.slice(3).trim();
    if (!ISO_DATE_PATTERN.test(heading)) report.warn(relativePath, `§9 date heading \`${heading}\` is not ISO 8601 YYYY-MM-DD`);
  }
}

// Link targets of a file outside fenced blocks. An unreadable file was already reported: no second error.
export function collectLinkTargets(filePath) {
  try {
    return listLinkTargets(readBundleFileText(filePath));
  } catch {
    return [];
  }
}

// Markdown link targets ([text](target), not images) outside fenced blocks.
export function listLinkTargets(text) {
  const linkTargets = [];
  let isInFence = false;
  for (const line of splitLines(text)) {
    if (FENCE_PATTERN.test(line.trim())) {
      isInFence = !isInFence;
      continue;
    }
    if (isInFence) continue;
    for (const linkMatch of line.matchAll(LINK_PATTERN)) linkTargets.push(linkMatch[1]);
  }
  return linkTargets;
}

// Broken bundle-internal links are warnings only (§6.1).
function checkLinks(bundleDirectory, markdownFiles, report) {
  const existingPaths = new Set(markdownFiles.map((markdownFile) => markdownFile.relativePath));
  const resolvedBundle = resolveExistingPrefix(bundleDirectory);
  for (const { filePath, relativePath } of markdownFiles) {
    for (const linkTarget of collectLinkTargets(filePath)) {
      const targetPath = linkTarget.split('#')[0];
      if (!targetPath || targetPath.endsWith('/')) continue;
      if (URL_SCHEME_PATTERN.test(targetPath) || targetPath.startsWith('mailto:')) continue;
      if (!targetPath.endsWith('.md')) continue;
      let resolvedTarget;
      if (targetPath.startsWith('/')) resolvedTarget = targetPath.replace(/^\/+/, '');
      else {
        const absoluteTarget = resolveExistingPrefix(join(dirname(filePath), targetPath));
        resolvedTarget = isInsideDirectory(absoluteTarget, resolvedBundle) ? relative(resolvedBundle, absoluteTarget).split(sep).join('/') : targetPath;
      }
      if (!existingPaths.has(resolvedTarget)) report.warn(relativePath, `cross-link target not found: \`${linkTarget}\` (tolerated under §6.1)`);
    }
  }
}

function compareRelativePaths(firstFile, secondFile) {
  const firstParts = firstFile.relativePath.split('/');
  const secondParts = secondFile.relativePath.split('/');
  for (let partIndex = 0; partIndex < Math.min(firstParts.length, secondParts.length); partIndex += 1) {
    if (firstParts[partIndex] !== secondParts[partIndex]) return firstParts[partIndex] < secondParts[partIndex] ? -1 : 1;
  }
  return firstParts.length - secondParts.length;
}

// Every `.md` file under the bundle, sorted as Python sorted its paths (by path component):
// [{ filePath, relativePath, fileName }].
export function listMarkdownFiles(bundleDirectory) {
  const markdownFiles = [];
  const visitDirectory = (directoryPath) => {
    for (const directoryEntry of readdirSync(directoryPath, { withFileTypes: true })) {
      const entryPath = join(directoryPath, directoryEntry.name);
      if (directoryEntry.isDirectory()) visitDirectory(entryPath);
      else if (directoryEntry.name.endsWith('.md')) {
        let isFile = directoryEntry.isFile();
        if (directoryEntry.isSymbolicLink()) {
          try { isFile = statSync(entryPath).isFile(); } catch { isFile = false; }
        }
        if (isFile) markdownFiles.push({ filePath: entryPath, relativePath: relative(bundleDirectory, entryPath).split(sep).join('/'), fileName: directoryEntry.name });
      }
    }
  };
  visitDirectory(bundleDirectory);
  return markdownFiles.sort(compareRelativePaths);
}

// { errors, warnings, concepts, indexes, logs } for the bundle at bundleDirectory.
export function validateOkfBundle(bundleDirectory) {
  const report = createReport();
  const markdownFiles = listMarkdownFiles(bundleDirectory);
  for (const { filePath, relativePath, fileName } of markdownFiles) {
    if (fileName === 'index.md') checkIndex(filePath, relativePath, !relativePath.includes('/'), report);
    else if (fileName === 'log.md') checkLog(filePath, relativePath, report);
    else checkConcept(filePath, relativePath, bundleDirectory, report);
  }
  checkLinks(bundleDirectory, markdownFiles, report);
  const { errors, warnings, concepts, indexes, logs } = report;
  return { errors, warnings, concepts, indexes, logs };
}

// A `# Citations` section split into citation entries (from a list marker over its continuation
// lines) and leftover prose, which stays in the body.
function splitCitationSection(sectionText) {
  const citationEntries = [];
  const keptProse = [];
  let currentEntry = null;
  let currentProse = [];
  for (const line of splitLines(sectionText)) {
    if (!line.trim()) {
      if (currentEntry !== null) { citationEntries.push(currentEntry.join(' ')); currentEntry = null; }
      if (currentProse.length) { keptProse.push(currentProse.join('\n')); currentProse = []; }
      continue;
    }
    if (CITATION_MARKER_PATTERN.test(line)) {
      if (currentEntry !== null) citationEntries.push(currentEntry.join(' '));
      currentEntry = [line.replace(CITATION_MARKER_PATTERN, '').trim()];
    } else if (currentEntry !== null) currentEntry.push(line.trim());
    else currentProse.push(line);
  }
  if (currentEntry !== null) citationEntries.push(currentEntry.join(' '));
  if (currentProse.length) keptProse.push(currentProse.join('\n'));
  return { citationEntries, keptProse };
}

// Hoists a v0.1 `# Citations` list into the `sources` family (§5.1, §13.1).
function moveCitationsToSources(frontmatterText, bodyText) {
  const headingMatch = CITATIONS_PATTERN.exec(bodyText);
  if (!headingMatch) return { frontmatterText, bodyText };
  const headingEnd = headingMatch.index + headingMatch[0].length;
  const restText = bodyText.slice(headingEnd);
  const nextHeading = HEADING_PATTERN.exec(restText);
  const sectionText = nextHeading ? restText.slice(0, nextHeading.index) : restText;
  const tailText = nextHeading ? restText.slice(nextHeading.index) : '';
  const { citationEntries, keptProse } = splitCitationSection(sectionText);
  const foundSources = [];
  for (const citationEntry of citationEntries) {
    const entryLinks = [...citationEntry.matchAll(MARKDOWN_LINK_PATTERN)];
    if (entryLinks.length) foundSources.push(...entryLinks.map((entryLink) => [entryLink[1], entryLink[2]]));
    else {
      // A plain-text citation (a file path, a document name) is still a source.
      const backtickPath = /`([^`]+)`/.exec(citationEntry);
      foundSources.push([citationEntry.replaceAll('`', ''), backtickPath ? backtickPath[1] : citationEntry]);
    }
  }
  if (!foundSources.length) return { frontmatterText, bodyText };
  // JSON strings are valid YAML double-quoted scalars.
  const sourcesBlock = 'sources:\n' + foundSources.map(([sourceTitle, sourceUrl]) => `  - resource: ${JSON.stringify(sourceUrl)}\n    title: ${JSON.stringify(sourceTitle)}\n`).join('');
  let keptBody = bodyText.slice(0, headingMatch.index).replace(/\n+$/, '');
  // Prose inside the section (e.g. "Related: [a](a.md)") is not a citation: it keeps its own heading.
  if (keptProse.length) keptBody += '\n\n# Related\n\n' + keptProse.join('\n\n');
  return { frontmatterText: frontmatterText + sourcesBlock, bodyText: keptBody + (tailText ? '\n\n' + tailText : '\n') };
}

// One file's v0.1 constructs rewritten to v0.2, or null when nothing changes. Textual on purpose, so
// comments, key order and quoting survive; each branch is skipped when the v0.2 key is already there.
export function migrateOkfText(text, isRootIndex) {
  const { frontmatterText, bodyText } = splitFrontmatter(text);
  if (frontmatterText === null) return null;
  if (isRootIndex) {
    const newFrontmatterText = frontmatterText.replace(OKF_VERSION_LINE_PATTERN, `$1"${OKF_VERSION}"`);
    return newFrontmatterText === frontmatterText ? null : `---\n${newFrontmatterText}---\n${bodyText}`;
  }
  let meta;
  try {
    meta = loadOkfYaml(frontmatterText);
  } catch {
    return null;
  }
  if (!isYamlMapping(meta)) return null;
  let newFrontmatterText = frontmatterText;
  let newBodyText = bodyText;
  if (!Object.hasOwn(meta, 'generated')) {
    newFrontmatterText = newFrontmatterText.replace(TIMESTAMP_LINE_PATTERN, (_timestampLine, timestampValue) => `generated:\n  by: ${MIGRATE_ACTOR}\n  at: ${timestampValue}`);
  }
  if (!Object.hasOwn(meta, 'sources')) ({ frontmatterText: newFrontmatterText, bodyText: newBodyText } = moveCitationsToSources(newFrontmatterText, newBodyText));
  if (newFrontmatterText === frontmatterText && newBodyText === bodyText) return null;
  return `---\n${newFrontmatterText}---\n${newBodyText}`;
}

// Migrates a bundle in place; returns the relative paths rewritten. Line endings become `\n`.
export function migrateOkfBundle(bundleDirectory) {
  const changedPaths = [];
  for (const { filePath, relativePath, fileName } of listMarkdownFiles(bundleDirectory)) {
    if (fileName === 'log.md') continue;
    const isRootIndex = relativePath === 'index.md';
    if (fileName === 'index.md' && !isRootIndex) continue;
    let text;
    try {
      text = readBundleFileText(filePath);
    } catch {
      continue;
    }
    const migratedText = migrateOkfText(text.replace(/^\uFEFF+/, ''), isRootIndex);
    if (migratedText !== null && migratedText !== text) {
      writeFileSync(filePath, migratedText, 'utf8');
      changedPaths.push(relativePath);
    }
  }
  return changedPaths;
}

export const OKF_VALIDATE_USAGE = 'ai1 okf validate <bundle-dir> [--strict | --max-warnings N] [--migrate] [--json]';

// `ai1 okf validate`: prints the report and returns the exit code (0 passed, 1 failed, 2 bad usage).
export function runOkfValidateCommand(validateArguments, writeOutput = console.log, writeError = console.error) {
  const bundleArgument = validateArguments.find((validateArgument, argumentIndex) => !validateArgument.startsWith('--') && validateArguments[argumentIndex - 1] !== '--max-warnings');
  const maxWarningsIndex = validateArguments.indexOf('--max-warnings');
  const maxWarningsOption = maxWarningsIndex >= 0 ? Number.parseInt(validateArguments[maxWarningsIndex + 1], 10) : null;
  if (!bundleArgument || Number.isNaN(maxWarningsOption)) {
    writeError(`usage: ${OKF_VALIDATE_USAGE}`);
    return 2;
  }
  let isDirectory = false;
  try { isDirectory = statSync(bundleArgument).isDirectory(); } catch { isDirectory = false; }
  if (!isDirectory) {
    writeError(`error: ${bundleArgument} is not a directory`);
    return 2;
  }
  const wantsMigrate = validateArguments.includes('--migrate');
  const migratedPaths = wantsMigrate ? migrateOkfBundle(bundleArgument) : [];
  const report = validateOkfBundle(bundleArgument);
  const isConformant = report.errors.length === 0;
  const maxWarnings = validateArguments.includes('--strict') ? 0 : maxWarningsOption;
  const hasFailed = !isConformant || (maxWarnings !== null && report.warnings.length > maxWarnings);

  if (validateArguments.includes('--json')) {
    writeOutput(JSON.stringify({
      bundle: bundleArgument,
      conformant: isConformant,
      passed: !hasFailed,
      counts: { concepts: report.concepts, indexes: report.indexes, logs: report.logs },
      errors: report.errors,
      warnings: report.warnings,
      migrated: migratedPaths,
    }, null, 2));
    return hasFailed ? 1 : 0;
  }
  if (wantsMigrate) {
    for (const migratedPath of migratedPaths) writeOutput(`  \x1b[36m→ migrated\x1b[0m  ${migratedPath}`);
    writeOutput(`  migrated ${migratedPaths.length} file(s) to v${OKF_VERSION}${migratedPaths.length ? `, \`generated.by\` recorded as \`${MIGRATE_ACTOR}\`` : ''}`);
    if (migratedPaths.length) {
      writeOutput('  note: per-claim attribution (the `[^id]` footnotes of §5.1) is not recoverable from a v0.1 `# Citations` list — sources moved up, but which claim cited which was never encoded.');
    }
  }
  writeOutput(`OKF v${OKF_VERSION} conformance — ${bundleArgument}`);
  writeOutput(`  concepts: ${report.concepts}   index.md: ${report.indexes}   log.md: ${report.logs}`);
  for (const errorLine of report.errors) writeOutput(`  \x1b[31m✗ ERROR\x1b[0m  ${errorLine}`);
  for (const warningLine of report.warnings) writeOutput(`  \x1b[33m! warn \x1b[0m  ${warningLine}`);
  if (isConformant && !report.warnings.length) writeOutput('  \x1b[32m✓ conformant — no issues\x1b[0m');
  else if (isConformant) writeOutput(`  \x1b[32m✓ conformant\x1b[0m (${report.warnings.length} warning(s))`);
  else writeOutput(`  \x1b[31m✗ non-conformant\x1b[0m (${report.errors.length} error(s))`);
  return hasFailed ? 1 : 0;
}
