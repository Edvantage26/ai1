// /ai1:ideas-brainstorm-topic is instructions for the agent: these tests pin the parts of its text
// that carry the approved behaviour, as the other skill tests of ai1 do. The live try with
// `claude --plugin-dir` checks that the agent loads it on the person's phrases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { splitFrontmatter } from '../src/core/frontmatter.mjs';

const readRepoFile = (relativePath) => readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), 'utf8');
const SKILL_TEXT = readRepoFile('skills/ideas-brainstorm-topic/SKILL.md');
const TECHNIQUES_TEXT = readRepoFile('skills/ideas-brainstorm-topic/techniques.md');
const DESIGN_SKILL_TEXT = readRepoFile('skills/sizing-design-before-code/SKILL.md');

test('brainstorm: answers problems, innovation and architecture; frames, researches, diverges, keeps ideas, converges with the person deciding [brainstorm-mode:S4]', () => {
  const frontmatterText = splitFrontmatter(SKILL_TEXT).frontmatterText.replace(/\s+/g, ' ');
  for (const triggerPhrase of ['hagamos un brainstorming', 'lluvia de ideas', 'ideas para innovar en', 'qué arquitectura usamos para', "let's brainstorm"]) {
    assert.ok(frontmatterText.includes(triggerPhrase), `trigger "${triggerPhrase}"`);
  }
  assert.match(frontmatterText, /Not for designing one chosen direction into a build plan \(that is \/ai1:sizing-design-before-code\)/);

  assert.match(SKILL_TEXT, /## 1\. Open the brainstorm[\s\S]*`\.ai1\/work\/<slug>\/plan\.md`[\s\S]*size: plan\nstatus: active[\s\S]*`ideas\.md` next to it/);
  assert.match(SKILL_TEXT, /## 2\. Frame \(one question at a time\)[\s\S]*Goals before options/);
  assert.match(SKILL_TEXT, /## 3\. Research before generating[\s\S]*hand them to one subagent[\s\S]*ai1" papers search "<query in English>"/);
  assert.match(SKILL_TEXT, /cite papers only from its output[\s\S]*never from memory/);
  assert.match(SKILL_TEXT, /one finding the conversation has not\s+touched yet/);
  assert.match(SKILL_TEXT, /## 4\. Diverge[\s\S]*several of them, never one[\s\S]*how likely you think a typical answer is/);
  assert.match(SKILL_TEXT, /## 5\. Converge[\s\S]*Merge duplicates[\s\S]*reject with a one-line reason each[\s\S]*comparing them in pairs[\s\S]*top 3[\s\S]*the person chooses/);
  assert.match(SKILL_TEXT, /## Fixed rules[\s\S]*- On demand only[\s\S]*- The person chooses/);

  for (const kindHeading of ['## Problem', '## Innovation', '## Software architecture', '## Scientific', '## Business']) {
    assert.ok(TECHNIQUES_TEXT.includes(kindHeading), `techniques for ${kindHeading}`);
  }
  assert.match(TECHNIQUES_TEXT, /\*\*Quality attributes first\*\*/);
});

test('brainstorm: sizing-design-before-code offers the brainstorm when the direction is open and starts a design from one', () => {
  assert.match(DESIGN_SKILL_TEXT, /direction itself is still open[\s\S]*offer `\/ai1:ideas-brainstorm-topic` in one line/);
  assert.match(DESIGN_SKILL_TEXT, /comes from a brainstorm \(`\.ai1\/work\/brainstorm-\*\/`[\s\S]*the chosen idea is the direction[\s\S]*runners-up and their reasons go under \*\*Approaches\*\*[\s\S]*its research counts as the look outside/);
  assert.match(SKILL_TEXT, /## 6\. Close[\s\S]*sized like any task: a clear,\s+contained one becomes a plan[\s\S]*`size: plan`, naming this folder[\s\S]*design choices or a risky area goes to `\/ai1:sizing-design-before-code`, which starts its design\s+from this folder/);
});
