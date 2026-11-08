// Features are what a repo chooses in .claude/jig.json (`features.<id>: true | false`).
// Each module belongs to one feature; a feature can also ship skills (e.g. the OKF pack).
// `enabledByDefault` applies when the repo does not mention the feature.

export const FEATURES = [
  {
    id: 'okf',
    title: 'OKF project knowledge',
    description: 'Loads the knowledge bundle index at session start, points to the concepts related to each message, and asks to keep the bundle up to date after changes. Skills: /jig:okf, /jig:validate, /jig:visualize, /jig:backfill.',
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
    description: 'The agent sizes each task: quick ones are done directly, medium ones get a short plan, complex or risky ones a design with questions that the person approves before any code is edited (skill /jig:deep). Restores progress after compaction.',
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
    description: 'The agent cannot finish while code it changed is newer than the last passing run of the verify commands in jig.json (run in full, no filters). Adds `jig verify` and `jig step-done`.',
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
