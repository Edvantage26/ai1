import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemporaryProject } from './helpers.mjs';
import { CUSTOMIZATION_HEADING, OVERLAY_MAX_BYTES, renderSkillContext, resolveSkillOverlays } from '../src/core/skill-customization.mjs';
import { runSkillContextCommand } from '../src/cli/skill-context-command.mjs';

function writeProjectOverlay(projectRoot, feature, overlayText) {
  mkdirSync(join(projectRoot, '.ai1', 'skills', feature), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'skills', feature, 'overlay.md'), overlayText);
}

function createUserHome(feature, overlayText) {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  if (overlayText !== undefined) {
    mkdirSync(join(homeDirectory, '.config', 'ai1', 'skills', feature), { recursive: true });
    writeFileSync(join(homeDirectory, '.config', 'ai1', 'skills', feature, 'overlay.md'), overlayText);
  }
  return homeDirectory;
}

function skillContextOutput(commandArguments, options) {
  const printedTexts = [];
  const exitCode = runSkillContextCommand(commandArguments, { ...options, writeOutput: (printedText) => printedTexts.push(printedText) });
  return { exitCode, printedText: printedTexts.join('\n') };
}

const noEnvironment = {};

test('no overlay: the heading, "none yet" and the footer that offers to customize', () => {
  const projectRoot = createTemporaryProject();
  const { exitCode, printedText } = skillContextOutput(['later-write'], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory: createUserHome('later') });
  assert.equal(exitCode, 0);
  assert.ok(printedText.startsWith(CUSTOMIZATION_HEADING));
  assert.match(printedText, /None yet for this project \(\.ai1\/skills\/later\/overlay\.md\)/);
  assert.match(printedText, /\/ai1:core-customize-skill/);
  assert.match(printedText, /Fixed rules of the skill above win/);
});

test('project and user overlays are both printed, project first, with the precedence', () => {
  const projectRoot = createTemporaryProject();
  writeProjectOverlay(projectRoot, 'session', '- Briefs always list the verify commands.\n');
  const homeDirectory = createUserHome('session', '- Keep briefs short.\n');
  const { printedText } = skillContextOutput(['session-fork-conversation'], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory });
  const projectIndex = printedText.indexOf('### This project (.ai1/skills/session/overlay.md)');
  const userIndex = printedText.indexOf('### This person (');
  assert.ok(projectIndex > 0 && userIndex > projectIndex);
  assert.match(printedText, /Briefs always list the verify commands\./);
  assert.match(printedText, /Keep briefs short\./);
  assert.match(printedText, /this project's wins over the person's/);
  assert.doesNotMatch(printedText, /None yet/);
});

test('XDG_CONFIG_HOME moves the user overlay', () => {
  const projectRoot = createTemporaryProject();
  const configHome = mkdtempSync(join(tmpdir(), 'ai1-xdg-'));
  mkdirSync(join(configHome, 'ai1', 'skills', 'okf'), { recursive: true });
  writeFileSync(join(configHome, 'ai1', 'skills', 'okf', 'overlay.md'), 'mine');
  const resolvedOverlays = resolveSkillOverlays('okf-maintain-knowledge', { workingDirectory: projectRoot, environment: { XDG_CONFIG_HOME: configHome }, homeDirectory: createUserHome('okf') });
  assert.equal(resolvedOverlays.user.text, 'mine');
});

test('a user-only skill ignores a project overlay and only offers a personal one', () => {
  const projectRoot = createTemporaryProject();
  writeProjectOverlay(projectRoot, 'core', 'project rule');
  const { printedText } = skillContextOutput(['core-setup-repo'], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory: createUserHome('core') });
  assert.doesNotMatch(printedText, /project rule/);
  assert.match(printedText, /None yet for this person/);
  assert.match(printedText, /for them \(personal\)/);
  assert.doesNotMatch(printedText, /this project's wins/);
});

test('excluded and unknown skills print nothing and exit 0', () => {
  const projectRoot = createTemporaryProject();
  writeProjectOverlay(projectRoot, 'core', 'should never show');
  for (const skillFolder of ['core-report-issue', 'okf-validate-bundle', 'no-such-skill']) {
    const { exitCode, printedText } = skillContextOutput([skillFolder], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory: createUserHome('core') });
    assert.equal(exitCode, 0);
    assert.equal(printedText, '');
  }
});

test('an unreadable overlay is a note, a long one is cut, and the rest still prints', () => {
  const projectRoot = createTemporaryProject();
  mkdirSync(join(projectRoot, '.ai1', 'skills', 'lanes', 'overlay.md'), { recursive: true });
  const homeDirectory = createUserHome('lanes', 'x'.repeat(OVERLAY_MAX_BYTES + 100));
  const { exitCode, printedText } = skillContextOutput(['lanes-design-before-code'], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory });
  assert.equal(exitCode, 0);
  assert.match(printedText, /\(could not be read: EISDIR\)/);
  assert.match(printedText, new RegExp(`cut at ${OVERLAY_MAX_BYTES} bytes`));
  assert.match(printedText, /Precedence:/);
});

test('inside a linked worktree the branch overlay wins, else the main checkout one is used', () => {
  const mainRoot = createTemporaryProject();
  const runGit = (gitArguments, cwd = mainRoot) => execFileSync('git', gitArguments, { cwd, stdio: 'ignore' });
  runGit(['init', '-q', '-b', 'main']);
  writeProjectOverlay(mainRoot, 'later', 'from main');
  runGit(['add', '.']);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  const worktreeRoot = join(mkdtempSync(join(tmpdir(), 'ai1-wt-')), 'wt');
  runGit(['worktree', 'add', '-q', '-b', 'wt/x', worktreeRoot]);
  const options = { workingDirectory: join(worktreeRoot, '.ai1'), environment: noEnvironment, homeDirectory: createUserHome('later') };
  writeProjectOverlay(worktreeRoot, 'later', 'from the branch');
  assert.equal(resolveSkillOverlays('later-write', options).project.text, 'from the branch');
  execFileSync('rm', ['-rf', join(worktreeRoot, '.ai1', 'skills')]);
  const fromMain = resolveSkillOverlays('later-write', { ...options, workingDirectory: worktreeRoot });
  assert.equal(fromMain.project.text, 'from main');
  assert.equal(fromMain.project.fromMainCheckout, true);
  assert.match(renderSkillContext(fromMain), /from the main checkout/);
});

test('--list names every skill with its status; a broken skills directory still exits 0', () => {
  const projectRoot = createTemporaryProject();
  writeProjectOverlay(projectRoot, 'okf', 'conventions');
  const listed = skillContextOutput(['--list', '--json'], { workingDirectory: projectRoot, environment: noEnvironment, homeDirectory: createUserHome('okf') });
  const skillCustomizations = JSON.parse(listed.printedText);
  const tidyEntry = skillCustomizations.find((skillCustomization) => skillCustomization.skill === 'okf-tidy-claude-md');
  assert.equal(tidyEntry.project, '.ai1/skills/okf/overlay.md');
  assert.equal(skillCustomizations.find((skillCustomization) => skillCustomization.skill === 'core-report-issue').customizable, false);
  const broken = skillContextOutput(['--list'], { workingDirectory: projectRoot, environment: noEnvironment, skillsDirectory: join(projectRoot, 'missing') });
  assert.equal(broken.exitCode, 0);
  assert.equal(broken.printedText, '');
});

test('the CLI entry point prints the context and exits 0', () => {
  const projectRoot = createTemporaryProject();
  writeProjectOverlay(projectRoot, 'worktrees', 'never share data/');
  const cliOutput = execFileSync('node', [join(import.meta.dirname, '..', 'bin', 'ai1'), 'skill-context', 'worktrees-plan-recipe'], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, HOME: createUserHome('worktrees'), XDG_CONFIG_HOME: '' } });
  assert.match(cliOutput, /never share data\//);
});

test('every skill folder is in the customization index, and each SKILL.md matches its entry', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { SKILL_CUSTOMIZATION_INDEX } = await import('../src/core/skill-customization-index.mjs');
  const skillsDirectory = join(import.meta.dirname, '..', 'skills');
  const skillFolders = readdirSync(skillsDirectory, { withFileTypes: true }).filter((directoryEntry) => directoryEntry.isDirectory()).map((directoryEntry) => directoryEntry.name);
  assert.deepEqual(skillFolders.filter((skillFolder) => !SKILL_CUSTOMIZATION_INDEX[skillFolder]), [], 'skills missing from src/core/skill-customization-index.mjs (decide: customizable, or not and why)');
  assert.deepEqual(Object.keys(SKILL_CUSTOMIZATION_INDEX).filter((skillFolder) => !skillFolders.includes(skillFolder)), [], 'index entries without a skill folder');
  for (const skillFolder of skillFolders) {
    const skillText = readFileSync(join(skillsDirectory, skillFolder, 'SKILL.md'), 'utf8');
    const frontmatterText = /^---\n([\s\S]*?)\n---/.exec(skillText)?.[1] ?? '';
    const allowedToolsLine = /^allowed-tools:(.*)$/m.exec(frontmatterText)?.[1] ?? '';
    const injectionLine = `!\`"\${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context ${skillFolder}\``;
    const lastLine = skillText.trimEnd().split('\n').at(-1);
    if (SKILL_CUSTOMIZATION_INDEX[skillFolder].customizable) {
      assert.ok(allowedToolsLine.includes('Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)'), `${skillFolder}: allowed-tools must pre-approve the plugin's own ai1 skill-context`);
      assert.match(skillText, /\n## Fixed rules\n+- /, `${skillFolder}: needs a "## Fixed rules" section with at least one bullet`);
      assert.equal(lastLine, injectionLine, `${skillFolder}: the last line must be ${injectionLine}`);
    } else {
      assert.ok(!allowedToolsLine.includes('skill-context'), `${skillFolder}: not customizable, so no skill-context permission`);
      assert.ok(!/!`[^`]*ai1" skill-context/.test(skillText), `${skillFolder}: not customizable, so no skill-context injection`);
      assert.ok(SKILL_CUSTOMIZATION_INDEX[skillFolder].reason, `${skillFolder}: an excluded skill says why`);
    }
  }
});
