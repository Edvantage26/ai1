// Where each ai1 skill comes from, one entry per `skills/<folder>`. A test fails when a skill folder has
// no entry, and `npm run readme-skills` turns this index into the "Skills" table of the README (another
// test fails when the README is out of date), so a new skill decides its origin once and the README
// follows. `importedFrom`: code or text copied into the skill (also listed in THIRD-PARTY.md with its
// license). `basedOn`: projects whose ideas or method the skill takes, with no code copied. Both empty:
// written in ai1. See .ai1/okf/features/skill-design.md.

const OKF_SKILLS = { name: 'okf-skills', url: 'https://github.com/scaccogatto/okf-skills', license: 'MIT' };
const SUPERPOWERS = { name: 'Superpowers', url: 'https://github.com/obra/superpowers' };
const IMPECCABLE = { name: 'Impeccable', url: 'https://github.com/pbakaus/impeccable', license: 'Apache 2.0' };

const WRITTEN_IN_AI1 = { importedFrom: [], basedOn: [] };

export const SKILL_ORIGIN_INDEX = {
  'core-customize-skill': WRITTEN_IN_AI1,
  'core-report-issue': WRITTEN_IN_AI1,
  'core-setup-repo': WRITTEN_IN_AI1,
  'danger-write-rule': WRITTEN_IN_AI1,
  'design-gather-brand': WRITTEN_IN_AI1,
  'design-review-usability': {
    importedFrom: [{ ...IMPECCABLE, what: 'the cognitive load checklist of its critique rubric' }],
    basedOn: [{ name: 'UXAgent', url: 'https://github.com/neuhai/UXAgent', what: 'an agent playing the user' }],
  },
  'later-write': WRITTEN_IN_AI1,
  'messages-draft-message': WRITTEN_IN_AI1,
  'okf-maintain-knowledge': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill, with the OKF v0.2 spec by Google LLC, Apache 2.0' }], basedOn: [] },
  'okf-tidy-claude-md': WRITTEN_IN_AI1,
  'okf-validate-bundle': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill; its validator rewritten in Node' }], basedOn: [] },
  'okf-visualize-bundle': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill and its viewer page' }], basedOn: [] },
  'reuse-encapsulate': WRITTEN_IN_AI1,
  'routines-set-routine': WRITTEN_IN_AI1,
  'session-delegate-change': WRITTEN_IN_AI1,
  'session-fork-conversation': WRITTEN_IN_AI1,
  'sizing-design-before-code': {
    importedFrom: [],
    basedOn: [{ name: 'gentle-ai', url: 'https://github.com/Gentleman-Programming/gentle-ai', what: 'ODD: sizing by risk, the plan starting with the request word for word' }],
  },
  'storyboard-record-flow': WRITTEN_IN_AI1,
  'verify-debug-systematically': {
    importedFrom: [],
    basedOn: [
      { ...SUPERPOWERS, what: '`systematic-debugging`' },
      { name: 'Matt Pocock\'s skills', url: 'https://github.com/mattpocock/skills', what: '`diagnosing-bugs`' },
      { name: 'Compound Engineering', url: 'https://github.com/EveryInc/compound-engineering-plugin', what: '`ce-debug`' },
    ],
  },
  'verify-evaluate-llm-prompts': {
    importedFrom: [],
    basedOn: [{ name: 'Hamel Husain and Shreya Shankar', url: 'https://hamel.dev/blog/posts/evals-faq/', what: 'error analysis of LLM evals' }],
  },
  'watches-follow-release': WRITTEN_IN_AI1,
  'worktrees-plan-recipe': WRITTEN_IN_AI1,
};
