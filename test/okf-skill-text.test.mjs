import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skillText = readFileSync(new URL('../skills/okf-maintain-knowledge/SKILL.md', import.meta.url), 'utf8');

test('the produce/maintain skill keeps the guidance learned on a large live system [okf-findings-2:S1]', () => {
  const requiredGuidance = [
    [/Read the revision that runs/, 'check the deployed revision first'],
    [/HEAD\.\.origin\/<deployed branch>/, 'how to compare the checkout'],
    [/MCP servers/, 'the project MCP servers as source and live check'],
    [/A live database:[\s\S]*Catalog only[\s\S]*read-only/, 'live database limits'],
    [/An incident found while documenting[\s\S]*do not fix it/, 'incidents are reported, not fixed'],
    [/A large area[\s\S]*check 3–5 claims/, 'reading through subagents and checking reports'],
    [/entry file in `resource`/, 'workers put their entry file in resource'],
    [/role: evidence/, 'evidence sources'],
    [/ai1 okf scan-secrets/, 'secrets scan'],
    [/resolve the ties/, 'file-map ties'],
  ];
  for (const [guidancePattern, guidanceName] of requiredGuidance) assert.match(skillText, guidancePattern, guidanceName);
});
