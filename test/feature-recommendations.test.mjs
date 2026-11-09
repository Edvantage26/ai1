import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { recommendFeatures, detectVerifyCommands } from '../src/cli/feature-recommendations.mjs';
import { describeRepo } from '../src/cli/setup-repo.mjs';
import { KNOWN_FEATURE_IDS, findFeature } from '../src/core/features.mjs';

// A committed repo with the given files ({ relativePath: content }).
function createRepoWithFiles(filesByPath) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-recommend-'));
  execFileSync('git', ['-C', repoRoot, 'init', '-q', '-b', 'main']);
  for (const [relativePath, fileContent] of Object.entries(filesByPath)) {
    mkdirSync(dirname(join(repoRoot, relativePath)), { recursive: true });
    writeFileSync(join(repoRoot, relativePath), fileContent);
  }
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return repoRoot;
}

const recommendedIn = (repoRoot) => Object.fromEntries(Object.entries(recommendFeatures(repoRoot, { hasKnowledgeBundle: false }).recommendations)
  .map(([featureId, recommendation]) => [featureId, recommendation.recommended]));

test('a small frontend repo: design and verify on, lanes off, worktrees asked', () => {
  const repoRoot = createRepoWithFiles({
    'package.json': JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { react: '^19.0.0' } }),
    'pnpm-lock.yaml': '',
    'src/App.tsx': 'export const App = () => null;\n',
  });
  const { recommendations, verifyCommands } = recommendFeatures(repoRoot, { hasKnowledgeBundle: false });
  assert.deepEqual(verifyCommands, ['pnpm test']);
  assert.equal(recommendations.design.recommended, true);
  assert.ok(recommendations.design.evidence.includes('package.json depends on react'));
  assert.equal(recommendations.lanes.recommended, false);
  assert.equal(recommendations.worktrees.recommended, null, 'nothing says how many sessions run at once: ask');
  assert.equal(recommendations.verify.recommended, true);
});

test('a backend repo with migrations and decision records: lanes and later on, design off', () => {
  const repoRoot = createRepoWithFiles({
    'pyproject.toml': '[tool.pytest.ini_options]\naddopts = "-q"\n',
    'app/db/migrations/0001_init.py': '',
    'infra/main.tf': '',
    'docs/adr/0001-use-postgres.md': '# Use Postgres\n',
  });
  const { recommendations, verifyCommands } = recommendFeatures(repoRoot, { hasKnowledgeBundle: false });
  assert.deepEqual(verifyCommands, ['pytest']);
  assert.equal(recommendations.lanes.recommended, true);
  assert.ok(recommendations.lanes.evidence.includes('risky area: app/db/migrations'));
  assert.ok(recommendations.lanes.evidence.includes('risky area: infra'));
  assert.equal(recommendations.later.recommended, true);
  assert.equal(recommendations.design.recommended, false);
});

test('an empty repo: only the always-useful features, verify off until there are tests', () => {
  assert.deepEqual(recommendedIn(createRepoWithFiles({ 'README.md': 'x\n' })), {
    okf: true, danger: true, craft: true, lanes: false, worktrees: null, later: false, design: false, verify: false,
  });
});

test('worktrees are recommended when the repo already uses them', () => {
  const repoRoot = createRepoWithFiles({ '.worktreeinclude': '.env\n' });
  assert.equal(recommendFeatures(repoRoot, { hasKnowledgeBundle: false }).recommendations.worktrees.recommended, true);
});

test('a monorepo: commands and frontend found in top-level folders with their own manifest', () => {
  const repoRoot = createRepoWithFiles({
    'backend/requirements-dev.txt': 'pytest==8.0\n',
    'backend/tests/test_api.py': '',
    'frontend/package.json': JSON.stringify({ scripts: { test: 'vitest run' }, dependencies: { next: '15.0.0' } }),
    'docs/notes.md': 'not a project\n',
  });
  const { recommendations, verifyCommands } = recommendFeatures(repoRoot, { hasKnowledgeBundle: false });
  assert.deepEqual(verifyCommands, ['cd backend && pytest', 'cd frontend && npm test']);
  assert.ok(recommendations.design.evidence.includes('frontend/package.json depends on next'));
});

test('verify commands: pytest through the project\'s uv, poetry or virtualenv', () => {
  assert.deepEqual(detectVerifyCommands(createRepoWithFiles({ 'conftest.py': '', 'uv.lock': '' })), ['uv run pytest']);
  assert.deepEqual(detectVerifyCommands(createRepoWithFiles({ 'conftest.py': '', 'poetry.lock': '' })), ['poetry run pytest']);
  const repoWithVirtualenv = createRepoWithFiles({ 'api/tests/conftest.py': '', 'api/requirements.txt': 'pytest\n' });
  mkdirSync(join(repoWithVirtualenv, 'api', '.venv', 'bin'), { recursive: true });
  writeFileSync(join(repoWithVirtualenv, 'api', '.venv', 'bin', 'pytest'), '');
  assert.deepEqual(detectVerifyCommands(repoWithVirtualenv), ['cd api && .venv/bin/pytest']);
});

test('verify commands: npm placeholder ignored; make, cargo and go detected', () => {
  assert.deepEqual(detectVerifyCommands(createRepoWithFiles({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })), []);
  assert.deepEqual(detectVerifyCommands(createRepoWithFiles({ Makefile: 'test:\n\tgo test ./...\n', 'Cargo.toml': '', 'go.mod': '' })), ['make test', 'cargo test', 'go test ./...']);
});

test('status gives every selectable feature a recommendation', () => {
  const repoDescription = describeRepo(createRepoWithFiles({ 'README.md': 'x\n' }));
  const selectableFeatureIds = KNOWN_FEATURE_IDS.filter((featureId) => !findFeature(featureId).alwaysOn);
  assert.deepEqual(repoDescription.features.map((featureStatus) => featureStatus.id), selectableFeatureIds);
  for (const featureStatus of repoDescription.features) assert.equal(typeof featureStatus.recommendation.reason, 'string', featureStatus.id);
  assert.deepEqual(repoDescription.detectedVerifyCommands, []);
});
