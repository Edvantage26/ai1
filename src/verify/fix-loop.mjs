// fix-loop (PostToolUse Edit/Write/MultiEdit, feature `verify`): counts failed fix attempts - a failing
// test run with an edit since that test's previous run - and after `max_failed_attempts` in a row
// (default 3) tells the agent to stop patching, go back to the root cause and tell the person. The
// method's rule ("3 failed fixes: stop and question the approach") is lost from prose after a
// compaction, so it is counted here. It never blocks: the person stays in charge of what comes next.
// - Streaks are per test command (its text), so filtered runs (`node --test x`, `pytest -k`) count; a
//   pass of the same command, or a full verify command passing, resets. Re-running without editing
//   does not count. Told at the threshold and once more at twice it, then silent until a reset.
// - Reads the transcript incrementally (core/transcript-scan); without one it stays silent.
// Options (`modules.fix-loop`): max_failed_attempts, test_commands (regexes, replace the built-in
// runner list; verify commands always count), ignore_paths (edits there are not attempts).

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { readStateJson, resolveStateDirectory, sessionStatePath, writeStateText } from '../core/session-state.mjs';
import { commandWordsWithoutRedirects, splitSimpleCommands } from '../core/shell-parse.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import { eventContentBlocks, readNewTranscriptEvents, TOOL_RESULT_MARKER, TOOL_USE_MARKER } from '../core/transcript-scan.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { DEFAULT_IGNORED_PATHS, didRunFail, verifyCommandsRunBy } from './verify-gate.mjs';

const MODULE_ID = 'fix-loop';
const DEFAULT_MAX_FAILED_ATTEMPTS = 3;
const FILE_EDITING_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_SHOWN_COMMAND_CHARACTERS = 120;
export const DEFAULT_TEST_RUNNERS = [
  /^(?:npm|pnpm|yarn|bun)(?: run)? test\b/,
  /^node\b.*--test\b/,
  /^(?:python3? -m )?pytest\b/,
  /^python3? -m unittest\b/,
  /^(?:npx |pnpm exec |yarn )?(?:jest|vitest|mocha)\b/,
  /^(?:go|cargo|bun|deno) test\b/,
];

// The test commands one shell command line runs: [{ commandKey, isFullVerifyRun }].
export function listTestRuns(commandLine, verifyCommands, testRunners = DEFAULT_TEST_RUNNERS) {
  const fullRunIndexes = verifyCommandsRunBy(commandLine, verifyCommands);
  const testRuns = splitSimpleCommands(String(commandLine || ''))
    .map(({ words }) => commandWordsWithoutRedirects(words))
    .filter((commandText) => testRunners.some((testRunner) => testRunner.test(commandText)))
    .map((commandText) => ({ commandKey: commandText, isFullVerifyRun: false }));
  if (fullRunIndexes.length) testRuns.push({ commandKey: '(verify)', isFullVerifyRun: true });
  return testRuns;
}

// Whether a tool call edits project code that counts as a fix attempt.
function isCountedEdit(toolUse, projectRoot, ignoredPaths, testRunners, verifyCommands) {
  const countsPath = (candidatePath) => {
    const relativePath = projectRelativePath(projectRoot, candidatePath, projectRoot);
    return relativePath !== null && !matchesAnyGlob(relativePath, ignoredPaths);
  };
  if (FILE_EDITING_TOOLS.has(toolUse.name)) return countsPath(toolUse.input?.file_path ?? toolUse.input?.notebook_path);
  if (toolUse.name !== 'Bash') return false;
  // Writes of a test run itself (`npm test > out.log`) are not edits.
  return splitSimpleCommands(String(toolUse.input?.command || ''))
    .filter(({ text }) => listTestRuns(text, verifyCommands, testRunners).length === 0)
    .some(({ text }) => listShellWriteTargets(text).targetPaths.some(countsPath));
}

// Updates scanState: { offset, editCount, pendingRuns: { toolUseId: [commandKey] }, streaks:
// { commandKey: { failedAttempts, editCountAtLastRun, toldLevel } } }. False without a transcript.
export function scanFixAttempts(transcriptPath, scanState, { projectRoot, verifyCommands, testRunners, ignoredPaths }) {
  const newTranscript = readNewTranscriptEvents(transcriptPath, scanState, [TOOL_USE_MARKER, TOOL_RESULT_MARKER]);
  if (!newTranscript) return false;
  if (newTranscript.restarted) Object.assign(scanState, { editCount: 0, pendingRuns: {}, streaks: {} });
  scanState.editCount ||= 0;
  scanState.pendingRuns ||= {};
  scanState.streaks ||= {};
  for (const transcriptEvent of newTranscript.events) {
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) {
      if (isCountedEdit(toolUse, projectRoot, ignoredPaths, testRunners, verifyCommands)) scanState.editCount += 1;
      if (toolUse.name !== 'Bash') continue;
      const testRuns = listTestRuns(toolUse.input?.command, verifyCommands, testRunners);
      if (testRuns.length) scanState.pendingRuns[toolUse.id] = testRuns;
    }
    for (const toolResult of eventContentBlocks(transcriptEvent, 'tool_result')) {
      const testRuns = scanState.pendingRuns[toolResult.tool_use_id];
      if (!testRuns) continue;
      delete scanState.pendingRuns[toolResult.tool_use_id];
      const runFailed = didRunFail(toolResult);
      if (!runFailed && testRuns.some((testRun) => testRun.isFullVerifyRun)) {
        scanState.streaks = {};
        continue;
      }
      for (const { commandKey } of testRuns.filter((testRun) => !testRun.isFullVerifyRun)) {
        const streak = scanState.streaks[commandKey] || { failedAttempts: 0, editCountAtLastRun: scanState.editCount, toldLevel: 0 };
        if (!runFailed) {
          delete scanState.streaks[commandKey];
          continue;
        }
        if (scanState.editCount > streak.editCountAtLastRun) streak.failedAttempts += 1;
        streak.editCountAtLastRun = scanState.editCount;
        scanState.streaks[commandKey] = streak;
      }
    }
  }
  return true;
}

export function buildFixLoopReminder(commandKey, failedAttempts) {
  const shownCommand = commandKey.length > MAX_SHOWN_COMMAND_CHARACTERS ? `${commandKey.slice(0, MAX_SHOWN_COMMAND_CHARACTERS)}...` : commandKey;
  return `ai1/fix-loop: ${failedAttempts} fix attempts in a row have failed (\`${shownCommand}\` still fails after each edit). Stop patching: go back to the root cause with /ai1:verify-debug-systematically (reproduce, one hypothesis, a failing test) and tell the person what you tried and what you now think, before another fix.`;
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit'],
  feature: 'verify',
  description: 'After 3 failed fix attempts in a row (a test still failing after each edit), tells the agent to stop patching and go back to the root cause with the person.',
  run({ hookInput, config, projectRoot, environment, moduleOptions }) {
    const maxFailedAttempts = Number.isInteger(moduleOptions.max_failed_attempts) && moduleOptions.max_failed_attempts > 0 ? moduleOptions.max_failed_attempts : DEFAULT_MAX_FAILED_ATTEMPTS;
    const testRunners = Array.isArray(moduleOptions.test_commands) && moduleOptions.test_commands.length
      ? moduleOptions.test_commands.map((testCommandPattern) => new RegExp(testCommandPattern))
      : DEFAULT_TEST_RUNNERS;
    const ignoredPaths = [...DEFAULT_IGNORED_PATHS, `${KNOWLEDGE_BUNDLE_PATH}/**`, ...(moduleOptions.ignore_paths || [])];
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'fix-loop');
    const scanState = readStateJson(statePath);
    if (!scanFixAttempts(hookInput.transcript_path, scanState, { projectRoot, verifyCommands: config.verify || [], testRunners, ignoredPaths })) return allowDecision();
    const [commandKey, streak] = Object.entries(scanState.streaks)
      .filter(([, candidateStreak]) => candidateStreak.failedAttempts >= maxFailedAttempts * (candidateStreak.toldLevel + 1) && candidateStreak.toldLevel < 2)
      .sort(([, firstStreak], [, secondStreak]) => secondStreak.failedAttempts - firstStreak.failedAttempts)[0] || [];
    if (streak) streak.toldLevel += 1;
    writeStateText(statePath, JSON.stringify(scanState));
    return streak ? contextDecision(MODULE_ID, buildFixLoopReminder(commandKey, streak.failedAttempts)) : allowDecision();
  },
};
