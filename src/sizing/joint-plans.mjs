// Joint plans: one change across several repositories with ai1. The coordinator repo keeps the joint
// plan (goal, `# Contract`, order, joint scenarios, its own part) with `subplans:` (absolute paths); each
// other repo keeps its part as a sub-plan (`size: plan`) in its main checkout's `.ai1/work/<slug>/`, written
// by a design session started there (`ai1 delegate --design`), with `parent:` (the joint plan) and
// `contract:` (the hash of the joint plan's Contract section it was designed against). The person
// approves only the joint plan, and only while every sub-plan links back, is ready and carries the
// current contract hash; nothing here writes another repository's files.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { findMainCheckout, findWorkingTreeTop } from '../core/project-roots.mjs';
import { shortHash } from '../core/session-state.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { readPlanStatus } from './sizing-work.mjs';

function unquote(itemText) {
  return itemText.trim().replace(/^['"]|['"]$/g, '');
}

// A frontmatter list as items, inline (`[a, b]`) or as a block (`- a`); paths with spaces survive.
export function readFrontmatterList(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:[ \\t]*(.*)$`, 'm').exec(frontmatterText || '');
  if (!fieldMatch) return [];
  const inlineValue = fieldMatch[1].trim();
  if (inlineValue) return inlineValue.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  const blockItems = [];
  for (const blockLine of frontmatterText.slice(fieldMatch.index + fieldMatch[0].length).split(/\r?\n/).slice(1)) {
    const itemMatch = /^\s*-\s*(.+)$/.exec(blockLine);
    if (!itemMatch) break;
    blockItems.push(unquote(itemMatch[1]));
  }
  return blockItems;
}

function readScalar(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:[ \\t]*(.+)$`, 'm').exec(frontmatterText || '');
  return fieldMatch ? unquote(fieldMatch[1]) : '';
}

// { subplans, parent, contract } of a plan's frontmatter.
export function readJointFields(planText) {
  const { frontmatterText } = splitFrontmatter(planText);
  return { subplans: readFrontmatterList(frontmatterText, 'subplans'), parent: readScalar(frontmatterText, 'parent'), contract: readScalar(frontmatterText, 'contract') };
}

export function isJointPlan(planText) {
  return readJointFields(planText).subplans.length > 0;
}

// The hash of the plan's `# Contract` section (up to the next top-level heading), whitespace
// normalized, so only a change of the contract itself asks for a new consult; '' without the section.
export function hashContractSection(planText) {
  const { bodyText } = splitFrontmatter(planText);
  const sectionMatch = /^# Contract[ \t]*\r?\n([\s\S]*?)(?=^# |(?![\s\S]))/m.exec(bodyText || '');
  if (!sectionMatch) return '';
  return shortHash(sectionMatch[1].replace(/\s+/g, ' ').trim());
}

// A plan path as it lives in its repo's main checkout: a joint plan written from a worktree moves there
// when the worktree is finished, so links are compared in this form.
export function canonicalPlanPath(planPath) {
  const planDirectory = dirname(planPath);
  const workingTree = findWorkingTreeTop(planDirectory);
  if (!workingTree) return planPath;
  return join(findMainCheckout(workingTree), WORK_DIRECTORY, basename(planDirectory), basename(planPath));
}

// Each listed sub-plan of a joint plan: { path, repo, status, problem } with problem null (ok),
// 'missing', 'no-back-link', 'not-ready' (only when `requireReady`) or 'stale-contract'.
export function checkSubplans(jointPlanPath, { requireReady = true } = {}) {
  const jointPlanText = readFileSync(jointPlanPath, 'utf8');
  const currentContract = hashContractSection(jointPlanText);
  const jointCanonicalPath = canonicalPlanPath(jointPlanPath);
  return readJointFields(jointPlanText).subplans.map((subplanPath) => {
    const workingTree = findWorkingTreeTop(dirname(subplanPath));
    const repo = workingTree ? findMainCheckout(workingTree) : dirname(subplanPath);
    if (!existsSync(subplanPath)) return { path: subplanPath, repo, status: null, problem: 'missing' };
    const subplanText = readFileSync(subplanPath, 'utf8');
    const { parent, contract } = readJointFields(subplanText);
    const status = readPlanStatus(subplanText);
    let problem = null;
    if (!parent || canonicalPlanPath(parent) !== jointCanonicalPath) problem = 'no-back-link';
    else if (requireReady && status !== 'ready') problem = 'not-ready';
    else if (contract !== currentContract) problem = 'stale-contract';
    return { path: subplanPath, repo, status, problem };
  });
}

const PROBLEM_TEXTS = {
  missing: 'does not exist (consult that repo with `ai1 delegate --design`)',
  'no-back-link': 'does not name this joint plan in `parent:`',
  'not-ready': 'is not `status: ready`',
  'stale-contract': 'was designed against another version of `# Contract` (consult that repo again with `ai1 delegate --design`)',
};

export function describeSubplanProblem(subplanCheck) {
  return `\`${subplanCheck.path}\` (${subplanCheck.repo}) ${PROBLEM_TEXTS[subplanCheck.problem]}`;
}
