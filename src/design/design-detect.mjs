// design-detect (PostToolUse Edit/Write/MultiEdit, feature `design`): after the agent edits a UI
// file (stylesheet or markup), runs the deterministic design rules on it and hands back what the
// edit introduced: only findings on the lines this edit wrote, each one once per session. Feedback,
// never a block: the edit already happened and some findings are deliberate choices.
//
// Options (modules.design-detect): ignore_rules: rule ids to switch off in this repo.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText, shortHash } from '../core/session-state.mjs';
import { DESIGN_RULES, classifyUiFile, scanUiFile } from './design-rules.mjs';

const MODULE_ID = 'design-detect';
const MAX_SCANNED_FILE_BYTES = 512 * 1024;
const MAX_LISTED_RULES = 8;
const MAX_LISTED_LINES_PER_RULE = 5;

// Line ranges (1-based, inclusive) the edit wrote, or null when it wrote the whole file.
export function findEditedLineRanges(hookInput, fileText) {
  const toolInput = hookInput.tool_input || {};
  if (hookInput.tool_name === 'Write') return null;
  const writtenFragments = hookInput.tool_name === 'MultiEdit'
    ? (toolInput.edits || []).map((fileEdit) => fileEdit?.new_string)
    : [toolInput.new_string];
  const editedRanges = [];
  for (const writtenFragment of writtenFragments) {
    if (typeof writtenFragment !== 'string' || !writtenFragment.trim()) continue;
    const fragmentLineCount = writtenFragment.split('\n').length;
    let fragmentIndex = fileText.indexOf(writtenFragment);
    while (fragmentIndex >= 0) {
      const firstLine = fileText.slice(0, fragmentIndex).split('\n').length;
      editedRanges.push([firstLine, firstLine + fragmentLineCount - 1]);
      fragmentIndex = fileText.indexOf(writtenFragment, fragmentIndex + writtenFragment.length);
    }
  }
  return editedRanges;
}

const isLineInRanges = (lineNumber, editedRanges) => editedRanges === null
  || editedRanges.some(([firstLine, lastLine]) => lineNumber >= firstLine && lineNumber <= lastLine);

export function buildDesignReport(relativePath, newFindings) {
  const linesByRule = new Map();
  for (const designFinding of newFindings) {
    if (!linesByRule.has(designFinding.ruleId)) linesByRule.set(designFinding.ruleId, []);
    linesByRule.get(designFinding.ruleId).push(designFinding.line);
  }
  const reportLines = [`Design check (ai1/design-detect) on ${relativePath}, in the lines this edit wrote:`];
  for (const [ruleId, findingLines] of [...linesByRule].slice(0, MAX_LISTED_RULES)) {
    const designRule = DESIGN_RULES.find((candidateRule) => candidateRule.id === ruleId);
    const listedLines = findingLines.slice(0, MAX_LISTED_LINES_PER_RULE).map((findingLine) => `L${findingLine}`).join(', ')
      + (findingLines.length > MAX_LISTED_LINES_PER_RULE ? ', ...' : '');
    reportLines.push(`  - [${ruleId}]${designRule.isHint ? ' (hint)' : ''} ${listedLines}: ${designRule.summary}`);
  }
  if (linesByRule.size > MAX_LISTED_RULES) reportLines.push(`  - ... and ${linesByRule.size - MAX_LISTED_RULES} more rules`);
  reportLines.push('Fix the ones that are not a deliberate choice. If one is deliberate (brand font, a chosen style), keep it and say why in one line. Hints are for review, not mandatory. The repo can switch a rule off in .ai1/config.json (modules.design-detect.ignore_rules).');
  return reportLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit'],
  feature: 'design',
  description: 'Checks every UI file the agent edits against deterministic design rules (generic AI look, contrast, headings, tiny text...) and reports what the edit introduced.',
  run({ hookInput, projectRoot, environment, moduleOptions }) {
    const relativePath = projectRelativePath(projectRoot, hookInput.tool_input?.file_path, hookInput.cwd || projectRoot);
    if (!relativePath || !classifyUiFile(relativePath)) return allowDecision();
    const absolutePath = join(projectRoot, relativePath);
    if (!existsSync(absolutePath) || statSync(absolutePath).size > MAX_SCANNED_FILE_BYTES) return allowDecision();

    const fileText = readFileSync(absolutePath, 'utf8');
    const editedRanges = findEditedLineRanges(hookInput, fileText);
    const fileLines = fileText.split('\n');
    const editFindings = scanUiFile(absolutePath, fileText, moduleOptions.ignore_rules ?? [])
      .filter((designFinding) => isLineInRanges(designFinding.line, editedRanges));
    if (!editFindings.length) return allowDecision();

    // Keyed by the line's text, not its number, so a finding that only moved is not reported again.
    const reportedPath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'design-reported');
    const reportedKeys = new Set((readStateText(reportedPath) || '').split('\n').filter(Boolean));
    const findingKey = (designFinding) => shortHash(`${relativePath}:${designFinding.ruleId}:${fileLines[designFinding.line - 1].trim()}`);
    const newFindings = editFindings.filter((designFinding) => !reportedKeys.has(findingKey(designFinding)));
    if (!newFindings.length) return allowDecision();
    writeStateText(reportedPath, [...reportedKeys, ...newFindings.map(findingKey)].join('\n'));
    return contextDecision(MODULE_ID, buildDesignReport(relativePath, newFindings));
  },
};
