// Which ai1 skills a project or a person can customize, one entry per `skills/<folder>`. A test fails
// when a skill folder has no entry, so every new skill decides: customizable (with the scopes it
// accepts) or not (with the reason). The feature of a skill is its folder prefix (`<module>-<action>`),
// and names its customization folder: `.ai1/skills/<feature>/customization.md` and
// `~/.config/ai1/skills/<feature>/customization.md`. See .ai1/okf/architecture/skill-customization.md.

const PROJECT_AND_USER = ['project', 'user'];

export const SKILL_CUSTOMIZATION_INDEX = {
  'worktrees-plan-recipe': { customizable: true, scopes: PROJECT_AND_USER },
  'session-fork-conversation': { customizable: true, scopes: PROJECT_AND_USER },
  'session-delegate-change': { customizable: true, scopes: PROJECT_AND_USER },
  'later-write': { customizable: true, scopes: PROJECT_AND_USER },
  'sizing-design-before-code': { customizable: true, scopes: PROJECT_AND_USER },
  'okf-maintain-knowledge': { customizable: true, scopes: PROJECT_AND_USER },
  'okf-tidy-claude-md': { customizable: true, scopes: PROJECT_AND_USER },
  'okf-visualize-bundle': { customizable: true, scopes: PROJECT_AND_USER },
  'verify-debug-systematically': { customizable: true, scopes: PROJECT_AND_USER },
  'verify-evaluate-llm-prompts': { customizable: true, scopes: PROJECT_AND_USER },
  'storyboard-record-flow': { customizable: true, scopes: PROJECT_AND_USER },
  'reuse-encapsulate': { customizable: true, scopes: PROJECT_AND_USER },
  'design-review-usability': { customizable: true, scopes: PROJECT_AND_USER },
  'watches-follow-release': { customizable: true, scopes: PROJECT_AND_USER },
  'messages-draft-message': { customizable: true, scopes: PROJECT_AND_USER },
  'routines-set-routine': { customizable: true, scopes: PROJECT_AND_USER },
  'core-setup-repo': { customizable: true, scopes: ['user'] },
  'core-report-issue': { customizable: false, reason: 'its privacy guarantee for a public issue lives only in the skill text' },
  'okf-validate-bundle': { customizable: false, reason: 'a deterministic checker; a customization could only change how its errors are read' },
  'core-customize-skill': { customizable: false, reason: 'it writes the customizations; customizing it would let a customization change how customizations are approved' },
  'danger-write-rule': { customizable: false, reason: 'what a project customizes is already data (the rules it writes); a customization must not weaken how they are approved' },
};

export function featureOfSkill(skillFolder) {
  return skillFolder.split('-')[0];
}
