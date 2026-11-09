// test-guard (PreToolUse, feature `verify`): the verify gate trusts a passing suite, so a suite made
// to pass by skipping, emptying or deleting tests asks the person first. Deterministic shapes on
// test files only, compared before and after the change; added tests are never flagged.
// Options (`modules.test-guard` in .ai1/config.json):
//   test_paths: globs of test files (replace the defaults below);
//   ignore_rules: rule ids to switch off in this repo, e.g. ["test-assertions-removed"].

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { allowDecision, askDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { listToolCallChanges } from '../core/tool-call-paths.mjs';

const MODULE_ID = 'test-guard';
export const DEFAULT_TEST_PATHS = ['*.test.*', '*.spec.*', 'test_*.py', '*_test.py', '*_test.go', '**/test/**', '**/tests/**', '**/__tests__/**'];
export const TEST_GUARD_RULE_IDS = ['test-skip-added', 'test-assertions-removed', 'test-file-emptied', 'test-file-removed', 'test-shell-edit'];

// One match per assertion call: node:assert, Jest/Vitest expect, pytest/unittest, tap, Go testing, Chai.
const ASSERTION_PATTERN = /\bassert(?:[._]\w+)*\s*\(|\bassert\s+(?![(=:])\S|\bexpect\s*\(|\bself\.assert\w*\s*\(|\bt\.(?:equal|notEqual|deepEqual|strictEqual|deepStrictEqual|same|ok|notOk|is|not|true|false|truthy|falsy|throws|match|assert|Error|Errorf|Fatal|Fatalf|Fail)\w*\s*\(|\brequire\.\w+\s*\(|\.should\b/g;
// Markers that skip or focus tests: Jest/Vitest/Mocha, node:test, pytest, unittest, Go.
const SKIP_MARKER_PATTERN = /\b(?:it|test|describe|context|suite)\.(?:skip|only|todo)\s*\(|\bx(?:it|test|describe)\s*\(|\bf(?:it|describe)\s*\(|\bt\.(?:skip|todo)\s*\(|\{\s*(?:skip|todo|only)\s*:\s*true|@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.skip|\bself\.skipTest\s*\(|\bpytest\.skip\s*\(|\bt\.Skip(?:Now|f)?\s*\(/g;
const INLINE_SCRIPT_TEST_FILE = /[\w./-]*(?:\.test\.\w+|\.spec\.\w+|test_\w+\.py|_test\.(?:py|go))\b/g;

function countMatches(sourceText, matchPattern) {
  return (String(sourceText || '').match(matchPattern) || []).length;
}

function readFileText(absolutePath) {
  try {
    return existsSync(absolutePath) && statSync(absolutePath).isFile() ? readFileSync(absolutePath, 'utf8') : '';
  } catch {
    return '';
  }
}

function isDirectory(absolutePath) {
  try {
    return statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

// What a file tool call replaces and with what, for counting: { textBefore, textAfter, isWholeFile }.
function textsOfFileEdit(toolName, toolInput, absolutePath) {
  if (toolName === 'Write') return { textBefore: readFileText(absolutePath), textAfter: toolInput.content, isWholeFile: true };
  const fileEdits = toolName === 'MultiEdit' ? toolInput.edits || [] : [toolInput];
  return {
    textBefore: fileEdits.map((fileEdit) => fileEdit.old_string || '').join('\n'),
    textAfter: fileEdits.map((fileEdit) => fileEdit.new_string || '').join('\n'),
    isWholeFile: false,
  };
}

export function findFileEditShapes(toolName, toolInput, absolutePath) {
  const { textBefore, textAfter, isWholeFile } = textsOfFileEdit(toolName, toolInput, absolutePath);
  const testShapes = [];
  if (countMatches(textAfter, SKIP_MARKER_PATTERN) > countMatches(textBefore, SKIP_MARKER_PATTERN)) testShapes.push('test-skip-added');
  const assertionsBefore = countMatches(textBefore, ASSERTION_PATTERN);
  const assertionsAfter = countMatches(textAfter, ASSERTION_PATTERN);
  if (isWholeFile && assertionsBefore > 0 && assertionsAfter === 0) testShapes.push('test-file-emptied');
  else if (assertionsAfter < assertionsBefore) testShapes.push('test-assertions-removed');
  return testShapes;
}

const SHAPE_DESCRIPTIONS = {
  'test-skip-added': 'adds a skip or focus marker to',
  'test-assertions-removed': 'removes assertions from',
  'test-file-emptied': 'leaves without assertions',
  'test-file-removed': 'removes',
  'test-shell-edit': 'changes from the shell (bypassing the per-edit test check)',
};

export function findTestGuardFindings(hookInput, projectRoot, moduleOptions = {}) {
  const workingDirectory = hookInput.cwd || projectRoot;
  const testPaths = Array.isArray(moduleOptions.test_paths) && moduleOptions.test_paths.length ? moduleOptions.test_paths : DEFAULT_TEST_PATHS;
  const ignoredRuleIds = moduleOptions.ignore_rules ?? [];
  const relativeToProject = (absolutePath) => relative(projectRoot, absolutePath).split('\\').join('/');
  const isTestPath = (absolutePath) => {
    const relativePath = relativeToProject(absolutePath);
    return !relativePath.startsWith('..') && relativePath !== '' && matchesAnyGlob(relativePath, testPaths);
  };
  // A removed test counts when it holds assertions, or is a whole test folder.
  const holdsTests = (absolutePath) => (isDirectory(absolutePath) ? isTestPath(join(absolutePath, 'x')) : isTestPath(absolutePath) && countMatches(readFileText(absolutePath), ASSERTION_PATTERN) > 0);
  const testFindings = [];
  const addFinding = (ruleId, absolutePath) => {
    if (!ignoredRuleIds.includes(ruleId)) testFindings.push({ ruleId, path: relativeToProject(absolutePath) });
  };
  const { changes, runsInlineScript } = listToolCallChanges(hookInput, workingDirectory);
  for (const toolCallChange of changes) {
    if (toolCallChange.change === 'edit') {
      if (!isTestPath(toolCallChange.path)) continue;
      for (const ruleId of findFileEditShapes(hookInput.tool_name, hookInput.tool_input || {}, toolCallChange.path)) addFinding(ruleId, toolCallChange.path);
    } else if (toolCallChange.change === 'remove') {
      if (holdsTests(toolCallChange.path)) addFinding('test-file-removed', toolCallChange.path);
    } else if (toolCallChange.change === 'move') {
      const destinationPath = isDirectory(toolCallChange.movedTo) ? join(toolCallChange.movedTo, basename(toolCallChange.path)) : toolCallChange.movedTo;
      if (holdsTests(toolCallChange.path) && !isTestPath(destinationPath)) addFinding('test-file-removed', toolCallChange.path);
    } else if (toolCallChange.change === 'move-target') {
      // Renaming a test is fine; moving another file over an existing test replaces it.
      if (holdsTests(toolCallChange.path) && !isDirectory(toolCallChange.path)) addFinding('test-shell-edit', toolCallChange.path);
    } else if (isTestPath(toolCallChange.path) && !isDirectory(toolCallChange.path)) {
      addFinding('test-shell-edit', toolCallChange.path);
    }
  }
  if (runsInlineScript) {
    const namedTestFiles = String(hookInput.tool_input?.command || '').match(INLINE_SCRIPT_TEST_FILE) || [];
    for (const namedTestFile of new Set(namedTestFiles)) addFinding('test-shell-edit', join(workingDirectory, namedTestFile));
  }
  return testFindings;
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit', 'Bash'],
  feature: 'verify',
  description: 'Asks the person before the agent skips, empties, weakens or deletes tests, so the verify gate cannot be passed that way.',
  run({ hookInput, projectRoot, moduleOptions }) {
    const testFindings = findTestGuardFindings(hookInput, projectRoot, moduleOptions);
    if (testFindings.length === 0) return allowDecision();
    const findingLines = testFindings.map((testFinding) => `[${testFinding.ruleId}] ${SHAPE_DESCRIPTIONS[testFinding.ruleId]} \`${testFinding.path}\`.`);
    return askDecision(MODULE_ID, `${findingLines.join(' ')} A passing suite is what the verify gate trusts: fix the code, not the test. If the person asked for this change, they confirm.`);
  },
};
