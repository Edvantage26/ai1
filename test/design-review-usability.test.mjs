// /ai1:design-review-usability is instructions for the agent: these tests pin the parts of its text
// that carry each approved behaviour, as the other skill tests of ai1 do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applySkillVisibility } from '../src/core/skill-visibility.mjs';

const readRepoFile = (relativePath) => readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
const SKILL_TEXT = readRepoFile('skills/design-review-usability/SKILL.md');

test('a user-agent that knows only the profile and the goal tries the task, every step is walked, findings by severity and synthetic [usability-review:S1]', () => {
  assert.match(SKILL_TEXT, /## 3\. The user-agent[\s\S]*with only this brief[\s\S]*no code, no repo paths, no step captions, no hints/);
  assert.match(SKILL_TEXT, /> You are <profile text, word for word>[\s\S]*Your goal:\n> <goal>[\s\S]*after 25 actions, or when this person would give up/);
  assert.match(SKILL_TEXT, /## 4\. Walk every step yourself[\s\S]*1\. Will this user try to do the right thing[\s\S]*2\. Will they notice[\s\S]*3\. Will they connect[\s\S]*4\. After acting, will they see/);
  assert.match(SKILL_TEXT, /Each finding: step, profile, severity, what the\nuser runs into[\s\S]*one fix proposed/);
  assert.match(SKILL_TEXT, /\*\*P0\*\* the user cannot finish the goal\. \*\*P1\*\*[\s\S]*\*\*P3\*\* polish/);
  assert.match(SKILL_TEXT, /## Fixed rules[\s\S]*- Every finding is labelled synthetic/);
  assert.match(SKILL_TEXT, /- The user-agent never sees the code, the repo, the storyboard captions or hints/);
  assert.match(SKILL_TEXT, /`reference\/cognitive-load\.md`/);
  assert.ok(existsSync(fileURLToPath(new URL('../skills/design-review-usability/reference/cognitive-load.md', import.meta.url))));
});

test('without a profile the skill asks who uses the flow and records it in the Product concept first [usability-review:S2]', () => {
  assert.match(SKILL_TEXT, /`## Users` section of the knowledge concept of type `Product`/);
  assert.match(SKILL_TEXT, /No profile, or none that uses this flow: ask the person[\s\S]*Record the answer as a\s+`### <name>` under `## Users` in the `Product` concept[\s\S]*before going on/);
  assert.match(SKILL_TEXT, /- No review without a profile: ask the person and record it first\./);
});

test('fixes are proposed, never applied before the person says which [usability-review:S5]', () => {
  assert.match(SKILL_TEXT, /## 6\. Fixes\n\nPropose the fixes; apply none until the person says which\./);
  assert.match(SKILL_TEXT, /- No code change from this skill until the person says which fixes to apply\./);
});

test('after showing a storyboard, its skill offers the usability review in one line, run only after a yes [usability-review:S4]', () => {
  const storyboardSkillText = readRepoFile('skills/storyboard-record-flow/SKILL.md');
  assert.match(storyboardSkillText, /## 4\. Build and show it[\s\S]*If \/ai1:design-review-usability is available, offer it in one more line[\s\S]*Run it only after a yes\.[\s\S]*## 5\. Publish/);
});

test('the copied Impeccable text keeps its origin, commit and license', () => {
  const referenceText = readRepoFile('skills/design-review-usability/reference/cognitive-load.md');
  assert.match(referenceText, /^<!--\nCopied from Impeccable by Paul Bakaus[\s\S]*1995764b4936f2bfbf4eb719cb37b384a45ceacb[\s\S]*Apache License 2\.0: licenses\/impeccable-LICENSE/);
  assert.match(readRepoFile('licenses/impeccable-LICENSE'), /Apache License\s+Version 2\.0/);
  assert.match(readRepoFile('THIRD-PARTY.md'), /\| Cognitive load checklist[^\n]*skills\/design-review-usability\/reference\/cognitive-load\.md[^\n]*pbakaus\/impeccable[^\n]*Apache 2\.0/);
});

test('with design off the skill leaves the agent list like the other skills of a disabled feature', () => {
  const { skillOverrides } = applySkillVisibility({}, { version: 2, trunk: 'main', verify: [], features: { design: false } });
  assert.equal(skillOverrides['ai1:design-review-usability'], 'user-invocable-only');
});
