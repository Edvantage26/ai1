// Customizations kept up by the agent: the first-use paragraph (S1), the after-use check at Stop (S2),
// quieting it per skill (S3) and paths a customization mentions that no longer exist (S4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemporaryProject } from './helpers.mjs';
import { findMissingPaths, isSkillQuiet } from '../src/core/skill-customization.mjs';
import { buildCustomizationCheckReason } from '../src/core/customization-check.mjs';
import { runSkillContextCommand } from '../src/cli/skill-context-command.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';

function createUserHome() {
  return mkdtempSync(join(tmpdir(), 'ai1-home-'));
}

function skillContext(commandArguments, projectRoot, homeDirectory = createUserHome()) {
  const printedTexts = [];
  const exitCode = runSkillContextCommand(commandArguments, { workingDirectory: projectRoot, environment: {}, homeDirectory, writeOutput: (printedText) => printedTexts.push(printedText) });
  return { exitCode, printedText: printedTexts.join('\n') };
}

function writeCustomization(customizationDirectory, customizationText) {
  mkdirSync(customizationDirectory, { recursive: true });
  writeFileSync(join(customizationDirectory, 'customization.md'), customizationText);
}

test('first load of a skill in a repo with ai1: a "First time" paragraph with its hints, once; none in a repo without ai1 [customization-upkeep:S1]', () => {
  const projectRoot = createTemporaryProject({ version: 2 });
  const firstLoad = skillContext(['storyboard-record-flow'], projectRoot).printedText;
  assert.match(firstLoad, /First time this skill runs here for this person\./);
  assert.match(firstLoad, /how the app starts here, how to log in/);
  assert.match(firstLoad, /offer to save it for this project \(committed\) or only for them with \/ai1:core-customize-skill; if nothing did, say nothing about it\./);
  const personState = JSON.parse(readFileSync(join(projectRoot, '.ai1', 'local', 'state.json'), 'utf8'));
  assert.ok(personState.skills['storyboard-record-flow'].firstLoadAt);
  assert.doesNotMatch(skillContext(['storyboard-record-flow'], projectRoot).printedText, /First time/);
  assert.match(skillContext(['later-write'], projectRoot).printedText, /First time this skill runs here/, 'per skill');
  const repoWithoutAi1 = createTemporaryProject();
  assert.doesNotMatch(skillContext(['storyboard-record-flow'], repoWithoutAi1).printedText, /First time/);
});

test('ai1 skill-context quiet <skill> records it for the person, --off brings it back; refused outside ai1 or for an excluded skill [customization-upkeep:S3]', () => {
  const projectRoot = createTemporaryProject({ version: 2 });
  const quietRun = skillContext(['quiet', 'storyboard-record-flow'], projectRoot);
  assert.equal(quietRun.exitCode, 0);
  assert.match(quietRun.printedText, /no after-use question/);
  assert.equal(isSkillQuiet(projectRoot, 'storyboard-record-flow'), true);
  assert.equal(isSkillQuiet(projectRoot, 'later-write'), false);
  skillContext(['quiet', 'storyboard-record-flow', '--off'], projectRoot);
  assert.equal(isSkillQuiet(projectRoot, 'storyboard-record-flow'), false);
  assert.equal(skillContext(['quiet', 'core-report-issue'], projectRoot).exitCode, 1);
  assert.equal(skillContext(['quiet', 'storyboard-record-flow'], createTemporaryProject()).exitCode, 1);
});

test('findMissingPaths: only path-like spans, relative ones against the repo, ~/ and absolute always [customization-upkeep:S4]', () => {
  const projectRoot = createTemporaryProject();
  const homeDirectory = createUserHome();
  mkdirSync(join(projectRoot, 'scripts'));
  writeFileSync(join(projectRoot, 'scripts', 'dev.sh'), '');
  mkdirSync(join(homeDirectory, 'bin'));
  writeFileSync(join(homeDirectory, 'bin', 'open-agent'), '');
  const customizationText = [
    '- start with `scripts/dev.sh`, not `scripts/start-dev.sh`',
    '- open with `~/bin/open-agent` or `~/bin/gone`; never `rm -rf build/`',
    '- names: `/ai1:session-fork-conversation`, `src/**/*.ts`, `<repo>/x`, `https://example.com/a`, `--opener x/y`, `package.json`, `../sibling/file`',
  ].join('\n');
  assert.deepEqual(findMissingPaths(customizationText, { baseRoot: projectRoot, homeDirectory }), ['scripts/start-dev.sh', '~/bin/gone']);
  assert.deepEqual(findMissingPaths(customizationText, { baseRoot: null, homeDirectory }), ['~/bin/gone'], 'a personal customization: relative paths are not checked');
});

test('a customization that mentions a missing path says so when the skill loads, project and personal [customization-upkeep:S4]', () => {
  const projectRoot = createTemporaryProject();
  const homeDirectory = createUserHome();
  writeCustomization(join(projectRoot, '.ai1', 'skills', 'storyboard'), '- Start the app with `scripts/start-dev.sh`.\n');
  writeCustomization(join(homeDirectory, '.config', 'ai1', 'skills', 'storyboard'), '- Publish with `~/bin/publish-storyboard`.\n');
  const printedText = skillContext(['storyboard-record-flow'], projectRoot, homeDirectory).printedText;
  assert.match(printedText, /mentions paths that no longer exist: `scripts\/start-dev\.sh` - offer the person in one line to update this customization with \/ai1:core-customize-skill/);
  assert.match(printedText, /mentions paths that no longer exist: `~\/bin\/publish-storyboard`/);
  mkdirSync(join(projectRoot, 'scripts'));
  writeFileSync(join(projectRoot, 'scripts', 'start-dev.sh'), '');
  assert.doesNotMatch(skillContext(['storyboard-record-flow'], projectRoot, homeDirectory).printedText, /scripts\/start-dev\.sh` -/);
});

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: createUserHome(),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function toolUseLine(toolName, toolInput = {}) {
  return JSON.stringify({ type: 'assistant', timestamp: '2026-11-19T10:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${Math.random()}`, name: toolName, input: toolInput }] } });
}

function typedSkillLine(skillFolder) {
  return JSON.stringify({ type: 'user', message: { role: 'user', content: `<command-message>ai1:${skillFolder}</command-message>\n<command-name>/ai1:${skillFolder}</command-name>` } });
}

function appendTranscriptLines(transcriptPath, transcriptLines) {
  appendFileSync(transcriptPath, transcriptLines.map((transcriptLine) => `${transcriptLine}\n`).join(''));
}

function stopReason(projectRoot, transcriptPath, options) {
  const hookOutput = runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot, transcript_path: transcriptPath }, options);
  return hookOutput?.decision === 'block' ? hookOutput.reason : '';
}

const ONLY_CORE_STOP_MODULES = { version: 2, features: { reuse: false, okf: false, verify: false, later: false, storyboard: false } };

test('customization-check: once per skill and session, after 3 tool calls following its load, by the agent or typed by the person; never for excluded skills [customization-upkeep:S2]', () => {
  const projectRoot = createTemporaryProject(ONLY_CORE_STOP_MODULES);
  const options = hookOptions();
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  appendTranscriptLines(transcriptPath, [toolUseLine('Bash', { command: 'ls' }), toolUseLine('Skill', { skill: 'ai1:storyboard-record-flow' }), toolUseLine('Bash'), toolUseLine('Read')]);
  assert.equal(stopReason(projectRoot, transcriptPath, options), '', 'two tool calls after the load: not yet');
  appendTranscriptLines(transcriptPath, [toolUseLine('Bash')]);
  const reasonText = stopReason(projectRoot, transcriptPath, options);
  assert.match(reasonText, /Customization: \/ai1:storyboard-record-flow ran in this session\. Judge silently/);
  assert.match(reasonText, /a step redone or worked around; something you had to ask that will be the same next time; the person corrected the result; a rule of its customization made it worse/);
  assert.match(reasonText, /If none: finish without writing anything about it\./);
  assert.match(reasonText, /\/ai1:core-customize-skill/);
  assert.match(reasonText, /ai1 skill-context quiet <skill>/);
  assert.match(reasonText, /reuse proposal \(its own line, never merged with this one\)/);
  appendTranscriptLines(transcriptPath, [toolUseLine('Skill', { skill: 'ai1:storyboard-record-flow' }), toolUseLine('Bash'), toolUseLine('Bash'), toolUseLine('Bash')]);
  assert.equal(stopReason(projectRoot, transcriptPath, options), '', 'asked once per skill and session');
  appendTranscriptLines(transcriptPath, [typedSkillLine('later-write'), toolUseLine('Skill', { skill: 'ai1:core-report-issue' }), toolUseLine('Bash'), toolUseLine('Bash'), toolUseLine('Bash')]);
  const typedReason = stopReason(projectRoot, transcriptPath, options);
  assert.match(typedReason, /\/ai1:later-write ran/);
  assert.doesNotMatch(typedReason, /core-report-issue/, 'an excluded skill is never asked about');
});

test('customization-check: a quiet skill is not asked about [customization-upkeep:S3]', () => {
  const projectRoot = createTemporaryProject(ONLY_CORE_STOP_MODULES);
  skillContext(['quiet', 'storyboard-record-flow'], projectRoot);
  const options = hookOptions();
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  appendTranscriptLines(transcriptPath, [toolUseLine('Skill', { skill: 'ai1:storyboard-record-flow' }), toolUseLine('Bash'), toolUseLine('Bash'), toolUseLine('Bash')]);
  assert.equal(stopReason(projectRoot, transcriptPath, options), '');
});

test('every customization offer explains the skill (ai1 plugin, customizable) before the proposed rule [customization-upkeep:S5]', () => {
  const projectRoot = createTemporaryProject({ version: 2 });
  const offerShape = /what the skill does in a few words and that it belongs to the ai1 plugin; that it accepts a customization for this project \(committed\) or only for (them|the person), added to its own steps; the exact rule you propose/;
  assert.match(skillContext(['storyboard-record-flow'], projectRoot).printedText, offerShape);
  const checkReason = buildCustomizationCheckReason(['storyboard-record-flow']);
  assert.match(checkReason, offerShape);
  assert.doesNotMatch(checkReason, /¿Lo guardo en la personalización de <skill>\?/);
});
