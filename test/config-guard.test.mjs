import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import configGuard from '../src/guards/config-guard.mjs';
import { listToolCallChanges } from '../src/core/tool-call-paths.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-config-guard-')));

function runGuard(toolName, toolInput) {
  return configGuard.run({ hookInput: { cwd: projectRoot, tool_name: toolName, tool_input: toolInput }, projectRoot });
}

const EXPECTED_DECISIONS = [
  // File tools.
  ['Edit', { file_path: join(projectRoot, '.ai1/config.json') }, 'ask'],
  ['Write', { file_path: join(projectRoot, '.claude/settings.json') }, 'ask'],
  ['MultiEdit', { file_path: join(projectRoot, '.claude/settings.local.json') }, 'ask'],
  ['Write', { file_path: join(projectRoot, '.claude/hooks/guard.sh') }, 'ask'],
  ['Edit', { file_path: join(projectRoot, '.claude/worktrees/feature/.ai1/config.json') }, 'ask'],
  ['Edit', { file_path: '/home/someone/.claude/settings.json' }, 'ask'],
  ['Edit', { file_path: join(projectRoot, 'src/config.json') }, 'allow'],
  ['Write', { file_path: join(projectRoot, '.ai1/okf/index.md') }, 'allow'],
  ['Write', { file_path: join(projectRoot, '.claude/skills/worktree/SKILL.md') }, 'allow'],
  ['Write', { file_path: join(projectRoot, '.ai1/skills/session/overlay.md') }, 'ask'],
  ['Edit', { file_path: join(projectRoot, '.claude/worktrees/feature/.ai1/skills/okf/overlay.md') }, 'ask'],
  // Shell.
  ['Bash', { command: 'echo "{}" > .ai1/config.json' }, 'ask'],
  ['Bash', { command: 'jq ".features.danger=false" .ai1/config.json | tee .ai1/config.json' }, 'ask'],
  ['Bash', { command: "sed -i 's/true/false/' .ai1/config.json" }, 'ask'],
  ['Bash', { command: 'rm .ai1/config.json' }, 'ask'],
  ['Bash', { command: 'mv .claude/settings.json /tmp/settings.json' }, 'ask'],
  ['Bash', { command: 'cp /tmp/x.json .claude/settings.local.json' }, 'ask'],
  ['Bash', { command: 'git checkout -- .ai1/config.json' }, 'ask'],
  ['Bash', { command: 'git -C . rm .ai1/config.json' }, 'ask'],
  ['Bash', { command: 'python3 -c "import json; json.dump({}, open(\'.ai1/config.json\', \'w\'))"' }, 'ask'],
  ['Bash', { command: 'echo "- briefs in Spanish" >> .ai1/skills/session/overlay.md' }, 'ask'],
  ['Bash', { command: 'rm -r .ai1/skills/okf' }, 'ask'],
  ['Bash', { command: 'cat .ai1/config.json' }, 'allow'],
  ['Bash', { command: 'cat .ai1/skills/okf/overlay.md' }, 'allow'],
  ['Bash', { command: 'ai1 init --features okf,danger --verify "npm test"' }, 'allow'],
  ['Bash', { command: 'python3 -c "print(1)" > out.txt' }, 'allow'],
  ['Bash', { command: 'git status && npm test' }, 'allow'],
];

for (const [toolName, toolInput, expectedDecision] of EXPECTED_DECISIONS) {
  test(`config-guard: ${expectedDecision} <- ${toolName} ${toolInput.command || toolInput.file_path}`, () => {
    const moduleDecision = runGuard(toolName, toolInput);
    assert.equal(moduleDecision.kind, expectedDecision, JSON.stringify(moduleDecision));
  });
}

test('config-guard: the reason names the file and asks not to work around it', () => {
  const moduleDecision = runGuard('Bash', { command: 'rm .ai1/config.json' });
  assert.match(moduleDecision.reason, /`\.ai1\/config\.json`/);
  assert.match(moduleDecision.reason, /do not make it another way/);
});

test('config-guard: a symlink that leads to a protected file counts', () => {
  mkdirSync(join(projectRoot, '.ai1'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'config.json'), '{}');
  symlinkSync(join(projectRoot, '.ai1', 'config.json'), join(projectRoot, 'harmless.json'));
  assert.equal(runGuard('Write', { file_path: join(projectRoot, 'harmless.json') }).kind, 'ask');
});

test('tool-call paths: removals, moves and shell writes are told apart', () => {
  const { changes } = listToolCallChanges({ tool_name: 'Bash', tool_input: { command: 'rm -f a.txt && mv b.txt c/ && echo x >> d.log && git rm -q e.txt' } }, '/repo');
  assert.deepEqual(changes.map(({ path, change, movedTo }) => [path, change, movedTo]), [
    ['/repo/a.txt', 'remove', undefined],
    ['/repo/b.txt', 'move', '/repo/c'],
    ['/repo/c', 'move-target', undefined],
    ['/repo/d.log', 'shell-write', undefined],
    ['/repo/e.txt', 'remove', undefined],
  ]);
});

test('config-guard runs through the dispatcher with danger on by default, and can be switched off alone', () => {
  const repoWithDefaults = createTemporaryProject({ version: 1 });
  const hookOutput = runHookEvent('PreToolUse', bashPayload(repoWithDefaults, 'rm .ai1/config.json'));
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(hookOutput.hookSpecificOutput.permissionDecisionReason, /ai1\/config-guard/);
  const repoWithoutGuard = createTemporaryProject({ version: 1, modules: { 'config-guard': false } });
  assert.equal(runHookEvent('PreToolUse', bashPayload(repoWithoutGuard, 'rm .ai1/config.json')), null);
});
