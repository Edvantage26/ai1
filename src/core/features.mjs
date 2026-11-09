// Features are what a repo chooses in .ai1/config.json (`features.<id>: true | false`).
// Each module belongs to one feature; a feature can also ship skills (e.g. the OKF pack).
// `enabledByDefault` applies when the repo does not mention the feature.

export const FEATURES = [
  {
    id: 'okf',
    title: 'OKF project knowledge',
    description: 'Loads the knowledge bundle index at session start, points to the concepts related to each message, and asks to keep the bundle up to date after changes. Skills: /ai1:okf-maintain-knowledge, /ai1:okf-validate-bundle, /ai1:okf-visualize-bundle, /ai1:okf-backfill-from-history.',
    enabledByDefault: true,
  },
  {
    id: 'danger',
    title: 'Destructive command guard',
    description: 'Confirms or refuses shell commands that destroy work, history or data (reset --hard, force push, rm -r, DROP TABLE, --no-verify...).',
    enabledByDefault: true,
  },
  {
    id: 'craft',
    title: 'Code craft rules',
    description: 'Gives the agent the rules for orderly code at session start: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed instead of applied, self-explanatory names.',
    enabledByDefault: true,
  },
  {
    id: 'lanes',
    title: 'Work lanes by task size',
    description: 'The agent sizes each task: quick ones are done directly, medium ones get a short plan, complex or risky ones a design with questions that the person approves before any code is edited (skill /ai1:lanes-design-before-code). Restores progress after compaction.',
    enabledByDefault: false,
  },
  {
    id: 'worktrees',
    title: 'A worktree per change',
    description: 'Every change to the repo files is done in a worktree (created before the first edit), made the way this project needs (modes full/light/auto by disk, copied env, shared or regenerated heavy folders, a port per worktree, named commands, checked integration). The recipe is planned once with the person (/ai1:worktrees-plan-recipe) and saved as the project skill .claude/skills/worktree/. The agent keeps saying which worktree it works in. Adds `ai1 worktree`.',
    enabledByDefault: false,
  },
  {
    id: 'proposals',
    title: 'Proposals for undecided changes',
    description: 'Proposals for large changes and future features live in .ai1/proposals/ (one versioned file each, idea or full size), apart from the knowledge bundle because they are not the system. Created only when the person asks for one, or picks it in the one-line offer the agent makes when a clearly different subject comes up mid-task (do it here, fork the conversation, or save it as a proposal). Lists the open ones at session start, points to the related ones on each message, and when the session touched them checks they are consistent and that accepted ones are recorded in the bundle. Skill /ai1:proposals-write; `ai1 proposals new|set|index|check`.',
    enabledByDefault: false,
  },
  {
    id: 'design',
    title: 'UI design rules and checks',
    description: 'For repos with a frontend. Gives the agent the UI rules at session start (read the product and design-system context, avoid the generic AI look, keep a quality floor) and checks every UI file it edits with deterministic rules (overused fonts, purple gradients, low contrast, skipped headings, tiny text...), reporting what the edit introduced. Points to the impeccable skill when it is installed.',
    enabledByDefault: false,
  },
  {
    id: 'verify',
    title: 'Verification gate',
    description: 'The agent cannot finish while code it changed is newer than the last passing run of the verify commands in .ai1/config.json (run in full, no filters). Adds `ai1 verify` and `ai1 step-done`. Also asks before tests are skipped, emptied, weakened or deleted, and after 3 failed fix attempts in a row tells the agent to stop and go back to the root cause (/ai1:verify-debug-systematically).',
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
