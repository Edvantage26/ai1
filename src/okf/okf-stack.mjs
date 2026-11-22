// Stack: the pieces a person always uses (hosting, data, logs, monitoring, auth, payments...), each
// with when it applies, how it is set up and how it is checked. Three sources share one format:
// - the person: `<ai1 config folder>/stack.md` (`~/.config/ai1/stack.md`), for every project;
// - an enabled plugin: `ai1/stack.md` inside it (a person's or team's private pack);
// - the project: `.ai1/okf/stack.md` (`type: Stack`), the pieces this project chose, each with its
//   state (integrated | pending | none) and a note.
// The catalog is the person's pieces plus the plugins', one per id (the person's win, then plugins by id).
// Every write goes through here (the `ai1 okf stack` CLI): only the lines of the touched piece change,
// prose and unknown bullets are kept.
//
// A piece:
//   ## <id>: <title>
//   - area: <topic>
//   - applies: <when it applies>
//   - setup: <how it is set up>
//   - check: <how it is checked>
//   - state: integrated | pending | none     (project only)
//   - note: <why none, when, a link>          (project only)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { userConfigDirectory } from '../core/skill-customization.mjs';
import { listEnabledPluginInstalls } from '../core/plugin-customizations.mjs';

export const STACK_FILE = 'stack.md';
export const PLUGIN_STACK_PATH = join('ai1', STACK_FILE);
export const PIECE_FIELDS = ['area', 'applies', 'setup', 'check'];
export const PIECE_STATES = ['integrated', 'pending', 'none'];
const PIECE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PIECE_HEADING_PATTERN = /^## ([^:\s]+):\s*(.*)$/;
const FIELD_LINE_PATTERN = /^- ([a-z]+):[ \t]*(.*)$/;
const WRITER_ACTOR = 'process:ai1-okf-stack';

export function isValidPieceId(pieceId) {
  return PIECE_ID_PATTERN.test(String(pieceId || ''));
}

export function userStackPath({ environment = process.env, homeDirectory = homedir() } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), STACK_FILE);
}

export function projectStackPath(bundleDirectory) {
  return join(bundleDirectory, STACK_FILE);
}

// The pieces of a stack text: [{ id, title, area, applies, setup, check, state, note }], in file order.
export function parseStackPieces(stackText) {
  const pieces = [];
  let currentPiece = null;
  for (const line of String(stackText || '').split(/\r?\n/)) {
    const headingMatch = PIECE_HEADING_PATTERN.exec(line);
    if (headingMatch) {
      currentPiece = isValidPieceId(headingMatch[1]) ? { id: headingMatch[1], title: headingMatch[2].trim() } : null;
      if (currentPiece) pieces.push(currentPiece);
      continue;
    }
    if (/^#{1,2} /.test(line)) {
      currentPiece = null;
      continue;
    }
    // Only the bullets right under the heading are the piece's fields; the first other line ends them.
    const fieldMatch = currentPiece && FIELD_LINE_PATTERN.exec(line);
    if (!fieldMatch) {
      currentPiece = null;
      continue;
    }
    if (!(fieldMatch[1] in currentPiece)) currentPiece[fieldMatch[1]] = fieldMatch[2].trim();
  }
  return pieces;
}

function readStackFile(stackPath) {
  try {
    return existsSync(stackPath) ? readFileSync(stackPath, 'utf8') : null;
  } catch {
    return null;
  }
}

// The catalog: the person's pieces, then each enabled plugin's (by plugin id), one per id.
// { pieces: [{ ...piece, source }], shadowed: [{ id, source, by }] }.
export function buildStackCatalog(checkoutRoot, { environment = process.env, homeDirectory = homedir() } = {}) {
  const sources = [{ source: 'person', stackPath: userStackPath({ environment, homeDirectory }) }];
  for (const { pluginName, installPath } of listEnabledPluginInstalls(checkoutRoot, { homeDirectory }).plugins) {
    sources.push({ source: `plugin ${pluginName}`, stackPath: join(installPath, PLUGIN_STACK_PATH) });
  }
  const pieces = [];
  const shadowed = [];
  for (const { source, stackPath } of sources) {
    for (const piece of parseStackPieces(readStackFile(stackPath))) {
      const existingPiece = pieces.find((catalogPiece) => catalogPiece.id === piece.id);
      if (existingPiece) shadowed.push({ id: piece.id, source, by: existingPiece.source });
      else pieces.push({ ...piece, source });
    }
  }
  return { pieces, shadowed };
}

export function listProjectStackPieces(bundleDirectory) {
  return parseStackPieces(readStackFile(projectStackPath(bundleDirectory)));
}

function renderPiece(piece, { withState }) {
  return [
    `## ${piece.id}: ${String(piece.title || piece.id).trim()}`,
    ...PIECE_FIELDS.filter((fieldName) => String(piece[fieldName] || '').trim()).map((fieldName) => `- ${fieldName}: ${String(piece[fieldName]).replace(/\s+/g, ' ').trim()}`),
    ...(withState ? [`- state: ${piece.state || 'pending'}`] : []),
    ...(withState && String(piece.note || '').trim() ? [`- note: ${String(piece.note).replace(/\s+/g, ' ').trim()}`] : []),
  ].join('\n');
}

const nowTimestamp = (now) => `${now.toISOString().slice(0, 19)}Z`;

function projectStackTemplate(now) {
  return [
    '---',
    'type: Stack',
    'title: "Stack"',
    'description: "The pieces this project uses (hosting, data, logs, monitoring, auth...): integrated, pending or not applicable, with how each is set up and checked."',
    'tags: [stack, project-context]',
    `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
    '---',
    '',
    'Written by `ai1 okf stack`. How each piece is operated lives in [operations](operations.md).',
    '',
  ].join('\n');
}

// Links the project stack from the bundle's root index once.
function linkFromRootIndex(bundleDirectory) {
  const rootIndexPath = join(bundleDirectory, 'index.md');
  if (!existsSync(rootIndexPath)) return;
  const rootIndexText = readFileSync(rootIndexPath, 'utf8');
  if (rootIndexText.includes(`](${STACK_FILE})`)) return;
  writeFileSync(rootIndexPath, `${rootIndexText.trimEnd()}\n* [Stack](${STACK_FILE}) - the pieces this project uses: integrated, pending or not applicable.\n`);
}

function refreshGenerated(stackText, now) {
  return stackText.replace(/^generated:.*$/m, `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`);
}

// Appends a piece to a stack file (created when missing). `withState`: a project file.
function appendPiece(stackPath, piece, { withState, now, header }) {
  const existingText = readStackFile(stackPath);
  const baseText = existingText ?? header;
  const joinedText = `${baseText.trimEnd()}\n\n${renderPiece(piece, { withState })}\n`;
  mkdirSync(dirname(stackPath), { recursive: true });
  writeFileSync(stackPath, withState ? refreshGenerated(joinedText, now) : joinedText);
}

function validatePieceInput(piece) {
  if (!isValidPieceId(piece.id)) throw new Error('a piece needs --id <slug> (lowercase letters, digits and dashes)');
  if (!String(piece.title || '').trim()) throw new Error('a piece needs --title "<what it is>"');
}

// Adds a piece to the person's stack (`scope: user`) or to the project's (`scope: project`, state pending
// unless given). Returns the path written.
export function addStackPiece({ scope, bundleDirectory, piece, environment = process.env, homeDirectory = homedir(), now = new Date() }) {
  validatePieceInput(piece);
  if (scope === 'user') {
    const stackPath = userStackPath({ environment, homeDirectory });
    if (parseStackPieces(readStackFile(stackPath)).some((existingPiece) => existingPiece.id === piece.id)) throw new Error(`${piece.id} is already in ${stackPath}`);
    appendPiece(stackPath, piece, { withState: false, now, header: '# My stack\n\nThe pieces I use in my projects (`ai1 okf stack`). Each is offered in the project interview when it applies.\n' });
    return stackPath;
  }
  if (scope !== 'project') throw new Error('--scope must be user or project');
  if (!existsSync(join(bundleDirectory, 'index.md'))) throw new Error('there is no knowledge bundle yet: create it first (/ai1:okf-maintain-knowledge, produce mode)');
  if (listProjectStackPieces(bundleDirectory).some((existingPiece) => existingPiece.id === piece.id)) throw new Error(`${piece.id} is already in this project's stack: change it with ai1 okf stack set`);
  const state = piece.state || 'pending';
  if (!PIECE_STATES.includes(state)) throw new Error(`state must be one of ${PIECE_STATES.join(', ')}`);
  if (state === 'none' && !String(piece.note || '').trim()) throw new Error('a piece that does not apply needs --note "<why>"');
  appendPiece(projectStackPath(bundleDirectory), { ...piece, state }, { withState: true, now, header: projectStackTemplate(now) });
  linkFromRootIndex(bundleDirectory);
  return STACK_FILE;
}

// Copies catalog pieces into the project as pending. { adopted: [id], skipped: [{ id, why }] }.
export function adoptStackPieces(bundleDirectory, pieceIds, catalog, { now = new Date() } = {}) {
  const adopted = [];
  const skipped = [];
  for (const pieceId of pieceIds) {
    const catalogPiece = catalog.pieces.find((piece) => piece.id === pieceId);
    if (!catalogPiece) {
      skipped.push({ id: pieceId, why: 'not in the catalog (ai1 okf stack catalog)' });
      continue;
    }
    if (listProjectStackPieces(bundleDirectory).some((piece) => piece.id === pieceId)) {
      skipped.push({ id: pieceId, why: 'already in this project\'s stack' });
      continue;
    }
    addStackPiece({ scope: 'project', bundleDirectory, piece: { ...catalogPiece, state: 'pending', note: '' }, now });
    adopted.push(pieceId);
  }
  return { adopted, skipped };
}

// Sets a project piece's state (and note), touching only its own lines.
export function setStackPieceState(bundleDirectory, pieceId, state, { note = '', now = new Date() } = {}) {
  if (!PIECE_STATES.includes(state)) throw new Error(`state must be one of ${PIECE_STATES.join(', ')}`);
  if (state === 'none' && !String(note).trim()) throw new Error('a piece that does not apply needs --note "<why>"');
  const stackPath = projectStackPath(bundleDirectory);
  const stackText = readStackFile(stackPath);
  if (!parseStackPieces(stackText).some((piece) => piece.id === pieceId)) throw new Error(`${pieceId} is not in this project's stack: add it with ai1 okf stack adopt ${pieceId} (from the catalog) or ai1 okf stack add --scope project`);
  const lines = stackText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => PIECE_HEADING_PATTERN.exec(line)?.[1] === pieceId);
  let endIndex = lines.findIndex((line, lineIndex) => lineIndex > headingIndex && /^#{1,2} /.test(line));
  if (endIndex < 0) endIndex = lines.length;
  const pieceLines = lines.slice(headingIndex, endIndex);
  // The piece's own fields are the bullets right under its heading; prose or bullets after a blank line are kept as they are.
  const fieldBlockEnd = () => {
    let lineIndex = 1;
    while (lineIndex < pieceLines.length && FIELD_LINE_PATTERN.test(pieceLines[lineIndex])) lineIndex += 1;
    return lineIndex;
  };
  const replaceOrAdd = (fieldName, value) => {
    const fieldIndex = pieceLines.slice(0, fieldBlockEnd()).findIndex((line) => FIELD_LINE_PATTERN.exec(line)?.[1] === fieldName);
    const fieldLine = `- ${fieldName}: ${String(value).replace(/\s+/g, ' ').trim()}`;
    if (fieldIndex >= 0) pieceLines[fieldIndex] = fieldLine;
    else pieceLines.splice(fieldBlockEnd(), 0, fieldLine);
  };
  replaceOrAdd('state', state);
  if (String(note).trim()) replaceOrAdd('note', note);
  const newText = [...lines.slice(0, headingIndex), ...pieceLines, ...lines.slice(endIndex)].join('\n');
  writeFileSync(stackPath, refreshGenerated(newText, now));
  return STACK_FILE;
}

// The gap of the stack pieces: missing when there is a catalog and no project stack, partial with
// pending pieces, clear otherwise (nothing to choose, or every piece integrated or not applicable).
export function describeStackPiecesGap(projectPieces, catalogPieceCount) {
  if (!projectPieces.length) return catalogPieceCount ? { status: 'missing', why: `${catalogPieceCount} pieces in the catalog, none chosen yet` } : { status: 'clear', why: '' };
  const pendingIds = projectPieces.filter((piece) => (piece.state || 'pending') === 'pending').map((piece) => piece.id);
  return pendingIds.length ? { status: 'partial', why: `pending: ${pendingIds.join(', ')}` } : { status: 'clear', why: '' };
}
