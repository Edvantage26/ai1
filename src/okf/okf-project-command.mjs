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
  REQUIREMENT_STATES, setRequirementCheckCommand, verifyRequirements, isProjectContextEnabled, PROJECT_CONTEXT_MODULE_ID,
  setRequirementMilestone, buildRequirementsReview, stampRequirementsReview, mapSatisfyingConcepts,
  findAvoidedTermsInPlan, listTechnicalDecisions, addTechnicalDecision, setTechnicalDecisionState,
} from './okf-project.mjs';

export const OKF_PROJECT_USAGE = 'ai1 okf project init [--title "..."] | gaps [--json] | req add --title "..." [--statement "..."] [--priority must|should] [--state active|out-of-scope] [--check "..."] [--check-command "..."] [--supersedes <id>] [--milestone <name>] [--quote "..."] [--from <who>] [--reason "..."] | req milestone <id> <name> | review [--milestone <name>] [--json] [--done] | req set <id> <state> [--by <id>] [--quote "..."] [--reason "..."] [--plan <slug>] | req command <id> "<command>" | req list [--state <state>] [--json] | req goal <id> | verify [<id>] [--json] | decision add --title "..." [--decision "..."] [--why "..."] [--alternatives "a; b"] [--avoid "x; y"] [--from <who>] [--state proposed|accepted] [--quote "..."] | decision set <slug> <proposed|accepted|replaced> [--by <slug>] | decision list [--json] | question add --about <category> "<question>" | question assume <id> "<assumption>" | question answer <id> "<answer>" [--to <concept>] | question list [--json] | conflicts <plan-slug-or-path>';
const OPTIONS_WITH_VALUE = new Set(['--title', '--statement', '--priority', '--state', '--check', '--check-command', '--supersedes', '--milestone', '--by', '--quote', '--from', '--reason', '--plan', '--about', '--to', '--decision', '--why', '--alternatives', '--avoid']);

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

// The commands still run by hand when the repo switched requirements off; they say so once.
function describeModuleOff(projectRoot) {
  const loadedConfig = loadHarnessConfig(projectRoot);
  if (loadedConfig.status !== 'ok' || isProjectContextEnabled(loadedConfig.config)) return null;
  return `note: requirements are off in this repo (\`modules.${PROJECT_CONTEXT_MODULE_ID}: false\` in .ai1/config.json): nothing about them runs on its own; do not offer the interview.`;
}

const plainRequirementTitle = (requirement) => (requirement.title || requirement.id).replace(/^R\d+\s+/, '');

// The review as the agent reads it: per milestone what holds, what is still to build, what was left
// out and why (to re-check), what was replaced, and what has no command to prove it.
export function formatRequirementsReview(requirementsReview) {
  const lines = [`Requirements review (last: ${requirementsReview.lastReviewed || 'never'})`];
  if (!requirementsReview.milestones.length) return `${lines[0]}\nno requirements`;
  const listLine = (requirement) => `    ${requirement.id} ${plainRequirementTitle(requirement)}`;
  for (const milestoneReview of requirementsReview.milestones) {
    lines.push(`${milestoneReview.name}: ${milestoneReview.validated.length} validated, ${milestoneReview.active.length} active, ${milestoneReview.outOfScope.length} out of scope, ${milestoneReview.superseded.length} superseded`);
    if (milestoneReview.active.length) lines.push('  still to build:', ...milestoneReview.active.map(listLine));
    if (milestoneReview.outOfScope.length) lines.push('  out of scope (does the reason still hold?):', ...milestoneReview.outOfScope.map((requirement) => `${listLine(requirement)}${requirement.reason ? ` - ${requirement.reason}` : ''}`));
    if (milestoneReview.superseded.length) lines.push('  superseded:', ...milestoneReview.superseded.map((requirement) => `${listLine(requirement)} -> ${requirement.supersededBy}`));
    if (milestoneReview.withoutCheckCommand.length) lines.push('  in force without a check command:', ...milestoneReview.withoutCheckCommand.map(listLine));
  }
  lines.push('After going through it with the person: ai1 okf project review --done');
  return lines.join('\n');
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
      const moduleOffNote = describeModuleOff(projectRoot);
      if (options.json) printJson({ ...gapMap, enabled: !moduleOffNote });
      else writeOutput([moduleOffNote, formatGapMap(gapMap)].filter(Boolean).join('\n'));
      return 0;
    }
    if (subcommandName === 'req') {
      if (actionName === 'add') {
        const { id, relativePath } = addRequirement(bundleDirectory, {
          title: options.title, statement: options.statement, priority: options.priority || 'must', state: options.state || 'active',
          check: options.check, checkCommand: options['check-command'], supersedes: options.supersedes, milestone: options.milestone, quote: options.quote, from: options.from, reason: options.reason,
        });
        writeOutput(`${id}: created ${relativePath}${options.supersedes ? `; ${findRequirement(listRequirements(bundleDirectory), options.supersedes).id} superseded by ${id}` : ''}`);
        return 0;
      }
      if (actionName === 'set') {
        if (!firstArgument || !secondArgument) throw new Error('usage: ai1 okf project req set <id> <state> [--by <id>] [--quote "..."] [--reason "..."] [--plan <slug>]');
        const { id, previousState } = setRequirementState(bundleDirectory, firstArgument, secondArgument, { quote: options.quote, from: options.from, reason: options.reason, plan: options.plan, by: options.by });
        writeOutput(`${id}: ${previousState} -> ${secondArgument}`);
        return 0;
      }
      if (actionName === 'milestone') {
        const { id, previousMilestone } = setRequirementMilestone(bundleDirectory, firstArgument, positionalArguments.slice(3).join(' '));
        writeOutput(`${id}: milestone ${previousMilestone || 'none'} -> ${positionalArguments.slice(3).join(' ')}`);
        return 0;
      }
      if (actionName === 'command') {
        const { id } = setRequirementCheckCommand(bundleDirectory, firstArgument, positionalArguments.slice(3).join(' '));
        writeOutput(`${id}: check command set`);
        return 0;
      }
      if (actionName === 'list') {
        const satisfyingConcepts = mapSatisfyingConcepts(bundleDirectory);
        const requirements = listRequirements(bundleDirectory).filter((requirement) => !options.state || requirement.state === options.state)
          .map((requirement) => ({ ...requirement, satisfiedBy: satisfyingConcepts[requirement.id] || [] }));
        if (options.json) printJson(requirements);
        else writeOutput(requirements.map((requirement) => `${requirement.id} [${requirement.state}, ${requirement.priority}] ${(requirement.title || '').replace(/^R\d+\s+/, '')}${requirement.satisfiedBy.length ? ` <- ${requirement.satisfiedBy.join(', ')}` : ''}`).join('\n') || 'no requirements');
        return 0;
      }
      if (actionName === 'goal') {
        const requirement = findRequirement(listRequirements(bundleDirectory), firstArgument);
        if (!requirement) throw new Error(`no requirement ${firstArgument || '(missing id)'}`);
        writeOutput(buildGoalLine(requirement));
        return 0;
      }
    }
    if (subcommandName === 'review') {
      if (options.done) {
        writeOutput(`review recorded on ${stampRequirementsReview(bundleDirectory)} (requirements_reviewed)`);
        return 0;
      }
      const requirementsReview = buildRequirementsReview(bundleDirectory, { milestone: options.milestone || '' });
      if (options.json) printJson(requirementsReview);
      else writeOutput(formatRequirementsReview(requirementsReview));
      return 0;
    }
    if (subcommandName === 'verify') {
      const checkResults = verifyRequirements(bundleDirectory, projectRoot, { requirementId: actionName || '' });
      if (options.json) printJson(checkResults);
      else {
        writeOutput(checkResults.map((checkResult) => `${checkResult.id} ${checkResult.passed ? 'passes' : `FAILS (exit ${checkResult.exitCode})`}: ${checkResult.command}${checkResult.reopened ? ' - was validated, back to active' : ''}`).join('\n')
          || 'no active or validated requirement has a check command (ai1 okf project req command <id> "<command>")');
      }
      return checkResults.some((checkResult) => !checkResult.passed) ? 1 : 0;
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
      const planText = readPlanText(projectRoot, actionName);
      const conflictingRequirements = findOutOfScopeConflicts(planText, listRequirements(bundleDirectory));
      const avoidedTerms = findAvoidedTermsInPlan(planText, listTechnicalDecisions(bundleDirectory));
      const conflictLines = [
        ...(conflictingRequirements.length ? ['The plan may touch what is out of scope (advisory; tell the person before approval):', ...conflictingRequirements.map((requirement) => `- ${requirement.title} (${requirement.relativePath})`)] : []),
        ...(avoidedTerms.length ? ['The plan names what the technical vision says to avoid (advisory; tell the person before approval):', ...avoidedTerms.map((avoidedTerm) => `- ${avoidedTerm.term}: ${avoidedTerm.decision.title} (${avoidedTerm.decision.relativePath}, ${avoidedTerm.decision.decisionState})`)] : []),
      ];
      writeOutput(conflictLines.length ? conflictLines.join('\n') : 'no out-of-scope requirement nor avoided technology named in the plan');
      return 0;
    }
    if (subcommandName === 'decision') {
      if (actionName === 'add') {
        const { slug, relativePath } = addTechnicalDecision(bundleDirectory, {
          title: options.title, decision: options.decision, why: options.why, alternatives: options.alternatives, avoid: options.avoid,
          from: options.from, state: options.state || 'proposed', quote: options.quote,
        });
        writeOutput(`${slug}: created ${relativePath}`);
        return 0;
      }
      if (actionName === 'set') {
        if (!firstArgument || !secondArgument) throw new Error('usage: ai1 okf project decision set <slug> <proposed|accepted|replaced> [--by <slug>] [--quote "..."] [--from <who>] [--reason "..."]');
        const { slug, previousState } = setTechnicalDecisionState(bundleDirectory, firstArgument, secondArgument, { quote: options.quote, from: options.from, reason: options.reason, by: options.by });
        writeOutput(`${slug}: ${previousState} -> ${secondArgument}`);
        return 0;
      }
      if (actionName === 'list') {
        const technicalDecisions = listTechnicalDecisions(bundleDirectory);
        if (options.json) printJson(technicalDecisions);
        else writeOutput(technicalDecisions.map((technicalDecision) => `${technicalDecision.slug} [${technicalDecision.decisionState}${technicalDecision.from ? `, from ${technicalDecision.from}` : ''}] ${technicalDecision.title}${technicalDecision.avoid.length ? ` (avoid: ${technicalDecision.avoid.join(', ')})` : ''}`).join('\n') || 'no technical decisions');
        return 0;
      }
    }
  } catch (commandFailure) {
    writeError(`ai1 okf project: ${commandFailure.message}`);
    return 1;
  }
  writeError(`usage: ${OKF_PROJECT_USAGE}\ncategories: ${PROJECT_CATEGORIES.map((projectCategory) => projectCategory.id).join(', ')}`);
  return 2;
}
