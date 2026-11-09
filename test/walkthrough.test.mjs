import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCapture, readStoryboard, resolveStoryboardSlug, stepIdFromCaption, storyboardDirectory } from '../src/walkthrough/walkthrough-storyboard.mjs';
import { buildStoryboard, renderStoryboardSummary } from '../src/walkthrough/walkthrough-build.mjs';
import { createTemporaryProject } from './helpers.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
// A 1x1 transparent PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createUiRepo() {
  const projectRoot = createTemporaryProject({ features: { walkthrough: true } });
  writeFileSync(join(projectRoot, 'app.css'), 'body{}\n');
  runGit(projectRoot, ['init', '-q', '-b', 'main']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return projectRoot;
}

function writeScreenshot(projectRoot, fileName) {
  const screenshotPath = join(projectRoot, fileName);
  writeFileSync(screenshotPath, TINY_PNG);
  return screenshotPath;
}

function runAi1(workingDirectory, cliArguments) {
  return spawnSync(process.execPath, [AI1_CLI, ...cliArguments], { cwd: workingDirectory, encoding: 'utf8' });
}

test('step ids come from the caption, without accents or punctuation', () => {
  assert.equal(stepIdFromCaption('Pulsa «Reservar» y se abre el calendario'), 'pulsa-reservar-y-se-abre-el-calendario');
  assert.equal(stepIdFromCaption('!!!'), '');
});

test('the slug is --slug, else the worktree (a -before worktree feeds its pair), else the only open plan', () => {
  const projectRoot = createUiRepo();
  assert.equal(resolveStoryboardSlug({ treeRoot: projectRoot, mainRoot: projectRoot, requestedSlug: 'given' }), 'given');
  assert.throws(() => resolveStoryboardSlug({ treeRoot: projectRoot, mainRoot: projectRoot }), /--slug/);
  const beforeWorktree = join(projectRoot, '.claude', 'worktrees', 'booking-before');
  runGit(projectRoot, ['worktree', 'add', '-q', beforeWorktree, '-b', 'wt/booking-before']);
  assert.equal(resolveStoryboardSlug({ treeRoot: beforeWorktree, mainRoot: projectRoot }), 'booking');
  mkdirSync(join(projectRoot, '.ai1', 'work', 'one-plan'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'one-plan', 'plan.md'), '---\ntitle: x\nstatus: approved\n---\n');
  assert.equal(resolveStoryboardSlug({ treeRoot: projectRoot, mainRoot: projectRoot }), 'one-plan');
});

test('add then build writes one self-contained HTML with numbered steps, desktop and mobile [walkthrough:S1]', () => {
  const projectRoot = createUiRepo();
  const desktopShot = writeScreenshot(projectRoot, 'desktop.png');
  const mobileShot = writeScreenshot(projectRoot, 'mobile.png');
  const firstAdd = runAi1(projectRoot, ['walkthrough', 'add', '--slug', 'booking', '--title', 'Booking flow', '--step', 'Opens the calendar', '--image', desktopShot]);
  assert.equal(firstAdd.status, 0, firstAdd.stderr);
  assert.match(firstAdd.stdout, /step 1 "Opens the calendar"/);
  runAi1(projectRoot, ['walkthrough', 'add', '--slug', 'booking', '--step', 'Opens the calendar', '--viewport', 'mobile', '--image', mobileShot]);
  runAi1(projectRoot, ['walkthrough', 'add', '--slug', 'booking', '--step', 'Picks a <day>', '--detail', 'Free days in green', '--image', desktopShot]);

  const storyboardPath = storyboardDirectory(projectRoot, 'booking');
  const storyboard = readStoryboard(storyboardPath);
  assert.deepEqual(storyboard.steps.map((storyboardStep) => storyboardStep.id), ['opens-the-calendar', 'picks-a-day']);
  assert.equal(storyboard.steps[0].captures.length, 2);

  const buildRun = runAi1(projectRoot, ['walkthrough', 'build', '--slug', 'booking']);
  assert.equal(buildRun.status, 0, buildRun.stderr);
  const storyboardHtml = readFileSync(join(storyboardPath, 'index.html'), 'utf8');
  assert.match(storyboardHtml, /<title>Booking flow - walkthrough<\/title>/);
  assert.match(storyboardHtml, /id="step-1"[\s\S]*Opens the calendar[\s\S]*id="step-2"/);
  assert.match(storyboardHtml, /row-desktop[\s\S]*row-mobile/);
  assert.match(storyboardHtml, /Picks a &lt;day&gt;/, 'captions are escaped');
  assert.match(storyboardHtml, /src="data:image\/png;base64,/, 'images are inlined');
  assert.doesNotMatch(storyboardHtml, /src="(?:https?:|images\/)/, 'no external or relative image');
  assert.match(storyboardHtml, /ArrowRight/, 'slides move with the arrow keys');
  assert.match(storyboardHtml, /@media print[\s\S]*break-after:page/, 'one step per printed page');
  assert.match(readFileSync(join(storyboardPath, 'SUMMARY.md'), 'utf8'), /## 2\. Picks a <day>\n\nFree days in green\n\n!\[after desktop\]\(images\/picks-a-day-after-desktop\.png\)/);
});

test('the same step, variant and viewport again replaces the image', () => {
  const projectRoot = createUiRepo();
  const storyboardPath = storyboardDirectory(projectRoot, 'flow');
  const screenshotPath = writeScreenshot(projectRoot, 'shot.png');
  addCapture(storyboardPath, 'flow', { caption: 'Home', imageFile: screenshotPath });
  const { storyboard } = addCapture(storyboardPath, 'flow', { caption: 'Home', imageFile: screenshotPath });
  assert.equal(storyboard.steps.length, 1);
  assert.equal(storyboard.steps[0].captures.length, 1);
  assert.throws(() => addCapture(storyboardPath, 'flow', { caption: 'Home', imageFile: screenshotPath, viewport: 'tablet' }), /--viewport/);
  assert.throws(() => addCapture(storyboardPath, 'flow', { caption: 'Home', imageFile: join(projectRoot, 'missing.png') }), /--image/);
});

test('before and after side by side; steps only after are new, only before removed [walkthrough:S2]', () => {
  const projectRoot = createUiRepo();
  const storyboardPath = storyboardDirectory(projectRoot, 'checkout');
  const screenshotPath = writeScreenshot(projectRoot, 'shot.png');
  addCapture(storyboardPath, 'checkout', { caption: 'Cart', stepId: 'cart', imageFile: screenshotPath, variant: 'before', base: 'main' });
  addCapture(storyboardPath, 'checkout', { caption: 'Cart with totals', stepId: 'cart', imageFile: screenshotPath });
  addCapture(storyboardPath, 'checkout', { caption: 'Old coupon page', imageFile: screenshotPath, variant: 'before' });
  addCapture(storyboardPath, 'checkout', { caption: 'Pay in one click', imageFile: screenshotPath });

  buildStoryboard(storyboardPath);
  const storyboardHtml = readFileSync(join(storyboardPath, 'index.html'), 'utf8');
  const cartSection = /<section class="step" id="step-1">[\s\S]*?<\/section>/.exec(storyboardHtml)[0];
  assert.match(cartSection, /Cart with totals/, 'the after caption wins');
  assert.match(cartSection, /cols-2[\s\S]*before · desktop[\s\S]*after · desktop/);
  assert.match(storyboardHtml, /step-removed" id="step-2"[\s\S]*Removed step/);
  assert.match(storyboardHtml, /step-new" id="step-3"[\s\S]*New step/);
  assert.match(storyboardHtml, /before\/after vs main/);
  assert.match(renderStoryboardSummary(readStoryboard(storyboardPath)), /## 3\. Pay in one click \(new step\)/);
});

test('build without steps says how to add them', () => {
  const projectRoot = createUiRepo();
  const buildRun = runAi1(projectRoot, ['walkthrough', 'build', '--slug', 'empty']);
  assert.equal(buildRun.status, 1);
  assert.match(buildRun.stderr, /ai1 walkthrough add/);
  assert.equal(existsSync(join(storyboardDirectory(projectRoot, 'empty'), 'index.html')), false);
});
