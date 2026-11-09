// Behaviour scenarios of a deep-lane plan: a `# Behaviour` section lists `- S1: Given ..., when ...,
// then ...`, and the test that covers a scenario carries the tag `[<slug>:S1]` in its name or a
// comment. `ai1 plan-done` closes a plan only when every scenario's tag is found in the repo and the
// verify commands are green. It proves a tagged test exists and the suite passes, not that the test
// proves the scenario: that is the person's review (and test-guard against weakened tests).

import { execFileSync } from 'node:child_process';
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { AI1_DIRECTORY } from '../core/config.mjs';
import { readPlanStatus, UNAPPROVED_STATUSES } from './lanes-work.mjs';

const BEHAVIOUR_HEADING_PATTERN = /^#{1,2}\s+behaviou?r\s*$/i;
const ANY_SECTION_HEADING_PATTERN = /^#{1,2}\s/;
const CODE_FENCE_PATTERN = /^\s*(```|~~~)/;
const SCENARIO_LINE_PATTERN = /^\s*[-*]\s+(S\d+)\s*:/;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MILLISECONDS = 10000;

// { hasBehaviourSection, scenarioIds, duplicateIds }. Headings and scenario lines inside code fences
// do not count: a plan may quote the template.
export function readPlanScenarios(planText) {
  const { bodyText } = splitFrontmatter(planText);
  const scenarioIds = [];
  const duplicateIds = [];
  let hasBehaviourSection = false;
  let isInsideBehaviour = false;
  let isInsideFence = false;
  for (const planLine of bodyText.split(/\r?\n/)) {
    if (CODE_FENCE_PATTERN.test(planLine)) { isInsideFence = !isInsideFence; continue; }
    if (isInsideFence) continue;
    if (ANY_SECTION_HEADING_PATTERN.test(planLine)) {
      isInsideBehaviour = BEHAVIOUR_HEADING_PATTERN.test(planLine);
      if (isInsideBehaviour) hasBehaviourSection = true;
      continue;
    }
    const scenarioMatch = isInsideBehaviour && SCENARIO_LINE_PATTERN.exec(planLine);
    if (!scenarioMatch) continue;
    if (scenarioIds.includes(scenarioMatch[1])) duplicateIds.push(scenarioMatch[1]);
    else scenarioIds.push(scenarioMatch[1]);
  }
  return { hasBehaviourSection, scenarioIds, duplicateIds };
}

export function formatScenarioTag(planSlug, scenarioId) {
  return `[${planSlug}:${scenarioId}]`;
}

// Tracked and untracked-not-ignored files of the checkout. Throws when git cannot list them: the
// caller fails closed, since a scan that silently finds nothing would let a plan close.
export function listRepoFiles(repoRoot) {
  const gitOutput = execFileSync('git', ['-C', repoRoot, 'ls-files', '-co', '--exclude-standard', '-z'], {
    encoding: 'utf8', timeout: GIT_TIMEOUT_MILLISECONDS, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return gitOutput.split('\0').filter(Boolean);
}

// Docs and ai1's own files never count as coverage: a tag quoted in a README or a plan is not a test.
function isScannedPath(relativePath) {
  return !relativePath.startsWith(`${AI1_DIRECTORY}/`) && !relativePath.toLowerCase().endsWith('.md');
}

function readTextFile(filePath) {
  let fileSize;
  try { fileSize = statSync(filePath).size; } catch { return null; }
  if (fileSize > MAX_SCANNED_FILE_BYTES || fileSize === 0) return null;
  const fileBuffer = Buffer.alloc(fileSize);
  const fileDescriptor = openSync(filePath, 'r');
  try { readSync(fileDescriptor, fileBuffer, 0, fileSize, 0); } finally { closeSync(fileDescriptor); }
  if (fileBuffer.subarray(0, 8000).includes(0)) return null;
  return fileBuffer.toString('utf8');
}

// Map scenarioId -> first location `path:line` of its tag; scenarios without a tag are absent.
export function findScenarioTags(repoRoot, planSlug, scenarioIds, repoFiles = listRepoFiles(repoRoot)) {
  const scenarioLocations = new Map();
  const pendingTags = new Map(scenarioIds.map((scenarioId) => [formatScenarioTag(planSlug, scenarioId), scenarioId]));
  for (const relativePath of repoFiles.filter(isScannedPath).sort()) {
    if (pendingTags.size === 0) break;
    const fileText = readTextFile(join(repoRoot, relativePath));
    if (fileText === null) continue;
    for (const [scenarioTag, scenarioId] of pendingTags) {
      const tagIndex = fileText.indexOf(scenarioTag);
      if (tagIndex === -1) continue;
      const lineNumber = fileText.slice(0, tagIndex).split('\n').length;
      scenarioLocations.set(scenarioId, `${relativePath}:${lineNumber}`);
      pendingTags.delete(scenarioTag);
    }
  }
  return scenarioLocations;
}

// { scenarioIds, duplicateIds, coveredLocations: Map, missingIds } for a plan's text.
export function checkScenarioCoverage(repoRoot, planSlug, planText, repoFiles) {
  const { scenarioIds, duplicateIds } = readPlanScenarios(planText);
  const coveredLocations = scenarioIds.length === 0 ? new Map() : findScenarioTags(repoRoot, planSlug, scenarioIds, repoFiles);
  const missingIds = scenarioIds.filter((scenarioId) => !coveredLocations.has(scenarioId));
  return { scenarioIds, duplicateIds, coveredLocations, missingIds };
}

// Why a write that turns a plan's `diskText` into `resultText` must go another way, or null. On a plan
// with scenarios: `status: done` is set only by `ai1 plan-done`, and dropping a scenario (or the
// section, or replacing it with None) needs the person again, so it passes only with the plan back
// to `ready`/`draft`. Adding or rewording scenarios is free.
export function findPlanScenarioViolation(planSlug, diskText, resultText) {
  const diskScenarioIds = readPlanScenarios(diskText).scenarioIds;
  if (diskScenarioIds.length === 0) return null;
  const resultStatus = readPlanStatus(resultText);
  if (resultStatus === 'done' && readPlanStatus(diskText) !== 'done') {
    return `this plan has behaviour scenarios: close it with \`ai1 plan-done ${planSlug}\`, which checks each scenario has its tagged test and the verify commands pass, instead of writing \`status: done\`.`;
  }
  const resultScenarioIds = new Set(readPlanScenarios(resultText).scenarioIds);
  const droppedIds = diskScenarioIds.filter((scenarioId) => !resultScenarioIds.has(scenarioId));
  if (droppedIds.length && !UNAPPROVED_STATUSES.has(resultStatus)) {
    return `this write drops approved behaviour scenarios (${droppedIds.join(', ')}). The person approved them: to change them, set the plan back to \`status: ready\` in the same write and ask the person again.`;
  }
  return null;
}
