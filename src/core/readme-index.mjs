// What the docs say about each skill and each hook module, and where each one comes from.
// `npm run readme-tables` (scripts/readme-tables.mjs) turns it into the "Skills" table of README.md and
// the "Hooks" table of docs/reference.md; test/readme-tables.test.mjs fails when a skill folder or a
// module of src/core/module-index.mjs has no entry, or when a table is out of date. So a new skill or
// hook decides its origin once and the docs follow.
// `importedFrom`: code or text copied (also listed in THIRD-PARTY.md with its license). `basedOn`:
// projects whose ideas or method it takes, with no code copied. Both empty: written in ai1.
// A skill's description is the first sentence of its SKILL.md `description`; a hook's lives here.
// See .ai1/okf/features/skill-design.md and .ai1/okf/architecture/hook-runtime.md.

const OKF_SKILLS = { name: 'okf-skills', url: 'https://github.com/scaccogatto/okf-skills', license: 'MIT' };
const SUPERPOWERS = { name: 'Superpowers', url: 'https://github.com/obra/superpowers' };
const IMPECCABLE = { name: 'Impeccable', url: 'https://github.com/pbakaus/impeccable', license: 'Apache 2.0' };
const HALLMARK = { name: 'Hallmark', url: 'https://github.com/Nutlope/hallmark' };
const GENTLE_AI = { name: 'gentle-ai', url: 'https://github.com/Gentleman-Programming/gentle-ai' };
const CLAUDE_CODE_HOOKS = { name: 'claude-code-hooks', url: 'https://github.com/karanb192/claude-code-hooks' };
const AGENT_GUARD = { name: 'agent-guard', url: 'https://github.com/hahahahahahahahah6/agent-guard' };
const EVERYTHING_CLAUDE_CODE = { name: 'Everything Claude Code', url: 'https://github.com/affaan-m/ECC' };

const NO_ORIGIN = { importedFrom: [], basedOn: [] };

export const SKILL_ORIGIN_INDEX = {
  'core-customize-skill': NO_ORIGIN,
  'core-report-issue': NO_ORIGIN,
  'core-setup-config': {
    importedFrom: [],
    basedOn: [
      { name: 'chezmoi', url: 'https://www.chezmoi.io/', what: 'copies by default, symlinks only on request' },
      { name: 'dotclaude', url: 'https://github.com/daniel7an/dotclaude', what: 'settings merged by keys, credentials and caches left out' },
      { name: 'doug.is', url: 'https://www.doug.is/writing/about/development/syncing-claude-code-across-multiple-machines', what: 'what belongs to one machine kept apart' },
    ],
  },
  'core-setup-repo': NO_ORIGIN,
  'danger-write-rule': NO_ORIGIN,
  'design-gather-brand': NO_ORIGIN,
  'design-review-usability': {
    importedFrom: [{ ...IMPECCABLE, what: 'the cognitive load checklist of its critique rubric' }],
    basedOn: [{ name: 'UXAgent', url: 'https://github.com/neuhai/UXAgent', what: 'an agent playing the user' }],
  },
  'ideas-brainstorm-topic': {
    importedFrom: [],
    basedOn: [
      { ...SUPERPOWERS, what: 'brainstorming: one question at a time, only what changes the decision, goals before options' },
      { name: 'BMAD Method', url: 'https://github.com/bmad-code-org/BMAD-METHOD', what: 'brainstorming: techniques chosen by kind of problem, diverging apart from converging, ideas logged to resume' },
      { name: 'Compound Engineering', url: 'https://github.com/EveryInc/compound-engineering-plugin', what: 'ce-ideate: web research before ideas, parallel angles, a reason for every rejected idea' },
      { name: 'STORM', url: 'https://github.com/stanford-oval/storm', what: 'Co-STORM: bring up retrieved findings the conversation has not covered' },
      { name: 'Si et al. 2024', url: 'https://arxiv.org/abs/2409.04109', what: 'LLM ideas duplicate and LLM judges are near chance: deduplicate, compare in pairs, the person decides' },
      { name: 'Verbalized Sampling', url: 'https://arxiv.org/abs/2510.01171', what: 'asking for ideas with their probabilities for more diverse ideas' },
      { name: 'AI Scientist', url: 'https://github.com/SakanaAI/AI-Scientist', what: 'novelty check of an idea against the literature' },
    ],
  },
  'later-write': NO_ORIGIN,
  'messages-draft-message': NO_ORIGIN,
  'okf-maintain-knowledge': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill, with the OKF v0.2 spec by Google LLC, Apache 2.0' }], basedOn: [] },
  'okf-interview-project': {
    importedFrom: [],
    basedOn: [
      { name: 'Spec Kit', url: 'https://github.com/github/spec-kit', what: '`/speckit.clarify`: coverage per category, questions ranked by impact x uncertainty, capped, each with a recommended answer' },
      { name: 'GSD', url: 'https://github.com/glittercowboy/get-shit-done', what: '`/gsd:new-project`: open questioning and requirements active / validated / out of scope with reason' },
      { name: 'Kiro', url: 'https://kiro.dev/docs/steering/', what: 'steering files inferred from the codebase' },
    ],
  },
  'okf-tidy-claude-md': NO_ORIGIN,
  'okf-validate-bundle': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill; its validator rewritten in Node' }], basedOn: [] },
  'okf-visualize-bundle': { importedFrom: [{ ...OKF_SKILLS, what: 'the skill and its viewer page' }], basedOn: [] },
  'reuse-encapsulate': NO_ORIGIN,
  'routines-set-routine': NO_ORIGIN,
  'session-delegate-change': NO_ORIGIN,
  'session-fork-conversation': NO_ORIGIN,
  'sizing-design-before-code': {
    importedFrom: [],
    basedOn: [
      { ...GENTLE_AI, what: 'ODD: sizing by risk, the plan starting with the request word for word' },
      { ...SUPERPOWERS, what: 'a fresh reviewer with the main model (cheap reviewers missed planted defects), one capped round' },
      { name: 'EpicenterHQ adversarial-review', url: 'https://github.com/EpicenterHQ/epicenter', what: 'the critic reads the goal and constraints before the proposal, against anchoring' },
    ],
  },
  'storyboard-record-flow': NO_ORIGIN,
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
  'watches-follow-release': NO_ORIGIN,
  'worktrees-plan-recipe': NO_ORIGIN,
};

export const HOOK_README_INDEX = {
  'brief': { description: 'tells the agent at session start which harness runs here', ...NO_ORIGIN },
  'issue-offer': { description: 'when ai1 itself fails in a repo (a module throws, the hook crashes), the agent offers once to report it with `/ai1:core-report-issue`; nothing is filed without your yes to the text, unless you chose automatic reports (`ai1 init --report-errors auto`: only versions and the error\'s module and plugin file:line are sent)', ...NO_ORIGIN },
  'issue-guard': { description: 'refuses `gh issue|pr create|comment|edit` aimed at the ai1 repo, and `ai1 issue url`, while the title or body holds private data (your repo names, home paths, user name, emails, IPs, hostnames, tokens, the project\'s contacts and clients), listing each with its placeholder; also when the body cannot be read (`--body "$(...)"`, stdin). `modules.issue-guard: false` silences it', ...NO_ORIGIN },
  'customization-check': { description: 'after an ai1 skill you can customize ran (3+ tool calls after it loaded, by the agent or typed by you), the agent judges silently whether a customization rule would have made it go better and only then proposes it in one line; once per skill and session, `ai1 skill-context quiet <skill>` to stop it', ...NO_ORIGIN },
  'config-sync-start': { description: 'in any folder, once you have a config repo (`ai1 config`): copies into ~/.claude and ~/.config/ai1 what changed in it, names conflicts, and asks for `ai1 config sync` when it is over 12 hours old; no network', ...NO_ORIGIN },
  'config-sync-stop': { description: 'in any folder: commits into your config repo what the session changed in your Claude Code config (skills, CLAUDE.md, settings keys, ai1 customizations, stack); a file with a secret-like line is held back and named', ...NO_ORIGIN },
  'config-skill-hint': { description: 'once per session, when a user-level skill is created and you have a config repo: where it goes and the shape of a technology skill (`ai1 config new-skill`)', ...NO_ORIGIN },
  'local-sync-start': { description: 'at session start, unseals your data in `.ai1/local/` when a newer sealed copy arrived, telling a conflict without overwriting (`ai1 local sync on|off|status`)', ...NO_ORIGIN },
  'local-sync-stop': { description: 'at the end of a turn, seals your data in `.ai1/local/` again when it changed', ...NO_ORIGIN },
  'okf-index': { description: 'loads the knowledge bundle index and its maintenance rules', ...NO_ORIGIN },
  'okf-claude-md': { description: 'at session start, one line when the repo\'s CLAUDE.md drifts from the bundle (too long, sections that repeat a concept or hold knowledge no concept has, sections holding a literal secret, which are never moved, references that no longer exist), told once per set of findings; `ai1 claude-md` prints the report and `/ai1:okf-tidy-claude-md` proposes a short CLAUDE.md and the concept edits, applied after the person approves', ...NO_ORIGIN },
  'okf-catch-up-start': { description: 'when a branch that had no knowledge bundle was merged into the current branch (in a terminal, on a forge and pulled, or by the agent), says so once and has the agent hand the documentation of its changes to an independent background agent, in its own worktree and commit; the commit\'s `Knowledge-Catch-Up: <merge sha>` trailer closes it in every clone; `ai1 okf catch-up` lists what is pending and prints the brief. Squash merges are not seen', ...NO_ORIGIN },
  'okf-catch-up-prompt': { description: 'the same catch-up check as `okf-catch-up-start`, on the next message after HEAD moves', ...NO_ORIGIN },
  'okf-project': { description: 'at session start, once the project context is started: the rule to ask before guessing what neither the code nor the bundle answers, its gaps in one line, what is out of scope, open questions and active must requirements (`ai1 okf project`, `/ai1:okf-interview-project`)', ...NO_ORIGIN },
  'okf-recall': { description: 'on every message, points the agent to the OKF concepts related to it; a message that may change a requirement in force, or names one out of scope, gets one more line (`okf-project` off: none)', ...NO_ORIGIN },
  'okf-file-context': { description: 'when the agent reads or edits a file, names the concept that describes it (from `resource`, `sources` and code paths in concepts); on an edit, a concept with `satisfies: [R004]` asks once to run that requirement\'s check', ...NO_ORIGIN },
  'danger': { description: 'confirms or refuses `git reset --hard`, force push, `rm -rf`, `--no-verify`, `DROP TABLE`...', ...NO_ORIGIN },
  'config-guard': {
    description: 'asks you before the agent changes `.ai1/config.json`, `.claude/settings*.json`, `.claude/hooks/` or the skill customizations in `.ai1/skills/` (file tools or shell), in any worktree',
    importedFrom: [],
    basedOn: [{ ...CLAUDE_CODE_HOOKS, what: '`config-guard`' }],
  },
  'rule-offer': { description: 'when you say something must never happen again ("no vuelvas a...", "never do that again"), has the agent offer to turn it into a repo rule with `/ai1:danger-write-rule`', ...NO_ORIGIN },
  'repo-rules': { description: 'your repo\'s own ask/deny rules for shell commands, edits and MCP calls, from `rules` in `.ai1/config.json`', ...NO_ORIGIN },
  'okf-upkeep': { description: 'asks to update the bundle after changes, new memories or a long run of investigation (findings, ways to validate, ways of working), and runs the OKF validator itself when the bundle changed, blocking only on errors', ...NO_ORIGIN },
  'craft-brief': { description: 'the code craft rules at session start', ...NO_ORIGIN },
  'sizing-brief': {
    description: 'the sizing recipe at session start; restores deep progress after compaction',
    importedFrom: [],
    basedOn: [{ ...GENTLE_AI, what: 'ODD: when a task is small' }, { ...SUPERPOWERS, what: 'the living plan document' }],
  },
  'sizing-approval': { description: 'records your approval of a deep design marked ready', ...NO_ORIGIN },
  'sizing-gate': { description: 'refuses code edits (tools and shell writes) while a deep design waits for approval, and closing by hand or dropping approved scenarios of a plan with behaviour scenarios', ...NO_ORIGIN },
  'sizing-escalate': { description: 'asks once when a task without a plan outgrows a quick change', ...NO_ORIGIN },
  'design-brief': { description: 'UI rules and the design context files at session start', ...NO_ORIGIN },
  'design-detect': {
    description: 'design rules on every edited UI file, findings of that edit only, once per session (`modules.design-detect.ignore_rules`)',
    importedFrom: [],
    basedOn: [
      { ...IMPECCABLE, what: 'rule ids and a deterministic detector run as a hook' },
      { ...HALLMARK, license: 'MIT', what: 'nine rules from its gates' },
    ],
  },
  'verify-gate': {
    description: 'no "done" while code is newer than the last passing run of `verify`',
    importedFrom: [],
    basedOn: [{ ...SUPERPOWERS, what: 'verification before completion, `task-done`' }],
  },
  'test-guard': {
    description: 'asks you before tests are skipped, emptied, weakened or deleted, or an existing lint/format/type-check/test-runner config is changed (`modules.test-guard.test_paths` / `check_config_paths` / `ignore_rules`)',
    importedFrom: [],
    basedOn: [
      { ...CLAUDE_CODE_HOOKS, what: '`protect-tests`' },
      { ...AGENT_GUARD, what: 'test tampering shapes' },
      { ...EVERYTHING_CLAUDE_CODE, what: '`config-protection`' },
    ],
  },
  'fix-loop': {
    description: 'counts failed fix attempts (a test still failing after an edit) and after 3 in a row tells the agent to stop patching, go back to the root cause with `/ai1:verify-debug-systematically` and tell you',
    importedFrom: [],
    basedOn: [{ ...SUPERPOWERS, what: 'fix-loop counters in a hook' }],
  },
  'llm-brief': { description: 'in repos that depend on an LLM SDK, points to `/ai1:verify-evaluate-llm-prompts` at session start', ...NO_ORIGIN },
  'tool-loop': {
    description: 'when the last 5 tool calls are the same call with the same input, tells the agent once to stop polling or retrying by hand (`modules.tool-loop.repeat_threshold`)',
    importedFrom: [],
    basedOn: [{ ...EVERYTHING_CLAUDE_CODE, what: 'the repeated tool call nudge' }],
  },
  'worktree-brief': { description: 'worktree rules at session start, the basic recipe and how to complete the project recipe; names the worktree the session is in', ...NO_ORIGIN },
  'worktree-reminder': { description: 'the active worktrees when they change and every few prompts, marking this session\'s', ...NO_ORIGIN },
  'later-brief': { description: 'where later entries live, that they are not the system, that "propuesta" is never this feature, when to note one down, and the open ones', ...NO_ORIGIN },
  'later-recall': { description: 'on every message, points the agent to the related later entries, labelled with their status', ...NO_ORIGIN },
  'storyboard-reminder': { description: 'when the session changed UI files and built no storyboard after them, asks once to record the flow or say why not (`modules.storyboard-reminder.ignore`)', ...NO_ORIGIN },
  'later-upkeep': { description: 'when the session touched `.ai1/later/`, checks numbering, statuses, the index and that accepted entries are cited by the bundle; asks to mark an entry implemented when its deep plan is done', ...NO_ORIGIN },
  'routine-notice': { description: 'at session start, lists your due routines in one line, each at most once a day, and has the agent offer to run one here, in a new conversation, snooze it or turn it off', ...NO_ORIGIN },
  'watch-notice': { description: 'at session start, one line only with news from the watches you follow: a failed run or a recovery, a follow-up that ended, a release you have not confirmed, checks that are due', ...NO_ORIGIN },
  'watch-release-detect': { description: 'after a release command (`git push` to the trunk or a tag, `gh release create`, `npm publish`, the repo\'s own deploy commands), tells the agent once to offer `/ai1:watches-follow-release`', ...NO_ORIGIN },
  'reuse-brief': { description: 'before a task done before in this repo, look up how with `ai1 reuse search`; how to propose encapsulating repeated work; only this repo', ...NO_ORIGIN },
  'reuse-check': { description: 'after 8+ tool calls since the last check (`modules.reuse-check.minToolCalls`), asks once to judge whether the work will recur here and to search or propose; at most twice per session', ...NO_ORIGIN },
  'foreign-repo': { description: 'an edit of another repository with ai1 refused, pointing to `/ai1:session-delegate-change`, unless that repo allows hot edits (`hot_max_files`) or the person said to do it here: then its own rules, config-guard and danger apply; one line of context for a repo without ai1 (runs where the launch directory has no ai1 too)', ...NO_ORIGIN },
  'delegate-report': { description: 'in a session started by `ai1 delegate`: records for the caller whether the verify commands passed and the plans left open (`ai1 delegate show`)', ...NO_ORIGIN },
  'foreign-repo-context': { description: 'a file of another repository with ai1 read or edited from here: names the concept of its OKF bundle that describes it, and on an edit asks to update it, once per concept (runs where the launch directory has no ai1 too)', ...NO_ORIGIN },
  'foreign-repo-upkeep': { description: 'files changed in another repository from here (hot edits or allowed): asks once to run `ai1 verify --cwd` there, to fix its OKF bundle if it no longer validates, and to update the concepts of it that describe them (runs where the launch directory has no ai1 too)', ...NO_ORIGIN },
};
