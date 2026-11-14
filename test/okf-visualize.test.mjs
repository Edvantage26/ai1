// `ai1 okf visualize` (src/okf/okf-visualize.mjs): graph data, a safe inline script and the options.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildBundleGraph, runOkfVisualizeCommand } from '../src/okf/okf-visualize.mjs';

const silent = () => {};

function createBundle(bundleFiles) {
  const bundleDirectory = mkdtempSync(join(tmpdir(), 'ai1-okf-viz-'));
  for (const [relativePath, fileContent] of Object.entries(bundleFiles)) {
    mkdirSync(dirname(join(bundleDirectory, relativePath)), { recursive: true });
    writeFileSync(join(bundleDirectory, relativePath), fileContent);
  }
  return bundleDirectory;
}

const BUNDLE_FILES = {
  'index.md': '# Root\n* [a](a.md)\n',
  'log.md': '## 2026-01-01\n',
  'a.md': '---\ntype: Service\ntitle: A\ngenerated: { by: human:x, at: 2026-01-01T00:00:00Z }\nverified: { by: process:ci }\nsources:\n  - { resource: /b.md, title: B doc, usage_count: 3 }\n  - { resource: https://x, id: ext }\nusage_window: { from: 2026-01-01, to: 2026-02-01 }\n---\nSee [b](b.md), [b again](./b.md#x), [out](https://x/y.md) and </script><!-- tricky.\n',
  'b.md': '---\ntype: Decision\ntimestamp: 2025-05-05\ntags: [t1]\n---\n```\n[fenced](a.md)\n```\n',
  'sub/c.md': 'no frontmatter, links [up](../a.md)\n',
};

test('visualize: nodes carry type, trust and sources; links and concept sources are edges, fences are not [okf-node:S4]', () => {
  const { nodes, edges } = buildBundleGraph(createBundle(BUNDLE_FILES), silent);
  assert.deepEqual(nodes.map((node) => node.id), ['a', 'b', 'sub/c']);
  const [nodeA, nodeB, nodeC] = nodes;
  assert.deepEqual([nodeA.type, nodeA.title, nodeA.group, nodeA.generated, nodeA.verified], ['Service', 'A', '(root)', { by: 'human:x', at: '2026-01-01T00:00:00Z' }, [{ by: 'process:ci', at: '' }]]);
  assert.deepEqual(nodeA.sources[0], { title: 'B doc', resource: '/b.md', cid: 'b', author: '', usage_count: 3, usage_window: '2026-01-01→2026-02-01', last_modified: '' });
  assert.equal(nodeA.sources[1].title, 'ext');
  assert.deepEqual([nodeB.generated, nodeB.tags], [{ by: '', at: '2025-05-05' }, ['t1']]);
  assert.deepEqual([nodeC.type, nodeC.title, nodeC.group], ['Untyped', 'c', 'sub']);
  assert.deepEqual(edges, [{ source: 'a', target: 'b' }, { source: 'sub/c', target: 'a' }]);
});

test('ai1 okf visualize writes viz.html with the data escaped for an inline script, and checks its options', () => {
  const bundleDirectory = createBundle(BUNDLE_FILES);
  const printed = [];
  assert.equal(runOkfVisualizeCommand([bundleDirectory, '-t', 'My graph', '--layout', 'grid'], (line) => printed.push(line), silent), 0);
  assert.match(printed[0], /^rendered 3 concepts, 2 links -> .*viz\.html$/);
  const pageText = readFileSync(join(bundleDirectory, 'viz.html'), 'utf8');
  assert.ok(!pageText.includes('</script><!--'), 'a body cannot close the inline script');
  assert.match(pageText, /<title>OKF — My graph<\/title>/);
  assert.match(pageText, /let curLayout='grid';/);
  assert.equal(runOkfVisualizeCommand([bundleDirectory, '--max-nodes', '2', '-o', join(bundleDirectory, 'x.html')], silent, silent), 1);
  assert.equal(runOkfVisualizeCommand([bundleDirectory, '--layout', 'nope'], silent, silent), 2);
  assert.equal(runOkfVisualizeCommand([join(bundleDirectory, 'a.md')], silent, silent), 2);
});
