// Features are what a repo chooses in .ai1/config.json (`features.<id>: true | false`).
// Each module belongs to one feature; a feature can also ship skills (e.g. the OKF pack).
// `enabledByDefault` applies when the repo does not mention the feature: every feature is on unless the repo
// writes it `false` (opt-out, config version 2; see .ai1/okf/architecture/features.md).

export const FEATURES = [
  {
    id: 'okf',
    title: 'OKF project knowledge',
    description: 'Loads the knowledge bundle index at session start, points to the concepts related to each message, and asks to keep the bundle up to date after changes. Skills: /ai1:okf-maintain-knowledge, /ai1:okf-validate-bundle, /ai1:okf-visualize-bundle.',
    enabledByDefault: true,
  },
  {
    id: 'danger',
    title: 'Destructive command guard',
    description: 'Confirms or refuses shell commands that destroy work, history or data (reset --hard, force push, rm -r, DROP TABLE, --no-verify...). Applies the repo\'s own rules, and when the person says something must never happen again offers to turn it into one (/ai1:danger-write-rule).',
    enabledByDefault: true,
  },
  {
    id: 'craft',
    title: 'Code craft rules',
    description: 'Gives the agent the rules for orderly code at session start: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed instead of applied, self-explanatory names.',
    enabledByDefault: true,
  },
  {
    id: 'sizing',
    title: 'Task sizing',
    description: 'The agent sizes each task: quick ones are done directly, medium ones get a short plan, complex or risky ones a design with questions that the person approves before any code is edited (skill /ai1:sizing-design-before-code). Restores progress after compaction.',
    enabledByDefault: true,
  },
  {
    id: 'worktrees',
    title: 'A worktree per change',
    description: 'Every change to the repo files is done in a worktree (created before the first edit), made the way this project needs (modes full/light/auto by disk, copied env, shared or regenerated heavy folders, a port per worktree, named commands, checked integration). The recipe is planned once with the person (/ai1:worktrees-plan-recipe) and saved as the project skill .claude/skills/worktree/. The agent keeps saying which worktree it works in. Adds `ai1 worktree`.',
    enabledByDefault: true,
  },
  {
    id: 'later',
    title: 'Undecided changes noted down for later',
    description: 'Large changes and future features that are not decided yet are noted down for later in .ai1/later/ (one versioned file each, idea or full size, called by its number: later 0003), apart from the knowledge bundle because they are not the system. Only on demand: created only when the person asks for it ("apúntalo para luego"); the agent never offers it. Lists the open ones at session start, points to the related ones on each message, and when the session touched them checks they are consistent and that accepted ones are recorded in the bundle. Skill /ai1:later-write; `ai1 later new|set|index|check`.',
    enabledByDefault: true,
  },
  {
    id: 'reuse',
    title: 'Repeated work turned into reusable pieces',
    description: 'When a task took real work (8 or more tool calls since the last check), the agent judges in one line whether it will be asked again in this repo; if it may, it searches this repo\'s own past sessions and its project skills, commands and MCP servers (`ai1 reuse search`) and proposes in one line to turn it into a skill, script, MCP entry, hook or rule - or to complete or merge one that exists. Built only on a yes (skill /ai1:reuse-encapsulate); a no is kept in .ai1/reuse.json and not proposed again. Only this repo: never other repos\' sessions. Adds `ai1 reuse search|dismiss`.',
    enabledByDefault: true,
  },
  {
    id: 'design',
    title: 'UI design rules and checks',
    description: 'For repos with a frontend. Gives the agent the UI rules at session start (read the product and design-system context, avoid the generic AI look, keep a quality floor) and checks every UI file it edits with deterministic rules (overused fonts, purple gradients, low contrast, skipped headings, tiny text...), reporting what the edit introduced. Skill /ai1:design-review-usability checks that a flow is intuitive for the people who use it: an agent that knows only their profile and the goal tries the task, every step is walked, findings land on the storyboard. Points to the impeccable and frontend-design skills when they are installed.',
    enabledByDefault: true,
  },
  {
    id: 'storyboard',
    title: 'Visual storyboard of the user flow',
    description: 'For repos with a frontend. After a visual change, the agent records the user flow as numbered steps (what the user does, desktop and mobile screenshots, before and after) and builds a storyboard the person reviews without running the app: an HTML served at a local URL and a PDF, kept in .ai1/storyboards/ (link that folder anywhere, a synced cloud folder for instance, with your own tooling). Usability findings show on their steps. Reminds once at stop when UI files changed without a storyboard. Skill /ai1:storyboard-record-flow; `ai1 storyboard`.',
    enabledByDefault: true,
  },
  {
    id: 'verify',
    title: 'Verification gate',
    description: 'The agent cannot finish while code it changed is newer than the last passing run of the verify commands in .ai1/config.json (run in full, no filters). Adds `ai1 verify` and `ai1 step-done`. Also asks before tests are skipped, emptied, weakened or deleted or the config of a check (lint, format, types) is changed, tells the agent when it repeats the same tool call 5 times in a row, and after 3 failed fix attempts in a row tells the agent to stop and go back to the root cause (/ai1:verify-debug-systematically). In a repo that depends on an LLM SDK, points to /ai1:verify-evaluate-llm-prompts for prompt and model work.',
    enabledByDefault: true,
  },
  {
    id: 'delegate',
    title: 'Edits of another repo delegated to a session there',
    description: 'An edit to a file of another repository that has ai1 active is refused and delegated to a session started in that repository (`ai1 delegate`, skill /ai1:session-delegate-change), so its own config, hooks, CLAUDE.md and skills apply; the delegated session stops and returns its questions and blocked confirmations, and is resumed with the answer. The edited repository decides with this feature; it applies even where the session was launched without ai1.',
    enabledByDefault: true,
  },
  {
    id: 'maintenance',
    title: 'Maintenance tasks for the people who maintain ai1 in the repo',
    description: 'The repo lists who maintains ai1 there (`maintainers`, git emails; without the list everyone does). Maintainers get the maintenance tasks: the CLAUDE.md drift and bundle health hints, and periodic checks (later entries left open for months) said in one line at session start, at most every few days and sessions. Each person mutes a task for themselves (`ai1 maintain off|snooze <task>`, in their ignored .ai1/local/). Developers get none of them.',
    enabledByDefault: true,
  },
  {
    id: 'watches',
    title: 'Following what was shipped to production',
    description: 'When something goes to production, the agent offers to follow it with a watch (.ai1/watches/, committed: how it is checked, a health command, a command that counts successes and failures since the release, or a prompt for the agent). Each person subscribes for a while in their ignored .ai1/local/; `ai1 watch run` (from a scheduler or on a yes) records the results and the totals, `ai1 watch confirm` records that the person tried it and it works, and the session start says in one line only what changed. Skill /ai1:watches-follow-release; `ai1 watch`.',
    enabledByDefault: true,
  },
  {
    id: 'messages',
    title: 'Messages to the project\'s contacts',
    description: 'Skill /ai1:messages-draft-message drafts an email or message to a contact of the project: who they are comes from the knowledge bundle (.ai1/okf/people/contacts.md, committed), the person\'s own relation and tone with each one from their ignored .ai1/local/contacts.md. It shows the draft; it sends only through the tool the person names in their customization. `ai1 contacts`.',
    enabledByDefault: true,
  },
  {
    id: 'routines',
    title: 'Periodic tasks the person sets',
    description: 'Each person sets their own periodic tasks in a repo (run a skill, check something; every few hours or days, or on a weekday) in their ignored .ai1/local/routines.json. At session start one line says which are due (once a day) and the agent offers to do it here or to launch it in a new conversation the person sees, with the task written. ai1\'s own periodic maintenance tasks are built-in routines for maintainers. Snooze, off, done with a note. Skill /ai1:routines-set-routine; `ai1 routine`.',
    enabledByDefault: true,
  },
  {
    id: 'core',
    title: 'Harness brief',
    description: 'Tells the agent at session start which harness runs in the repo. Always on.',
    enabledByDefault: true,
    alwaysOn: true,
  },
];

export const KNOWN_FEATURE_IDS = FEATURES.map((featureDefinition) => featureDefinition.id);

export function findFeature(featureId) {
  return FEATURES.find((featureDefinition) => featureDefinition.id === featureId);
}

export function isFeatureEnabled(featureId, config) {
  const featureDefinition = findFeature(featureId);
  if (!featureDefinition) return false;
  if (featureDefinition.alwaysOn) return true;
  const featureSetting = config.features?.[featureId];
  return typeof featureSetting === 'boolean' ? featureSetting : featureDefinition.enabledByDefault;
}
