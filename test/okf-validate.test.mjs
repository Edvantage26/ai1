// `ai1 okf validate` (src/okf/okf-validate.mjs), ported from the Python toolkit's test_okf_validate.py:
// the same cases, plus the YAML 1.1 behaviours the port keeps from PyYAML.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { splitOkfFrontmatter, validateOkfBundle, migrateOkfBundle, collectLinkTargets, runOkfValidateCommand } from '../src/okf/okf-validate.mjs';

const FULL_META = '---\ntype: Reference\ntitle: t\ndescription: d\ntags: [x]\ngenerated: { by: human:tester, at: "2026-01-01T00:00:00Z" }\n---\n\nbody\n';

function createBundle(bundleFiles = {}) {
  const bundleDirectory = mkdtempSync(join(tmpdir(), 'ai1-okf-validate-'));
  writeBundleFiles(bundleDirectory, bundleFiles);
  return bundleDirectory;
}

function writeBundleFiles(bundleDirectory, bundleFiles) {
  for (const [relativePath, fileContent] of Object.entries(bundleFiles)) {
    mkdirSync(dirname(join(bundleDirectory, relativePath)), { recursive: true });
    writeFileSync(join(bundleDirectory, relativePath), fileContent);
  }
}

const validateFiles = (bundleFiles) => validateOkfBundle(createBundle(bundleFiles));

// A concept with the recommended fields set, so only the frontmatter under test can warn.
function validateConcept(extraMeta, bodyText = 'body\n') {
  return validateFiles({ 'c.md': `---\ntype: Reference\ntitle: t\ndescription: d\ntags: [x]\n${extraMeta}---\n\n${bodyText}` });
}

function onlyWarning(report) {
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1, report.warnings.join('\n'));
  return report.warnings[0];
}

function assertClean(report, label) {
  assert.deepEqual([report.errors, report.warnings], [[], []], label);
}

test('splitOkfFrontmatter: block, none, unterminated, bare fence line, trailing spaces, empty block', () => {
  assert.deepEqual(splitOkfFrontmatter('---\ntype: A\n---\nbody\n'), { frontmatterText: 'type: A\n', bodyText: 'body\n' });
  assert.deepEqual(splitOkfFrontmatter('just text'), { frontmatterText: null, bodyText: 'just text' });
  assert.equal(splitOkfFrontmatter('---\ntype: A\nno closing fence\n').frontmatterText, null);
  assert.equal(splitOkfFrontmatter('---not a fence\ntype: A\n---\n').frontmatterText, null);
  assert.deepEqual(splitOkfFrontmatter('---  \ntype: A\n---  \nbody'), { frontmatterText: 'type: A\n', bodyText: 'body' });
  assert.deepEqual(splitOkfFrontmatter('---\n---\nbody'), { frontmatterText: '', bodyText: 'body' });
});

test('concept: full metadata is clean, a BOM is skipped', () => {
  const report = validateFiles({ 'c.md': FULL_META });
  assert.deepEqual([report.errors, report.warnings, report.concepts], [[], [], 1]);
  assert.deepEqual(validateFiles({ 'c.md': `﻿${FULL_META}` }).errors, []);
});

test('concept: missing, unterminated, invalid or non-mapping frontmatter is an error', () => {
  const missing = validateFiles({ 'c.md': 'no frontmatter\n' }).errors[0];
  assert.match(missing, /§11\.1/);
  assert.match(missing, /`type`/);
  assert.match(validateFiles({ 'c.md': '---\ntype: A\nbody without closing fence\n' }).errors[0], /§11\.1/);
  assert.match(validateFiles({ 'c.md': '---\ntype: [unclosed\n---\nbody\n' }).errors[0], /not valid YAML/);
  assert.match(validateFiles({ 'c.md': '---\n- a\n- b\n---\nbody\n' }).errors[0], /YAML mapping/);
});

test('concept: a missing or empty type is an error; missing recommended fields only warn', () => {
  for (const typeLine of ['title: t', "type: ''", 'type:   ']) {
    assert.ok(validateFiles({ 'c.md': `---\n${typeLine}\n---\nbody\n` }).errors.some((error) => error.includes('§11.2')), typeLine);
  }
  const report = validateFiles({ 'c.md': '---\ntype: A\n---\nbody\n' });
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 4);
});

test('concept: a non-UTF-8 file is a per-file error, not a crash', () => {
  const bundleDirectory = createBundle();
  writeFileSync(join(bundleDirectory, 'c.md'), Buffer.from([0xff, 0xfe, 0x20, 0x69]));
  assert.ok(validateOkfBundle(bundleDirectory).errors.some((error) => error.startsWith('c.md: cannot read file')));
});

test('trust: legacy timestamp, generated without by, verified as mapping or list', () => {
  assert.match(onlyWarning(validateConcept('timestamp: "2026-01-01T00:00:00Z"\n')), /legacy v0\.1 `timestamp`/);
  assert.match(onlyWarning(validateConcept('generated: { at: "2026-01-01T00:00:00Z" }\n')), /§5\.2/);
  assertClean(validateConcept('generated: { by: human:t }\nverified: { by: human:t, at: "2026-01-01T00:00:00Z" }\n'));
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nverified:\n  - { at: "2026-01-01T00:00:00Z" }\n')), /§5\.2/);
});

test('lifecycle: status values and stale_after', () => {
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nstatus: retired\n')), /§5\.4/);
  for (const status of ['draft', 'stable', 'deprecated']) assertClean(validateConcept(`generated: { by: human:t }\nstatus: ${status}\n`), status);
  for (const staleAfter of ['2026-09-23', "'2026-09-23'", '2026-09-21T00:00:00Z']) assertClean(validateConcept(`generated: { by: human:t }\nstale_after: ${staleAfter}\n`), staleAfter);
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nstale_after: 30d\n')), /§5\.5/);
});

test('sources: usage windows, last_modified, resource required', () => {
  assertClean(validateConcept('generated: { by: human:t }\nusage_window: { from: 2026-06-01T00:00:00Z, to: 2026-06-30T00:00:00Z }\nsources:\n  - { resource: https://x, usage_count: 5 }\n'));
  assertClean(validateConcept('generated: { by: human:t }\nsources:\n  - { resource: https://x, last_modified: 2026-09-21T10:00:00+02:00 }\n'));
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nsources:\n  - { id: a, title: A }\n')), /§5\.1/);
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nsources:\n  - { resource: https://x, usage_count: 5 }\n')), /usage_window/);
  assertClean(validateConcept('generated: { by: human:t }\nusage_window: { from: 2026-06-01, to: 2026-06-30 }\nsources:\n  - { resource: https://x, usage_count: 5 }\n'));
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nusage_window: { from: 2026-06-01, to: last month }\nsources:\n  - { resource: https://x, usage_count: 5 }\n')), /usage_window\.to/);
});

const POLICY_SOURCE = 'generated: { by: human:t }\nsources:\n  - { id: pol, resource: https://x/pol, title: Policy }\n';

test('footnotes: a label must name a source; code is not a footnote', () => {
  assertClean(validateConcept(POLICY_SOURCE, 'Claim.[^pol]\n\n[^pol]: Policy\n'));
  assert.match(onlyWarning(validateConcept(POLICY_SOURCE, 'Claim.[^nope]\n\n[^nope]: Nope\n')), /\[\^nope\]/);
  const codeBody = '- `.../clients/(?<client_code>[^#?/]+).*` matches `clients/folders` too\n- ``a `[^a-z]` b`` in a double-backtick span\n\n```\nre.compile(r"[^0-9]+")\n```\n\n~~~python\n[^x]\n~~~\n\nClaim.[^pol]\n\n[^pol]: Policy\n';
  assertClean(validateConcept(POLICY_SOURCE, codeBody));
  const report = validateConcept(POLICY_SOURCE, '`[^a-z]` then a claim.[^nope]\n\n```\n[^b]\n```\nAfter.[^gone]\n');
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 2);
  assert.ok(report.warnings.some((warning) => warning.includes('[^nope]')));
  assert.ok(report.warnings.some((warning) => warning.includes('[^gone]')));
});

test('legacy # Citations body section warns', () => {
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\n', '# Citations\n\n[1] [x](https://x)\n')), /legacy v0\.1 `# Citations`/);
});

test('actors: near-misses of human:/process: warn, the spec shapes pass, a bare name warns', () => {
  for (const badActor of ['human/dana', 'Human:dana', 'human-dana', 'PROCESS:nightly']) {
    assert.match(onlyWarning(validateConcept(`generated: { by: ${badActor} }\n`)), /§7/, badActor);
  }
  assertClean(validateConcept('generated: { by: humanoid_agent/v1 }\n'));
  for (const goodActor of ['human:dana', 'process:nightly', 'reference_agent/gemini-2.5-pro']) assertClean(validateConcept(`generated: { by: ${goodActor} }\n`), goodActor);
  assertClean(validateConcept('generated: { by: human:t }\nsources:\n  - { resource: https://x, author: team:ga4-docs }\n'));
  assert.match(onlyWarning(validateConcept('generated: { by: dana }\n')), /§7/);
});

test('instants are RFC 3339, a date alone is tolerated', () => {
  for (const instant of ['"2026-06-20T22:53:05Z"', '"2026-06-20"', '2026-06-20T22:53:05Z', '"2026-06-20T22:53:05+02:00"']) {
    assertClean(validateConcept(`generated: { by: human:t, at: ${instant} }\n`), instant);
  }
  assert.match(onlyWarning(validateConcept('generated: { by: human:t, at: "last tuesday" }\n')), /RFC 3339/);
});

test('attested computation: runtime required, bundle paths that point nowhere warn', () => {
  const head = '---\ntype: Attested Computation\ntitle: t\ndescription: d\ntags: [x]\ngenerated: { by: human:t }\nruntime: bigquery\n';
  assert.match(onlyWarning(validateFiles({ 'c.md': `${head}attester: { resource: references/gone.py }\n---\n\nbody\n` })), /§6\.2/);
  assertClean(validateFiles({ 'c.md': `${head}attester: { resource: https://x/att.py }\n---\n\nbody\n` }));
  assertClean(validateFiles({ 'c.md': `${head}attester: { resource: references/att.py }\n---\n\nbody\n`, 'references/att.py': 'print(1)\n' }));
  const noRuntime = '---\ntype: Attested Computation\ntitle: t\ndescription: d\ntags: [x]\ngenerated: { by: human:t }\n---\n\nbody\n';
  assert.match(onlyWarning(validateFiles({ 'c.md': noRuntime })), /§10\.2/);
});

test('index: root keys okf_version, upkeep, recursive are clean; others and old versions warn; sub-index frontmatter warns', () => {
  const rootReport = validateFiles({ 'index.md': "---\nokf_version: '0.2'\n---\n# Index\n" });
  assert.deepEqual([rootReport.errors, rootReport.warnings, rootReport.indexes], [[], [], 1]);
  assertClean(validateFiles({ 'index.md': "---\nokf_version: '0.2'\nupkeep: enforced\nrecursive: true\n---\n# Index\n" }));
  assert.equal(validateFiles({ 'index.md': "---\nokf_version: '0.2'\ntype: X\n---\n" }).warnings[0], "index.md: §12 root index.md frontmatter may only carry `okf_version`, `upkeep`, `recursive` (found ['type'])");
  const oldVersion = validateFiles({ 'index.md': "---\nokf_version: '0.1'\n---\n# Index\n" });
  assert.deepEqual(oldVersion.errors, []);
  assert.match(oldVersion.warnings[0], /okf_version/);
  assert.match(validateFiles({ 'sub/index.md': "---\nokf_version: '0.2'\n---\n" }).warnings[0], /§8/);
  assert.deepEqual(validateFiles({ 'sub/index.md': '# Plain index\n' }).warnings, []);
});

test('log: ISO headings are clean, other headings and frontmatter warn', () => {
  const report = validateFiles({ 'log.md': '# Log\n\n## 2026-01-31\n* entry\n' });
  assert.deepEqual([report.errors, report.warnings, report.logs], [[], [], 1]);
  assert.match(validateFiles({ 'log.md': '## January 2026\n' }).warnings[0], /not ISO 8601/);
  assert.match(validateFiles({ 'log.md': '---\ntype: Log\n---\n## 2026-01-01\n' }).warnings[0], /§9/);
});

test('links: images and fenced code are skipped', () => {
  const bundleDirectory = createBundle({
    'a.md': 'See [a](a.md) and [b](b.md "title") but not ![img](pic.png).\n',
    'f.md': '[real](a.md)\n```\n[fake](in-fence.md)\n```\n~~~\n[fake2](tilde.md)\n~~~\n[also](b.md)\n',
  });
  assert.deepEqual(collectLinkTargets(join(bundleDirectory, 'a.md')), ['a.md', 'b.md']);
  assert.deepEqual(collectLinkTargets(join(bundleDirectory, 'f.md')), ['a.md', 'b.md']);
});

test('links: only missing bundle .md targets warn (absolute, anchors, external, dirs and assets do not)', () => {
  const report = validateFiles({
    'a.md': '[ok](sub/b.md) [ok abs](/sub/b.md) [anchor](sub/b.md#x) [ext](https://example.com/x.md) [mail](mailto:x@y.z) [dir](sub/) [asset](img.png) [missing](nope.md)',
    'sub/b.md': '[up ok](../a.md) [escape](../../etc/passwd.md)',
  });
  const linkWarnings = report.warnings.filter((warning) => warning.includes('cross-link'));
  assert.equal(linkWarnings.length, 2, linkWarnings.join('\n'));
  assert.ok(linkWarnings.some((warning) => warning.includes('nope.md')));
  assert.ok(linkWarnings.some((warning) => warning.includes('passwd.md')));
});

test('a whole bundle: counts and conformance', () => {
  const report = validateFiles({ 'index.md': "---\nokf_version: '0.2'\n---\n# Root\n\n* [c](c.md)\n", 'c.md': FULL_META, 'log.md': '## 2026-01-01\n* created\n' });
  assertClean(report);
  assert.deepEqual([report.concepts, report.indexes, report.logs], [1, 1, 1]);
});

test('YAML 1.1 like PyYAML: yes/no are booleans, a duplicate key keeps the last value', () => {
  assert.ok(validateFiles({ 'c.md': '---\ntype: yes\n---\nbody\n' }).errors.some((error) => error.includes('§11.2')));
  assert.match(onlyWarning(validateConcept('generated: { by: human:t }\nstatus: no\n')), /unknown `status` `False`/);
  assertClean(validateConcept('generated: { by: human:t }\nstatus: retired\nstatus: stable\n'));
});

const LEGACY_CONCEPT = '---\ntype: Service\ntitle: Auth API        # inline comment\ndescription: Issues JWTs.\ntags: [auth]\ntimestamp: "2026-01-01T00:00:00Z"\nresource: https://github.com/acme/auth\n---\n\n# Overview\n\nIssues tokens.\n\n# Citations\n\n[1] [Auth README](https://github.com/acme/auth#readme)\n\n# Endpoints\n\n`POST /token`\n';

function migrateLegacy(conceptText = LEGACY_CONCEPT) {
  const bundleDirectory = createBundle({ 'index.md': '---\nokf_version: "0.1"\n---\n# Root\n\n* [c](c.md)\n', 'c.md': conceptText });
  migrateOkfBundle(bundleDirectory);
  return { bundleDirectory, migratedText: readFileSync(join(bundleDirectory, 'c.md'), 'utf8') };
}

test('migrate: timestamp becomes generated without disturbing the rest; citations become sources', () => {
  const { migratedText } = migrateLegacy();
  assert.ok(migratedText.includes('generated:\n  by: process:okf-migrate\n  at: "2026-01-01T00:00:00Z"\n'));
  assert.ok(!migratedText.includes('timestamp:'));
  assert.ok(migratedText.includes('# inline comment'));
  assert.ok(migratedText.indexOf('title:') < migratedText.indexOf('generated:'));
  assert.ok(migratedText.indexOf('generated:') < migratedText.indexOf('resource:'));
  assert.ok(migratedText.includes('  - resource: "https://github.com/acme/auth#readme"\n    title: "Auth README"\n'));
  assert.ok(!migratedText.includes('# Citations'));
  assert.ok(migratedText.includes('# Endpoints'));
});

test('migrate: no citation is dropped when one carries a title', () => {
  const conceptText = FULL_META.replace('\nbody\n', '\nbody\n\n# Citations\n\n[1] [A](https://a.com)\n[2] [B](https://b.com "Titolo")\n[3] [C](https://c.com)\n').replace('generated: { by: human:tester, at: "2026-01-01T00:00:00Z" }\n', '');
  const { migratedText } = migrateLegacy(conceptText);
  for (const sourceUrl of ['https://a.com', 'https://b.com', 'https://c.com']) assert.ok(migratedText.includes(`resource: "${sourceUrl}"`), sourceUrl);
  assert.ok(!migratedText.includes('# Citations'));
});

test('migrate: plain-text citations are kept as sources, prose stays in the body', () => {
  const { migratedText: pathsText } = migrateLegacy(LEGACY_CONCEPT.replace('[1] [Auth README](https://github.com/acme/auth#readme)\n', '- [Auth README](https://github.com/acme/auth#readme)\n- `src/auth/token.py`, `src/auth/keys.py`.\n- `docs/AUTH.md` (spec,\n  not OKF).\n'));
  assert.ok(pathsText.includes('resource: "https://github.com/acme/auth#readme"'));
  assert.ok(pathsText.includes('  - resource: "src/auth/token.py"\n    title: "src/auth/token.py, src/auth/keys.py."\n'));
  assert.ok(pathsText.includes('  - resource: "docs/AUTH.md"\n    title: "docs/AUTH.md (spec, not OKF)."\n'));
  const { migratedText: proseText } = migrateLegacy(LEGACY_CONCEPT.replace('[1] [Auth README](https://github.com/acme/auth#readme)\n', '- `src/auth/token.py`.\n\nRelated: [billing](/billing.md), [users](/users.md).\n'));
  assert.ok(proseText.includes('resource: "src/auth/token.py"'));
  assert.ok(proseText.includes('# Related\n\nRelated: [billing](/billing.md), [users](/users.md).'));
  assert.ok(!proseText.includes('resource: "/billing.md"'));
  assert.ok(proseText.includes('# Endpoints'));
});

test('migrate: root index version bumped, result strict-clean, idempotent, v0.2 concepts left alone', () => {
  const { bundleDirectory, migratedText } = migrateLegacy();
  assert.ok(readFileSync(join(bundleDirectory, 'index.md'), 'utf8').includes('okf_version: "0.2"'));
  assert.deepEqual(validateOkfBundle(bundleDirectory).warnings, []);
  assert.deepEqual(migrateOkfBundle(bundleDirectory), []);
  assert.equal(readFileSync(join(bundleDirectory, 'c.md'), 'utf8'), migratedText);
  assert.deepEqual(migrateOkfBundle(createBundle({ 'c.md': FULL_META })), []);
});

test('ai1 okf validate: exit codes, --strict, --max-warnings, --json', () => {
  const printed = [];
  const capture = (line) => printed.push(line);
  const warningBundle = createBundle({ 'c.md': '---\ntype: A\n---\nbody\n' });
  assert.equal(runOkfValidateCommand([warningBundle], capture, capture), 0);
  assert.equal(runOkfValidateCommand([warningBundle, '--strict'], capture, capture), 1);
  assert.equal(runOkfValidateCommand([warningBundle, '--max-warnings', '4'], capture, capture), 0);
  assert.equal(runOkfValidateCommand([warningBundle, '--max-warnings', '3'], capture, capture), 1);
  assert.equal(runOkfValidateCommand([join(warningBundle, 'missing')], capture, capture), 2);
  printed.length = 0;
  assert.equal(runOkfValidateCommand([createBundle({ 'c.md': 'x\n' }), '--json'], capture, capture), 1);
  const jsonReport = JSON.parse(printed.join('\n'));
  assert.deepEqual([jsonReport.conformant, jsonReport.passed, jsonReport.counts.concepts, jsonReport.errors.length], [false, false, 1, 1]);
});
