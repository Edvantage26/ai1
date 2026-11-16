import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skillText = readFileSync(new URL('../skills/okf-maintain-knowledge/SKILL.md', import.meta.url), 'utf8');
const sourcesText = readFileSync(new URL('../skills/okf-maintain-knowledge/reference/sources.md', import.meta.url), 'utf8');

function assertGuidance(text, requiredGuidance) {
  for (const [guidancePattern, guidanceName] of requiredGuidance) assert.match(text, guidancePattern, guidanceName);
}

test('the skill keeps the short rules learned on real bundles [okf-skill-stable:S1]', () => {
  assertGuidance(skillText, [
    [/Read the revision that runs/, 'check the deployed revision first'],
    [/HEAD\.\.origin\/<deployed branch>/, 'how to compare the checkout'],
    [/A doc is a claim, not a fact/, 'docs are checked against the code'],
    [/never copy one; write where it lives, never the value/, 'secrets in one line'],
    [/An incident found while documenting[\s\S]*do not fix it/, 'incidents are reported, not fixed'],
    [/told as soon as it is confirmed/, 'urgent incidents'],
    [/never a\s+concept of this bundle/, 'no circular sources'],
    [/`resource: human:<id>`/, 'a person as the source of a why'],
    [/Never invent a why/, 'no invented whys'],
    [/pending review/, 'an unknown why is investigated and documented'],
    [/entry file in `resource`/, 'workers put their entry file in resource'],
    [/role: evidence/, 'evidence sources'],
    [/okf file-map/, 'check the file map'],
    [/okf-tidy-claude-md/, 'offer to tidy CLAUDE.md'],
  ]);
});

test('the skill no longer asks for a secrets scan [okf-skill-stable:S1]', () => {
  assert.doesNotMatch(skillText, /scan-secrets/);
});

test('reading other sources lives in reference/sources.md, linked from produce and maintain [okf-skill-stable:S2] [okf-skill-stable:S3]', () => {
  assert.equal(skillText.match(/\(reference\/sources\.md\)/g)?.length, 2, 'linked from produce and maintain');
  assertGuidance(sourcesText, [
    [/docstrings, design docs and the warnings/, 'where the why lives'],
    [/`git log --grep` or `git log -S` per candidate/, 'large histories'],
    [/`git:<repo>@<sha>`/, 'commit with repository'],
    [/list it at the end of `decisions\/index\.md`/, 'decisions with no written why'],
    [/MCP servers/, 'the project MCP servers as source and live check'],
    [/Catalog only[\s\S]*read-only transaction/, 'live database limits'],
    [/variable names, never their values/, 'live configuration by names'],
    [/Bound every live read/, 'bounded live reads'],
    [/no live\s+systems, no MCP calls, no writes \(not even in `\/tmp`\)/, 'subagent brief limits'],
    [/the incidents and security claims first/, 'check incidents first'],
    [/Link only to concepts already written/, 'no forward links in phased bundles'],
    [/An area's overview puts its own folders in `sources`/, 'area overviews'],
    [/resolve the ties/, 'file-map ties'],
  ]);
});
