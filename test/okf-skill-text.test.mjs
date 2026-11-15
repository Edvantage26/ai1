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

test('the skill keeps the rules learned on phases 3-6 of a large bundle [okf-findings-3:S1] [okf-findings-3:S3]', () => {
  const requiredGuidance = [
    [/link only to concepts already written/, 'no forward links in phased bundles'],
    [/variable names, never their\s+values/, 'live configuration by names'],
    [/Bound every live read/, 'bounded live reads'],
    [/no live systems, no MCP calls, no writes \(not even in `\/tmp`\)/, 'subagent brief limits'],
    [/the incidents and security claims first/, 'check incidents first'],
    [/as soon as it is confirmed, not in\s+the final summary/, 'urgent incidents'],
    [/An area's overview puts its own folders in `sources`/, 'area overviews'],
    [/docstrings, design docs and the warnings/, 'where the why lives'],
    [/`git log --grep`\s+per candidate/, 'large histories'],
    [/never a concept of this bundle/, 'no circular sources'],
    [/`git:<repo>@<sha>`/, 'commit with repository'],
    [/list it at the end of `decisions\/index\.md`/, 'decisions with no written why'],
  ];
  for (const [guidancePattern, guidanceName] of requiredGuidance) assert.match(skillText, guidancePattern, guidanceName);
});
