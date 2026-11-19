// /ai1:design-gather-brand is instructions for the agent: these tests pin the parts of its text that
// carry each approved behaviour, as the other skill tests of ai1 do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILL_TEXT = readFileSync(fileURLToPath(new URL('../skills/design-gather-brand/SKILL.md', import.meta.url)), 'utf8');

test('the brand is looked for in order - this repo, other projects, customization sources, website, the person - and recorded with its sources [design-client-brand:S4]', () => {
  assert.match(SKILL_TEXT, /1\. \*\*This repo\*\*[\s\S]*2\. \*\*The person's other projects with this client\*\*[\s\S]*brand find "<client>"[\s\S]*3\. \*\*The sources in the customization below\*\*[\s\S]*4\. \*\*The client's website\*\*[\s\S]*5\. \*\*The person\*\*, for what is still missing/);
  assert.match(SKILL_TEXT, /frontmatter `brand_owner: <client>` and a `## Brand` section[\s\S]*with where it came from/);
  assert.match(SKILL_TEXT, /Show the person a short summary/);
  assert.match(SKILL_TEXT, /## Fixed rules[\s\S]*- Never invent a logo, draw one or use a doubtful one[\s\S]*- Never present a guessed colour as the client's[\s\S]*- Ask the person only for what is still missing after looking\./);
  assert.match(SKILL_TEXT, /^allowed-tools: Bash\("\$\{CLAUDE_PLUGIN_DATA\}\/bin\/ai1" skill-context \*\) Bash\("\$\{CLAUDE_PLUGIN_DATA\}\/bin\/ai1" brand \*\)$/m);
});
