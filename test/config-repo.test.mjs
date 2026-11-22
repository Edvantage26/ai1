import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configRepoDirectory, isExcluded, listRepoFiles, planConfigSync, readConfigState, runConfigSync } from '../src/config/config-repo.mjs';

function writeFile(filePath, text) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, text);
}

// A home folder and a config repo inside its ai1 folder, with the common tree and one machine tree.
function createSetup() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const pathOptions = { homeDirectory, environment: {} };
  const repoDirectory = configRepoDirectory(pathOptions);
  writeFile(join(repoDirectory, 'claude', 'CLAUDE.md'), '# Global rules\n');
  writeFile(join(repoDirectory, 'claude', 'skills', 'deploy-tool', 'SKILL.md'), '---\nname: deploy-tool\n---\n');
  writeFile(join(repoDirectory, 'claude', 'skills', 'deploy-tool', 'scripts', 'run.sh'), 'echo run\n');
  writeFile(join(repoDirectory, 'ai1', 'stack.md'), '## app-logs: Logs\n- area: Logs\n');
  writeFile(join(repoDirectory, 'home', 'CLAUDE.md'), '# Home\n');
  writeFile(join(repoDirectory, 'machines', 'box-1', 'claude', 'skills', 'local-only', 'SKILL.md'), 'only here\n');
  writeFile(join(repoDirectory, 'machines', 'box-1', 'home', 'CLAUDE.md'), '# Home of box-1\n');
  writeFile(join(repoDirectory, 'machines', 'box-2', 'home', 'CLAUDE.md'), '# Home of box-2\n');
  writeFile(join(repoDirectory, 'tools', 'lock.json'), '{}\n');
  writeFile(join(repoDirectory, 'ai1-config.json'), JSON.stringify({ files: [{ repo: 'tools/lock.json', target: '~/skills-lock.json' }] }));
  writeFile(join(homeDirectory, '.config', 'ai1', 'config-state.json'), JSON.stringify({ machine: 'Box-1', files: {} }));
  return { homeDirectory, pathOptions, repoDirectory };
}

const kindsByKey = (plan) => Object.fromEntries(plan.actions.map((action) => [action.key, action.kind]));

test('a new machine: every file of the common and this machine\'s tree lands in its place, a different file is kept as .bak, and then all is in sync [ai1-config:S1]', () => {
  const { homeDirectory, pathOptions, repoDirectory } = createSetup();
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Old rules\n');
  const plan = planConfigSync(repoDirectory, { pathOptions });
  assert.equal(plan.machine, 'box-1');
  assert.deepEqual(kindsByKey(plan), {
    'claude/CLAUDE.md': 'install-backup',
    'claude/skills/deploy-tool/SKILL.md': 'install',
    'claude/skills/deploy-tool/scripts/run.sh': 'install',
    'ai1/stack.md': 'install',
    'home/CLAUDE.md': 'install',
    'claude/skills/local-only/SKILL.md': 'install',
    'file:~/skills-lock.json': 'install',
  });
  const { backups, conflicts } = runConfigSync(repoDirectory, plan, { pathOptions });
  assert.deepEqual(conflicts, []);
  assert.deepEqual(backups, [join(homeDirectory, '.claude', 'CLAUDE.md.bak')]);
  assert.equal(readFileSync(join(homeDirectory, '.claude', 'CLAUDE.md.bak'), 'utf8'), '# Old rules\n');
  assert.equal(readFileSync(join(homeDirectory, '.claude', 'CLAUDE.md'), 'utf8'), '# Global rules\n');
  assert.equal(readFileSync(join(homeDirectory, '.claude', 'skills', 'deploy-tool', 'scripts', 'run.sh'), 'utf8'), 'echo run\n');
  assert.equal(readFileSync(join(homeDirectory, 'CLAUDE.md'), 'utf8'), '# Home of box-1\n', 'the machine tree wins');
  assert.equal(readFileSync(join(homeDirectory, '.config', 'ai1', 'stack.md'), 'utf8'), '## app-logs: Logs\n- area: Logs\n');
  assert.ok(existsSync(join(homeDirectory, 'skills-lock.json')));
  assert.ok(Object.values(kindsByKey(planConfigSync(repoDirectory, { pathOptions }))).every((kind) => kind === 'in-sync'));
  assert.equal(readConfigState(pathOptions).files['home/CLAUDE.md'].source, 'machine');
});

test('afterwards: a changed copy is captured into its own tree, a changed repo file is applied, both changed is a conflict that touches nothing', () => {
  const { homeDirectory, pathOptions, repoDirectory } = createSetup();
  runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions });
  writeFile(join(homeDirectory, '.claude', 'skills', 'deploy-tool', 'SKILL.md'), 'edited in a session\n');
  writeFile(join(homeDirectory, 'CLAUDE.md'), '# Home of box-1, edited\n');
  writeFile(join(repoDirectory, 'ai1', 'stack.md'), '## app-logs: Logs from another machine\n');
  writeFile(join(repoDirectory, 'claude', 'CLAUDE.md'), '# Rules from another machine\n');
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Rules edited here\n');
  const plan = planConfigSync(repoDirectory, { pathOptions });
  assert.equal(kindsByKey(plan)['claude/skills/deploy-tool/SKILL.md'], 'capture');
  assert.equal(kindsByKey(plan)['home/CLAUDE.md'], 'capture');
  assert.equal(kindsByKey(plan)['ai1/stack.md'], 'apply');
  assert.equal(kindsByKey(plan)['claude/CLAUDE.md'], 'conflict');
  const { conflicts } = runConfigSync(repoDirectory, plan, { pathOptions });
  assert.deepEqual(conflicts.map((conflict) => conflict.key), ['claude/CLAUDE.md']);
  assert.equal(readFileSync(join(repoDirectory, 'claude', 'skills', 'deploy-tool', 'SKILL.md'), 'utf8'), 'edited in a session\n');
  assert.equal(readFileSync(join(repoDirectory, 'machines', 'box-1', 'home', 'CLAUDE.md'), 'utf8'), '# Home of box-1, edited\n', 'back to the tree it came from');
  assert.equal(readFileSync(join(repoDirectory, 'home', 'CLAUDE.md'), 'utf8'), '# Home\n');
  assert.equal(readFileSync(join(homeDirectory, '.config', 'ai1', 'stack.md'), 'utf8'), '## app-logs: Logs from another machine\n');
  assert.equal(readFileSync(join(homeDirectory, '.claude', 'CLAUDE.md'), 'utf8'), '# Rules edited here\n');
  assert.equal(readFileSync(join(repoDirectory, 'claude', 'CLAUDE.md'), 'utf8'), '# Rules from another machine\n');
});

test('new skills are taken in (not synced ones nor caches); deletions travel both ways; a dropped file the person changed is kept', () => {
  const { homeDirectory, pathOptions, repoDirectory } = createSetup();
  runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions });
  writeFile(join(homeDirectory, '.claude', 'skills', 'new-tool', 'SKILL.md'), 'new\n');
  writeFile(join(homeDirectory, '.claude', 'skills', 'new-tool', '__pycache__', 'x.pyc'), 'cache');
  writeFile(join(homeDirectory, '.claude', 'skills', 'synced', 'abc', 'SKILL.md'), 'synced by claude.ai');
  writeFile(join(homeDirectory, '.claude', 'history.jsonl'), 'state of Claude Code');
  rmSync(join(homeDirectory, '.claude', 'skills', 'deploy-tool', 'scripts', 'run.sh'));
  rmSync(join(repoDirectory, 'ai1', 'stack.md'));
  rmSync(join(repoDirectory, 'claude', 'skills', 'local-only', 'SKILL.md').replace(join('claude', 'skills', 'local-only'), join('machines', 'box-1', 'claude', 'skills', 'local-only')));
  writeFile(join(homeDirectory, '.claude', 'skills', 'local-only', 'SKILL.md'), 'changed here before it was dropped\n');
  const plan = planConfigSync(repoDirectory, { pathOptions });
  const kinds = kindsByKey(plan);
  assert.equal(kinds['claude/skills/new-tool/SKILL.md'], 'capture-new');
  assert.equal(kinds['claude/skills/deploy-tool/scripts/run.sh'], 'capture-delete');
  assert.equal(kinds['ai1/stack.md'], 'apply-delete');
  assert.equal(kinds['claude/skills/local-only/SKILL.md'], 'conflict');
  assert.ok(!Object.keys(kinds).some((key) => /synced|pycache|history/.test(key)));
  runConfigSync(repoDirectory, plan, { pathOptions });
  assert.ok(existsSync(join(repoDirectory, 'claude', 'skills', 'new-tool', 'SKILL.md')));
  assert.ok(!existsSync(join(repoDirectory, 'claude', 'skills', 'deploy-tool', 'scripts', 'run.sh')));
  assert.ok(!existsSync(join(homeDirectory, '.config', 'ai1', 'stack.md')));
  assert.ok(existsSync(join(homeDirectory, '.claude', 'skills', 'local-only', 'SKILL.md')));
});

test('only directions asked are carried out: apply alone leaves captures for later', () => {
  const { homeDirectory, pathOptions, repoDirectory } = createSetup();
  runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions });
  writeFile(join(homeDirectory, '.claude', 'skills', 'deploy-tool', 'SKILL.md'), 'edited\n');
  runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions, directions: ['apply'] });
  assert.equal(readFileSync(join(repoDirectory, 'claude', 'skills', 'deploy-tool', 'SKILL.md'), 'utf8'), '---\nname: deploy-tool\n---\n');
  assert.equal(kindsByKey(planConfigSync(repoDirectory, { pathOptions }))['claude/skills/deploy-tool/SKILL.md'], 'capture');
});

test('exclusions: always the synced skills, trash, caches and .bak; plus the repo\'s own', () => {
  assert.ok(isExcluded('claude/skills/synced/x/SKILL.md'));
  assert.ok(isExcluded('claude/skills/.trash/x'));
  assert.ok(isExcluded('claude/skills/a/__pycache__/b.pyc'));
  assert.ok(isExcluded('claude/CLAUDE.md.bak'));
  assert.ok(isExcluded('claude/skills/private-tool/SKILL.md', ['claude/skills/private-tool']));
  assert.ok(!isExcluded('claude/skills/deploy-tool/SKILL.md'));
  const { pathOptions, repoDirectory } = createSetup();
  assert.ok(listRepoFiles(repoDirectory, { pathOptions, machine: 'box-2' }).every((managedFile) => managedFile.key !== 'claude/skills/local-only/SKILL.md'));
});
