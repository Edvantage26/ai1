// config-skill-hint (PostToolUse on Write, core, person-scoped): when the agent creates a skill at user
// level (`~/.claude/skills/<name>/SKILL.md`) and the person has a config repo, says once per session where
// it goes and how a technology skill is shaped, so the person's skills keep one structure. Silent
// without a config repo (the setup offer at session start covers that) and for every other file.

import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { readStateText, resolveStateDirectory, sessionStatePath, writeStateText } from '../core/session-state.mjs';
import { isConfigSyncOn } from './config-sync.mjs';

const MODULE_ID = 'config-skill-hint';

// The skill name when `filePath` is a user-level SKILL.md, else null.
export function userSkillName(filePath, homeDirectory) {
  const relativePath = relative(join(homeDirectory, '.claude', 'skills'), String(filePath || ''));
  const parts = relativePath.split(sep);
  return !relativePath.startsWith('..') && parts.length === 2 && parts[1] === 'SKILL.md' && parts[0] !== 'synced' ? parts[0] : null;
}

export const SKILL_HINT = (skillName) => `ai1 config: ${skillName} is a skill of the person's own config: it is committed to their config repo when the session ends (\`claude/skills/${skillName}/\`; only on this machine: \`machines/<host>/\`). If it is one technology of their stack, give it the sections of \`ai1 config new-skill\` (When it applies, Integrate, Audit, Operate, When done) and its piece in the stack: \`ai1 okf stack add --scope user --id <id> --title "..." --area "..." --applies "..." --setup "${skillName}" --check "..."\`.`;

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  feature: 'core',
  personScoped: true,
  toolNames: ['Write'],
  description: 'Once per session, when a user-level skill is created and the person has a config repo: where it goes and the shape of a technology skill.',
  run({ hookInput, environment, homeDirectory }) {
    const resolvedHome = homeDirectory || homedir();
    const skillName = userSkillName(hookInput.tool_input?.file_path, resolvedHome);
    if (!skillName) return allowDecision();
    const pathOptions = { environment: environment || process.env, homeDirectory: resolvedHome };
    if (!isConfigSyncOn(pathOptions)) return allowDecision();
    const statePath = sessionStatePath(resolveStateDirectory(environment || process.env), hookInput.session_id, resolvedHome, MODULE_ID);
    if (readStateText(statePath)) return allowDecision();
    writeStateText(statePath, 'told');
    return contextDecision(MODULE_ID, SKILL_HINT(skillName));
  },
};
