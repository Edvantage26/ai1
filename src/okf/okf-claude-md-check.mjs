// CLAUDE.md drift check (feature `okf`): the repo's CLAUDE.md files are loaded whole in every
// session, while the bundle is read on demand, so knowledge that piles up in CLAUDE.md costs tokens
// every time and drifts from the bundle. Deterministic, no LLM: per section of each CLAUDE.md it
// reports overlap with a concept, long sections no concept covers, and references that no longer
// exist. Used by the okf-claude-md hook (okf-claude-md.mjs, one hint at session start) and by `ai1 claude-md` (the
// full report for /ai1:okf-tidy-claude-md, which does the judging and rewriting on request).

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, posix } from 'node:path';
import { tryGit } from '../core/git.mjs';
import { listBundleConcepts } from './okf-bundle.mjs';
import { normalizeKeywords } from './okf-recall.mjs';
import { readBodyCodePaths, stripLocation } from './okf-file-map.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

export const MAX_CLAUDE_MD_LINES = 80;
export const MAX_CLAUDE_MD_CHARACTERS = 6000;
const MIN_OVERLAP_SECTION_LINES = 6;
const MIN_KNOWLEDGE_SECTION_LINES = 12;
const MIN_OVERLAP_KEYWORDS = 3;
const MIN_OVERLAP_SHARE = 0.6;
// "About" keywords found in this share of concepts or more (`hooks`, `repo`, `code` in most bundles)
// say nothing about which concept a section matches.
const COMMON_ABOUT_KEYWORD_RATIO = 0.2;
// Paths cited as `resource` or `sources` (file-map strength >= 2); body citations would make overview
// concepts match every section.
const MIN_PATH_CITATION_STRENGTH = 2;
const HEADING_PATTERN = /^(#{1,3})\s+(.+?)\s*#*\s*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const MARKDOWN_LINK_PATTERN = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const PLACEHOLDER_PATTERN = /[*<>{}$[\]?|=]/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;

// Tracked and new (not ignored) repo files, minus those deleted from the checkout; null without git.
export function listRepoFiles(projectRoot) {
  const listedOutput = tryGit(projectRoot, ['ls-files', '--cached', '--others', '--exclude-standard']);
  if (listedOutput === null) return null;
  const deletedFiles = new Set((tryGit(projectRoot, ['ls-files', '--deleted']) || '').split('\n'));
  return [...new Set(listedOutput.split('\n').filter((listedPath) => listedPath && !deletedFiles.has(listedPath)))];
}

// The repo's files named CLAUDE.md, outside the bundle. Without git, the root one.
export function listClaudeMdFiles(projectRoot, repoFiles) {
  if (repoFiles === null) return existsSync(join(projectRoot, 'CLAUDE.md')) ? ['CLAUDE.md'] : [];
  return repoFiles
    .filter((repoFile) => basename(repoFile) === 'CLAUDE.md' && !repoFile.startsWith(`${KNOWLEDGE_BUNDLE_PATH}/`)
      && existsSync(join(projectRoot, repoFile)))
    .sort();
}

// Flat sections, one per heading (#, ## or ###) outside fenced blocks; text before the first heading
// is a section with an empty heading. `line` (the heading's) and `endLine` are 1-based.
export function splitClaudeMdSections(claudeMdText) {
  const sections = [{ heading: '', line: 1, bodyLines: [] }];
  let isInsideFence = false;
  claudeMdText.split(/\r?\n/).forEach((textLine, lineIndex) => {
    if (FENCE_PATTERN.test(textLine)) isInsideFence = !isInsideFence;
    const headingMatch = !isInsideFence && HEADING_PATTERN.exec(textLine);
    if (headingMatch) sections.push({ heading: headingMatch[2], line: lineIndex + 1, bodyLines: [] });
    else sections[sections.length - 1].bodyLines.push(textLine);
  });
  return sections
    .map(({ heading, line, bodyLines }) => ({
      heading,
      line,
      endLine: (heading ? line : 0) + bodyLines.length,
      bodyText: bodyLines.join('\n'),
      contentLineCount: bodyLines.filter((bodyLine) => bodyLine.trim()).length,
    }))
    .filter((section) => section.heading || section.contentLineCount);
}

// Per concept: the keywords that say what it is about (title, tags, description, minus the common
// ones) and the repo paths it cites strongly. `fileMap` is the okf-file-map map.
export function buildConceptOverlapCatalog(bundleDirectory, fileMap) {
  const strongPathsByConcept = new Map(fileMap.map((conceptEntry) => [conceptEntry.conceptPath,
    conceptEntry.citedPaths.filter((citedPath) => citedPath.strength >= MIN_PATH_CITATION_STRENGTH)]));
  const conceptEntries = listBundleConcepts(bundleDirectory).map((bundleConcept) => {
    const conceptPath = bundleConcept.relativePath.split('\\').join('/');
    return {
      conceptPath,
      title: bundleConcept.title || conceptPath,
      aboutKeywords: normalizeKeywords([bundleConcept.title, bundleConcept.tags, bundleConcept.description].filter(Boolean).join(' ')),
      strongPaths: strongPathsByConcept.get(conceptPath) || [],
    };
  });
  const aboutKeywordFrequency = new Map();
  for (const conceptEntry of conceptEntries) {
    for (const aboutKeyword of conceptEntry.aboutKeywords) aboutKeywordFrequency.set(aboutKeyword, (aboutKeywordFrequency.get(aboutKeyword) || 0) + 1);
  }
  const commonKeywordThreshold = Math.max(2, conceptEntries.length * COMMON_ABOUT_KEYWORD_RATIO);
  return conceptEntries.map((conceptEntry) => ({
    ...conceptEntry,
    aboutKeywords: new Set(conceptEntry.aboutKeywords.filter((aboutKeyword) => aboutKeywordFrequency.get(aboutKeyword) < commonKeywordThreshold)),
  }));
}

// The concept a section overlaps most, or null: most of the concept's "about" keywords appear in the
// section, or the section cites a path the concept describes.
export function findOverlappingConcept(sectionText, overlapCatalog) {
  const sectionKeywords = new Set(normalizeKeywords(sectionText));
  const sectionPaths = readBodyCodePaths(sectionText, new Set()).map((citedPath) => citedPath.path);
  let bestOverlap = null;
  for (const conceptEntry of overlapCatalog) {
    const matchedKeywordCount = [...conceptEntry.aboutKeywords].filter((aboutKeyword) => sectionKeywords.has(aboutKeyword)).length;
    const keywordShare = conceptEntry.aboutKeywords.size ? matchedKeywordCount / conceptEntry.aboutKeywords.size : 0;
    const keywordScore = matchedKeywordCount >= MIN_OVERLAP_KEYWORDS && keywordShare >= MIN_OVERLAP_SHARE ? keywordShare : 0;
    const citesConceptPath = sectionPaths.some((sectionPath) => conceptEntry.strongPaths.some((strongPath) => (strongPath.isFolder
      ? sectionPath.startsWith(strongPath.path) : sectionPath === strongPath.path)));
    const overlapScore = Math.max(keywordScore, citesConceptPath ? 1 : 0);
    if (overlapScore && (!bestOverlap || overlapScore > bestOverlap.overlapScore)) bestOverlap = { ...conceptEntry, overlapScore };
  }
  return bestOverlap;
}

// Backticked paths and relative markdown links that look like repo files or folders. A backticked
// candidate needs a `/` and an extension or a trailing `/` (`owner/repo` or `text/html` are not paths).
export function readClaudeMdReferences(claudeMdText) {
  const references = [];
  let isInsideFence = false;
  claudeMdText.split(/\r?\n/).forEach((textLine, lineIndex) => {
    if (FENCE_PATTERN.test(textLine)) isInsideFence = !isInsideFence;
    if (isInsideFence) return;
    for (const inlineCodeMatch of textLine.matchAll(INLINE_CODE_PATTERN)) {
      const citedText = stripLocation(inlineCodeMatch[1]);
      if (!citedText.includes('/') || /\s/.test(citedText) || URI_SCHEME_PATTERN.test(citedText)) continue;
      if (/^([/~]|@\/)/.test(citedText) || PLACEHOLDER_PATTERN.test(citedText)) continue;
      if (citedText.endsWith('/') || FILE_EXTENSION_PATTERN.test(citedText)) references.push({ reference: citedText, line: lineIndex + 1, isLink: false });
    }
    for (const linkMatch of textLine.matchAll(MARKDOWN_LINK_PATTERN)) {
      const linkTarget = linkMatch[1].replace(/#.*$/, '');
      if (!linkTarget || URI_SCHEME_PATTERN.test(linkTarget) || /^[/~]/.test(linkTarget) || PLACEHOLDER_PATTERN.test(linkTarget)) continue;
      references.push({ reference: linkTarget, line: lineIndex + 1, isLink: true });
    }
  });
  return references;
}

// A reference resolves from the CLAUDE.md's own folder or, for backticked paths, from the repo root or
// as the end of any repo file path (`app/main.py` written for a `backend/` subproject).
function referenceExists(projectRoot, claudeMdPath, { reference, isLink }, repoFiles) {
  const fromFileFolder = posix.normalize(posix.join(posix.dirname(claudeMdPath), reference));
  if (!fromFileFolder.startsWith('..') && existsSync(join(projectRoot, fromFileFolder))) return true;
  if (isLink) return false;
  if (existsSync(join(projectRoot, reference))) return true;
  const referenceSuffix = `/${reference.replace(/^\.\//, '')}`;
  return (repoFiles || []).some((repoFile) => (referenceSuffix.endsWith('/')
    ? `/${repoFile}`.includes(referenceSuffix) : `/${repoFile}`.endsWith(referenceSuffix)));
}

// Findings of one CLAUDE.md: [{ kind, line, section?, conceptPath?, conceptTitle?, reference? }].
export function checkClaudeMdText(projectRoot, claudeMdPath, claudeMdText, overlapCatalog, repoFiles = null) {
  const claudeMdFindings = [];
  const lineCount = claudeMdText.split(/\r?\n/).length;
  if (lineCount > MAX_CLAUDE_MD_LINES || claudeMdText.length > MAX_CLAUDE_MD_CHARACTERS) {
    claudeMdFindings.push({ kind: 'too-long', line: 1, lineCount, characterCount: claudeMdText.length });
  }
  for (const section of splitClaudeMdSections(claudeMdText)) {
    if (section.contentLineCount < MIN_OVERLAP_SECTION_LINES) continue;
    const overlappingConcept = findOverlappingConcept(`${section.heading}\n${section.bodyText}`, overlapCatalog);
    if (overlappingConcept) {
      claudeMdFindings.push({ kind: 'duplicates-concept', line: section.line, endLine: section.endLine, section: section.heading, conceptPath: overlappingConcept.conceptPath, conceptTitle: overlappingConcept.title });
    } else if (section.contentLineCount >= MIN_KNOWLEDGE_SECTION_LINES) {
      claudeMdFindings.push({ kind: 'knowledge-without-concept', line: section.line, endLine: section.endLine, section: section.heading, lineCount: section.contentLineCount });
    }
  }
  for (const claudeMdReference of readClaudeMdReferences(claudeMdText)) {
    if (!referenceExists(projectRoot, claudeMdPath, claudeMdReference, repoFiles)) {
      claudeMdFindings.push({ kind: 'stale-reference', line: claudeMdReference.line, reference: claudeMdReference.reference });
    }
  }
  return claudeMdFindings.sort((firstFinding, secondFinding) => firstFinding.line - secondFinding.line);
}

// [{ path, findings }] for every CLAUDE.md of the repo that has findings.
export function checkClaudeMdFiles(projectRoot, bundleDirectory, fileMap) {
  const overlapCatalog = buildConceptOverlapCatalog(bundleDirectory, fileMap);
  const repoFiles = listRepoFiles(projectRoot);
  return listClaudeMdFiles(projectRoot, repoFiles)
    .map((claudeMdPath) => ({
      path: claudeMdPath,
      findings: checkClaudeMdText(projectRoot, claudeMdPath, readFileSync(join(projectRoot, claudeMdPath), 'utf8'), overlapCatalog, repoFiles),
    }))
    .filter((claudeMdReport) => claudeMdReport.findings.length);
}

// One line per finding, for the CLI.
export function formatClaudeMdReport(claudeMdReports) {
  if (!claudeMdReports.length) return 'CLAUDE.md: nothing to tidy.';
  const reportLines = [];
  for (const { path, findings } of claudeMdReports) {
    for (const finding of findings) {
      const location = `${path}:${finding.line}${finding.endLine ? `-${finding.endLine}` : ''}`;
      const sectionName = finding.section ? `"${finding.section}"` : 'top of the file';
      if (finding.kind === 'too-long') reportLines.push(`${location} too-long: ${finding.lineCount} lines, ${finding.characterCount} characters (limits ${MAX_CLAUDE_MD_LINES} / ${MAX_CLAUDE_MD_CHARACTERS})`);
      if (finding.kind === 'duplicates-concept') reportLines.push(`${location} duplicates-concept: section ${sectionName} overlaps ${KNOWLEDGE_BUNDLE_PATH}/${finding.conceptPath} (${finding.conceptTitle})`);
      if (finding.kind === 'knowledge-without-concept') reportLines.push(`${location} knowledge-without-concept: section ${sectionName} (${finding.lineCount} lines) matches no concept; candidate to move into the bundle`);
      if (finding.kind === 'stale-reference') reportLines.push(`${location} stale-reference: \`${finding.reference}\` does not exist`);
    }
  }
  return reportLines.join('\n');
}

// The session-start hint: counts per kind, no detail (the CLI has it).
export function summarizeClaudeMdReports(claudeMdReports) {
  const allFindings = claudeMdReports.flatMap((claudeMdReport) => claudeMdReport.findings);
  const countOf = (findingKind) => allFindings.filter((finding) => finding.kind === findingKind).length;
  const summaryParts = [];
  const longFiles = claudeMdReports.filter((claudeMdReport) => claudeMdReport.findings.some((finding) => finding.kind === 'too-long'));
  if (longFiles.length) summaryParts.push(`${longFiles.map((claudeMdReport) => claudeMdReport.path).join(', ')} over ${MAX_CLAUDE_MD_LINES} lines or ${MAX_CLAUDE_MD_CHARACTERS} characters`);
  if (countOf('duplicates-concept')) summaryParts.push(`${countOf('duplicates-concept')} section(s) overlap bundle concepts`);
  if (countOf('knowledge-without-concept')) summaryParts.push(`${countOf('knowledge-without-concept')} long section(s) look like knowledge with no concept`);
  if (countOf('stale-reference')) summaryParts.push(`${countOf('stale-reference')} reference(s) no longer exist`);
  return summaryParts.join('; ');
}
