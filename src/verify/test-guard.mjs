// test-guard (PreToolUse, feature `verify`): the verify gate trusts a passing suite, so a suite made
// to pass by skipping, emptying or deleting tests asks the person first. Deterministic shapes on
// test files only, compared before and after the change; added tests are never flagged.
// The same goes for the configuration of the checks (lint, format, types, test runner): an agent
// relaxes the check instead of fixing the code. Changing or removing an existing check config file
// asks; creating one does not. In shared files (pyproject.toml, setup.cfg, tox.ini, package.json)
// only a change to a checker's own section or key counts.
// Options (`modules.test-guard` in .ai1/config.json):
//   test_paths: globs of test files (replace the defaults below);
//   check_config_paths: globs of dedicated check config files (replace the defaults below);
//   ignore_rules: rule ids to switch off in this repo, e.g. ["test-assertions-removed"].

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { allowDecision, askDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { listToolCallChanges } from '../core/tool-call-paths.mjs';

const MODULE_ID = 'test-guard';
export const DEFAULT_TEST_PATHS = ['*.test.*', '*.spec.*', 'test_*.py', '*_test.py', '*_test.go', '**/test/**', '**/tests/**', '**/__tests__/**'];
export const DEFAULT_CHECK_CONFIG_PATHS = [
  '.eslintrc*', 'eslint.config.*', '.prettierrc*', 'prettier.config.*', 'biome.json', 'biome.jsonc', '.stylelintrc*', 'stylelint.config.*',
  'tsconfig*.json', 'jsconfig.json', 'jest.config.*', 'vitest.config.*', '.mocharc*',
  'ruff.toml', '.ruff.toml', 'mypy.ini', '.mypy.ini', '.flake8', '.pylintrc', 'pylintrc', 'pyrightconfig.json', 'pytest.ini', '.coveragerc',
  '.golangci.yml', '.golangci.yaml', '.golangci.toml', 'clippy.toml', '.clippy.toml', '.rubocop.yml',
];
export const TEST_GUARD_RULE_IDS = ['test-skip-added', 'test-assertions-removed', 'test-file-emptied', 'test-file-removed', 'test-shell-edit', 'check-config-changed'];
// Shared files: only the checkers' sections (TOML/INI headers) or keys (package.json) count.
const SECTIONED_CONFIG_FILES = new Set(['pyproject.toml', 'setup.cfg', 'tox.ini']);
const CHECKER_SECTION_HEADER = /^\[(?:tool[.:])?(?:ruff|mypy|pylint|flake8|pyright|pytest|coverage|isort|black|pydocstyle|bandit)\b/;
const PACKAGE_JSON_CHECKER_KEYS = ['eslintConfig', 'prettier', 'jest', 'stylelint', 'mocha', 'ava'];

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

// The text a file tool call leaves in the file: the whole content for Write, the edits applied for Edit.
function fileTextAfterEdit(toolName, toolInput, fileTextBefore) {
  if (toolName === 'Write') return String(toolInput.content ?? '');
  const fileEdits = toolName === 'MultiEdit' ? toolInput.edits || [] : [toolInput];
  return fileEdits.reduce((fileText, fileEdit) => {
    const oldText = String(fileEdit.old_string ?? '');
    const newText = String(fileEdit.new_string ?? '');
    if (!oldText) return fileText;
    return fileEdit.replace_all ? fileText.split(oldText).join(newText) : fileText.replace(oldText, () => newText);
  }, fileTextBefore);
}

// The checkers' part of a shared config file, to compare before and after a change.
export function checkerConfigText(fileName, fileText) {
  if (fileName === 'package.json') {
    try {
      const packageManifest = JSON.parse(fileText || '{}');
      return JSON.stringify(PACKAGE_JSON_CHECKER_KEYS.map((checkerKey) => packageManifest?.[checkerKey] ?? null));
    } catch {
      return null; // Unparsable JSON: the change cannot be judged.
    }
  }
  const checkerLines = [];
  let isInCheckerSection = false;
  for (const fileLine of String(fileText || '').split('\n')) {
    const trimmedLine = fileLine.trim();
    if (trimmedLine.startsWith('[')) isInCheckerSection = CHECKER_SECTION_HEADER.test(trimmedLine);
    if (isInCheckerSection && trimmedLine && !trimmedLine.startsWith('#')) checkerLines.push(trimmedLine);
  }
  return checkerLines.join('\n');
}

// Whether a file tool call changes an existing check configuration.
export function changesCheckConfig(toolName, toolInput, absolutePath, isDedicatedConfig) {
  if (!existsSync(absolutePath)) return false; // Creating a config is not relaxing one.
  if (isDedicatedConfig) return true;
  const fileName = basename(absolutePath);
  const fileTextBefore = readFileText(absolutePath);
  const textBefore = checkerConfigText(fileName, fileTextBefore);
  const textAfter = checkerConfigText(fileName, fileTextAfterEdit(toolName, toolInput, fileTextBefore));
  return textBefore !== null && textAfter !== null && textBefore !== textAfter;
}

const SHAPE_DESCRIPTIONS = {
  'test-skip-added': 'adds a skip or focus marker to',
  'test-assertions-removed': 'removes assertions from',
  'test-file-emptied': 'leaves without assertions',
  'test-file-removed': 'removes',
  'test-shell-edit': 'changes from the shell (bypassing the per-edit test check)',
  'check-config-changed': 'changes or removes the configuration of a check (lint, format, types, tests) in',
};

export function findTestGuardFindings(hookInput, projectRoot, moduleOptions = {}) {
  const workingDirectory = hookInput.cwd || projectRoot;
  const testPaths = Array.isArray(moduleOptions.test_paths) && moduleOptions.test_paths.length ? moduleOptions.test_paths : DEFAULT_TEST_PATHS;
  const checkConfigPaths = Array.isArray(moduleOptions.check_config_paths) && moduleOptions.check_config_paths.length ? moduleOptions.check_config_paths : DEFAULT_CHECK_CONFIG_PATHS;
  const ignoredRuleIds = moduleOptions.ignore_rules ?? [];
  const relativeToProject = (absolutePath) => relative(projectRoot, absolutePath).split('\\').join('/');
  const isTestPath = (absolutePath) => {
    const relativePath = relativeToProject(absolutePath);
    return !relativePath.startsWith('..') && relativePath !== '' && matchesAnyGlob(relativePath, testPaths);
  };
  const isDedicatedCheckConfig = (absolutePath) => {
    const relativePath = relativeToProject(absolutePath);
    return !relativePath.startsWith('..') && relativePath !== '' && matchesAnyGlob(relativePath, checkConfigPaths);
  };
  const isSharedCheckConfig = (absolutePath) => SECTIONED_CONFIG_FILES.has(basename(absolutePath)) || basename(absolutePath) === 'package.json';
  // A removed test counts when it holds assertions, or is a whole test folder.
  const holdsTests = (absolutePath) => (isDirectory(absolutePath) ? isTestPath(join(absolutePath, 'x')) : isTestPath(absolutePath) && countMatches(readFileText(absolutePath), ASSERTION_PATTERN) > 0);
  const testFindings = [];
  const addFinding = (ruleId, absolutePath) => {
    if (!ignoredRuleIds.includes(ruleId)) testFindings.push({ ruleId, path: relativeToProject(absolutePath) });
  };
  const { changes, runsInlineScript } = listToolCallChanges(hookInput, workingDirectory);
  for (const toolCallChange of changes) {
    const isCheckConfig = isDedicatedCheckConfig(toolCallChange.path);
    if (toolCallChange.change === 'edit' && (isCheckConfig || isSharedCheckConfig(toolCallChange.path))) {
      if (changesCheckConfig(hookInput.tool_name, hookInput.tool_input || {}, toolCallChange.path, isCheckConfig)) addFinding('check-config-changed', toolCallChange.path);
      continue;
    }
    if (isCheckConfig && existsSync(toolCallChange.path) && !isDirectory(toolCallChange.path)) {
      // A shell write, removal or move of a dedicated check config.
      addFinding('check-config-changed', toolCallChange.path);
      continue;
    }
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
  description: 'Asks the person before the agent skips, empties, weakens or deletes tests, or changes the configuration of a check (lint, format, types), so the verify gate cannot be passed that way.',
  run({ hookInput, projectRoot, moduleOptions }) {
    const testFindings = findTestGuardFindings(hookInput, projectRoot, moduleOptions);
    if (testFindings.length === 0) return allowDecision();
    const findingLines = testFindings.map((testFinding) => `[${testFinding.ruleId}] ${SHAPE_DESCRIPTIONS[testFinding.ruleId]} \`${testFinding.path}\`.`);
    return askDecision(MODULE_ID, `${findingLines.join(' ')} A passing suite and passing checks are what the verify gate trusts: fix the code, not the test or the check. If the person asked for this change, they confirm.`, [...new Set(testFindings.map((testFinding) => testFinding.ruleId))]);
  },
};
