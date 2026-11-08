import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { DESIGN_RULE_IDS, contrastRatio, parseCssColor, scanUiFile } from '../src/design/design-rules.mjs';
import { findEditedLineRanges } from '../src/design/design-detect.mjs';
import { createTemporaryProject } from './helpers.mjs';

// One file that must trigger the rule and one close variant that must not.
const RULE_SAMPLES = {
  'overused-font': {
    flagged: ['styles.css', 'body { font-family: "Inter", sans-serif; }'],
    clean: ['styles.css', 'body { font-family: "Söhne", "Helvetica Neue", sans-serif; }'],
  },
  'gradient-text': {
    flagged: ['page.tsx', '<h1 className="bg-gradient-to-r from-sky-500 to-teal-500 bg-clip-text text-transparent">Hi</h1>'],
    clean: ['page.tsx', '<h1 className="text-slate-900">Hi</h1>'],
  },
  'ai-color-palette': {
    flagged: ['styles.css', '.hero { background: linear-gradient(135deg, #7c3aed, #4f46e5); }'],
    clean: ['styles.css', '.hero { background: linear-gradient(135deg, #0f766e, #155e75); }'],
  },
  'side-tab': {
    flagged: ['card.tsx', '<div className="rounded-lg border-l-4 border-blue-500 p-4">x</div>'],
    clean: ['card.tsx', '<div className="rounded-lg border border-slate-200 p-4">x</div>'],
  },
  'dark-glow': {
    flagged: ['styles.css', '.button { box-shadow: 0 0 24px #a855f7; }'],
    clean: ['styles.css', '.button { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1); }'],
  },
  'bounce-easing': {
    flagged: ['styles.css', '.menu { transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1); }'],
    clean: ['styles.css', '.menu { transition: transform 300ms cubic-bezier(0.16, 1, 0.3, 1); }'],
  },
  'pulsing-dot': {
    flagged: ['status.tsx', '<span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />'],
    clean: ['status.tsx', '<div className="h-24 w-full rounded-md bg-slate-200 animate-pulse" />'],
  },
  marquee: {
    flagged: ['logos.tsx', '<div className="flex animate-marquee gap-8">{logos}</div>'],
    clean: ['logos.tsx', '<div className="flex flex-wrap gap-8">{logos}</div>'],
  },
  'kicker-above-heading': {
    flagged: ['hero.tsx', '<p className="text-xs uppercase tracking-widest text-slate-500">New</p>\n<h1 className="text-5xl">Ship faster</h1>'],
    clean: ['hero.tsx', '<p className="text-xs uppercase tracking-widest text-slate-500">Footer note</p>\n<p>More text</p>'],
  },
  'icon-tile-stack': {
    flagged: ['features.tsx', '<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100">\n  <Icon />\n</div>\n<h3>Fast</h3>'],
    clean: ['features.tsx', '<div className="flex items-center gap-3">\n  <Icon />\n  <h3>Fast</h3>\n</div>'],
  },
  'italic-serif-display': {
    flagged: ['hero.tsx', '<h1 className="font-serif italic text-7xl">A calmer inbox</h1>'],
    clean: ['hero.tsx', '<h1 className="font-serif text-7xl">A calmer inbox</h1>'],
  },
  'cream-palette': {
    flagged: ['styles.css', 'body {\n  background: #f5efe3;\n  color: #222;\n}'],
    clean: ['styles.css', 'body {\n  background: #ffffff;\n  color: #222;\n}'],
  },
  'marketing-buzzword': {
    flagged: ['hero.html', '<p>Streamline your workflow with our platform.</p>'],
    clean: ['hero.html', '<p>Send invoices in two clicks and get paid by card.</p>'],
  },
  'em-dash-overuse': {
    flagged: ['about.html', Array.from({ length: 8 }, (_, paragraphIndex) => `<p>Point ${paragraphIndex} — detail</p>`).join('\n')],
    clean: ['about.html', '<p>One point — with a detail.</p>\n<p>Another point.</p>'],
  },
  'theater-slop-phrase': {
    flagged: ['why.html', '<p>No more security theater.</p>'],
    clean: ['why.html', '<p>We encrypt every backup.</p>'],
  },
  'repeating-stripes-gradient': {
    flagged: ['styles.css', '.band { background: repeating-linear-gradient(45deg, #eee 0 10px, #fff 10px 20px); }'],
    clean: ['styles.css', '.band { background: #eee; }'],
  },
  'codex-grid-background': {
    flagged: ['styles.css', '.bg { background-image: linear-gradient(#e5e7eb 1px, transparent 1px); background-size: 24px 24px; }'],
    clean: ['styles.css', '.bg { background-image: linear-gradient(#e5e7eb, #ffffff); }'],
  },
  'hard-offset-shadow': {
    flagged: ['styles.css', '.card { box-shadow: 6px 6px 0 #000; }'],
    clean: ['styles.css', '.card { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); }'],
  },
  'organic-clip-path': {
    flagged: ['styles.css', '.blob { clip-path: path("M10 80 C 40 10, 65 10, 95 80 S 150 150, 180 80"); }'],
    clean: ['styles.css', '.tile { clip-path: polygon(0 0, 100% 0, 100% 100%, 0 100%); }'],
  },
  'extreme-negative-tracking': {
    flagged: ['styles.css', 'h1 { letter-spacing: -0.08em; }'],
    clean: ['styles.css', 'h1 { letter-spacing: -0.02em; }'],
  },
  'broken-image': {
    flagged: ['card.tsx', '<img src="https://via.placeholder.com/300" alt="" />'],
    clean: ['card.tsx', '<img src={product.photoUrl} alt={product.name} />'],
  },
  'skipped-heading': {
    flagged: ['page.html', '<h1>Title</h1>\n<h3>Section</h3>'],
    clean: ['page.html', '<h1>Title</h1>\n<h2>Section</h2>\n<h3>Sub</h3>\n<h2>Next</h2>'],
  },
  'gray-on-color': {
    flagged: ['banner.tsx', '<div className="bg-blue-600 text-gray-400 p-4">Note</div>'],
    clean: ['banner.tsx', '<div className="bg-blue-600 text-white p-4">Note</div>'],
  },
  'low-contrast': {
    flagged: ['styles.css', '.note {\n  color: #9ca3af;\n  background-color: #ffffff;\n}'],
    clean: ['styles.css', '.note {\n  color: #374151;\n  background-color: #ffffff;\n}'],
  },
  'tiny-text': {
    flagged: ['styles.css', '.legal { font-size: 9px; }'],
    clean: ['styles.css', '.legal { font-size: 12px; }'],
  },
  'justified-text': {
    flagged: ['styles.css', 'p { text-align: justify; }'],
    clean: ['styles.css', 'p { text-align: left; }'],
  },
};

const ruleIdsFound = (fileName, fileText) => scanUiFile(fileName, fileText).map((designFinding) => designFinding.ruleId);

test('design rules: every rule has a flagged and a clean sample', () => {
  assert.deepEqual(Object.keys(RULE_SAMPLES).sort(), [...DESIGN_RULE_IDS].sort());
});

for (const [ruleId, { flagged, clean }] of Object.entries(RULE_SAMPLES)) {
  test(`design rule ${ruleId}: flags the sample and leaves the clean variant alone`, () => {
    assert.ok(ruleIdsFound(...flagged).includes(ruleId), `${ruleId} should flag: ${flagged[1]}`);
    assert.ok(!ruleIdsFound(...clean).includes(ruleId), `${ruleId} should not flag: ${clean[1]}`);
  });
}

test('design rules: non-UI files and ignored rules are skipped', () => {
  assert.deepEqual(scanUiFile('server.py', 'font-family: Inter'), []);
  assert.deepEqual(scanUiFile('styles.css', 'body { font-family: Inter; }', ['overused-font']), []);
});

test('design rules: colour arithmetic', () => {
  assert.deepEqual(parseCssColor('#fff'), { red: 255, green: 255, blue: 255, alpha: 1 });
  assert.equal(parseCssColor('rgba(0, 0, 0, 0.5)').alpha, 0.5);
  assert.equal(Math.round(contrastRatio(parseCssColor('#000'), parseCssColor('#fff'))), 21);
});

test('findEditedLineRanges: Write is the whole file, Edit and MultiEdit the written fragments', () => {
  const fileText = 'one\ntwo\nthree\nfour';
  assert.equal(findEditedLineRanges({ tool_name: 'Write', tool_input: {} }, fileText), null);
  assert.deepEqual(findEditedLineRanges({ tool_name: 'Edit', tool_input: { new_string: 'two\nthree' } }, fileText), [[2, 3]]);
  assert.deepEqual(findEditedLineRanges({ tool_name: 'MultiEdit', tool_input: { edits: [{ new_string: 'one' }, { new_string: 'four' }] } }, fileText), [[1, 1], [4, 4]]);
});

function hookOptions(homeDirectory = mkdtempSync(join(tmpdir(), 'jig-home-'))) {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'jig-data-')) },
    homeDirectory,
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function editPayload(projectRoot, relativePath, newString) {
  return {
    session_id: 'session-1',
    cwd: projectRoot,
    tool_name: 'Edit',
    tool_input: { file_path: join(projectRoot, relativePath), old_string: 'x', new_string: newString },
  };
}

const postToolUseContext = (hookOutput) => hookOutput?.hookSpecificOutput?.additionalContext || '';

test('design-detect: reports what the edit wrote, once per session, as PostToolUse context', () => {
  const projectRoot = createTemporaryProject({ features: { okf: false, design: true } });
  writeFileSync(join(projectRoot, 'styles.css'), 'body { font-family: Inter; }\n.title { font-size: 9px; }\n');
  const options = hookOptions();
  const firstOutput = runHookEvent('PostToolUse', editPayload(projectRoot, 'styles.css', '.title { font-size: 9px; }'), options);
  assert.equal(firstOutput.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(postToolUseContext(firstOutput), /\[tiny-text\] L2/);
  assert.doesNotMatch(postToolUseContext(firstOutput), /overused-font/, 'line 1 was not written by this edit');
  assert.equal(runHookEvent('PostToolUse', editPayload(projectRoot, 'styles.css', '.title { font-size: 9px; }'), options), null, 'already reported');
});

test('design-detect: off by default, silent on non-UI files, honours ignore_rules', () => {
  const defaultProject = createTemporaryProject({ features: { okf: false } });
  writeFileSync(join(defaultProject, 'styles.css'), '.title { font-size: 9px; }\n');
  assert.equal(runHookEvent('PostToolUse', editPayload(defaultProject, 'styles.css', '.title { font-size: 9px; }'), hookOptions()), null);

  const designProject = createTemporaryProject({ features: { okf: false, design: true }, modules: { 'design-detect': { ignore_rules: ['tiny-text'] } } });
  writeFileSync(join(designProject, 'notes.md'), 'font-size: 9px\n');
  writeFileSync(join(designProject, 'styles.css'), '.title { font-size: 9px; }\n');
  assert.equal(runHookEvent('PostToolUse', editPayload(designProject, 'notes.md', 'font-size: 9px'), hookOptions()), null);
  assert.equal(runHookEvent('PostToolUse', editPayload(designProject, 'styles.css', '.title { font-size: 9px; }'), hookOptions()), null);

  const outsideDirectory = mkdtempSync(join(tmpdir(), 'jig-outside-'));
  writeFileSync(join(outsideDirectory, 'styles.css'), '.title { font-size: 9px; }\n');
  const outsidePayload = { ...editPayload(designProject, 'x', '.title { font-size: 9px; }'), tool_input: { file_path: join(outsideDirectory, 'styles.css'), new_string: '.title { font-size: 9px; }' } };
  assert.equal(runHookEvent('PostToolUse', outsidePayload, hookOptions()), null, 'files outside the project are not checked');
});

function startSessionContext(projectRoot, options = hookOptions(), source = 'startup') {
  return runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, options)?.hookSpecificOutput?.additionalContext || '';
}

test('design-brief: points to the bundle concepts of type Product and DesignSystem, and to Impeccable files', () => {
  const projectRoot = createTemporaryProject({ features: { okf: true, design: true } });
  mkdirSync(join(projectRoot, '.okf', 'design'), { recursive: true });
  writeFileSync(join(projectRoot, '.okf', 'index.md'), '---\nokf_version: "0.2"\n---\n# Index\n');
  writeFileSync(join(projectRoot, '.okf', 'design', 'system.md'), '---\ntype: DesignSystem\ntitle: Design system\n---\nPalette.\n');
  writeFileSync(join(projectRoot, '.okf', 'design', 'api.md'), '---\ntype: Service\ntitle: API\n---\nNot design.\n');
  writeFileSync(join(projectRoot, 'PRODUCT.md'), '# Product\n');
  const contextText = startSessionContext(projectRoot);
  assert.match(contextText, /Design: UI in this repo/);
  assert.match(contextText, /`\.okf\/design\/system\.md`, `PRODUCT\.md`/);
  assert.doesNotMatch(contextText, /api\.md/);
});

test('design-brief: asks for the context when there is none, and mentions Impeccable only when installed', () => {
  const projectRoot = createTemporaryProject({ features: { okf: true, design: true } });
  const contextText = startSessionContext(projectRoot);
  assert.match(contextText, /no product or design-system context yet.*type `Product` and `DesignSystem`/);
  assert.doesNotMatch(contextText, /\/impeccable critique/);

  const homeDirectory = mkdtempSync(join(tmpdir(), 'jig-home-'));
  mkdirSync(join(homeDirectory, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': [] } }));
  assert.match(startSessionContext(projectRoot, hookOptions(homeDirectory)), /\/impeccable critique/);
});

test('design-brief: off by default and silent on resume', () => {
  assert.doesNotMatch(startSessionContext(createTemporaryProject({ features: { okf: false } })), /Design: UI/);
  assert.doesNotMatch(startSessionContext(createTemporaryProject({ features: { okf: false, design: true } }), hookOptions(), 'resume'), /Design: UI/);
});
