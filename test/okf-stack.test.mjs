import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemporaryProject } from './helpers.mjs';
import { buildStackCatalog, describeStackPiecesGap, listProjectStackPieces, parseStackPieces } from '../src/okf/okf-stack.mjs';
import { runOkfStackCommand } from '../src/okf/okf-stack-command.mjs';
import { validateOkfBundle } from '../src/okf/okf-validate.mjs';

const noEnvironment = {};

function writeJson(filePath, jsonValue) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(jsonValue, null, 2)}\n`);
}

// A home with the person's stack and, optionally, an enabled plugin shipping its own stack.
function createHome({ personStack = '', pluginStack = null } = {}) {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  if (personStack) {
    mkdirSync(join(homeDirectory, '.config', 'ai1'), { recursive: true });
    writeFileSync(join(homeDirectory, '.config', 'ai1', 'stack.md'), personStack);
  }
  if (pluginStack !== null) {
    const installPath = join(homeDirectory, '.claude', 'plugins', 'cache', 'team-pack', 'team-pack', '1.0.0');
    mkdirSync(join(installPath, 'ai1'), { recursive: true });
    writeFileSync(join(installPath, 'ai1', 'stack.md'), pluginStack);
    writeJson(join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'team-pack@team-pack': [{ scope: 'user', installPath }] } });
    writeJson(join(homeDirectory, '.claude', 'settings.json'), { enabledPlugins: { 'team-pack@team-pack': true } });
  }
  return homeDirectory;
}

function createProjectWithBundle() {
  const projectRoot = createTemporaryProject({ features: { okf: true } });
  mkdirSync(join(projectRoot, '.ai1', 'okf'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Bundle\n');
  return projectRoot;
}

function runStack(projectRoot, homeDirectory, ...commandArguments) {
  const printedTexts = [];
  const errorTexts = [];
  const exitCode = runOkfStackCommand(projectRoot, commandArguments, { environment: noEnvironment, homeDirectory, writeOutput: (printedText) => printedTexts.push(printedText), writeError: (errorText) => errorTexts.push(errorText) });
  return { exitCode, printedText: printedTexts.join('\n'), errorText: errorTexts.join('\n') };
}

const PERSON_STACK = [
  '# My stack', '',
  '## app-logs: Backend logs in a log store', '- area: Logs', '- applies: if it has a backend', '- setup: the logging skill', '- check: recent logs in the stream', '',
  '## web-analytics: Privacy-first web analytics', '- area: Monitoring', '- applies: public websites', '- setup: add the snippet', '- check: visits arrive', '',
].join('\r\n');
const PLUGIN_STACK = [
  '## app-logs: Another logs piece', '- area: Logs', '',
  '## db-backups: Daily database backups', '- area: Database', '- applies: if it has a database', '- setup: the backups skill', '- check: last backup is from today', '',
].join('\n');

test('parse: pieces with their fields, CRLF tolerated, invalid ids and other sections skipped', () => {
  const pieces = parseStackPieces(`${PERSON_STACK}\r\n## Not A Piece: ignored\r\n- area: nothing\r\n`);
  assert.deepEqual(pieces.map((piece) => piece.id), ['app-logs', 'web-analytics']);
  assert.deepEqual(pieces[0], { id: 'app-logs', title: 'Backend logs in a log store', area: 'Logs', applies: 'if it has a backend', setup: 'the logging skill', check: 'recent logs in the stream' });
});

test('catalog: the person\'s pieces and an enabled plugin\'s, each with its source; on the same id the person\'s wins [stack:S2]', () => {
  const projectRoot = createProjectWithBundle();
  const homeDirectory = createHome({ personStack: PERSON_STACK, pluginStack: PLUGIN_STACK });
  const catalog = buildStackCatalog(projectRoot, { environment: noEnvironment, homeDirectory });
  assert.deepEqual(catalog.pieces.map((piece) => [piece.id, piece.source]), [['app-logs', 'person'], ['web-analytics', 'person'], ['db-backups', 'plugin team-pack']]);
  assert.equal(catalog.pieces[0].title, 'Backend logs in a log store');
  assert.deepEqual(catalog.shadowed, [{ id: 'app-logs', source: 'plugin team-pack', by: 'person' }]);
  const { printedText } = runStack(projectRoot, homeDirectory, 'catalog');
  assert.match(printedText, /db-backups: Daily database backups \(plugin team-pack\)/);
  assert.match(printedText, /note: app-logs from plugin team-pack is hidden by the one from person/);
  assert.match(runStack(projectRoot, createHome(), 'catalog').printedText, /no stack yet/);
});

test('add, adopt, set: the project stack keeps state and notes, links from the index, validates, and refuses the edges', () => {
  const projectRoot = createProjectWithBundle();
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  const homeDirectory = createHome({ personStack: PERSON_STACK, pluginStack: PLUGIN_STACK });
  assert.equal(runStack(projectRoot, homeDirectory, 'adopt', 'app-logs', 'db-backups', 'missing-piece').printedText, 'adopted as pending: app-logs, db-backups\nskipped missing-piece: not in the catalog (ai1 okf stack catalog)');
  assert.match(runStack(projectRoot, homeDirectory, 'adopt', 'app-logs').printedText, /skipped app-logs: already in this project's stack/);
  assert.equal(runStack(projectRoot, homeDirectory, 'set', 'web-analytics', 'none', '--note', 'no public web').exitCode, 1);
  assert.match(runStack(projectRoot, homeDirectory, 'set', 'db-backups', 'none').errorText, /needs --note/);
  assert.equal(runStack(projectRoot, homeDirectory, 'add', '--scope', 'project', '--id', 'web-analytics', '--title', 'Web analytics', '--state', 'none', '--note', 'internal tool, no public web').exitCode, 0);
  const stackPath = join(bundleDirectory, 'stack.md');
  writeFileSync(stackPath, readFileSync(stackPath, 'utf8').replace('## db-backups', 'Kept prose.\n- extra: kept bullet\n\n## db-backups'));
  assert.equal(runStack(projectRoot, homeDirectory, 'set', 'app-logs', 'integrated', '--note', 'checked 2026-11-22').exitCode, 0);
  const stackText = readFileSync(stackPath, 'utf8');
  assert.match(stackText, /^type: Stack$/m);
  assert.match(stackText, /## app-logs: Backend logs in a log store\n- area: Logs\n- applies: if it has a backend\n- setup: the logging skill\n- check: recent logs in the stream\n- state: integrated\n- note: checked 2026-11-22/);
  assert.match(stackText, /Kept prose\.\n- extra: kept bullet/);
  assert.deepEqual(listProjectStackPieces(bundleDirectory).map((piece) => [piece.id, piece.state]), [['app-logs', 'integrated'], ['db-backups', 'pending'], ['web-analytics', 'none']]);
  assert.match(readFileSync(join(bundleDirectory, 'index.md'), 'utf8'), /\[Stack\]\(stack\.md\)/);
  assert.equal(readFileSync(join(bundleDirectory, 'index.md'), 'utf8').match(/\]\(stack\.md\)/g).length, 1);
  assert.deepEqual(validateOkfBundle(bundleDirectory).errors ?? [], []);
  assert.match(runStack(projectRoot, homeDirectory, 'list').printedText, /db-backups: Daily database backups \[pending\]/);
});

test('add --scope user writes the person\'s stack file, refusing a duplicate id or a bad id', () => {
  const projectRoot = createProjectWithBundle();
  const homeDirectory = createHome();
  const addArguments = ['add', '--scope', 'user', '--id', 'error-alerts', '--title', 'Error alerts to a chat channel', '--area', 'Alerts', '--applies', 'always', '--check', 'a test error arrives'];
  assert.equal(runStack(projectRoot, homeDirectory, ...addArguments).exitCode, 0);
  const personStackText = readFileSync(join(homeDirectory, '.config', 'ai1', 'stack.md'), 'utf8');
  assert.match(personStackText, /^# My stack/);
  assert.match(personStackText, /## error-alerts: Error alerts to a chat channel\n- area: Alerts\n- applies: always\n- check: a test error arrives\n/);
  assert.doesNotMatch(personStackText, /- state:/);
  assert.match(runStack(projectRoot, homeDirectory, ...addArguments).errorText, /already in/);
  assert.match(runStack(projectRoot, homeDirectory, 'add', '--scope', 'user', '--id', 'Bad Id', '--title', 'x').errorText, /needs --id <slug>/);
});

test('stack pieces gap: missing with a catalog and no project stack, partial naming pending pieces, clear otherwise [stack:S3]', () => {
  assert.deepEqual(describeStackPiecesGap([], 3), { status: 'missing', why: '3 pieces in the catalog, none chosen yet' });
  assert.deepEqual(describeStackPiecesGap([], 0), { status: 'clear', why: '' });
  assert.deepEqual(describeStackPiecesGap([{ id: 'a', state: 'integrated' }, { id: 'b', state: 'pending' }, { id: 'c' }], 3), { status: 'partial', why: 'pending: b, c' });
  assert.deepEqual(describeStackPiecesGap([{ id: 'a', state: 'integrated' }, { id: 'b', state: 'none' }], 3), { status: 'clear', why: '' });
});

test('/ai1:okf-define-stack writes the person\'s stack or the project\'s only through ai1 okf stack, piece by piece, integrated only after its check [stack:S4]', () => {
  const skillText = readFileSync(new URL('../skills/okf-define-stack/SKILL.md', import.meta.url), 'utf8');
  assert.match(skillText, /ai1 okf stack add --scope user --id <id>/);
  assert.match(skillText, /ai1 okf stack adopt <id>\.\.\./);
  assert.match(skillText, /Infer before asking: what their repos already use/);
  assert.match(skillText, /`integrated` only after its check passed; `none` always with its reason/);
  assert.match(skillText, /never versions, files or secrets/);
  assert.doesNotMatch(skillText, /dokploy|openobserve|uptime kuma|telegram|1password|edvantage/i);
});

test('the interview offers the catalog pieces the project lacks as a multi-select by area, adopts the chosen and records the rest as none [stack:S1]; without a catalog it asks as before and writes no stack.md [stack:S5]', () => {
  const skillText = readFileSync(new URL('../skills/okf-interview-project/SKILL.md', import.meta.url), 'utf8');
  assert.match(skillText, /Bash\("\$\{CLAUDE_PLUGIN_DATA\}\/bin\/ai1" okf stack \*\)/);
  assert.match(skillText, /offer the ones this project's `stack\.md` does not have\s+yet/);
  assert.match(skillText, /multi-select \(`AskUserQuestion`\), one question per `area`, at most 4/);
  assert.match(skillText, /pre-selecting those whose `applies` fits/);
  assert.match(skillText, /`ai1 okf stack adopt <id>\.\.\.` \(pending\)/);
  assert.match(skillText, /--state none --note "<why>"/);
  assert.match(skillText, /Without pieces: ask the technical vision as above; create no `stack\.md`/);
});

test('session start and gaps name pending stack pieces once the project context started; missing with a catalog and no project stack [stack:S3]', async () => {
  const { runHookEvent } = await import('../src/core/dispatcher.mjs');
  const { initProjectContext } = await import('../src/okf/okf-project.mjs');
  const projectRoot = createProjectWithBundle();
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  const homeDirectory = createHome({ personStack: PERSON_STACK });
  const hookOptions = { environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) }, homeDirectory, reportInternalError: (errorMessage) => { throw new Error(errorMessage); } };
  const readSessionStart = () => runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, hookOptions).hookSpecificOutput?.additionalContext || '';
  initProjectContext(bundleDirectory, { projectTitle: 'Shop' });
  assert.match(readSessionStart(), /missing [^.]*stack pieces/);
  runStack(projectRoot, homeDirectory, 'adopt', 'app-logs', 'web-analytics');
  assert.match(readSessionStart(), /partial [^.]*stack pieces/);
  runStack(projectRoot, homeDirectory, 'set', 'app-logs', 'integrated');
  runStack(projectRoot, homeDirectory, 'set', 'web-analytics', 'none', '--note', 'no public web');
  assert.doesNotMatch(readSessionStart(), /stack pieces/);
});
