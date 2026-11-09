import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildFileMap, findConceptsForFile, loadFileMap, readBodyCodePaths, readSourceResources, resolveResourcePath,
} from '../src/okf/okf-file-map.mjs';
import { createTemporaryProject } from './helpers.mjs';

const BUNDLE_PATH = '.ai1/okf';

function writeConcept(projectRoot, conceptPath, conceptText) {
  const absolutePath = join(projectRoot, BUNDLE_PATH, conceptPath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, conceptText);
}

function createMappedBundle() {
  const projectRoot = createTemporaryProject();
  writeConcept(projectRoot, 'index.md', '---\nokf_version: "0.2"\n---\n# Bundle\n');
  writeConcept(projectRoot, 'overview.md', '---\ntype: Overview\ntitle: Overview\n---\nCode in `src/guards/` and `src/core/`, `src/core/config.mjs`, `src/okf/okf-index.mjs`, `src/okf/okf-upkeep.mjs`.\n');
  writeConcept(projectRoot, 'guards/danger.md', '---\ntype: Component\ntitle: danger guard\n---\nSource: `src/guards/danger.mjs`, parser `src/core/shell-parse.mjs:12`.\n');
  writeConcept(projectRoot, 'features/okf.md', [
    '---', 'type: Feature', 'title: okf feature', 'sources:', '  - id: index', '    resource: src/okf/okf-index.mjs',
    '  - { id: upkeep, resource: src/okf/okf-upkeep.mjs }', '  - src/okf/okf-bundle.mjs', '  - id: docs', '    resource: https://example.com/okf', '---', 'Body.', '',
  ].join('\n'));
  writeConcept(projectRoot, 'architecture/config.md', '---\ntype: Configuration\ntitle: Config contract\nresource: src/core/config.mjs\n---\nSee [okf](../features/okf.md).\n');
  writeConcept(projectRoot, 'architecture/no-paths.md', '---\ntype: Decision\ntitle: No code\n---\nNothing cited.\n');
  return projectRoot;
}

test('resolveResourcePath follows the OKF path forms plus repo-root bare paths', () => {
  assert.deepEqual(resolveResourcePath('src/x.mjs', BUNDLE_PATH, 'features/okf.md'), { path: 'src/x.mjs', isFolder: false });
  assert.deepEqual(resolveResourcePath('/references/spec.md', BUNDLE_PATH, 'features/okf.md'), { path: '.ai1/okf/references/spec.md', isFolder: false });
  assert.deepEqual(resolveResourcePath('../../../src/x.mjs', BUNDLE_PATH, 'features/okf.md'), { path: 'src/x.mjs', isFolder: false });
  assert.deepEqual(resolveResourcePath('"src/core/"', BUNDLE_PATH, 'okf.md'), { path: 'src/core/', isFolder: true });
  assert.equal(resolveResourcePath('https://example.com/x', BUNDLE_PATH, 'okf.md'), null);
  assert.equal(resolveResourcePath('all queries in project X', BUNDLE_PATH, 'okf.md'), null);
  assert.equal(resolveResourcePath('../../../../outside.mjs', BUNDLE_PATH, 'features/okf.md'), null);
});

test('readSourceResources reads block, inline and plain items, and stops at the next key', () => {
  const frontmatterText = 'type: X\nsources:\n  - id: a\n    resource: src/a.mjs\n  - { id: b, resource: src/b.mjs }\n- src/c.mjs\ntags: [x]\nresource: src/top.mjs';
  assert.deepEqual(readSourceResources(frontmatterText), ['src/a.mjs', 'src/b.mjs', 'src/c.mjs']);
  assert.deepEqual(readSourceResources('type: X'), []);
});

test('readBodyCodePaths keeps repo-looking paths and drops the rest', () => {
  const bodyText = [
    'Files `src/a.mjs`, `./src/b.mjs`, `src/c.mjs:42`, `src/d.mjs#L10`, folder `src/core/`.',
    'Dropped: `src/`, `test/`, `hook-io.mjs`, `src/<feature>/`, `skills/okf-*`, `/etc/hosts`, `~/x.js`,',
    '`https://x.io/a.js`, `npm test`, `features/okf.md` (a concept), `src/noext`.',
    '```', 'src/in-fence.mjs `src/in-fence-tick.mjs`', '```',
  ].join('\n');
  const citedPaths = readBodyCodePaths(bodyText, new Set(['features/okf.md'])).map((citedPath) => citedPath.path);
  assert.deepEqual(citedPaths, ['src/a.mjs', 'src/b.mjs', 'src/c.mjs', 'src/d.mjs', 'src/core/']);
});

test('findConceptsForFile: the specific concept wins, resource and sources beat body citations', () => {
  const projectRoot = createMappedBundle();
  const fileMap = buildFileMap(join(projectRoot, BUNDLE_PATH), BUNDLE_PATH);
  const conceptsFor = (filePath) => findConceptsForFile(fileMap, filePath).map((conceptMatch) => conceptMatch.conceptPath);
  assert.deepEqual(conceptsFor('src/guards/danger.mjs'), ['guards/danger.md'], 'body-exact beats overview body-folder');
  assert.deepEqual(conceptsFor('src/core/shell-parse.mjs'), ['guards/danger.md'], 'location suffix stripped');
  assert.deepEqual(conceptsFor('src/core/config.mjs'), ['architecture/config.md'], 'resource beats body-exact');
  assert.deepEqual(conceptsFor('src/okf/okf-upkeep.mjs'), ['features/okf.md'], 'inline sources mapping');
  assert.deepEqual(conceptsFor('src/okf/okf-bundle.mjs'), ['features/okf.md'], 'plain sources item');
  assert.deepEqual(conceptsFor('src/core/dispatcher.mjs'), ['overview.md'], 'only a folder citation covers it');
  assert.deepEqual(conceptsFor('README.md'), []);
  assert.ok(!fileMap.some((conceptEntry) => conceptEntry.conceptPath === 'architecture/no-paths.md'));
  assert.equal(fileMap.find((conceptEntry) => conceptEntry.conceptPath === 'guards/danger.md').repoPath, '.ai1/okf/guards/danger.md');
});

test('findConceptsForFile: ties keep at most two, the concept citing fewer paths first', () => {
  const fileMap = [
    { conceptPath: 'wide.md', repoPath: 'b/wide.md', title: 'Wide', citedPaths: [{ path: 'src/x.mjs', isFolder: false, strength: 1 }, { path: 'src/y.mjs', isFolder: false, strength: 1 }] },
    { conceptPath: 'narrow.md', repoPath: 'b/narrow.md', title: 'Narrow', citedPaths: [{ path: 'src/x.mjs', isFolder: false, strength: 1 }] },
    { conceptPath: 'third.md', repoPath: 'b/third.md', title: 'Third', citedPaths: [{ path: 'src/x.mjs', isFolder: false, strength: 1 }, { path: 'a', isFolder: false, strength: 1 }, { path: 'b', isFolder: false, strength: 1 }] },
    { conceptPath: 'folder.md', repoPath: 'b/folder.md', title: 'Folder', citedPaths: [{ path: 'src/deep/', isFolder: true, strength: 1 }, { path: 'src/', isFolder: true, strength: 1 }] },
  ];
  assert.deepEqual(findConceptsForFile(fileMap, 'src/x.mjs').map((conceptMatch) => conceptMatch.conceptPath), ['narrow.md', 'wide.md']);
  assert.deepEqual(findConceptsForFile(fileMap, 'src/deep/z.mjs')[0], { conceptPath: 'folder.md', repoPath: 'b/folder.md', title: 'Folder' });
});

test('loadFileMap caches by bundle change and rebuilds when the bundle changes', () => {
  const projectRoot = createMappedBundle();
  const stateDirectory = mkdtempSync(join(tmpdir(), 'ai1-state-'));
  const bundleDirectory = join(projectRoot, BUNDLE_PATH);
  const firstMap = loadFileMap(bundleDirectory, BUNDLE_PATH, projectRoot, stateDirectory);
  assert.ok(firstMap.length >= 4);
  writeConcept(projectRoot, 'guards/new.md', '---\ntype: Component\ntitle: New guard\n---\n`src/guards/new.mjs`\n');
  const futureSeconds = Date.now() / 1000 + 60;
  utimesSync(join(bundleDirectory, 'guards', 'new.md'), futureSeconds, futureSeconds);
  const rebuiltMap = loadFileMap(bundleDirectory, BUNDLE_PATH, projectRoot, stateDirectory);
  assert.deepEqual(findConceptsForFile(rebuiltMap, 'src/guards/new.mjs').map((conceptMatch) => conceptMatch.conceptPath), ['guards/new.md']);
  for (const cacheFileName of readdirSync(stateDirectory)) writeFileSync(join(stateDirectory, cacheFileName), '{corrupt');
  assert.deepEqual(loadFileMap(bundleDirectory, BUNDLE_PATH, projectRoot, stateDirectory), rebuiltMap, 'a corrupt cache is rebuilt');
});

test('buildFileMap reads CRLF concepts and a v0.1 bundle without sources', () => {
  const projectRoot = createTemporaryProject();
  writeConcept(projectRoot, 'legacy.md', '---\r\ntype: Service\r\ntimestamp: 2026-01-01\r\n---\r\n# Citations\r\n- `services/api/main.py`\r\n');
  const fileMap = buildFileMap(join(projectRoot, BUNDLE_PATH), BUNDLE_PATH);
  assert.deepEqual(findConceptsForFile(fileMap, 'services/api/main.py').map((conceptMatch) => conceptMatch.conceptPath), ['legacy.md']);
});
