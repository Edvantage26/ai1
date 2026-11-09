import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateRecipe, loadRecipe, listUnknownRecipeFields, DEFAULT_RECIPE, RECIPE_RELATIVE_PATH } from '../src/worktrees/worktree-recipe.mjs';
import { createWorktree, decideMode } from '../src/worktrees/worktree-create.mjs';
import { readWorktreeState } from '../src/worktrees/worktree-state.mjs';
import { listWorktrees, runWorktreeCommand, dropWorktree, applyCommandArguments } from '../src/worktrees/worktree-ops.mjs';
import { finishWorktree } from '../src/worktrees/worktree-finish.mjs';
import { integratedFileMatcher } from '../src/worktrees/worktree-integrations.mjs';
import { listSessionChangedCode } from '../src/verify/verify-gate.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { pickWorktreePort, writeEnvVariables, listListeningPorts } from '../src/worktrees/worktree-ports.mjs';
import { createTemporaryProject } from './helpers.mjs';

const readJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const TEST_RECIPE = {
  copy: ['.env'],
  heavy: [
    { path: 'node_modules', strategy: 'regenerate', command: 'npm ci' },
    { path: 'data/models', strategy: 'share' },
    { path: 'assets/video', strategy: 'exclude' },
  ],
  modes: { 'source-only': { sparse_exclude: ['assets'], skip_setup: true } },
  port: { env_file: '.env', variables: ['PORT', 'VITE_PORT'], range: [12000, 12999] },
  setup: ['npm ci'],
};

// A repo with a recipe: tracked src/ and assets/video (heavy), ignored .env, node_modules and data/models.
function createRecipeRepo(recipe = TEST_RECIPE) {
  const mainRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-wt-')));
  mkdirSync(join(mainRoot, '.claude', 'skills', 'worktree'), { recursive: true });
  writeFileSync(join(mainRoot, RECIPE_RELATIVE_PATH), JSON.stringify(recipe));
  writeFileSync(join(mainRoot, '.gitignore'), '.env\nnode_modules/\ndata/\n.claude/worktrees/\n');
  mkdirSync(join(mainRoot, 'src'));
  writeFileSync(join(mainRoot, 'src', 'app.js'), 'console.log(1);\n');
  mkdirSync(join(mainRoot, 'assets', 'video'), { recursive: true });
  writeFileSync(join(mainRoot, 'assets', 'video', 'clip.mp4'), 'v'.repeat(3000));
  writeFileSync(join(mainRoot, 'assets', 'logo.svg'), '<svg/>');
  runGit(mainRoot, ['init', '-q', '-b', 'main']);
  runGit(mainRoot, ['add', '.']);
  runGit(mainRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  writeFileSync(join(mainRoot, '.env'), 'API_URL=http://localhost\nPORT=3000\n');
  mkdirSync(join(mainRoot, 'node_modules', 'left-pad'), { recursive: true });
  writeFileSync(join(mainRoot, 'node_modules', 'left-pad', 'index.js'), 'm'.repeat(1000));
  mkdirSync(join(mainRoot, 'data', 'models'), { recursive: true });
  writeFileSync(join(mainRoot, 'data', 'models', 'model.bin'), 'd'.repeat(5000));
  return mainRoot;
}

const PLENTY_OF_DISK = { freeBytes: 1e12, totalBytes: 2e12 };

test('recipe: the shipped template is valid and has no unknown fields', () => {
  const templateRecipe = readJson('templates/worktree-skill/recipe.json');
  assert.deepEqual(validateRecipe(templateRecipe), []);
  assert.deepEqual(listUnknownRecipeFields(templateRecipe), []);
});

test('recipe: the schema documents every field the validator knows', () => {
  const schemaFields = Object.keys(readJson('schema/worktree-recipe.schema.json').properties);
  for (const fieldName of [...Object.keys(DEFAULT_RECIPE), '$schema', 'caches', 'slots']) assert.ok(schemaFields.includes(fieldName), fieldName);
  assert.deepEqual(listUnknownRecipeFields(Object.fromEntries(schemaFields.map((fieldName) => [fieldName, null]))), []);
});

test('recipe: invalid recipes are reported with a readable reason', () => {
  assert.match(validateRecipe([]).join(), /JSON object/);
  assert.match(validateRecipe({ version: 2 }).join(), /version/);
  assert.match(validateRecipe({ heavy: [{ path: 'x', strategy: 'zip' }] }).join(), /heavy\[0\]\.strategy/);
  assert.match(validateRecipe({ heavy: [{ path: 'node_modules', strategy: 'regenerate' }] }).join(), /command/);
  assert.match(validateRecipe({ modes: { full: {} } }).join(), /built in/);
  assert.match(validateRecipe({ default_mode: 'tiny' }).join(), /default_mode/);
  assert.deepEqual(validateRecipe({ default_mode: 'tiny', modes: { tiny: { sparse_exclude: ['assets'] } } }), []);
  assert.match(validateRecipe({ port: { env_file: '.env', variables: [] } }).join(), /port.variables/);
  assert.match(validateRecipe({ port: { env_file: '.env', variables: ['PORT'], range: [80, 90] } }).join(), /port.range/);
  assert.match(validateRecipe({ commands: { build: 3 } }).join(), /commands/);
  assert.match(validateRecipe({ finish: { strategy: 'squash' } }).join(), /finish.strategy/);
  assert.match(validateRecipe({ disk_margin_percent: 100 }).join(), /disk_margin_percent/);
});

test('recipe: load merges defaults and warns about unknown and planned fields', () => {
  const repoRoot = createTemporaryProject();
  assert.equal(loadRecipe(repoRoot).status, 'missing');
  mkdirSync(join(repoRoot, '.claude', 'skills', 'worktree'), { recursive: true });
  writeFileSync(join(repoRoot, RECIPE_RELATIVE_PATH), '{ nope');
  assert.equal(loadRecipe(repoRoot).status, 'invalid');
  writeFileSync(join(repoRoot, RECIPE_RELATIVE_PATH), JSON.stringify({ copy: ['.env'], finish: { strategy: 'merge' }, caches: [], teleport: 1 }));
  const loadedRecipe = loadRecipe(repoRoot);
  assert.equal(loadedRecipe.status, 'ok');
  assert.deepEqual(loadedRecipe.recipe.copy, ['.env']);
  assert.equal(loadedRecipe.recipe.branch_prefix, 'wt/');
  assert.deepEqual(loadedRecipe.recipe.finish, { strategy: 'merge', allow_merge: true, dirty_base_paths_ok: [] });
  assert.equal(loadedRecipe.warnings.length, 2);
});

test('create full: everything is there, the port is written and the state recorded', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'feature-a', { mode: 'full' });
  const worktreePath = join(mainRoot, '.claude', 'worktrees', 'feature-a');
  assert.equal(created.path, worktreePath);
  assert.equal(created.branch, 'wt/feature-a');
  assert.equal(created.base, 'main');
  assert.equal(created.mode, 'full');
  assert.ok(existsSync(join(worktreePath, 'assets', 'video', 'clip.mp4')));
  assert.ok(existsSync(join(worktreePath, 'node_modules', 'left-pad', 'index.js')));
  assert.ok(lstatSync(join(worktreePath, 'data', 'models')).isDirectory());
  assert.ok(created.port >= 12000 && created.port <= 12999);
  assert.equal(readFileSync(join(worktreePath, '.env'), 'utf8'), `API_URL=http://localhost\nPORT=${created.port}\nVITE_PORT=${created.port}\n`);
  assert.equal(readFileSync(join(mainRoot, '.env'), 'utf8'), 'API_URL=http://localhost\nPORT=3000\n', 'the main checkout keeps its env');
  assert.deepEqual(created.setup_commands, ['npm ci']);
  assert.equal(readWorktreeState(join(mainRoot, '.git'), 'feature-a').port, created.port);
  assert.equal(runGit(worktreePath, ['status', '--porcelain']), '');
  assert.throws(() => createWorktree(mainRoot, 'feature-a', { mode: 'full' }), /already exists/);
});

test('create light: tracked heavy excluded, ignored heavy shared or left to regenerate, git status clean', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'feature-b', { mode: 'light' });
  const worktreePath = created.path;
  assert.equal(existsSync(join(worktreePath, 'assets', 'video')), false);
  assert.ok(existsSync(join(worktreePath, 'assets', 'logo.svg')));
  assert.ok(lstatSync(join(worktreePath, 'data', 'models')).isSymbolicLink());
  assert.equal(readFileSync(join(worktreePath, 'data', 'models', 'model.bin'), 'utf8').length, 5000);
  assert.equal(existsSync(join(worktreePath, 'node_modules')), false);
  assert.deepEqual(created.setup_commands, ['npm ci']);
  assert.deepEqual(created.trimmed.map((trimmedEntry) => trimmedEntry.path).sort(), ['assets/video', 'data/models', 'node_modules']);
  assert.equal(runGit(worktreePath, ['status', '--porcelain']), '');
  assert.equal(runGit(mainRoot, ['status', '--porcelain']), '', 'sparse-checkout stays in the worktree');
});

test('create with an extra mode applies its excludes and skips setup', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'look', { mode: 'source-only' });
  assert.equal(existsSync(join(created.path, 'assets')), false);
  assert.ok(existsSync(join(created.path, 'src', 'app.js')));
  assert.deepEqual(created.setup_commands, ['npm ci'], 'regenerate still listed, setup skipped');
});

test('create auto: full when it fits, trims the largest space-saving path first when it does not', () => {
  const mainRoot = createRecipeRepo();
  const roomy = createWorktree(mainRoot, 'roomy', { mode: 'auto', diskSpace: PLENTY_OF_DISK, copyOnWrite: false });
  assert.equal(roomy.mode, 'full');
  const fullBytes = 3000 + 6 + 1000 + 5000;
  const tight = createWorktree(mainRoot, 'tight', { mode: 'auto', copyOnWrite: false, diskSpace: { freeBytes: 150000 + fullBytes - 4000, totalBytes: 1000000 } });
  assert.equal(tight.mode, 'light');
  assert.deepEqual(tight.trimmed.map((trimmedEntry) => trimmedEntry.path), ['data/models'], 'one trim is enough; regenerate saves nothing');
  assert.ok(existsSync(join(tight.path, 'assets', 'video', 'clip.mp4')));
  const cow = createWorktree(mainRoot, 'cow', { mode: 'auto', copyOnWrite: true, diskSpace: { freeBytes: 0, totalBytes: 1000000 } });
  assert.equal(cow.mode, 'full');
});

test('decideMode reports when even trimming everything may not fit', () => {
  const heavyEntries = [{ path: 'big', effectiveStrategy: 'exclude', bytes: 10 }];
  const decision = decideMode({ requestedMode: 'auto', recipe: { disk_margin_percent: 10 }, heavyEntries, neededFullBytes: 1000, diskSpace: { freeBytes: 500, totalBytes: 1000 }, copyOnWrite: false });
  assert.equal(decision.mode, 'light');
  assert.match(decision.reason, /may still not fit/);
  assert.equal(decideMode({ requestedMode: 'auto', recipe: { disk_margin_percent: 10 }, heavyEntries, neededFullBytes: 1, diskSpace: null, copyOnWrite: false }).mode, 'light');
});

test('create refuses bad names, unknown modes and undoes a failed creation', () => {
  const mainRoot = createRecipeRepo();
  assert.throws(() => createWorktree(mainRoot, 'Bad Name'), /invalid worktree name/);
  assert.throws(() => createWorktree(mainRoot, 'x', { mode: 'huge' }), /unknown mode/);
  assert.throws(() => createWorktree(mainRoot, 'x', { base: 'no-such-branch' }));
  assert.equal(runGit(mainRoot, ['branch', '--list', 'wt/x']), '');
  assert.throws(() => createWorktree(createTemporaryProject(), 'x'), /not inside a git repository|no worktree recipe/);
});

function commitInWorktree(worktreePath, fileName, fileText) {
  writeFileSync(join(worktreePath, fileName), fileText);
  runGit(worktreePath, ['add', fileName]);
  runGit(worktreePath, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', `change ${fileName}`]);
}

test('list shows each worktree with ahead/behind, uncommitted count and optional size', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'listed', { mode: 'light' });
  commitInWorktree(created.path, 'feature.js', 'x\n');
  writeFileSync(join(created.path, 'scratch.txt'), 'wip\n');
  const [listedWorktree] = listWorktrees(created.path, { withSize: true });
  assert.equal(listedWorktree.name, 'listed');
  assert.equal(listedWorktree.ahead, 1);
  assert.equal(listedWorktree.behind, 0);
  assert.equal(listedWorktree.uncommitted, 1);
  assert.ok(listedWorktree.size_bytes > 0);
  assert.equal(listWorktrees(mainRoot)[0].size_bytes, null);
});

test('run executes recipe commands in the worktree with env, port and placeholders, and records the run', () => {
  const mainRoot = createRecipeRepo({ ...TEST_RECIPE, env: { OUT_DIR: '{{repo_parent}}/out/{{name}}' }, commands: { dev: 'serve --port {{port}}', 'pre-finish': ['lint', 'test'] } });
  const created = createWorktree(mainRoot, 'runner', { mode: 'light' });
  const executedCommands = [];
  const recordCommand = (commandText, workingDirectory, commandEnvironment) => {
    executedCommands.push({ commandText, workingDirectory, outDir: commandEnvironment.OUT_DIR, port: commandEnvironment.PORT, worktree: commandEnvironment.AI1_WORKTREE });
    return commandText === 'test' ? 3 : 0;
  };
  assert.deepEqual(runWorktreeCommand(mainRoot, 'runner', 'dev', { runCommand: recordCommand }), { exitCode: 0, failedCommand: null });
  assert.deepEqual(executedCommands[0], { commandText: `serve --port ${created.port}`, workingDirectory: created.path, outDir: join(mainRoot, '..', 'out', 'runner'), port: String(created.port), worktree: 'runner' });
  assert.deepEqual(runWorktreeCommand(mainRoot, 'runner', 'pre-finish', { runCommand: recordCommand }), { exitCode: 3, failedCommand: 'test' });
  assert.equal(readWorktreeState(join(mainRoot, '.git'), 'runner').last_run.exit_code, 3);
  runWorktreeCommand(mainRoot, 'runner', 'setup', { runCommand: recordCommand });
  assert.equal(executedCommands.at(-1).commandText, 'npm ci');
  assert.throws(() => runWorktreeCommand(mainRoot, 'runner', 'deploy', { runCommand: recordCommand }), /no command "deploy"/);
  runWorktreeCommand(mainRoot, 'runner', 'dev', { runCommand: recordCommand, extraArguments: ['--host', 'my host'] });
  assert.equal(executedCommands.at(-1).commandText, `serve --port ${created.port} --host 'my host'`);
  assert.equal(applyCommandArguments('build {{args}} --release', ['App']), 'build App --release');
  assert.equal(applyCommandArguments('build', []), 'build');
  assert.equal(applyCommandArguments('echo {{args}}', ['$&']), "echo '$&'");
});

test('drop needs --confirm, refuses uncommitted work, bundles own commits and cleans everything', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'dropped', { mode: 'light' });
  assert.throws(() => dropWorktree(mainRoot, 'dropped'), /--confirm/);
  commitInWorktree(created.path, 'feature.js', 'x\n');
  writeFileSync(join(created.path, 'src', 'app.js'), 'changed\n');
  assert.throws(() => dropWorktree(mainRoot, 'dropped', { confirm: true }), /uncommitted changes[\s\S]*src\/app\.js/);
  const dropResult = dropWorktree(mainRoot, 'dropped', { confirm: true, discardUncommitted: true });
  assert.ok(existsSync(dropResult.bundlePath));
  assert.match(runGit(mainRoot, ['bundle', 'list-heads', dropResult.bundlePath]), /refs\/heads\/wt\/dropped/);
  assert.equal(existsSync(created.path), false);
  assert.equal(runGit(mainRoot, ['branch', '--list', 'wt/dropped']), '');
  assert.equal(readWorktreeState(join(mainRoot, '.git'), 'dropped'), null);
  assert.ok(existsSync(join(mainRoot, 'data', 'models', 'model.bin')), 'the shared target survives');
});

const commitInMain = (mainRoot, fileName, fileText) => commitInWorktree(mainRoot, fileName, fileText);
const NO_PYTHON = { AI1_PYTHON: 'no-such-python-for-ai1-tests' };

test('finish rebases onto a moved base, fast-forwards it and cleans everything', () => {
  const mainRoot = createRecipeRepo();
  const created = createWorktree(mainRoot, 'done', { mode: 'light' });
  commitInWorktree(created.path, 'feature.js', 'feature\n');
  commitInMain(mainRoot, 'other.js', 'other\n');
  const finishResult = finishWorktree(mainRoot, 'done', { environment: NO_PYTHON });
  assert.match(finishResult.steps.join('\n'), /rebased onto main[\s\S]*main fast-forwarded/);
  assert.ok(existsSync(join(mainRoot, 'feature.js')));
  assert.equal(runGit(mainRoot, ['log', '--format=%s', '-1']).trim(), 'change feature.js');
  assert.equal(existsSync(created.path), false);
  assert.equal(runGit(mainRoot, ['branch', '--list', 'wt/done']), '');
  assert.equal(readWorktreeState(join(mainRoot, '.git'), 'done'), null);
  assert.ok(existsSync(join(mainRoot, 'data', 'models', 'model.bin')));
});

test('finish refuses uncommitted work, stops on conflicts and on a dirty base checkout', () => {
  const mainRoot = createRecipeRepo({ ...TEST_RECIPE, finish: { dirty_base_paths_ok: ['notes/'] } });
  const created = createWorktree(mainRoot, 'busy', { mode: 'light' });
  writeFileSync(join(created.path, 'src', 'app.js'), 'wip\n');
  assert.throws(() => finishWorktree(mainRoot, 'busy', { environment: NO_PYTHON }), /uncommitted changes/);
  runGit(created.path, ['add', '.']);
  runGit(created.path, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'branch edit']);
  commitInMain(mainRoot, 'src/app.js', 'main edit\n');
  assert.throws(() => finishWorktree(mainRoot, 'busy', { environment: NO_PYTHON }), /could not rebase onto main \(conflicts\)/);
  assert.equal(runGit(created.path, ['status', '--porcelain']), '', 'the rebase was aborted');
  runGit(created.path, ['merge', '-q', '-X', 'ours', '-m', 'merge main', 'main']);
  writeFileSync(join(mainRoot, 'src', 'other.js'), 'uncommitted in main\n');
  assert.throws(() => finishWorktree(mainRoot, 'busy', { environment: NO_PYTHON }), /uncommitted changes, so it cannot move[\s\S]*src\/other\.js/);
  runGit(mainRoot, ['clean', '-fq', 'src']);
  mkdirSync(join(mainRoot, 'notes'));
  writeFileSync(join(mainRoot, 'notes', 'draft.md'), 'another session\n');
  const finishResult = finishWorktree(mainRoot, 'busy', { environment: NO_PYTHON });
  assert.match(finishResult.steps[0], /already contains the base/);
  assert.ok(existsSync(join(mainRoot, 'notes', 'draft.md')), 'allowed dirty paths stay as they were');
});

test('finish runs pre-finish and moves a base that is not checked out anywhere', () => {
  const mainRoot = createRecipeRepo({ ...TEST_RECIPE, commands: { 'pre-finish': 'npm test' } });
  runGit(mainRoot, ['branch', 'release']);
  const created = createWorktree(mainRoot, 'rel', { mode: 'light', base: 'release' });
  commitInWorktree(created.path, 'fix.js', 'fix\n');
  assert.throws(() => finishWorktree(mainRoot, 'rel', { environment: NO_PYTHON, runCommand: () => 1 }), /pre-finish failed/);
  assert.ok(existsSync(created.path));
  const finishResult = finishWorktree(mainRoot, 'rel', { environment: NO_PYTHON, runCommand: () => 0 });
  assert.match(finishResult.steps.join('\n'), /pre-finish passed[\s\S]*release moved/);
  assert.equal(runGit(mainRoot, ['log', '--format=%s', '-1', 'release']).trim(), 'change fix.js');
  assert.equal(existsSync(join(mainRoot, 'fix.js')), false, 'main is untouched');
  assert.match(finishResult.steps.at(-1), /worktree and branch .* removed/);
  assert.equal(runGit(mainRoot, ['branch', '--list', finishResult.steps.at(-1).match(/branch (\S+) removed/)[1]]).trim(), '', 'the branch is really gone although main has another HEAD');
});

test('finish asks for the knowledge bundle when the branch changes code without touching it', () => {
  const mainRoot = createRecipeRepo();
  mkdirSync(join(mainRoot, '.ai1', 'okf'), { recursive: true });
  writeFileSync(join(mainRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n# Bundle\n');
  writeFileSync(join(mainRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: true } }));
  runGit(mainRoot, ['add', '.']);
  runGit(mainRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'okf']);
  const created = createWorktree(mainRoot, 'docs', { mode: 'light' });
  commitInWorktree(created.path, 'feature.js', 'feature\n');
  assert.throws(() => finishWorktree(mainRoot, 'docs', { environment: NO_PYTHON }), /does not touch the knowledge bundle[\s\S]*feature\.js[\s\S]*--ack/);
  const finishResult = finishWorktree(mainRoot, 'docs', { environment: NO_PYTHON, acknowledgement: 'internal helper, no documented asset' });
  assert.match(finishResult.notes.join('\n'), /internal helper[\s\S]*validator not run/);
});

test('the ai1 worktree CLI creates, lists and drops, in text and JSON', () => {
  const mainRoot = createRecipeRepo();
  const ai1Cli = (cliArguments) => execFileSync(process.execPath, [new URL('../bin/ai1', import.meta.url).pathname, ...cliArguments], { cwd: mainRoot, encoding: 'utf8' });
  const createdText = ai1Cli(['worktree', 'create', 'cli-made', '--mode', 'light']);
  assert.match(createdText, /worktree cli-made ready at .*cli-made\nbranch wt\/cli-made from main \| mode light/);
  assert.match(createdText, /next: ai1 worktree run cli-made setup/);
  assert.match(createdText, /EnterWorktree with path/);
  assert.equal(JSON.parse(ai1Cli(['worktree', 'list', '--json']))[0].name, 'cli-made');
  assert.match(ai1Cli(['worktree', 'list']), /cli-made {2}wt\/cli-made <- main \| ahead 0 behind 0 \| clean \| mode light \| port \d+/);
  assert.match(ai1Cli(['worktree', 'drop', 'cli-made', '--confirm']), /worktree cli-made dropped/);
  assert.throws(() => ai1Cli(['worktree', 'drop', 'cli-made', '--confirm']), /no worktree "cli-made"/);
});

function hookOptions(mainRoot) {
  return {
    environment: { CLAUDE_PROJECT_DIR: mainRoot, CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

const contextOf = (hookOutput) => hookOutput?.hookSpecificOutput?.additionalContext ?? '';

test('worktree-brief: points to /ai1:worktrees-plan-recipe without a recipe, gives the rules with one, names the session worktree', () => {
  const bareRoot = createTemporaryProject({ features: { okf: false, worktrees: true } });
  runGit(bareRoot, ['init', '-q']);
  assert.match(contextOf(runHookEvent('SessionStart', { session_id: 's', cwd: bareRoot, source: 'startup' }, hookOptions(bareRoot))), /no worktree recipe[\s\S]*\/ai1:worktrees-plan-recipe/);
  const mainRoot = createRecipeRepo();
  mkdirSync(join(mainRoot, '.ai1'), { recursive: true });
  writeFileSync(join(mainRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: false, worktrees: true, lanes: true } }));
  const options = hookOptions(mainRoot);
  const mainContext = contextOf(runHookEvent('SessionStart', { session_id: 's', cwd: mainRoot, source: 'startup' }, options));
  assert.match(mainContext, /Worktrees: any change to the files of this repo happens in a worktree, never in the main checkout[\s\S]*create one before the first edit[\s\S]*ai1 worktree create <name>/);
  assert.match(mainContext, /plan and deep tasks are built in their own worktree/);
  assert.doesNotMatch(mainContext, /This session works in/);
  assert.equal(mainContext, contextOf(runHookEvent('SessionStart', { session_id: 's', cwd: mainRoot, source: 'startup' }, options)), 'byte-stable');
  const created = createWorktree(mainRoot, 'brief', { mode: 'light' });
  const worktreeContext = contextOf(runHookEvent('SessionStart', { session_id: 's2', cwd: created.path, source: 'startup' }, options));
  assert.match(worktreeContext, new RegExp(`This session works in worktree \`brief\` \\(${created.path}; branch \`wt/brief\`, mode light, port ${created.port}\\)`));
});

test('worktree-reminder: on change and every N prompts, marking this session, then once when none are left', () => {
  const mainRoot = createRecipeRepo({ ...TEST_RECIPE, reminder_every: 4 });
  mkdirSync(join(mainRoot, '.ai1'), { recursive: true });
  writeFileSync(join(mainRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: false, worktrees: true } }));
  const options = hookOptions(mainRoot);
  const sendPrompt = (workingDirectory) => contextOf(runHookEvent('UserPromptSubmit', { session_id: 's', cwd: workingDirectory, prompt: 'go' }, options));
  assert.equal(sendPrompt(mainRoot), '', 'no worktrees, nothing to say');
  const created = createWorktree(mainRoot, 'remind', { mode: 'light' });
  assert.match(sendPrompt(created.path), /\[ai1 worktrees\] Active: remind \(wt\/remind, light, port \d+\) <- this session\. Start your reply/);
  assert.equal(sendPrompt(created.path), '', 'unchanged, not yet periodic');
  assert.match(sendPrompt(created.path), /Active: remind/, 'fourth prompt is periodic');
  createWorktree(mainRoot, 'other', { mode: 'light' });
  assert.match(sendPrompt(created.path), /other \(wt\/other[^;]*\); remind .*<- this session/);
  dropWorktree(mainRoot, 'remind', { confirm: true });
  dropWorktree(mainRoot, 'other', { confirm: true });
  assert.equal(sendPrompt(mainRoot), '[ai1 worktrees] No active worktrees now.');
  assert.equal(sendPrompt(mainRoot), '');
});

test('ports are stable per name and skip taken ones; env files keep other lines', () => {
  assert.equal(pickWorktreePort('feature-a', [12000, 12999]), pickWorktreePort('feature-a', [12000, 12999]));
  const firstPort = pickWorktreePort('feature-a', [12000, 12999]);
  assert.notEqual(pickWorktreePort('feature-a', [12000, 12999], new Set([firstPort])), firstPort);
  assert.throws(() => pickWorktreePort('x', [12000, 12001], new Set([12000, 12001])), /no free port/);
  assert.ok(listListeningPorts() instanceof Set);
  const envPath = join(mkdtempSync(join(tmpdir(), 'ai1-env-')), '.env');
  writeFileSync(envPath, '# comment\nexport PORT=1\nOTHER=x\n');
  writeEnvVariables(envPath, { PORT: '12345', NEW_VAR: 'y' });
  assert.equal(readFileSync(envPath, 'utf8'), '# comment\nPORT=12345\nOTHER=x\nNEW_VAR=y\n');
});

test('base trunk: the main branch is detected whatever its name, checked, and a stale trunk is reported', () => {
  const trunkRecipe = { ...TEST_RECIPE, base: 'trunk' };
  const developRepo = createRecipeRepo(trunkRecipe);
  runGit(developRepo, ['branch', '-m', 'main', 'develop']);
  assert.equal(createWorktree(developRepo, 'no-config', { mode: 'light', diskSpace: PLENTY_OF_DISK }).base, 'develop', 'no .ai1/config.json: detected');
  mkdirSync(join(developRepo, '.ai1'), { recursive: true });
  writeFileSync(join(developRepo, '.ai1', 'config.json'), JSON.stringify({ version: 1 }));
  assert.equal(createWorktree(developRepo, 'no-trunk', { mode: 'light', diskSpace: PLENTY_OF_DISK }).base, 'develop', 'a config without trunk: detected, not "main"');

  writeFileSync(join(developRepo, '.ai1', 'config.json'), JSON.stringify({ version: 1, trunk: 'master' }));
  assert.throws(() => createWorktree(developRepo, 'missing-base', { mode: 'light', diskSpace: PLENTY_OF_DISK }), /the base master does not exist in this repo: set "trunk"/);

  runGit(developRepo, ['branch', 'master']);
  runGit(developRepo, ['update-ref', 'refs/remotes/origin/develop', 'develop']);
  runGit(developRepo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop']);
  const staleTrunk = createWorktree(developRepo, 'stale-trunk', { mode: 'light', diskSpace: PLENTY_OF_DISK });
  assert.equal(staleTrunk.base, 'master', 'the configured trunk wins');
  assert.ok(staleTrunk.warnings.some((warningText) => /base is master .* but origin\/HEAD points to develop/.test(warningText)));
});

// A repo whose recipe pre-finish runs `preFinish`, with okf and verify (`npm test`) on and a bundle.
function createCheckedRepo(preFinish) {
  const mainRoot = createRecipeRepo({ ...TEST_RECIPE, commands: { 'pre-finish': preFinish } });
  mkdirSync(join(mainRoot, '.ai1', 'okf'), { recursive: true });
  writeFileSync(join(mainRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n# Bundle\n');
  writeFileSync(join(mainRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: true, verify: true }, verify: ['npm test'] }));
  runGit(mainRoot, ['add', '.']);
  runGit(mainRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'okf']);
  return mainRoot;
}

function finishCodeAndConcept(mainRoot, worktreeName) {
  const created = createWorktree(mainRoot, worktreeName, { mode: 'light', diskSpace: PLENTY_OF_DISK });
  commitInWorktree(created.path, 'feature.js', 'feature\n');
  writeFileSync(join(created.path, '.ai1', 'okf', 'feature.md'), '---\ntype: Component\ntitle: Feature\ndescription: The feature.\n---\nIt does the feature.\n');
  runGit(created.path, ['add', '.']);
  runGit(created.path, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'concept']);
  finishWorktree(mainRoot, worktreeName, { environment: NO_PYTHON, runCommand: () => 0 });
}

test('finish records what it wrote into the base, so its Stop hooks do not ask again until a file is edited', () => {
  const mainRoot = createCheckedRepo(['npm test']);
  const options = { environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) }, homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')) };
  runHookEvent('SessionStart', { session_id: 's', cwd: mainRoot, source: 'startup' }, options);
  const baseHead = runGit(mainRoot, ['rev-parse', 'HEAD']).trim();
  finishCodeAndConcept(mainRoot, 'checked');
  const featureModified = statSync(join(mainRoot, 'feature.js')).mtimeMs;
  // The bundle keeps the dates the fast-forward gave it, after the session started (as in real use:
  // finish runs minutes into a session); until 2026-11-09 the test moved them a second back, so the
  // overview check passed only when the run took under a second.
  assert.ok(integratedFileMatcher(mainRoot, 'verified')('feature.js', featureModified));
  assert.ok(integratedFileMatcher(mainRoot, 'knowledge_checked')('feature.js', featureModified));
  assert.deepEqual(listSessionChangedCode(mainRoot, { baseHead, sessionStartMilliseconds: 0 }, ['.ai1/**']), []);
  assert.equal(runHookEvent('Stop', { session_id: 's', cwd: mainRoot }, options), null, 'okf-upkeep does not ask about the integrated files');
  writeFileSync(join(mainRoot, 'feature.js'), 'edited after the integration\n');
  const laterDate = new Date(Date.now() + 5000);
  utimesSync(join(mainRoot, 'feature.js'), laterDate, laterDate);
  assert.deepEqual(listSessionChangedCode(mainRoot, { baseHead, sessionStartMilliseconds: 0 }, ['.ai1/**']).map((changedFile) => changedFile.relativePath), ['feature.js']);
  assert.match(runHookEvent('Stop', { session_id: 's', cwd: mainRoot }, options).reason, /okf-upkeep[\s\S]*feature\.js/);
});

test('a concept edited after finish brought it in counts as this session\'s change again: the overview check asks', () => {
  const mainRoot = createCheckedRepo(['npm test']);
  const options = { environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) }, homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')) };
  runHookEvent('SessionStart', { session_id: 's', cwd: mainRoot, source: 'startup' }, options);
  finishCodeAndConcept(mainRoot, 'checked');
  assert.equal(runHookEvent('Stop', { session_id: 's', cwd: mainRoot }, options), null);
  const conceptPath = join(mainRoot, '.ai1', 'okf', 'feature.md');
  writeFileSync(conceptPath, `${readFileSync(conceptPath, 'utf8')}\nEdited after the integration.\n`);
  const laterDate = new Date(Date.now() + 5000);
  utimesSync(conceptPath, laterDate, laterDate);
  assert.match(runHookEvent('Stop', { session_id: 's', cwd: mainRoot }, options)?.reason ?? '', /changed concepts of the bundle[\s\S]*feature\.md/);
});

test('finish does not vouch for the verify commands when pre-finish does not run them', () => {
  const mainRoot = createCheckedRepo(['npm run lint']);
  finishCodeAndConcept(mainRoot, 'lint-only');
  const featureModified = statSync(join(mainRoot, 'feature.js')).mtimeMs;
  assert.equal(integratedFileMatcher(mainRoot, 'verified')('feature.js', featureModified), false);
  assert.ok(integratedFileMatcher(mainRoot, 'knowledge_checked')('feature.js', featureModified));
});
