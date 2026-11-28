// Which ai1 skills a project or a person can customize, one entry per `skills/<folder>`. A test fails
// when a skill folder has no entry, so every new skill decides: customizable (with the scopes it
// accepts) or not (with the reason). The feature of a skill is its folder prefix (`<module>-<action>`),
// and names its customization folder: `.ai1/skills/<feature>/customization.md` and
// `~/.config/ai1/skills/<feature>/customization.md`. A customizable skill's `hints` say, in one line,
// what a project or a person usually has to tell it; the first time it runs in a repo the agent is told
// to watch for them. See .ai1/okf/architecture/skill-customization.md.

const PROJECT_AND_USER = ['project', 'user'];

export const SKILL_CUSTOMIZATION_INDEX = {
  'worktrees-plan-recipe': { customizable: true, scopes: PROJECT_AND_USER, hints: 'what the recipe file does not hold: how worktrees are named here, when a light one is enough, which services must run beside one' },
  'session-fork-conversation': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where forks open for this person (an agent manager, a terminal command), what every brief here must carry (verify commands, a link to the plan)' },
  'session-delegate-change': { customizable: true, scopes: PROJECT_AND_USER, hints: 'how claude starts on this machine (--claude-command), what every brief to another repo must say, which repos are usually delegated to' },
  'later-write': { customizable: true, scopes: PROJECT_AND_USER, hints: 'who decides entries here and by when, the language and slug style of entries, sections this project always wants' },
  'sizing-design-before-code': { customizable: true, scopes: PROJECT_AND_USER, hints: 'what a design here always needs (a migration plan, a rollback, who approves), the usual risk areas of this project' },
  'okf-maintain-knowledge': { customizable: true, scopes: PROJECT_AND_USER, hints: 'which assets this project documents and which not, its concept types and folders, the language of concepts' },
  'okf-interview-project': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where the project documents live outside the repo (or the person\'s default folder per project, with the project name in it), the stack, libraries, hosting and tools this person always uses and what they always avoid, how to find out how a project is deployed, logged, monitored and alerted on with this person\'s tools, categories or questions this project adds' },
  'okf-tidy-claude-md': { customizable: true, scopes: PROJECT_AND_USER, hints: 'what this repo keeps in CLAUDE.md on purpose, what must never move into the bundle' },
  'okf-visualize-bundle': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where the graph should be opened or published for this person' },
  'verify-debug-systematically': { customizable: true, scopes: PROJECT_AND_USER, hints: 'how bugs are reproduced here (the single-test command, fixtures, seed data), the logs to read first' },
  'verify-evaluate-llm-prompts': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where the reference cases live, the models and budget allowed, how runs are compared and recorded here' },
  'storyboard-record-flow': { customizable: true, scopes: PROJECT_AND_USER, hints: 'how the app starts here, how to log in (a test user, a seed), the routes of the main flows, viewports, where storyboards are published' },
  'reuse-encapsulate': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where this repo keeps scripts and project skills, its naming, what must never be encapsulated' },
  'design-gather-brand': { customizable: true, scopes: PROJECT_AND_USER, hints: 'where this person keeps clients\' logos and brand files (folders, tools), which client a repo is for' },
  'design-review-usability': { customizable: true, scopes: PROJECT_AND_USER, hints: 'who the users are when no Product concept says it, the start URL and test account, which flows matter most' },
  'watches-follow-release': { customizable: true, scopes: PROJECT_AND_USER, hints: 'how production is checked here (a health URL, a log or metrics command, the platform CLI), how long releases are followed' },
  'ideas-brainstorm-topic': { customizable: true, scopes: PROJECT_AND_USER, hints: 'the kinds of brainstorm usual here, sources to search first (internal docs, journals, competitors), how this person likes to converge and record the result' },
  'messages-draft-message': { customizable: true, scopes: PROJECT_AND_USER, hints: 'the tool that sends messages for this person, their signature, default language and tone' },
  'routines-set-routine': { customizable: true, scopes: PROJECT_AND_USER, hints: 'how this person prefers due routines offered (here or launched), their usual periods' },
  'core-setup-config': { customizable: true, scopes: ['user'], hints: 'where this person keeps their config repo (owner, name), whether they push automatically, files that belong to one machine only' },
  'core-setup-repo': { customizable: true, scopes: ['user'], hints: 'features this person always turns off or on, how they answer the overlapping-plugins and error-report questions' },
  'core-report-issue': { customizable: false, reason: 'its privacy guarantee for a public issue lives only in the skill text' },
  'okf-validate-bundle': { customizable: false, reason: 'a deterministic checker; a customization could only change how its errors are read' },
  'core-customize-skill': { customizable: false, reason: 'it writes the customizations; customizing it would let a customization change how customizations are approved' },
  'danger-write-rule': { customizable: false, reason: 'what a project customizes is already data (the rules it writes); a customization must not weaken how they are approved' },
};

export function featureOfSkill(skillFolder) {
  return skillFolder.split('-')[0];
}
