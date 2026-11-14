import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCapture, readStoryboard, resolveStoryboardSlug, stepIdFromCaption, storyboardDirectory } from '../src/storyboard/storyboard-steps.mjs';
import { buildStoryboard, renderStoryboardSummary } from '../src/storyboard/storyboard-build.mjs';
import { findChromeBinaries, printStoryboardPdf } from '../src/storyboard/storyboard-pdf.mjs';
import { stopStoryboardServer } from '../src/storyboard/storyboard-serve.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject } from './helpers.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
// A 1x1 transparent PNG.
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createUiRepo() {
  const projectRoot = createTemporaryProject({ features: { storyboard: true } });
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
  const firstAdd = runAi1(projectRoot, ['storyboard', 'add', '--slug', 'booking', '--title', 'Booking flow', '--step', 'Opens the calendar', '--image', desktopShot]);
  assert.equal(firstAdd.status, 0, firstAdd.stderr);
  assert.match(firstAdd.stdout, /step 1 "Opens the calendar"/);
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'booking', '--step', 'Opens the calendar', '--viewport', 'mobile', '--image', mobileShot]);
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'booking', '--step', 'Picks a <day>', '--detail', 'Free days in green', '--image', desktopShot]);

  const storyboardPath = storyboardDirectory(projectRoot, 'booking');
  // [rename-walkthrough-to-storyboard:S1] `ai1 storyboard` writes to .ai1/storyboards/<slug>/
  assert.equal(storyboardPath, join(projectRoot, '.ai1', 'storyboards', 'booking'));
  const storyboard = readStoryboard(storyboardPath);
  assert.deepEqual(storyboard.steps.map((storyboardStep) => storyboardStep.id), ['opens-the-calendar', 'picks-a-day']);
  assert.equal(storyboard.steps[0].captures.length, 2);

  const buildRun = runAi1(projectRoot, ['storyboard', 'build', '--slug', 'booking']);
  assert.equal(buildRun.status, 0, buildRun.stderr);
  const storyboardHtml = readFileSync(join(storyboardPath, 'index.html'), 'utf8');
  assert.match(storyboardHtml, /<title>Booking flow - storyboard<\/title>/);
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
  assert.match(cartSection, /<h2>Cart with totals<\/h2><p class="before-caption">Before: Cart<\/p>/, 'the after caption leads, the base wording stays');
  assert.match(storyboardHtml, /zoom-in/, 'a screenshot opens full size');
  assert.match(cartSection, /cols-2[\s\S]*before · desktop[\s\S]*after · desktop/);
  assert.match(storyboardHtml, /step-removed" id="step-2"[\s\S]*Removed step/);
  assert.match(storyboardHtml, /step-new" id="step-3"[\s\S]*New step/);
  assert.match(storyboardHtml, /before\/after vs main/);
  assert.match(renderStoryboardSummary(readStoryboard(storyboardPath)), /## 3\. Pay in one click \(new step\)/);
});

test('build without steps says how to add them', () => {
  const projectRoot = createUiRepo();
  const buildRun = runAi1(projectRoot, ['storyboard', 'build', '--slug', 'empty']);
  assert.equal(buildRun.status, 1);
  assert.match(buildRun.stderr, /ai1 storyboard add/);
  assert.equal(existsSync(join(storyboardDirectory(projectRoot, 'empty'), 'index.html')), false);
});

test('build --pdf finds Chrome in Playwright\'s cache, prints one PDF, and fails open without one [walkthrough:S6]', () => {
  const projectRoot = createUiRepo();
  const fakeCache = join(projectRoot, 'ms-playwright');
  mkdirSync(join(fakeCache, 'chromium-1200', 'chrome-linux64'), { recursive: true });
  mkdirSync(join(fakeCache, 'chromium-999', 'chrome-linux'), { recursive: true });
  writeFileSync(join(fakeCache, 'chromium-1200', 'chrome-linux64', 'chrome'), '');
  writeFileSync(join(fakeCache, 'chromium-999', 'chrome-linux', 'chrome'), '');
  if (process.platform === 'linux') {
    assert.deepEqual(findChromeBinaries({ PATH: '', PLAYWRIGHT_BROWSERS_PATH: fakeCache }), [
      join(fakeCache, 'chromium-1200', 'chrome-linux64', 'chrome'), join(fakeCache, 'chromium-999', 'chrome-linux', 'chrome'),
    ], 'newest build first');
  }
  assert.deepEqual(findChromeBinaries({ PATH: '', PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, 'none') }), []);

  const storyboardPath = storyboardDirectory(projectRoot, 'pdf');
  addCapture(storyboardPath, 'pdf', { caption: 'Home', imageFile: writeScreenshot(projectRoot, 'shot.png') });
  const { htmlPath } = buildStoryboard(storyboardPath);
  assert.match(printStoryboardPdf(storyboardPath, htmlPath, { chromeBinaries: [] }).error, /no Chrome or Chromium/);
  assert.match(printStoryboardPdf(storyboardPath, htmlPath, { chromeBinaries: [join(projectRoot, 'not-a-browser')] }).error, /could not print/);

  const failOpenRun = spawnSync(process.execPath, [AI1_CLI, 'storyboard', 'build', '--slug', 'pdf', '--pdf'], {
    cwd: projectRoot, encoding: 'utf8', env: { ...process.env, PATH: '', PLAYWRIGHT_BROWSERS_PATH: join(projectRoot, 'none') },
  });
  assert.equal(failOpenRun.status, 0, 'a missing browser never fails the build');
  assert.match(failOpenRun.stdout, /pdf not written: no Chrome[\s\S]*with your browser tool/);

  const realChromes = findChromeBinaries();
  if (realChromes.length) {
    const printResult = printStoryboardPdf(storyboardPath, htmlPath, { chromeBinaries: [join(projectRoot, 'not-a-browser'), ...realChromes] });
    if (printResult.pdfPath) assert.equal(readFileSync(printResult.pdfPath).subarray(0, 5).toString(), '%PDF-', 'a failing browser falls through to the next one');
  }
});

async function fetchStatus(serverUrl) {
  try {
    return (await fetch(serverUrl)).status;
  } catch {
    return 'down';
  }
}

test('serve gives a local URL; stop, worktree finish and drop release it; the storyboard stays [walkthrough:S3]', async (testContext) => {
  const projectRoot = createUiRepo();
  testContext.after(() => ['flow', 'other'].forEach((slug) => stopStoryboardServer(projectRoot, slug)));
  mkdirSync(join(projectRoot, '.claude', 'skills', 'worktree'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'skills', 'worktree', 'recipe.json'), '{"version":1}\n');
  writeFileSync(join(projectRoot, '.gitignore'), '.claude/worktrees/\n*.png\n');
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'recipe']);
  const createRun = runAi1(projectRoot, ['worktree', 'create', 'flow']);
  assert.equal(createRun.status, 0, createRun.stderr);
  const worktreePath = join(projectRoot, '.claude', 'worktrees', 'flow');

  assert.match(runAi1(worktreePath, ['storyboard', 'serve']).stderr, /storyboard build/, 'nothing to serve before a build');
  runAi1(worktreePath, ['storyboard', 'add', '--step', 'Home', '--image', writeScreenshot(projectRoot, 'shot.png')]);
  runAi1(worktreePath, ['storyboard', 'build']);
  const serveRun = runAi1(worktreePath, ['storyboard', 'serve']);
  assert.equal(serveRun.status, 0, serveRun.stderr);
  const serverUrl = /at (http:\/\/127\.0\.0\.1:\d+\/)/.exec(serveRun.stdout)[1];
  assert.equal(await fetchStatus(serverUrl), 200);
  assert.equal(await fetchStatus(`${serverUrl}server.json`), 404, 'the server record is not served');
  assert.equal(await fetchStatus(`${serverUrl}..%2F..%2Fplan.md`), 404, 'nothing outside the storyboard');
  assert.match(runAi1(worktreePath, ['storyboard', 'serve']).stdout, /already serving flow/);
  assert.match(runAi1(projectRoot, ['storyboard', 'list']).stdout, /flow: 1 steps, built, at http/);

  assert.match(runAi1(worktreePath, ['storyboard', 'stop']).stdout, /stopped http/);
  assert.equal(await fetchStatus(serverUrl), 'down');

  runAi1(worktreePath, ['storyboard', 'serve']);
  writeFileSync(join(worktreePath, 'app.css'), 'body{color:red}\n');
  runGit(worktreePath, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'red']);
  const finishRun = runAi1(projectRoot, ['worktree', 'finish', 'flow']);
  assert.equal(finishRun.status, 0, finishRun.stderr);
  assert.match(finishRun.stdout, /storyboard server stopped .*1 residual screenshot\(s\) deleted; the storyboard stays/);
  assert.equal(existsSync(join(projectRoot, 'shot.png')), false, 'the screenshot the agent left in the repo is gone');
  assert.match(runAi1(projectRoot, ['storyboard', 'list']).stdout, /^flow: 1 steps, built\n?$/m, 'archived, no URL');
  assert.ok(existsSync(join(storyboardDirectory(projectRoot, 'flow'), 'index.html')));

  runAi1(projectRoot, ['worktree', 'create', 'other']);
  const otherPath = join(projectRoot, '.claude', 'worktrees', 'other');
  runAi1(otherPath, ['storyboard', 'add', '--step', 'Home', '--image', writeScreenshot(projectRoot, 'other.png')]);
  runAi1(otherPath, ['storyboard', 'build']);
  const otherUrl = /at (http:\S+)/.exec(runAi1(otherPath, ['storyboard', 'serve']).stdout)[1];
  const dropRun = runAi1(projectRoot, ['worktree', 'drop', 'other', '--confirm']);
  assert.match(dropRun.stdout, /storyboard server stopped/);
  assert.equal(await fetchStatus(otherUrl), 'down');
});

test('closing deletes the residual screenshots add copied from, only unchanged untracked images [walkthrough:S10]', () => {
  const projectRoot = createUiRepo();
  const storyboardPath = storyboardDirectory(projectRoot, 'close');
  mkdirSync(join(projectRoot, '.playwright-mcp'), { recursive: true });
  const residualShot = writeScreenshot(projectRoot, join('.playwright-mcp', 'page-1.png'));
  const changedShot = writeScreenshot(projectRoot, 'changed.png');
  const trackedShot = writeScreenshot(projectRoot, 'docs-shot.png');
  runGit(projectRoot, ['add', 'docs-shot.png']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'tracked image']);
  addCapture(storyboardPath, 'close', { caption: 'Home', imageFile: residualShot });
  addCapture(storyboardPath, 'close', { caption: 'Menu', imageFile: changedShot });
  addCapture(storyboardPath, 'close', { caption: 'Docs', imageFile: trackedShot });
  writeFileSync(changedShot, Buffer.concat([TINY_PNG, Buffer.from('more')]));

  const cleanRun = runAi1(projectRoot, ['storyboard', 'clean', '--slug', 'close']);
  assert.equal(cleanRun.status, 0, cleanRun.stderr);
  assert.match(cleanRun.stdout, /deleted 1 residual screenshot/);
  assert.match(cleanRun.stdout, /kept .*changed\.png \(changed since it was added\)/);
  assert.match(cleanRun.stdout, /kept .*docs-shot\.png \(tracked by git\)/);
  assert.equal(existsSync(residualShot), false);
  assert.ok(existsSync(changedShot) && existsSync(trackedShot));
  assert.ok(existsSync(join(storyboardPath, 'images', 'home-after-desktop.png')), 'the storyboard keeps its copy');
  assert.equal(readStoryboard(storyboardPath).steps[0].captures[0].source, undefined, 'a deleted source is forgotten');
  assert.match(runAi1(projectRoot, ['storyboard', 'clean', '--slug', 'close']).stdout, /deleted 0/);
});

test('storyboards live in .ai1/storyboards/<slug>/, ignored by git, and work through a symlinked folder [walkthrough:S7]', async (testContext) => {
  const projectRoot = createUiRepo();
  testContext.after(() => stopStoryboardServer(projectRoot, 'linked'));
  const screenshotPath = writeScreenshot(projectRoot, join('.ai1', 'shot.png'));
  writeFileSync(join(projectRoot, '.ai1', '.gitignore'), 'shot.png\n');
  runGit(projectRoot, ['add', '.ai1/.gitignore']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'ignore test shot']);
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'local', '--step', 'Home', '--image', screenshotPath]);
  assert.equal(storyboardDirectory(projectRoot, 'local'), join(projectRoot, '.ai1', 'storyboards', 'local'));
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'storyboards', '.gitignore'), 'utf8'), '*\n');
  assert.equal(execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' }), '', 'nothing of it reaches git');

  // The person's own tooling moves the folder to a synced one and leaves a symlink.
  const syncedFolder = join(projectRoot, '..', `${projectRoot.split('/').pop()}-synced`);
  execFileSync('mv', [join(projectRoot, '.ai1', 'storyboards'), syncedFolder]);
  symlinkSync(syncedFolder, join(projectRoot, '.ai1', 'storyboards'));
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'linked', '--step', 'Home', '--image', writeScreenshot(projectRoot, join('.ai1', 'shot.png'))]);
  assert.equal(runAi1(projectRoot, ['storyboard', 'build', '--slug', 'linked']).status, 0);
  assert.ok(existsSync(join(syncedFolder, 'linked', 'index.html')), 'written into the linked folder');
  const serverUrl = /at (http:\S+)/.exec(runAi1(projectRoot, ['storyboard', 'serve', '--slug', 'linked']).stdout)[1];
  assert.equal(await fetchStatus(serverUrl), 200);
  assert.match(runAi1(projectRoot, ['storyboard', 'list']).stdout, /linked: 1 steps, built, at http[\s\S]*local: 1 steps/);
  assert.match(runAi1(projectRoot, ['storyboard', 'clean', '--slug', 'linked']).stdout, /deleted 1/);
});

test('publish destinations come from the customization, offered and published only after a yes [walkthrough:S4]', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/storyboard-record-flow/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skillText, /## 5\. Publish \(only if a customization asks for it\)[\s\S]*publish only after the person says yes[\s\S]*With no customization, there is nothing to publish/);
  assert.match(skillText, /## Fixed rules\n\n- Never publish anywhere outside the repo without the person's yes/);

  const projectRoot = createUiRepo();
  const homeDirectory = join(projectRoot, 'home');
  mkdirSync(join(homeDirectory, '.config', 'ai1', 'skills', 'storyboard'), { recursive: true });
  writeFileSync(join(homeDirectory, '.config', 'ai1', 'skills', 'storyboard', 'overlay.md'), '- Publish: hand steps.json to my task tracker skill.\n');
  const withOverlay = spawnSync(process.execPath, [AI1_CLI, 'skill-context', 'storyboard-record-flow'], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, HOME: homeDirectory, XDG_CONFIG_HOME: '' } });
  assert.match(withOverlay.stdout, /hand steps\.json to my task tracker skill/);
  const withoutOverlay = spawnSync(process.execPath, [AI1_CLI, 'skill-context', 'storyboard-record-flow'], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, HOME: join(projectRoot, 'nobody'), XDG_CONFIG_HOME: '' } });
  assert.match(withoutOverlay.stdout, /None yet for this project \(\.ai1\/skills\/storyboard\/overlay\.md\)/);
});

// [rename-walkthrough-to-storyboard:S1] the Stop reminder comes from storyboard-reminder and names /ai1:storyboard-record-flow
test('storyboard-reminder: UI changed and no storyboard after it reminds once; a build or an ignore glob silences it [walkthrough:S5]', () => {
  const projectRoot = createUiRepo();
  const hookOptions = {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  const stopSession = () => runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot }, hookOptions);
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, hookOptions);
  assert.equal(stopSession(), null, 'nothing changed');
  writeFileSync(join(projectRoot, 'README.md'), 'docs only\n');
  assert.equal(stopSession(), null, 'not a UI file');

  writeFileSync(join(projectRoot, 'app.css'), 'body{color:#222}\n');
  const stopOutput = stopSession();
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /ai1\/storyboard-reminder: Storyboard: this session changed UI files \(`app\.css`\)[\s\S]*\/ai1:storyboard-record-flow[\s\S]*why not/);
  assert.equal(stopSession(), null, 'the same files are reminded once');

  writeFileSync(join(projectRoot, 'Button.tsx'), 'export const Button = () => null;\n');
  assert.equal(stopSession().decision, 'block', 'new UI files remind again');
  const storyboardPath = storyboardDirectory(projectRoot, 'ui');
  addCapture(storyboardPath, 'ui', { caption: 'Home', imageFile: writeScreenshot(projectRoot, 'shot.png') });
  buildStoryboard(storyboardPath);
  writeFileSync(join(projectRoot, 'Card.tsx'), 'export const Card = () => null;\n');
  const futureMilliseconds = Date.now() / 1000 + 5;
  utimesSync(join(storyboardPath, 'index.html'), futureMilliseconds, futureMilliseconds);
  assert.equal(stopSession(), null, 'a storyboard built after the changes');

  const ignoringRoot = createTemporaryProject({ features: { storyboard: true }, modules: { 'storyboard-reminder': { ignore: ['emails/**'] } } });
  runGit(ignoringRoot, ['init', '-q', '-b', 'main']);
  writeFileSync(join(ignoringRoot, 'seed.txt'), 'x\n');
  runGit(ignoringRoot, ['add', '.']);
  runGit(ignoringRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  runHookEvent('SessionStart', { session_id: 'session-2', cwd: ignoringRoot, source: 'startup' }, hookOptions);
  mkdirSync(join(ignoringRoot, 'emails'));
  writeFileSync(join(ignoringRoot, 'emails', 'welcome.html'), '<p>hi</p>\n');
  assert.equal(runHookEvent('Stop', { session_id: 'session-2', cwd: ignoringRoot }, hookOptions), null, 'ignored by the repo');
});

test('usability findings go on their step and show in the HTML, the print view and SUMMARY.md [usability-review:S3]', () => {
  const projectRoot = createUiRepo();
  const screenshotPath = writeScreenshot(projectRoot, 'shot.png');
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'booking', '--step', 'Opens the calendar', '--image', screenshotPath]);
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'booking', '--step', 'Picks a day', '--image', screenshotPath]);

  const noteRun = runAi1(projectRoot, ['storyboard', 'note', '--slug', 'booking', '--step', 'picks-a-day', '--severity', 'P1',
    '--text', 'Does not see that grey days are full', '--profile', 'Patient', '--viewport', 'mobile', '--fix', 'Write "Full" on full days']);
  assert.equal(noteRun.status, 0, noteRun.stderr);
  assert.match(noteRun.stdout, /note n1 \(P1\) on step 2 "Picks a day"/);
  runAi1(projectRoot, ['storyboard', 'note', '--slug', 'booking', '--step', 'opens-the-calendar', '--severity', 'P3', '--text', 'The <title> is long']);

  const storyboardPath = storyboardDirectory(projectRoot, 'booking');
  const storyboard = readStoryboard(storyboardPath);
  assert.equal(storyboard.version, 1, 'notes are additive: the version stays');
  assert.deepEqual(storyboard.steps[1].notes, [{ id: 'n1', severity: 'P1', text: 'Does not see that grey days are full', profile: 'Patient', fix: 'Write "Full" on full days', viewport: 'mobile' }]);

  runAi1(projectRoot, ['storyboard', 'build', '--slug', 'booking']);
  const storyboardHtml = readFileSync(join(storyboardPath, 'index.html'), 'utf8');
  assert.match(storyboardHtml, /id="step-2"[\s\S]*class="note note-p1"[\s\S]*Patient · mobile[\s\S]*grey days are full[\s\S]*Fix: Write &quot;Full&quot;/);
  assert.match(storyboardHtml, /The &lt;title&gt; is long/, 'notes are escaped');
  assert.match(storyboardHtml, /findings are synthetic/);
  assert.doesNotMatch(storyboardHtml, /@media print[^}]*\.notes\{display:none/, 'notes are printed too');
  const summaryText = readFileSync(join(storyboardPath, 'SUMMARY.md'), 'utf8');
  assert.match(summaryText, /> Usability findings are synthetic/);
  assert.match(summaryText, /## 2\. Picks a day\n\nFindings:\n\n- \*\*P1\*\* \(Patient, mobile\): Does not see that grey days are full Fix: Write "Full" on full days/);
});

test('a second review replaces the notes: --clear removes them; bad step or severity fail with the choices [usability-review:S3]', () => {
  const projectRoot = createUiRepo();
  const screenshotPath = writeScreenshot(projectRoot, 'shot.png');
  runAi1(projectRoot, ['storyboard', 'add', '--slug', 'flow', '--step', 'Home', '--image', screenshotPath]);
  runAi1(projectRoot, ['storyboard', 'note', '--slug', 'flow', '--step', 'home', '--severity', 'P2', '--text', 'Too many buttons']);

  const unknownStep = runAi1(projectRoot, ['storyboard', 'note', '--slug', 'flow', '--step', 'nope', '--severity', 'P2', '--text', 'x']);
  assert.notEqual(unknownStep.status, 0);
  assert.match(unknownStep.stderr + unknownStep.stdout, /step ids: home/);
  const badSeverity = runAi1(projectRoot, ['storyboard', 'note', '--slug', 'flow', '--step', 'home', '--severity', 'high', '--text', 'x']);
  assert.match(badSeverity.stderr + badSeverity.stdout, /--severity must be one of P0, P1, P2, P3/);

  const clearRun = runAi1(projectRoot, ['storyboard', 'note', '--slug', 'flow', '--clear']);
  assert.match(clearRun.stdout, /removed 1 note\(s\)/);
  const storyboardPath = storyboardDirectory(projectRoot, 'flow');
  assert.equal(readStoryboard(storyboardPath).steps[0].notes, undefined);
  buildStoryboard(storyboardPath);
  assert.doesNotMatch(readFileSync(join(storyboardPath, 'index.html'), 'utf8'), /class="note |findings are synthetic/);
});
