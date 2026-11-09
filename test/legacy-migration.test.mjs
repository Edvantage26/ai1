import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { planLegacyMigration, migrateLegacyLayout } from '../src/cli/legacy-migration.mjs';
import { setupRepo, describeRepo } from '../src/cli/setup-repo.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { AI1_PLUGIN_ID, SCHEMA_URL } from '../src/core/config.mjs';

const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));
const runGit = (repoRoot, gitArguments) => execFileSync('git', ['-C', repoRoot, ...gitArguments], { encoding: 'utf8' });

function writeRepoFile(repoRoot, relativePath, fileText) {
  mkdirSync(dirname(join(repoRoot, relativePath)), { recursive: true });
  writeFileSync(join(repoRoot, relativePath), fileText);
}

// A repo set up with jig (ai1's former name): config, bundle, RFCs, a work plan and settings.
function createLegacyRepo({ legacyConfig = { $schema: 'https://example.invalid/jig.schema.json', version: 1, features: { okf: true, rfc: true, danger: false }, trunk: 'main', verify: ['npm test'], knowledge: '.okf' } } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-legacy-'));
  runGit(repoRoot, ['init', '-q', '-b', 'main']);
  if (legacyConfig) writeRepoFile(repoRoot, '.claude/jig.json', JSON.stringify(legacyConfig));
  writeRepoFile(repoRoot, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'jig@jig': true, 'other@x': true }, extraKnownMarketplaces: { jig: { source: { source: 'github', repo: 'Edvantage26/jig' } } } }));
  writeRepoFile(repoRoot, '.okf/index.md', '---\nokf_version: "0.2"\n---\n# Bundle\n* [Decision](decisions/guard.md)\n');
  writeRepoFile(repoRoot, '.okf/decisions/guard.md', '---\ntype: Decision\nsources:\n  - resource: docs/rfc/0001-guard.md\n---\nDecided in `docs/rfc/0001-guard.md`; code in [the guard](../../src/guard.mjs).\n');
  writeRepoFile(repoRoot, 'docs/rfc/0001-guard.md', 'See the [decision](../../.okf/decisions/guard.md) and the bundle `.okf/`.\n');
  writeRepoFile(repoRoot, 'docs/other.md', 'Not an RFC.\n');
  writeRepoFile(repoRoot, 'src/guard.mjs', 'export {};\n');
  writeRepoFile(repoRoot, 'CLAUDE.md', 'Read `.okf/index.md` first.\n');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'legacy']);
  writeRepoFile(repoRoot, '.okf/draft.md', 'untracked concept\n');
  writeRepoFile(repoRoot, '.jig/.gitignore', '*\n');
  writeRepoFile(repoRoot, '.jig/work/billing/plan.md', '---\ntitle: x\nstatus: draft\n---\n');
  return repoRoot;
}

function writeUserSettings() {
  const settingsPath = join(mkdtempSync(join(tmpdir(), 'ai1-user-')), 'settings.json');
  writeFileSync(settingsPath, '{}');
  return settingsPath;
}

test('status shows the old layout and the features the repo had', () => {
  const repoRoot = createLegacyRepo();
  const repoDescription = describeRepo(repoRoot);
  assert.equal(repoDescription.hasAi1Config, false);
  assert.deepEqual(repoDescription.legacyMigration.moves.map((plannedMove) => plannedMove.from), ['.claude/jig.json', '.okf', 'docs/rfc', '.jig/work']);
  assert.deepEqual(repoDescription.legacyMigration.settingsFiles, ['.claude/settings.json']);
  assert.equal(repoDescription.features.find((featureStatus) => featureStatus.id === 'rfc').enabled, true);
  assert.equal(repoDescription.features.find((featureStatus) => featureStatus.id === 'danger').enabled, false);
});

test('ai1 init moves the old layout to .ai1/, keeps history and rewrites links', () => {
  const repoRoot = createLegacyRepo();
  const setupResult = setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'rfc'], userSettingsPath: writeUserSettings() });
  for (const movedAway of ['.claude/jig.json', '.okf', 'docs/rfc', '.jig']) assert.equal(existsSync(join(repoRoot, movedAway)), false, movedAway);
  assert.ok(existsSync(join(repoRoot, 'docs/other.md')), 'the rest of docs/ stays');
  assert.ok(existsSync(join(repoRoot, '.ai1/okf/draft.md')), 'untracked bundle files move too');
  assert.ok(existsSync(join(repoRoot, '.ai1/work/billing/plan.md')));
  assert.equal(readFileSync(join(repoRoot, '.ai1/work/.gitignore'), 'utf8'), '*\n');

  const ai1Config = readJson(join(repoRoot, '.ai1/config.json'));
  assert.ok(!Object.hasOwn(ai1Config, 'knowledge'), 'the retired setting is removed');
  assert.equal(ai1Config.$schema, SCHEMA_URL);
  assert.deepEqual(ai1Config.verify, ['npm test'], 'fields of the old config are kept');

  const projectSettings = readJson(join(repoRoot, '.claude/settings.json'));
  assert.equal(projectSettings.enabledPlugins['jig@jig'], undefined);
  assert.equal(projectSettings.enabledPlugins[AI1_PLUGIN_ID], true);
  assert.equal(projectSettings.enabledPlugins['other@x'], true);
  assert.equal(projectSettings.extraKnownMarketplaces.jig, undefined);
  assert.equal(projectSettings.extraKnownMarketplaces.ai1.source.repo, 'Edvantage26/ai1');

  assert.equal(readFileSync(join(repoRoot, '.ai1/rfc/0001-guard.md'), 'utf8'), 'See the [decision](../okf/decisions/guard.md) and the bundle `.ai1/okf/`.\n');
  assert.equal(readFileSync(join(repoRoot, '.ai1/okf/decisions/guard.md'), 'utf8'), '---\ntype: Decision\nsources:\n  - resource: .ai1/rfc/0001-guard.md\n---\nDecided in `.ai1/rfc/0001-guard.md`; code in [the guard](../../../src/guard.mjs).\n');
  assert.equal(readFileSync(join(repoRoot, '.ai1/okf/index.md'), 'utf8'), '---\nokf_version: "0.2"\n---\n# Bundle\n* [Decision](decisions/guard.md)\n');

  const stagedRenames = runGit(repoRoot, ['diff', '--cached', '-M', '--name-status']);
  assert.match(stagedRenames, /^R\d+\t\.okf\/index\.md\t\.ai1\/okf\/index\.md$/m);
  assert.match(stagedRenames, /^R\d+\t\.claude\/jig\.json\t\.ai1\/config\.json$/m);
  assert.deepEqual(setupResult.legacyMigration.filesMentioningOldPaths, ['CLAUDE.md']);

  assert.deepEqual(setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'rfc'], userSettingsPath: writeUserSettings() }).legacyMigration.moves, [], 'a second run has nothing to move');
});

test('migration refuses when a target exists and moves nothing', () => {
  const repoRoot = createLegacyRepo();
  writeRepoFile(repoRoot, '.ai1/okf/index.md', 'already here\n');
  assert.deepEqual(planLegacyMigration(repoRoot).conflicts, ['.ai1/okf']);
  assert.throws(() => migrateLegacyLayout(repoRoot), /\.ai1\/okf already exist/);
  assert.ok(existsSync(join(repoRoot, '.claude/jig.json')));
  assert.ok(existsSync(join(repoRoot, '.okf/index.md')));
});

test('a repo without ai1 but with an .okf/ bundle gets it moved; a custom knowledge path moves too', () => {
  const okfOnlyRepo = createLegacyRepo({ legacyConfig: null });
  assert.deepEqual(planLegacyMigration(okfOnlyRepo).moves.map((plannedMove) => plannedMove.from), ['.okf', '.jig/work'], 'docs/rfc is not ours without the old rfc feature');
  setupRepo(okfOnlyRepo, { enabledFeatureIds: ['okf'], userSettingsPath: writeUserSettings() });
  assert.ok(existsSync(join(okfOnlyRepo, '.ai1/okf/index.md')));
  assert.ok(existsSync(join(okfOnlyRepo, 'docs/rfc/0001-guard.md')));
  assert.ok(!Object.hasOwn(readJson(join(okfOnlyRepo, '.ai1/config.json')), 'knowledge'));

  const customRepo = createLegacyRepo({ legacyConfig: { version: 1, features: { okf: true }, knowledge: 'docs/kb' } });
  writeRepoFile(customRepo, 'docs/kb/index.md', '---\nokf_version: "0.2"\n---\n# Custom bundle\n');
  assert.deepEqual(planLegacyMigration(customRepo).moves.map((plannedMove) => plannedMove.from), ['.claude/jig.json', 'docs/kb', '.jig/work']);
  setupRepo(customRepo, { enabledFeatureIds: ['okf'], userSettingsPath: writeUserSettings() });
  assert.ok(!Object.hasOwn(readJson(join(customRepo, '.ai1/config.json')), 'knowledge'));
  assert.match(readFileSync(join(customRepo, '.ai1/okf/index.md'), 'utf8'), /Custom bundle/);
  assert.ok(existsSync(join(customRepo, '.okf/index.md')), '.okf/ was not the bundle: left alone');
});

test('ai1 init moves the bundle of a current config with a custom knowledge path and drops the setting', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-custom-'));
  runGit(repoRoot, ['init', '-q', '-b', 'main']);
  writeRepoFile(repoRoot, '.ai1/config.json', JSON.stringify({ version: 1, features: { okf: true }, knowledge: 'docs/kb/' }));
  writeRepoFile(repoRoot, 'docs/kb/index.md', '---\nokf_version: "0.2"\n---\n# Bundle\n* [A](a.md)\n');
  writeRepoFile(repoRoot, 'docs/kb/a.md', '---\ntype: Decision\n---\nA.\n');
  setupRepo(repoRoot, { enabledFeatureIds: ['okf'], userSettingsPath: writeUserSettings() });
  assert.ok(existsSync(join(repoRoot, '.ai1/okf/a.md')));
  assert.ok(!existsSync(join(repoRoot, 'docs/kb')));
  assert.ok(!Object.hasOwn(readJson(join(repoRoot, '.ai1/config.json')), 'knowledge'));
  writeRepoFile(repoRoot, 'docs/kb/index.md', 'again');
  writeRepoFile(repoRoot, '.ai1/config.json', JSON.stringify({ version: 1, features: { okf: true }, knowledge: 'docs/kb' }));
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf'], userSettingsPath: writeUserSettings() }), /\.ai1\/okf already exist/, 'refuses when .ai1/okf exists');
});

test('session start in an old layout points to the migration', () => {
  const repoRoot = createLegacyRepo();
  const hookOutput = runHookEvent('SessionStart', { session_id: 's', cwd: repoRoot, source: 'startup' }, { environment: {}, reportInternalError: () => {} });
  assert.match(hookOutput.hookSpecificOutput.additionalContext, /old layout[\s\S]*\/ai1:core-setup-repo moves it to \.ai1\//);
});
