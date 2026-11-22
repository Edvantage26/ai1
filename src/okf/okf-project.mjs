// Project context in the knowledge bundle: what the agent must know of any project before working on
// it, kept as ai1 conventions on top of OKF (the spec only demands `type`):
// - `product.md` (`type: Product`, shared with the design feature): one `## <heading>` per category.
// - `requirements/R<nnn>-<slug>.md` (`type: Requirement`): one requirement each, its `state`
//   (active | validated | out-of-scope | superseded; `status` is reserved by OKF §5.4), `priority`,
//   `check` (how to prove it, usable as a /goal condition), an optional `check_command` that proves it
//   (run by `ai1 okf project verify` and `ai1 plan-done`), `superseded_by` and a `# History` of dated
//   changes quoting the person.
// - `requirements/questions.md` (`type: OpenQuestions`): `## Q<nn>: <question>` with status open |
//   assumed | answered.
// - `requirements/index.md`: generated list of the requirements by state.
// - `operations.md` (`type: Operations`): how the project runs in production, one `## <heading>` per
//   topic (deploy, environments, logs, database, access, monitoring, alerts), naming where each secret
//   lives, never its value.
// The gap map (clear / partial / missing per category) is computed here, without a model, and read by
// the okf-project SessionStart hook and the `ai1 okf project` CLI; every write goes through these
// functions so numbering, states and history follow one set of rules.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { splitFrontmatter, readFrontmatterField, writeFrontmatterField } from '../core/frontmatter.mjs';
import { listBundleConcepts } from './okf-bundle.mjs';
import { isModuleEnabled } from '../core/config.mjs';

// The one switch of everything about requirements in a repo: `"modules": { "okf-project": false }`
// turns off the session-start lines, the prompt and edit hints, the review task, the setup offer and
// plan-done's requirement notes; okf itself keeps working, and `ai1 okf project` still runs by hand.
export const PROJECT_CONTEXT_MODULE_ID = 'okf-project';
export function isProjectContextEnabled(config) {
  return Boolean(config) && isModuleEnabled({ id: PROJECT_CONTEXT_MODULE_ID, feature: 'okf' }, config);
}

export const PRODUCT_FILE = 'product.md';
export const REQUIREMENTS_DIRECTORY = 'requirements';
export const QUESTIONS_FILE = 'questions.md';
const REQUIREMENTS_INDEX_FILE = 'index.md';
export const REQUIREMENT_STATES = ['active', 'validated', 'out-of-scope', 'superseded'];
// The ones the project must do, whose check command is worth running.
const CHECKED_STATES = new Set(['active', 'validated']);
const CHECK_COMMAND_TIMEOUT_MILLISECONDS = 10 * 60 * 1000;
export const REQUIREMENT_PRIORITIES = ['must', 'should'];
export const QUESTION_STATUSES = ['open', 'assumed', 'answered'];
const WRITER_ACTOR = 'process:ai1-okf-project';
const REQUIREMENT_FILE_PATTERN = /^R(\d{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const QUESTION_HEADING_PATTERN = /^## (Q\d{2,}): (.*)$/;
const PLACEHOLDER_PATTERN = /\b(TBD|TODO)\b|^\?+$/i;

// The categories of the gap map, in the order they are asked and shown. `heading` is the section of
// the Product concept that answers it.
export const PROJECT_CATEGORIES = [
  { id: 'purpose', heading: 'Purpose', label: 'purpose' },
  { id: 'users', heading: 'Users', label: 'users' },
  { id: 'scope', heading: 'Scope', label: 'scope (what is out)' },
  { id: 'constraints', heading: 'Constraints', label: 'constraints' },
  { id: 'stack', heading: 'Stack', label: 'stack and structure' },
  { id: 'technical-vision', heading: 'Technical vision', label: 'technical vision' },
  { id: 'run-test', heading: 'Run and test', label: 'run and test' },
  { id: 'deploy', heading: 'Deploy', label: 'deploy' },
  { id: 'operations', heading: 'Operations', label: 'operations', conceptType: 'Operations' },
  { id: 'integrations-data', heading: 'Integrations and data', label: 'integrations and data' },
  { id: 'decision-makers', heading: 'Decision makers', label: 'decision makers' },
];
const CATEGORY_IDS = new Set(PROJECT_CATEGORIES.map((projectCategory) => projectCategory.id));

export function todayDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function nowTimestamp(now = new Date()) {
  return `${now.toISOString().slice(0, 19)}Z`;
}

export function padRequirementNumber(requirementNumber) {
  return `R${String(requirementNumber).padStart(3, '0')}`;
}

function padQuestionNumber(questionNumber) {
  return `Q${String(questionNumber).padStart(2, '0')}`;
}

// A frontmatter scalar that YAML reads back as the same string.
function yamlString(text) {
  return JSON.stringify(String(text).replace(/\s+/g, ' ').trim());
}

// A frontmatter scalar as written by yamlString: a double-quoted value is read back with its escapes
// (a check command with quotes must run as written); anything else as readFrontmatterField reads it.
function readYamlScalar(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:[ \\t]*(".*")[ \\t]*$`, 'm').exec(frontmatterText || '');
  if (fieldMatch) {
    try {
      return JSON.parse(fieldMatch[1]);
    } catch {
      // Not JSON-compatible YAML: fall back to the plain read below.
    }
  }
  return readFrontmatterField(frontmatterText, fieldName);
}

// The person's words in a history line, and who said them (`--from client`, `--from developer`): a
// client's word makes a requirement, a developer's preference a technical decision.
function quoteLine(quoteText, fromText = '') {
  const fromPart = String(fromText || '').trim() ? ` (${String(fromText).trim()})` : '';
  return quoteText ? `: "${String(quoteText).replace(/\s+/g, ' ').trim()}"${fromPart}` : fromPart;
}

// --- Product concept ---------------------------------------------------------------------------

// The Product concept: `product.md` when it is one, else the first `type: Product` by path.
// { relativePath, bodyText, others } or null.
export function findProductConcept(bundleDirectory, bundleConcepts = listBundleConcepts(bundleDirectory)) {
  const productConcepts = bundleConcepts.filter((bundleConcept) => bundleConcept.type === 'Product')
    .sort((firstConcept, secondConcept) => firstConcept.relativePath.localeCompare(secondConcept.relativePath));
  if (!productConcepts.length) return null;
  const chosenConcept = productConcepts.find((bundleConcept) => bundleConcept.relativePath === PRODUCT_FILE) || productConcepts[0];
  return { ...chosenConcept, others: productConcepts.filter((bundleConcept) => bundleConcept !== chosenConcept).map((bundleConcept) => bundleConcept.relativePath) };
}

// The text under `## <heading>` (any heading level 2, case-insensitive), up to the next level-2 heading.
export function readSectionText(bodyText, heading) {
  const lines = String(bodyText || '').split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (headingIndex < 0) return null;
  const sectionLines = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (/^## /.test(line)) break;
    sectionLines.push(line);
  }
  return sectionLines.join('\n').trim();
}

const PRODUCT_TEMPLATE = (projectTitle, now) => [
  '---',
  'type: Product',
  `title: ${yamlString(`${projectTitle} - product`)}`,
  `description: ${yamlString(`What ${projectTitle} is for, who uses it, its scope and constraints, how it runs and ships, and who decides.`)}`,
  'tags: [product, project-context]',
  'project_context: true',
  `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
  '---',
  '',
  ...PROJECT_CATEGORIES.filter((projectCategory) => !projectCategory.conceptType).flatMap((projectCategory) => [`## ${projectCategory.heading}`, '', '']),
].join('\n').trimEnd() + '\n';

// --- Operations concept ------------------------------------------------------------------------

export const OPERATIONS_FILE = 'operations.md';
// The topics of the Operations concept, in order, with the hint the template leaves under each.
export const OPERATIONS_SECTIONS = [
  { heading: 'Deploy', hint: 'How a change reaches production (pipeline, platform, command) and how to roll back.' },
  { heading: 'Environments', hint: 'Each environment, its URL and where it runs (host, platform, project).' },
  { heading: 'Logs', hint: 'How to read production logs and errors (command, dashboard, stream).' },
  { heading: 'Database', hint: 'How to reach each database (tunnel, port, client) and where its backups go.' },
  { heading: 'Access', hint: 'How to get into the servers or containers (SSH alias, console) and who can.' },
  { heading: 'Monitoring', hint: 'What is watched (uptime, jobs, backups) and where.' },
  { heading: 'Alerts', hint: 'Where alerts go (channel) and who acts on them.' },
];

// A section with something written in it: the template's hint comments do not count.
function hasSectionContent(sectionText) {
  return Boolean(String(sectionText || '').replace(/<!--[\s\S]*?-->/g, '').trim());
}

// The Operations concept: `operations.md` when it is one, else the first `type: Operations` by path.
export function findOperationsConcept(bundleDirectory, bundleConcepts = listBundleConcepts(bundleDirectory)) {
  const operationsConcepts = bundleConcepts.filter((bundleConcept) => bundleConcept.type === 'Operations')
    .sort((firstConcept, secondConcept) => firstConcept.relativePath.localeCompare(secondConcept.relativePath));
  return operationsConcepts.find((bundleConcept) => bundleConcept.relativePath === OPERATIONS_FILE) || operationsConcepts[0] || null;
}

// Which topics of the Operations concept are written, empty, or only a placeholder.
function describeOperationsSections(operationsConcept) {
  const sectionTexts = OPERATIONS_SECTIONS.map((operationsSection) => ({ heading: operationsSection.heading, text: readSectionText(operationsConcept.bodyText, operationsSection.heading) }));
  return {
    empty: sectionTexts.filter((sectionText) => !hasSectionContent(sectionText.text)).map((sectionText) => sectionText.heading),
    placeholder: sectionTexts.filter((sectionText) => hasSectionContent(sectionText.text) && PLACEHOLDER_PATTERN.test(sectionText.text.replace(/<!--[\s\S]*?-->/g, ''))).map((sectionText) => sectionText.heading),
  };
}

const OPERATIONS_TEMPLATE = (projectTitle, now) => [
  '---',
  'type: Operations',
  `title: ${yamlString(`${projectTitle} - operations`)}`,
  `description: ${yamlString(`How ${projectTitle} is deployed and run in production: environments, logs, databases, access, monitoring and alerts.`)}`,
  'tags: [operations, project-context]',
  `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
  '---',
  '',
  'The exact command or place for each topic. Secrets: name where each one lives (secret manager item,',
  'platform environment), never its value. Write "none" when the project has no such thing.',
  '',
  ...OPERATIONS_SECTIONS.flatMap((operationsSection) => [`## ${operationsSection.heading}`, '', `<!-- ${operationsSection.hint} -->`, '']),
].join('\n').trimEnd() + '\n';

// --- Requirements ------------------------------------------------------------------------------

function requirementsDirectory(bundleDirectory) {
  return join(bundleDirectory, REQUIREMENTS_DIRECTORY);
}

// Every requirement file: { id, number, slug, fileName, relativePath, title, state, priority, check,
// checkCommand, validatedBy, supersededBy, statement }.
export function listRequirements(bundleDirectory) {
  const directoryPath = requirementsDirectory(bundleDirectory);
  if (!existsSync(directoryPath)) return [];
  const requirements = [];
  for (const fileName of readdirSync(directoryPath)) {
    const fileMatch = REQUIREMENT_FILE_PATTERN.exec(fileName);
    if (!fileMatch) continue;
    const { frontmatterText, bodyText } = splitFrontmatter(readFileSync(join(directoryPath, fileName), 'utf8'));
    const readField = (fieldName) => readYamlScalar(frontmatterText, fieldName);
    requirements.push({
      id: padRequirementNumber(Number(fileMatch[1])),
      number: Number(fileMatch[1]),
      slug: fileMatch[2],
      fileName,
      relativePath: `${REQUIREMENTS_DIRECTORY}/${fileName}`,
      title: readField('title'),
      state: readField('state') || 'active',
      priority: readField('priority') || 'must',
      check: readField('check'),
      checkCommand: readField('check_command'),
      supersededBy: readField('superseded_by'),
      milestone: readField('milestone'),
      validatedBy: readField('validated_by').split(/[\s,]+/).filter(Boolean),
      statement: bodyText.split(/^# History/m)[0].trim(),
      historyLines: (bodyText.split(/^# History[^\n]*$/m)[1] || '').split(/\r?\n/).filter((line) => /^- \d{4}-\d{2}-\d{2} /.test(line)),
    });
  }
  return requirements.sort((firstRequirement, secondRequirement) => firstRequirement.number - secondRequirement.number);
}

export function findRequirement(requirements, requirementId) {
  const wantedNumber = Number(String(requirementId || '').replace(/^R/i, ''));
  return requirements.find((requirement) => requirement.number === wantedNumber) || null;
}

function slugFromTitle(titleText) {
  return String(titleText).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').split('-').slice(0, 6).join('-') || 'requirement';
}

// Adds a dated line at the end of the `# History` section (created when missing).
function appendHistoryLine(conceptText, historyLine) {
  const trimmedText = conceptText.trimEnd();
  if (!/^# History\s*$/m.test(trimmedText)) return `${trimmedText}\n\n# History\n\n${historyLine}\n`;
  return `${trimmedText}\n${historyLine}\n`;
}

// Creates `requirements/R<nnn>-<slug>.md` and refreshes the index. Returns { id, relativePath }.
// `supersedes`: the new requirement replaces that one, which becomes superseded by it.
export function addRequirement(bundleDirectory, { title, statement = '', priority = 'must', state = 'active', check = '', checkCommand = '', supersedes = '', milestone = '', quote = '', from = '', reason = '', now = new Date() }) {
  if (!String(title || '').trim()) throw new Error('a requirement needs --title "<what must hold>"');
  if (!REQUIREMENT_PRIORITIES.includes(priority)) throw new Error(`priority must be one of ${REQUIREMENT_PRIORITIES.join(', ')}`);
  if (!REQUIREMENT_STATES.includes(state)) throw new Error(`state must be one of ${REQUIREMENT_STATES.join(', ')}`);
  if (state === 'out-of-scope' && !String(reason).trim()) throw new Error('an out-of-scope requirement needs --reason "<why it is out>"');
  if (state === 'superseded') throw new Error('a new requirement cannot start superseded; add the new one with --supersedes <id>');
  const requirements = listRequirements(bundleDirectory);
  const supersededRequirement = supersedes ? findRequirement(requirements, supersedes) : null;
  if (supersedes && !supersededRequirement) throw new Error(`no requirement ${supersedes} to supersede`);
  const requirementNumber = Math.max(0, ...requirements.map((requirement) => requirement.number)) + 1;
  const requirementId = padRequirementNumber(requirementNumber);
  const fileName = `${requirementId}-${slugFromTitle(title)}.md`;
  const historyDetail = [supersededRequirement ? `replaces ${supersededRequirement.id}` : '', String(reason).trim()].filter(Boolean).join('; ');
  const historyLine = `- ${todayDate(now)} ${state}${historyDetail ? ` (${historyDetail})` : ''}${quoteLine(quote, from)}`;
  const conceptText = [
    '---',
    'type: Requirement',
    `title: ${yamlString(`${requirementId} ${title}`)}`,
    `description: ${yamlString(String(statement || title))}`,
    `tags: [requirement, ${state}]`,
    `id: ${requirementId}`,
    `state: ${state}`,
    `priority: ${priority}`,
    ...(String(milestone).trim() ? [`milestone: ${yamlString(String(milestone).trim())}`] : []),
    ...(check ? [`check: ${yamlString(check)}`] : []),
    ...(checkCommand ? [`check_command: ${yamlString(checkCommand)}`] : []),
    `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
    '---',
    '',
    String(statement || title).trim(),
    '',
    '# History',
    '',
    historyLine,
    '',
  ].join('\n');
  mkdirSync(requirementsDirectory(bundleDirectory), { recursive: true });
  writeFileSync(join(requirementsDirectory(bundleDirectory), fileName), conceptText);
  if (supersededRequirement) setRequirementState(bundleDirectory, supersededRequirement.id, 'superseded', { by: requirementId, quote, from, reason, now });
  writeRequirementsIndex(bundleDirectory);
  return { id: requirementId, relativePath: `${REQUIREMENTS_DIRECTORY}/${fileName}` };
}

// Changes a requirement's state (and its history), keeping what it said before. `plan` adds the plan
// slug to `validated_by`; `by` names the requirement that supersedes it. Returns { id, relativePath, previousState }.
export function setRequirementState(bundleDirectory, requirementId, newState, { quote = '', from = '', reason = '', plan = '', by = '', now = new Date() } = {}) {
  if (!REQUIREMENT_STATES.includes(newState)) throw new Error(`state must be one of ${REQUIREMENT_STATES.join(', ')}`);
  if (newState === 'out-of-scope' && !String(reason).trim()) throw new Error('moving a requirement out of scope needs --reason "<why>"');
  const requirements = listRequirements(bundleDirectory);
  const requirement = findRequirement(requirements, requirementId);
  if (!requirement) throw new Error(`no requirement ${requirementId} in ${REQUIREMENTS_DIRECTORY}/`);
  const replacingRequirement = by ? findRequirement(requirements, by) : null;
  if (newState === 'superseded' && (!replacingRequirement || replacingRequirement.id === requirement.id)) throw new Error('superseded needs --by <id> naming the requirement that replaces it (add it first, or use req add --supersedes)');
  const filePath = join(bundleDirectory, requirement.relativePath);
  let conceptText = readFileSync(filePath, 'utf8');
  conceptText = writeFrontmatterField(conceptText, 'state', newState);
  conceptText = writeFrontmatterField(conceptText, 'tags', `[requirement, ${newState}]`);
  if (newState === 'superseded') conceptText = writeFrontmatterField(conceptText, 'superseded_by', replacingRequirement.id);
  if (plan) conceptText = writeFrontmatterField(conceptText, 'validated_by', `[${[...new Set([...requirement.validatedBy, plan])].join(', ')}]`);
  conceptText = writeFrontmatterField(conceptText, 'generated', `{ by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`);
  const detailText = [plan ? `plan ${plan}` : '', newState === 'superseded' ? `by ${replacingRequirement.id}` : '', String(reason).trim()].filter(Boolean).join('; ');
  conceptText = appendHistoryLine(conceptText, `- ${todayDate(now)} ${requirement.state} -> ${newState}${detailText ? ` (${detailText})` : ''}${quoteLine(quote, from)}`);
  writeFileSync(filePath, conceptText);
  writeRequirementsIndex(bundleDirectory);
  return { id: requirement.id, relativePath: requirement.relativePath, previousState: requirement.state };
}

export function renderRequirementsIndex(requirements, hasQuestions = false, technicalDecisions = []) {
  const lines = ['# Requirements', '', 'Generated by `ai1 okf project`; change requirements with `ai1 okf project req add|set`, not by hand.', ''];
  for (const requirementState of REQUIREMENT_STATES) {
    const stateRequirements = requirements.filter((requirement) => requirement.state === requirementState);
    if (!stateRequirements.length) continue;
    lines.push(`## ${requirementState}`, '');
    for (const requirement of stateRequirements) lines.push(`* [${requirement.title || requirement.id}](${requirement.fileName}) - ${requirement.supersededBy ? `superseded by ${requirement.supersededBy}` : requirement.priority}`);
    lines.push('');
  }
  if (technicalDecisions.length) {
    lines.push('## Technical vision', '');
    for (const technicalDecision of technicalDecisions) lines.push(`* [${technicalDecision.title}](../${technicalDecision.relativePath}) - ${technicalDecision.decisionState}${technicalDecision.from ? `, from ${technicalDecision.from}` : ''}`);
    lines.push('');
  }
  if (hasQuestions) lines.push('* [Open questions](questions.md)', '');
  return lines.join('\n');
}

export function writeRequirementsIndex(bundleDirectory) {
  mkdirSync(requirementsDirectory(bundleDirectory), { recursive: true });
  const indexPath = join(requirementsDirectory(bundleDirectory), REQUIREMENTS_INDEX_FILE);
  writeFileSync(indexPath, renderRequirementsIndex(listRequirements(bundleDirectory), existsSync(questionsPath(bundleDirectory)), listTechnicalDecisions(bundleDirectory)));
  return `${REQUIREMENTS_DIRECTORY}/${REQUIREMENTS_INDEX_FILE}`;
}

// The /goal line for a requirement: its title, and its check as the proof.
export function buildGoalLine(requirement) {
  const titleText = (requirement.title || requirement.id).replace(/^R\d+\s+/, '');
  return `/goal ${requirement.id} ${titleText}${requirement.check ? `; done when ${requirement.check}` : ''}`;
}

// Which concepts declare they serve each requirement (`satisfies: [R004]`): { R004: ['payments.md'] }.
export function mapSatisfyingConcepts(bundleDirectory) {
  const satisfyingConcepts = {};
  for (const bundleConcept of listBundleConcepts(bundleDirectory)) {
    for (const requirementId of readFrontmatterField(bundleConcept.frontmatterText, 'satisfies').split(/[\s,]+/).filter(Boolean)) {
      const normalizedId = padRequirementNumber(Number(requirementId.replace(/^R/i, '')));
      satisfyingConcepts[normalizedId] = [...(satisfyingConcepts[normalizedId] || []), bundleConcept.relativePath.split('\\').join('/')];
    }
  }
  return satisfyingConcepts;
}

// How well the bundle links code to requirements, as a report only (nothing nags or blocks): validated
// requirements no concept says it satisfies (built, but where and how is not written), and `satisfies`
// links to requirements that do not exist, are out of scope or were superseded (stale links, or code
// that is no longer wanted). { validatedWithoutConcept: [requirement], staleLinks: [{ concept, id, reason }] }.
export function checkSatisfiesLinks(bundleDirectory, requirements = listRequirements(bundleDirectory)) {
  const satisfyingConcepts = mapSatisfyingConcepts(bundleDirectory);
  const staleLinks = [];
  for (const [requirementId, conceptPaths] of Object.entries(satisfyingConcepts)) {
    const requirement = findRequirement(requirements, requirementId);
    const reason = !requirement ? 'no such requirement' : ['out-of-scope', 'superseded'].includes(requirement.state) ? requirement.state : '';
    if (reason) staleLinks.push(...conceptPaths.map((conceptPath) => ({ concept: conceptPath, id: requirementId, reason })));
  }
  return {
    validatedWithoutConcept: requirements.filter((requirement) => requirement.state === 'validated' && !satisfyingConcepts[requirement.id]),
    staleLinks,
  };
}

// --- Milestones and review ---------------------------------------------------------------------

// Puts a requirement in a milestone (free text: v1, v2, "launch"...). Returns { id, previousMilestone }.
export function setRequirementMilestone(bundleDirectory, requirementId, milestone, { now = new Date() } = {}) {
  const milestoneName = String(milestone || '').trim();
  if (!milestoneName) throw new Error('req milestone needs the milestone name, e.g. v1');
  const requirement = findRequirement(listRequirements(bundleDirectory), requirementId);
  if (!requirement) throw new Error(`no requirement ${requirementId} in ${REQUIREMENTS_DIRECTORY}/`);
  const filePath = join(bundleDirectory, requirement.relativePath);
  let conceptText = writeFrontmatterField(readFileSync(filePath, 'utf8'), 'milestone', yamlString(milestoneName));
  conceptText = writeFrontmatterField(conceptText, 'generated', `{ by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`);
  writeFileSync(filePath, appendHistoryLine(conceptText, `- ${todayDate(now)} milestone: ${requirement.milestone || 'none'} -> ${milestoneName}`));
  writeRequirementsIndex(bundleDirectory);
  return { id: requirement.id, previousMilestone: requirement.milestone };
}

// The reason a requirement was put out of scope: the parenthesis of its last history line into that state.
function readOutOfScopeReason(requirement) {
  const outLine = [...requirement.historyLines].reverse().find((historyLine) => /(^- \d{4}-\d{2}-\d{2} out-of-scope|-> out-of-scope)/.test(historyLine));
  const reasonMatch = /out-of-scope \(([^)]*)\)/.exec(outLine || '');
  return reasonMatch ? reasonMatch[1] : '';
}

const NO_MILESTONE = '(no milestone)';

// What a review of the requirements looks at, per milestone (in order of first appearance, requirements
// without one last): { lastReviewed, milestones: [{ name, validated, active, outOfScope: [{ ..., reason }],
// superseded, withoutCheckCommand }] }. Read-only; the judgement is the interview skill's review mode.
export function buildRequirementsReview(bundleDirectory, { milestone = '' } = {}) {
  const requirements = listRequirements(bundleDirectory).filter((requirement) => !milestone || requirement.milestone === milestone);
  const milestoneNames = [...new Set(requirements.map((requirement) => requirement.milestone || NO_MILESTONE))]
    .sort((firstName, secondName) => (firstName === NO_MILESTONE) - (secondName === NO_MILESTONE));
  const product = existsSync(bundleDirectory) ? findProductConcept(bundleDirectory) : null;
  return {
    lastReviewed: readFrontmatterField(product?.frontmatterText, 'requirements_reviewed'),
    links: checkSatisfiesLinks(bundleDirectory),
    milestones: milestoneNames.map((milestoneName) => {
      const milestoneRequirements = requirements.filter((requirement) => (requirement.milestone || NO_MILESTONE) === milestoneName);
      const inState = (requirementState) => milestoneRequirements.filter((requirement) => requirement.state === requirementState);
      return {
        name: milestoneName,
        validated: inState('validated'),
        active: inState('active'),
        outOfScope: inState('out-of-scope').map((requirement) => ({ ...requirement, reason: readOutOfScopeReason(requirement) })),
        superseded: inState('superseded'),
        withoutCheckCommand: milestoneRequirements.filter((requirement) => CHECKED_STATES.has(requirement.state) && !requirement.checkCommand),
      };
    }),
  };
}

// `review --done`: one date for the whole project on the Product concept (`requirements_reviewed`),
// the start of the periodic review's count. Returns the Product concept's path.
export function stampRequirementsReview(bundleDirectory, { now = new Date() } = {}) {
  const product = existsSync(bundleDirectory) ? findProductConcept(bundleDirectory) : null;
  if (!product) throw new Error('no Product concept to stamp the review on: run ai1 okf project init first');
  const productPath = join(bundleDirectory, product.relativePath);
  writeFileSync(productPath, writeFrontmatterField(readFileSync(productPath, 'utf8'), 'requirements_reviewed', todayDate(now)));
  return product.relativePath.split('\\').join('/');
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
export const REVIEW_THRESHOLDS = { closedPlans: 5, requirementChanges: 3, days: 90 };

// How much changed since the last review, for the requirements-review maintenance task: null when the
// project context has not started. `since`: `requirements_reviewed`, else the earliest history date.
// Changes: history lines after that day, creation lines (without `->`) left out, so a project whose
// requirements were all just added counts none. Plans: `status: done` in `<workRoot>/.ai1/work/`,
// modified after that day. { since, closedPlans, requirementChanges, days, due }.
export function measureChangesSinceReview(bundleDirectory, workRoot, { now = new Date() } = {}) {
  const gapMap = buildGapMap(bundleDirectory);
  if (!gapMap.started) return null;
  const historyDates = gapMap.requirements.flatMap((requirement) => requirement.historyLines.map((historyLine) => ({ date: historyLine.slice(2, 12), isChange: historyLine.includes('->') })));
  const reviewedDate = buildRequirementsReview(bundleDirectory).lastReviewed;
  const since = /^\d{4}-\d{2}-\d{2}$/.test(reviewedDate) ? reviewedDate : historyDates.map((historyDate) => historyDate.date).sort()[0];
  if (!since) return null;
  const sinceEndMilliseconds = Date.parse(`${since}T00:00:00Z`) + DAY_MILLISECONDS;
  const requirementChanges = historyDates.filter((historyDate) => historyDate.isChange && historyDate.date > since).length;
  const workDirectory = join(workRoot, '.ai1', 'work');
  const closedPlans = existsSync(workDirectory) ? readdirSync(workDirectory).filter((planSlug) => {
    const planPath = join(workDirectory, planSlug, 'plan.md');
    if (!existsSync(planPath)) return false;
    const planText = readFileSync(planPath, 'utf8');
    return readFrontmatterField(splitFrontmatter(planText).frontmatterText, 'status') === 'done' && statSync(planPath).mtimeMs >= sinceEndMilliseconds;
  }).length : 0;
  const days = Math.floor((now.getTime() - Date.parse(`${since}T00:00:00Z`)) / DAY_MILLISECONDS);
  const due = closedPlans >= REVIEW_THRESHOLDS.closedPlans || requirementChanges >= REVIEW_THRESHOLDS.requirementChanges || days >= REVIEW_THRESHOLDS.days;
  return { since, closedPlans, requirementChanges, days, due };
}

// --- Open questions ----------------------------------------------------------------------------

function questionsPath(bundleDirectory) {
  return join(requirementsDirectory(bundleDirectory), QUESTIONS_FILE);
}

const QUESTIONS_HEADER = (now) => [
  '---',
  'type: OpenQuestions',
  'title: Open questions',
  'description: What the agent asked and the person could not answer yet, and the assumptions it works with until they do.',
  'tags: [project-context, questions]',
  `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
  '---',
  '',
  'Change it with `ai1 okf project question add|assume|answer`, not by hand.',
  '',
].join('\n');

// Every question: { id, number, text, status, about, asked, assumption, answer }.
export function listQuestions(bundleDirectory) {
  const filePath = questionsPath(bundleDirectory);
  if (!existsSync(filePath)) return [];
  const questions = [];
  let currentQuestion = null;
  for (const line of splitFrontmatter(readFileSync(filePath, 'utf8')).bodyText.split(/\r?\n/)) {
    const headingMatch = QUESTION_HEADING_PATTERN.exec(line);
    if (headingMatch) {
      currentQuestion = { id: headingMatch[1], number: Number(headingMatch[1].slice(1)), text: headingMatch[2].trim(), status: 'open', about: '', asked: '', assumption: '', answer: '' };
      questions.push(currentQuestion);
      continue;
    }
    const fieldMatch = /^- (status|about|asked|assumption|answer): (.*)$/.exec(line);
    if (currentQuestion && fieldMatch) currentQuestion[fieldMatch[1]] = fieldMatch[2].trim();
  }
  return questions;
}

function renderQuestions(questions, now) {
  return QUESTIONS_HEADER(now) + questions.map((question) => [
    `## ${question.id}: ${question.text}`,
    '',
    `- status: ${question.status}`,
    ...(question.about ? [`- about: ${question.about}`] : []),
    `- asked: ${question.asked}`,
    ...(question.assumption ? [`- assumption: ${question.assumption}`] : []),
    ...(question.answer ? [`- answer: ${question.answer}`] : []),
    '',
  ].join('\n')).join('\n');
}

function writeQuestions(bundleDirectory, questions, now) {
  mkdirSync(requirementsDirectory(bundleDirectory), { recursive: true });
  writeFileSync(questionsPath(bundleDirectory), renderQuestions(questions, now));
  writeRequirementsIndex(bundleDirectory);
}

export function addQuestion(bundleDirectory, { text, about = '', now = new Date() }) {
  const questionText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!questionText) throw new Error('a question needs its text');
  if (about && !CATEGORY_IDS.has(about)) throw new Error(`--about must be one of ${[...CATEGORY_IDS].join(', ')}`);
  const questions = listQuestions(bundleDirectory);
  const questionId = padQuestionNumber(Math.max(0, ...questions.map((question) => question.number)) + 1);
  writeQuestions(bundleDirectory, [...questions, { id: questionId, number: 0, text: questionText, status: 'open', about, asked: todayDate(now), assumption: '', answer: '' }], now);
  return { id: questionId, relativePath: `${REQUIREMENTS_DIRECTORY}/${QUESTIONS_FILE}` };
}

// `assume`: the agent works on an assumption until the person confirms; `answer`: the question is
// settled, and `where` names the concept the answer went into.
export function settleQuestion(bundleDirectory, questionId, { status, text, where = '', now = new Date() }) {
  if (!['assumed', 'answered'].includes(status)) throw new Error('a question is settled as assumed or answered');
  const settledText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!settledText) throw new Error(`${status === 'assumed' ? 'assume' : 'answer'} needs its text`);
  const questions = listQuestions(bundleDirectory);
  const question = questions.find((candidateQuestion) => candidateQuestion.id.toLowerCase() === String(questionId).toLowerCase());
  if (!question) throw new Error(`no question ${questionId} in ${REQUIREMENTS_DIRECTORY}/${QUESTIONS_FILE}`);
  question.status = status;
  if (status === 'assumed') question.assumption = `${settledText} (${todayDate(now)})`;
  else question.answer = `${settledText} (${todayDate(now)}${where ? `, in ${where}` : ''})`;
  writeQuestions(bundleDirectory, questions, now);
  return { id: question.id, relativePath: `${REQUIREMENTS_DIRECTORY}/${QUESTIONS_FILE}` };
}

// --- Gap map -----------------------------------------------------------------------------------

// The Product concept was made the project context (`project_context: true`, written by init), not
// only the user profiles and tone of the design feature.
function isProjectContextProduct(product) {
  return readFrontmatterField(product?.frontmatterText, 'project_context') === 'true';
}

// { started, product, others, categories: [{ id, label, status: clear|partial|missing, why }],
//   requirements, questions }. `started`: the project has a requirement or a Product concept marked
// `project_context: true`, so gaps are worth a line at session start; a Product concept of the
// design feature alone does not start it.
export function buildGapMap(bundleDirectory, { verifyCommands = [] } = {}) {
  const product = existsSync(bundleDirectory) ? findProductConcept(bundleDirectory) : null;
  const requirements = listRequirements(bundleDirectory);
  const technicalDecisions = listTechnicalDecisions(bundleDirectory);
  const questions = listQuestions(bundleDirectory);
  const pendingQuestions = questions.filter((question) => question.status !== 'answered');
  const operationsConcept = existsSync(bundleDirectory) ? findOperationsConcept(bundleDirectory) : null;
  const categories = PROJECT_CATEGORIES.map((projectCategory) => {
    const sectionText = product ? readSectionText(product.bodyText, projectCategory.heading) : null;
    let hasAnswer = Boolean(sectionText);
    const pendingAbout = pendingQuestions.filter((question) => question.about === projectCategory.id);
    if (projectCategory.id === 'deploy' && operationsConcept && hasSectionContent(readSectionText(operationsConcept.bodyText, 'Deploy'))) hasAnswer = true;
    if (projectCategory.id === 'operations' && operationsConcept) return describeOperationsCategory(projectCategory, operationsConcept, pendingAbout);
    if (projectCategory.id === 'scope' && requirements.some((requirement) => requirement.state === 'out-of-scope')) hasAnswer = true;
    if (projectCategory.id === 'technical-vision' && technicalDecisions.some((technicalDecision) => technicalDecision.decisionState !== 'replaced')) hasAnswer = true;
    if (projectCategory.id === 'run-test' && verifyCommands.length) hasAnswer = true;
    if (!hasAnswer) return { id: projectCategory.id, label: projectCategory.label, status: 'missing', why: pendingAbout.length ? `${pendingAbout.map((question) => question.id).join(', ')} pending` : 'not written' };
    if (sectionText && PLACEHOLDER_PATTERN.test(sectionText)) return { id: projectCategory.id, label: projectCategory.label, status: 'partial', why: 'placeholder (TBD/TODO)' };
    if (pendingAbout.length) return { id: projectCategory.id, label: projectCategory.label, status: 'partial', why: `${pendingAbout.map((question) => question.id).join(', ')} pending` };
    return { id: projectCategory.id, label: projectCategory.label, status: 'clear', why: '' };
  });
  return {
    started: isProjectContextProduct(product) || requirements.length > 0,
    product: product?.relativePath || null,
    others: product?.others || [],
    categories,
    requirements,
    questions,
  };
}

// The operations category from the Operations concept: clear when every topic is written, partial
// naming the empty ones, missing when none is.
function describeOperationsCategory(projectCategory, operationsConcept, pendingAbout) {
  const { empty, placeholder } = describeOperationsSections(operationsConcept);
  const categoryOf = (status, why) => ({ id: projectCategory.id, label: projectCategory.label, status, why });
  const pendingText = pendingAbout.length ? `${pendingAbout.map((question) => question.id).join(', ')} pending` : '';
  if (empty.length === OPERATIONS_SECTIONS.length) return categoryOf('missing', pendingText || `${operationsConcept.relativePath.split('\\').join('/')} is empty`);
  const whyParts = [empty.length ? `empty: ${empty.join(', ')}` : '', placeholder.length ? `placeholder: ${placeholder.join(', ')}` : '', pendingText].filter(Boolean);
  return whyParts.length ? categoryOf('partial', whyParts.join('; ')) : categoryOf('clear', '');
}

// Creates the Product concept (with one empty section per category), the Operations concept (one
// empty section per topic), the requirements index and the open questions file when missing, and links them from the bundle's root index. Returns the
// paths it wrote.
export function initProjectContext(bundleDirectory, { projectTitle, now = new Date() }) {
  if (!existsSync(join(bundleDirectory, 'index.md'))) throw new Error('there is no knowledge bundle yet: create it first (/ai1:okf-maintain-knowledge, produce mode)');
  const writtenPaths = [];
  const existingProduct = findProductConcept(bundleDirectory);
  if (!existingProduct) {
    writeFileSync(join(bundleDirectory, PRODUCT_FILE), PRODUCT_TEMPLATE(projectTitle, now));
    writtenPaths.push(PRODUCT_FILE);
  } else if (!isProjectContextProduct(existingProduct)) {
    const productPath = join(bundleDirectory, existingProduct.relativePath);
    writeFileSync(productPath, writeFrontmatterField(readFileSync(productPath, 'utf8'), 'project_context', 'true'));
    writtenPaths.push(existingProduct.relativePath.split('\\').join('/'));
  }
  if (!findOperationsConcept(bundleDirectory)) {
    writeFileSync(join(bundleDirectory, OPERATIONS_FILE), OPERATIONS_TEMPLATE(projectTitle, now));
    writtenPaths.push(OPERATIONS_FILE);
  }
  if (!existsSync(questionsPath(bundleDirectory))) {
    writeQuestions(bundleDirectory, [], now);
    writtenPaths.push(`${REQUIREMENTS_DIRECTORY}/${QUESTIONS_FILE}`);
  }
  writtenPaths.push(writeRequirementsIndex(bundleDirectory));
  const rootIndexPath = join(bundleDirectory, 'index.md');
  const rootIndexText = readFileSync(rootIndexPath, 'utf8');
  const missingLinks = [
    [PRODUCT_FILE, `* [Product](${PRODUCT_FILE}) - what the project is for, its users, scope, constraints, how it runs and ships, who decides.`],
    [OPERATIONS_FILE, `* [Operations](${OPERATIONS_FILE}) - how it is deployed and run in production: environments, logs, databases, access, monitoring, alerts.`],
    [`${REQUIREMENTS_DIRECTORY}/`, `* [${REQUIREMENTS_DIRECTORY}/](${REQUIREMENTS_DIRECTORY}/${REQUIREMENTS_INDEX_FILE}) - requirements by state, and the open questions.`],
  ].filter(([linkTarget]) => !rootIndexText.includes(`](${linkTarget}`));
  if (missingLinks.length) {
    writeFileSync(rootIndexPath, `${rootIndexText.trimEnd()}\n${missingLinks.map(([, linkLine]) => linkLine).join('\n')}\n`);
    writtenPaths.push('index.md');
  }
  return writtenPaths;
}

// What a technical decision in force says to avoid (`avoid:`), named in a plan's text: advisory.
// [{ decision, term }], a term matched as whole words, case and accents ignored.
export function findAvoidedTermsInPlan(planText, technicalDecisions) {
  const normalize = (text) => String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normalizedPlan = ` ${normalize(planText).replace(/[^a-z0-9]+/g, ' ')} `;
  return technicalDecisions.filter((technicalDecision) => technicalDecision.decisionState !== 'replaced').flatMap((technicalDecision) => technicalDecision.avoid
    .filter((avoidedTerm) => normalize(avoidedTerm).replace(/[^a-z0-9]+/g, ' ').trim() && normalizedPlan.includes(` ${normalize(avoidedTerm).replace(/[^a-z0-9]+/g, ' ').trim()} `))
    .map((avoidedTerm) => ({ decision: technicalDecision, term: avoidedTerm })));
}

// Requirements out of scope whose words show up in a plan's text: advisory, never blocking.
// A requirement matches when at least two of its significant title words (4+ letters) are in the text.
export function findOutOfScopeConflicts(planText, requirements) {
  const normalize = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const planWords = new Set(normalize(planText).match(/[a-z0-9]{4,}/g) || []);
  return requirements.filter((requirement) => requirement.state === 'out-of-scope').filter((requirement) => {
    const titleWords = [...new Set(normalize((requirement.title || '').replace(/^R\d+\s+/, '')).match(/[a-z0-9]{4,}/g) || [])];
    const sharedWords = titleWords.filter((titleWord) => planWords.has(titleWord));
    return sharedWords.length >= Math.min(2, titleWords.length);
  });
}

// The command that proves a requirement, run from the project root; returns its exit code.
function defaultRunCheckCommand(checkCommand, projectRoot) {
  const commandResult = spawnSync(checkCommand, { cwd: projectRoot, shell: true, stdio: 'inherit', timeout: CHECK_COMMAND_TIMEOUT_MILLISECONDS });
  return commandResult.status ?? 1;
}

// Sets or replaces the command that proves a requirement. Returns { id }.
export function setRequirementCheckCommand(bundleDirectory, requirementId, checkCommand, { now = new Date() } = {}) {
  const requirement = findRequirement(listRequirements(bundleDirectory), requirementId);
  if (!requirement) throw new Error(`no requirement ${requirementId} in ${REQUIREMENTS_DIRECTORY}/`);
  if (!String(checkCommand || '').trim()) throw new Error('req command needs the command that proves the requirement');
  const filePath = join(bundleDirectory, requirement.relativePath);
  let conceptText = writeFrontmatterField(readFileSync(filePath, 'utf8'), 'check_command', yamlString(checkCommand));
  conceptText = writeFrontmatterField(conceptText, 'generated', `{ by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`);
  writeFileSync(filePath, appendHistoryLine(conceptText, `- ${todayDate(now)} check command: \`${String(checkCommand).trim()}\``));
  return { id: requirement.id };
}

// `ai1 okf project verify`: runs the check command of every active or validated requirement that has
// one. A validated requirement whose check fails goes back to active (it regressed); an active one that
// passes stays active (only a plan or the person validates). [{ id, command, passed, exitCode, reopened }].
export function verifyRequirements(bundleDirectory, projectRoot, { requirementId = '', runCommand = defaultRunCheckCommand, now = new Date() } = {}) {
  const wantedRequirement = requirementId ? findRequirement(listRequirements(bundleDirectory), requirementId) : null;
  if (requirementId && !wantedRequirement) throw new Error(`no requirement ${requirementId} in ${REQUIREMENTS_DIRECTORY}/`);
  const checkedRequirements = listRequirements(bundleDirectory)
    .filter((requirement) => CHECKED_STATES.has(requirement.state) && requirement.checkCommand)
    .filter((requirement) => !wantedRequirement || requirement.id === wantedRequirement.id);
  return checkedRequirements.map((requirement) => {
    const exitCode = runCommand(requirement.checkCommand, projectRoot);
    const reopened = exitCode !== 0 && requirement.state === 'validated';
    if (reopened) setRequirementState(bundleDirectory, requirement.id, 'active', { reason: `check failed: \`${requirement.checkCommand}\` exit ${exitCode}`, now });
    return { id: requirement.id, command: requirement.checkCommand, passed: exitCode === 0, exitCode, reopened };
  });
}

// `ai1 plan-done`: the requirements a closed plan lists in `requirements:` become validated by it,
// when their check command (if any) passes. Never fails the close: a missing id, one no longer in
// force or a failing check is only reported. Returns one note per id.
export function validatePlanRequirements(bundleDirectory, planSlug, requirementIds, { projectRoot = '', runCommand = defaultRunCheckCommand, now = new Date() } = {}) {
  const requirements = listRequirements(bundleDirectory);
  return requirementIds.map((requirementId) => {
    const requirement = findRequirement(requirements, requirementId);
    if (!requirement) return `${requirementId}: no such requirement in ${REQUIREMENTS_DIRECTORY}/, not validated`;
    if (requirement.state === 'out-of-scope') return `${requirement.id}: out of scope, not validated (tell the person the plan built it)`;
    if (requirement.state === 'superseded') return `${requirement.id}: superseded by ${requirement.supersededBy || 'another requirement'}, not validated (list that one instead)`;
    if (requirement.checkCommand && projectRoot) {
      const exitCode = runCommand(requirement.checkCommand, projectRoot);
      if (exitCode !== 0) return `${requirement.id}: check \`${requirement.checkCommand}\` failed (exit ${exitCode}), not validated`;
    }
    setRequirementState(bundleDirectory, requirement.id, 'validated', { plan: planSlug, now });
    return `${requirement.id}: validated by ${planSlug}`;
  });
}

// --- Technical vision --------------------------------------------------------------------------
// The developer's picture of how the project is built (architecture, libraries and services to reuse,
// how it integrates, what to avoid): not requirements (changing it needs no client decision) but
// decisions, `decisions/<slug>.md` with `type: Decision` and the tag `technical-vision`, in state
// proposed | accepted | replaced. A constraint the client imposes ("their SAP", "their Postgres") is a
// requirement or a Product constraint instead.

export const DECISIONS_DIRECTORY = 'decisions';
export const TECHNICAL_DECISION_STATES = ['proposed', 'accepted', 'replaced'];
const TECHNICAL_VISION_TAG = 'technical-vision';

// A frontmatter list as written by addTechnicalDecision (a JSON array is a YAML flow list).
function readYamlList(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:[ \\t]*(\\[.*\\])[ \\t]*$`, 'm').exec(frontmatterText || '');
  if (!fieldMatch) return [];
  try {
    const parsedList = JSON.parse(fieldMatch[1]);
    return Array.isArray(parsedList) ? parsedList.map(String) : [];
  } catch {
    return fieldMatch[1].replace(/^\[|\]$/g, '').split(',').map((listItem) => listItem.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
}

// Every technical-vision decision: { slug, relativePath, title, decisionState, from, avoid }.
export function listTechnicalDecisions(bundleDirectory) {
  const decisionsDirectory = join(bundleDirectory, DECISIONS_DIRECTORY);
  if (!existsSync(decisionsDirectory)) return [];
  const technicalDecisions = [];
  for (const fileName of readdirSync(decisionsDirectory).filter((candidateName) => candidateName.endsWith('.md') && candidateName !== 'index.md').sort()) {
    const { frontmatterText } = splitFrontmatter(readFileSync(join(decisionsDirectory, fileName), 'utf8'));
    if (!readFrontmatterField(frontmatterText, 'tags').split(/[\s,]+/).includes(TECHNICAL_VISION_TAG)) continue;
    technicalDecisions.push({
      slug: fileName.replace(/\.md$/, ''),
      relativePath: `${DECISIONS_DIRECTORY}/${fileName}`,
      title: readYamlScalar(frontmatterText, 'title'),
      decisionState: readFrontmatterField(frontmatterText, 'decision_state') || 'proposed',
      from: readYamlScalar(frontmatterText, 'decided_from'),
      avoid: readYamlList(frontmatterText, 'avoid'),
    });
  }
  return technicalDecisions;
}

const splitItems = (listText) => (Array.isArray(listText) ? listText : String(listText || '').split(';')).map((listItem) => String(listItem).trim()).filter(Boolean);

// Creates `decisions/<slug>.md`. Returns { slug, relativePath }.
export function addTechnicalDecision(bundleDirectory, { title, decision = '', why = '', alternatives = '', avoid = '', from = '', state = 'proposed', quote = '', now = new Date() }) {
  if (!String(title || '').trim()) throw new Error('a technical decision needs --title "<what it decides>"');
  if (!['proposed', 'accepted'].includes(state)) throw new Error('a new technical decision is proposed or accepted');
  const slug = slugFromTitle(title);
  const relativePath = `${DECISIONS_DIRECTORY}/${slug}.md`;
  if (existsSync(join(bundleDirectory, relativePath))) throw new Error(`${relativePath} already exists: change it with decision set, or pick another title`);
  const alternativeItems = splitItems(alternatives);
  const avoidItems = splitItems(avoid);
  const conceptText = [
    '---',
    'type: Decision',
    `title: ${yamlString(title)}`,
    `description: ${yamlString(String(decision || title))}`,
    `tags: [decision, ${TECHNICAL_VISION_TAG}, ${state}]`,
    `decision_state: ${state}`,
    ...(String(from).trim() ? [`decided_from: ${yamlString(from)}`] : []),
    ...(avoidItems.length ? [`avoid: ${JSON.stringify(avoidItems)}`] : []),
    `generated: { by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`,
    '---',
    '',
    String(decision || title).trim(),
    '',
    ...(String(why).trim() ? ['# Why', '', String(why).trim(), ''] : []),
    ...(alternativeItems.length ? ['# Alternatives considered', '', ...alternativeItems.map((alternativeItem) => `- ${alternativeItem}`), ''] : []),
    ...(avoidItems.length ? ['# Avoid', '', ...avoidItems.map((avoidItem) => `- ${avoidItem}`), ''] : []),
    '# History',
    '',
    `- ${todayDate(now)} ${state}${quoteLine(quote, from)}`,
    '',
  ].join('\n');
  mkdirSync(join(bundleDirectory, DECISIONS_DIRECTORY), { recursive: true });
  writeFileSync(join(bundleDirectory, relativePath), conceptText);
  writeRequirementsIndex(bundleDirectory);
  return { slug, relativePath };
}

// Moves a technical decision to accepted or replaced (`by`: the decision that replaces it). Returns
// { slug, previousState }.
export function setTechnicalDecisionState(bundleDirectory, decisionSlug, newState, { quote = '', from = '', reason = '', by = '', now = new Date() } = {}) {
  if (!TECHNICAL_DECISION_STATES.includes(newState)) throw new Error(`state must be one of ${TECHNICAL_DECISION_STATES.join(', ')}`);
  const technicalDecisions = listTechnicalDecisions(bundleDirectory);
  const technicalDecision = technicalDecisions.find((candidateDecision) => candidateDecision.slug === decisionSlug);
  if (!technicalDecision) throw new Error(`no technical decision ${decisionSlug} in ${DECISIONS_DIRECTORY}/ (ai1 okf project decision list)`);
  if (by && !technicalDecisions.some((candidateDecision) => candidateDecision.slug === by)) throw new Error(`no technical decision ${by} to be replaced by`);
  const filePath = join(bundleDirectory, technicalDecision.relativePath);
  let conceptText = writeFrontmatterField(readFileSync(filePath, 'utf8'), 'decision_state', newState);
  conceptText = writeFrontmatterField(conceptText, 'tags', `[decision, ${TECHNICAL_VISION_TAG}, ${newState}]`);
  if (by) conceptText = writeFrontmatterField(conceptText, 'replaced_by', by);
  conceptText = writeFrontmatterField(conceptText, 'generated', `{ by: '${WRITER_ACTOR}', at: '${nowTimestamp(now)}' }`);
  const detailText = [by ? `by ${by}` : '', String(reason).trim()].filter(Boolean).join('; ');
  writeFileSync(filePath, appendHistoryLine(conceptText, `- ${todayDate(now)} ${technicalDecision.decisionState} -> ${newState}${detailText ? ` (${detailText})` : ''}${quoteLine(quote, from)}`));
  writeRequirementsIndex(bundleDirectory);
  return { slug: technicalDecision.slug, previousState: technicalDecision.decisionState };
}
