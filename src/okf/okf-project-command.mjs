// `ai1 okf project ...`: the project context of the bundle (src/okf/okf-project.mjs) from the command
// line, called by /ai1:okf-interview-project, the sizing design skill and by hand. Numbering, states,
// history and the requirements index are written only here.

import { existsSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { findRepoRoot } from '../cli/setup-repo.mjs';
import { loadHarnessConfig, WORK_DIRECTORY } from '../core/config.mjs';
import { resolveBundleDirectory } from './okf-bundle.mjs';
import {
  buildGapMap, initProjectContext, addRequirement, setRequirementState, listRequirements, findRequirement,
  addQuestion, settleQuestion, listQuestions, findOutOfScopeConflicts, buildGoalLine, PROJECT_CATEGORIES,
  REQUIREMENT_STATES,
} from './okf-project.mjs';

export const OKF_PROJECT_USAGE = 'ai1 okf project init [--title "..."] | gaps [--json] | req add --title "..." [--statement "..."] [--priority must|should] [--state active|out-of-scope] [--check "..."] [--quote "..."] [--reason "..."] | req set <id> <state> [--quote "..."] [--reason "..."] [--plan <slug>] | req list [--state <state>] [--json] | req goal <id> | question add --about <category> "<question>" | question assume <id> "<assumption>" | question answer <id> "<answer>" [--to <concept>] | question list [--json] | conflicts <plan-slug-or-path>';
const OPTIONS_WITH_VALUE = new Set(['--title', '--statement', '--priority', '--state', '--check', '--quote', '--reason', '--plan', '--about', '--to']);

function parseArguments(commandArguments) {
  const positionalArguments = [];
  const options = {};
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (OPTIONS_WITH_VALUE.has(commandArgument)) {
      options[commandArgument.slice(2)] = commandArguments[argumentIndex + 1] ?? '';
      argumentIndex += 1;
    } else if (commandArgument.startsWith('--')) {
      options[commandArgument.slice(2)] = true;
    } else {
      positionalArguments.push(commandArgument);
    }
  }
  return { positionalArguments, options };
}

function readVerifyCommands(projectRoot) {
  const loadedConfig = loadHarnessConfig(projectRoot);
  return loadedConfig.status === 'ok' ? loadedConfig.config.verify || [] : [];
}

export function formatGapMap(gapMap) {
  const statusMarks = { clear: '✓', partial: '~', missing: '✗' };
  const lines = [
    `Project context: ${gapMap.product ? `Product concept ${gapMap.product}` : 'no Product concept yet (ai1 okf project init)'}`,
    ...gapMap.categories.map((projectCategory) => `  ${statusMarks[projectCategory.status]} ${projectCategory.label}: ${projectCategory.status}${projectCategory.why ? ` (${projectCategory.why})` : ''}`),
  ];
  if (gapMap.others.length) lines.push(`warning: several Product concepts; using ${gapMap.product}, not ${gapMap.others.join(', ')}`);
  const countByState = Object.fromEntries(REQUIREMENT_STATES.map((requirementState) => [requirementState, gapMap.requirements.filter((requirement) => requirement.state === requirementState).length]));
  lines.push(`Requirements: ${REQUIREMENT_STATES.map((requirementState) => `${countByState[requirementState]} ${requirementState}`).join(', ')}`);
  lines.push(`Open questions: ${gapMap.questions.filter((question) => question.status === 'open').length} open, ${gapMap.questions.filter((question) => question.status === 'assumed').length} assumed`);
  return lines.join('\n');
}

// The plan file of a slug (`.ai1/work/<slug>/plan.md` in this checkout) or a path given as is.
function readPlanText(projectRoot, planReference) {
  const candidatePaths = [
    isAbsolute(planReference) ? planReference : join(projectRoot, planReference),
    join(projectRoot, WORK_DIRECTORY, planReference, 'plan.md'),
  ];
  const planPath = candidatePaths.find((candidatePath) => existsSync(candidatePath) && basename(candidatePath).endsWith('.md'));
  if (!planPath) throw new Error(`no plan at ${planReference} nor ${WORK_DIRECTORY}/${planReference}/plan.md`);
  return readFileSync(planPath, 'utf8');
}

// Prints the result and returns the exit code.
export function runOkfProjectCommand(workingDirectory, commandArguments, writeOutput = console.log, writeError = console.error) {
  const projectRoot = findRepoRoot(workingDirectory);
  const bundleDirectory = resolveBundleDirectory(projectRoot);
  const { positionalArguments, options } = parseArguments(commandArguments);
  const [subcommandName, actionName, firstArgument, secondArgument] = positionalArguments;
  const printJson = (value) => writeOutput(JSON.stringify(value, null, 2));
  try {
    if (subcommandName === 'init') {
      const writtenPaths = initProjectContext(bundleDirectory, { projectTitle: options.title || basename(projectRoot) });
      writeOutput(writtenPaths.map((writtenPath) => `wrote ${writtenPath}`).join('\n'));
      return 0;
    }
    if (subcommandName === 'gaps') {
      const gapMap = buildGapMap(bundleDirectory, { verifyCommands: readVerifyCommands(projectRoot) });
      if (options.json) printJson(gapMap);
      else writeOutput(formatGapMap(gapMap));
      return 0;
    }
    if (subcommandName === 'req') {
      if (actionName === 'add') {
        const { id, relativePath } = addRequirement(bundleDirectory, {
          title: options.title, statement: options.statement, priority: options.priority || 'must', state: options.state || 'active',
          check: options.check, quote: options.quote, reason: options.reason,
        });
        writeOutput(`${id}: created ${relativePath}`);
        return 0;
      }
      if (actionName === 'set') {
        if (!firstArgument || !secondArgument) throw new Error('usage: ai1 okf project req set <id> <state> [--quote "..."] [--reason "..."] [--plan <slug>]');
        const { id, previousState } = setRequirementState(bundleDirectory, firstArgument, secondArgument, { quote: options.quote, reason: options.reason, plan: options.plan });
        writeOutput(`${id}: ${previousState} -> ${secondArgument}`);
        return 0;
      }
      if (actionName === 'list') {
        const requirements = listRequirements(bundleDirectory).filter((requirement) => !options.state || requirement.state === options.state);
        if (options.json) printJson(requirements);
        else writeOutput(requirements.map((requirement) => `${requirement.id} [${requirement.state}, ${requirement.priority}] ${(requirement.title || '').replace(/^R\d+\s+/, '')}`).join('\n') || 'no requirements');
        return 0;
      }
      if (actionName === 'goal') {
        const requirement = findRequirement(listRequirements(bundleDirectory), firstArgument);
        if (!requirement) throw new Error(`no requirement ${firstArgument || '(missing id)'}`);
        writeOutput(buildGoalLine(requirement));
        return 0;
      }
    }
    if (subcommandName === 'question') {
      if (actionName === 'add') {
        const { id } = addQuestion(bundleDirectory, { text: positionalArguments.slice(2).join(' '), about: options.about || '' });
        writeOutput(`${id}: open`);
        return 0;
      }
      if (actionName === 'assume' || actionName === 'answer') {
        const settledText = positionalArguments.slice(3).join(' ');
        const { id } = settleQuestion(bundleDirectory, firstArgument, { status: actionName === 'assume' ? 'assumed' : 'answered', text: settledText, where: options.to || '' });
        writeOutput(`${id}: ${actionName === 'assume' ? 'assumed' : 'answered'}`);
        return 0;
      }
      if (actionName === 'list') {
        const questions = listQuestions(bundleDirectory);
        if (options.json) printJson(questions);
        else writeOutput(questions.map((question) => `${question.id} [${question.status}${question.about ? `, ${question.about}` : ''}] ${question.text}`).join('\n') || 'no questions');
        return 0;
      }
    }
    if (subcommandName === 'conflicts') {
      if (!actionName) throw new Error('usage: ai1 okf project conflicts <plan-slug-or-path>');
      const conflictingRequirements = findOutOfScopeConflicts(readPlanText(projectRoot, actionName), listRequirements(bundleDirectory));
      writeOutput(conflictingRequirements.length
        ? ['The plan may touch what is out of scope (advisory; tell the person before approval):', ...conflictingRequirements.map((requirement) => `- ${requirement.title} (${requirement.relativePath})`)].join('\n')
        : 'no out-of-scope requirement named in the plan');
      return 0;
    }
  } catch (commandFailure) {
    writeError(`ai1 okf project: ${commandFailure.message}`);
    return 1;
  }
  writeError(`usage: ${OKF_PROJECT_USAGE}\ncategories: ${PROJECT_CATEGORIES.map((projectCategory) => projectCategory.id).join(', ')}`);
  return 2;
}
