// What ai1 proposes for a repo before the person chooses: one recommendation per feature, read
// from cheap local signals (tracked files, package manifests, git history), each with its reason
// and the evidence behind it. /ai1:core-setup-repo shows them and pre-selects the recommended ones;
// the person decides. `recommended: null` means the repo cannot tell and the skill asks.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tryGit } from '../core/git.mjs';
import { readJsonFileIfValid } from '../core/json-file.mjs';

const FRONTEND_PACKAGES = ['react', 'vue', 'svelte', '@angular/core', 'next', 'nuxt', 'astro', 'solid-js', 'preact', 'lit', '@remix-run/react', 'react-native', 'expo'];
const FRONTEND_FILE_PATTERN = /\.(tsx|jsx|vue|svelte|astro|css|scss)$/i;
const RISKY_PATH_PATTERN = /(^|\/)(migrations?|alembic|auth|authentication|payments?|billing|infra|terraform)(\/|$)|\.tf$/i;
const REUSE_EVIDENCE_PATHS = ['.claude/skills', '.claude/commands', '.mcp.json'];
const LATER_EVIDENCE_DIRECTORIES = ['.ai1/later', 'docs/rfc', 'docs/rfcs', 'rfcs', 'docs/adr', 'adr', 'docs/decisions', 'decisions'];
const WORKTREE_PRACTICE_FILES = ['.worktreeinclude', '.config/wt.toml', '.gtrconfig', '.claude/worktrees'];
const LARGE_REPO_TRACKED_FILES = 50;
const LARGE_REPO_COMMITS = 100;
// npm's placeholder when a package has no tests.
const NPM_PLACEHOLDER_TEST = /no test specified/;
const PROJECT_MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'requirements-dev.txt', 'Makefile', 'Cargo.toml', 'go.mod', 'pytest.ini'];

function readTextIfPresent(filePath) {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : null;
}

function listTrackedFiles(repoRoot) {
  return (tryGit(repoRoot, ['ls-files']) ?? '').split('\n').filter(Boolean);
}

// The repo root and each top-level folder with its own manifest (`frontend/`, `backend/` in a
// monorepo), as { directory, label, commandPrefix } so a command runs from where it belongs.
function listProjectDirectories(repoRoot) {
  const subprojectNames = readdirSync(repoRoot, { withFileTypes: true })
    .filter((directoryEntry) => directoryEntry.isDirectory() && !directoryEntry.name.startsWith('.') && directoryEntry.name !== 'node_modules')
    .map((directoryEntry) => directoryEntry.name)
    .filter((subprojectName) => PROJECT_MANIFESTS.some((manifestName) => existsSync(join(repoRoot, subprojectName, manifestName))))
    .sort();
  return [
    { directory: repoRoot, label: '', commandPrefix: '' },
    ...subprojectNames.map((subprojectName) => ({ directory: join(repoRoot, subprojectName), label: `${subprojectName}/`, commandPrefix: `cd ${subprojectName} && ` })),
  ];
}

function usesPytest(projectDirectory) {
  return ['pytest.ini', 'conftest.py', 'tests/conftest.py'].some((fileName) => existsSync(join(projectDirectory, fileName)))
    || /\[tool\.pytest/.test(readTextIfPresent(join(projectDirectory, 'pyproject.toml')) ?? '')
    || ['requirements.txt', 'requirements-dev.txt'].some((fileName) => /^pytest\b/m.test(readTextIfPresent(join(projectDirectory, fileName)) ?? ''));
}

// How this project runs pytest: its uv or poetry environment, its virtualenv, or the PATH.
function pytestRunner(projectDirectory) {
  if (existsSync(join(projectDirectory, 'uv.lock'))) return 'uv run pytest';
  if (existsSync(join(projectDirectory, 'poetry.lock'))) return 'poetry run pytest';
  const virtualenvName = ['.venv', 'venv'].find((candidateName) => existsSync(join(projectDirectory, candidateName, 'bin', 'pytest')));
  return virtualenvName ? `${virtualenvName}/bin/pytest` : 'pytest';
}

function detectProjectTestCommands(projectDirectory) {
  const testCommands = [];
  const packageTestScript = readJsonFileIfValid(join(projectDirectory, 'package.json'))?.scripts?.test;
  if (packageTestScript && !NPM_PLACEHOLDER_TEST.test(packageTestScript)) {
    const packageManager = existsSync(join(projectDirectory, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(projectDirectory, 'yarn.lock')) ? 'yarn' : 'npm';
    testCommands.push(`${packageManager} test`);
  }
  if (/^test:/m.test(readTextIfPresent(join(projectDirectory, 'Makefile')) ?? '')) testCommands.push('make test');
  if (usesPytest(projectDirectory)) testCommands.push(pytestRunner(projectDirectory));
  if (existsSync(join(projectDirectory, 'Cargo.toml'))) testCommands.push('cargo test');
  if (existsSync(join(projectDirectory, 'go.mod'))) testCommands.push('go test ./...');
  return testCommands;
}

// The commands that run this repo's tests, in the order a person would try them.
export function detectVerifyCommands(repoRoot) {
  return listProjectDirectories(repoRoot).flatMap(({ directory, commandPrefix }) => detectProjectTestCommands(directory)
    .map((testCommand) => `${commandPrefix}${testCommand}`));
}

function recommendDesign(repoRoot, trackedFiles) {
  const frontendPackageEvidence = listProjectDirectories(repoRoot).flatMap(({ directory, label }) => {
    const packageManifest = readJsonFileIfValid(join(directory, 'package.json')) ?? {};
    const declaredPackages = Object.keys({ ...packageManifest.dependencies, ...packageManifest.devDependencies });
    return FRONTEND_PACKAGES.filter((packageName) => declaredPackages.includes(packageName)).map((packageName) => `${label}package.json depends on ${packageName}`);
  });
  const frontendFileCount = trackedFiles.filter((trackedPath) => FRONTEND_FILE_PATTERN.test(trackedPath)).length;
  const evidence = [
    ...frontendPackageEvidence,
    ...(frontendFileCount ? [`${frontendFileCount} UI files (.tsx, .vue, .css...)`] : []),
  ];
  return evidence.length
    ? { recommended: true, reason: 'the repo has a frontend', evidence }
    : { recommended: false, reason: 'no frontend found', evidence };
}

// Whether the repo has a frontend (UI packages or tracked UI files): design-brief stays quiet without one.
export function repoHasFrontend(repoRoot) {
  return recommendDesign(repoRoot, listTrackedFiles(repoRoot)).recommended;
}

function recommendSizing(repoRoot, trackedFiles) {
  const commitCount = Number(tryGit(repoRoot, ['rev-list', '--count', 'HEAD']) ?? 0);
  // The path up to the risky folder (`db/migrations`), or the risky file itself (`main.tf`).
  const riskyDirectories = [...new Set(trackedFiles.flatMap((trackedPath) => {
    const riskyMatch = RISKY_PATH_PATTERN.exec(trackedPath);
    return riskyMatch ? [trackedPath.slice(0, riskyMatch.index + riskyMatch[0].length).replace(/\/$/, '')] : [];
  }))].slice(0, 5);
  const isLarge = trackedFiles.length >= LARGE_REPO_TRACKED_FILES || commitCount >= LARGE_REPO_COMMITS;
  const evidence = [`${trackedFiles.length} tracked files, ${commitCount} commits`, ...riskyDirectories.map((riskyPath) => `risky area: ${riskyPath}`)];
  if (riskyDirectories.length) return { recommended: true, reason: 'it has risky areas (data, auth, money, infra) where a design should come before code', evidence };
  if (isLarge) return { recommended: true, reason: 'the repo is large enough for tasks of very different sizes', evidence };
  return { recommended: false, reason: 'small repo: most tasks are quick', evidence };
}

function recommendWorktrees(repoRoot) {
  const worktreeCount = (tryGit(repoRoot, ['worktree', 'list', '--porcelain']) ?? '').split('\n').filter((porcelainLine) => porcelainLine.startsWith('worktree ')).length;
  const recentAuthorCount = (tryGit(repoRoot, ['shortlog', '-sn', '--since=90.days', 'HEAD']) ?? '').split('\n').filter(Boolean).length;
  const evidence = [
    ...WORKTREE_PRACTICE_FILES.filter((practicePath) => existsSync(join(repoRoot, practicePath))).map((practicePath) => `${practicePath} exists`),
    ...(worktreeCount > 1 ? [`${worktreeCount - 1} git worktrees besides the main checkout`] : []),
    ...(recentAuthorCount > 1 ? [`${recentAuthorCount} authors in the last 90 days`] : []),
  ];
  return evidence.length
    ? { recommended: true, reason: 'several people or sessions work on this repo at once', evidence }
    : { recommended: null, reason: 'it depends on whether you run several sessions on this repo at the same time', evidence };
}

function recommendLater(repoRoot) {
  const evidence = [...LATER_EVIDENCE_DIRECTORIES, 'ROADMAP.md'].filter((candidatePath) => existsSync(join(repoRoot, candidatePath))).map((candidatePath) => `${candidatePath} exists`);
  return evidence.length
    ? { recommended: true, reason: 'the repo already keeps RFCs, decisions or a roadmap', evidence }
    : { recommended: false, reason: 'no RFCs, decision records or roadmap found', evidence };
}

function recommendReuse(repoRoot) {
  const evidence = REUSE_EVIDENCE_PATHS.filter((candidatePath) => existsSync(join(repoRoot, candidatePath))).map((candidatePath) => `${candidatePath} exists`);
  return evidence.length
    ? { recommended: true, reason: 'the repo already keeps its own skills, commands or MCP servers', evidence }
    : { recommended: null, reason: 'it depends on whether the same kind of task comes back in this repo', evidence };
}

// { [featureId]: { recommended: true | false | null, reason, evidence: [] } } and the verify commands.
export function recommendFeatures(repoRoot, { hasKnowledgeBundle }) {
  const trackedFiles = listTrackedFiles(repoRoot);
  const verifyCommands = detectVerifyCommands(repoRoot);
  const designRecommendation = recommendDesign(repoRoot, trackedFiles);
  return {
    verifyCommands,
    recommendations: {
      okf: { recommended: true, reason: hasKnowledgeBundle ? 'the repo already has a knowledge bundle' : 'project knowledge the agent reads before it acts', evidence: [] },
      danger: { recommended: true, reason: 'protects work, history and data in every repo', evidence: [] },
      craft: { recommended: true, reason: 'keeps changes small and the code in order in every repo', evidence: [] },
      sizing: recommendSizing(repoRoot, trackedFiles),
      worktrees: recommendWorktrees(repoRoot),
      later: recommendLater(repoRoot),
      reuse: recommendReuse(repoRoot),
      design: designRecommendation,
      storyboard: designRecommendation.recommended
        ? { ...designRecommendation, reason: 'the repo has a frontend whose user flow can be reviewed as a storyboard' }
        : designRecommendation,
      verify: verifyCommands.length
        ? { recommended: true, reason: 'the repo has tests to run before a change is done', evidence: verifyCommands }
        : { recommended: false, reason: 'no test command found; enable it once the repo has one', evidence: [] },
    },
  };
}
