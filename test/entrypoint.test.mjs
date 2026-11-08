import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const HOOK_ENTRYPOINT = fileURLToPath(new URL('../bin/ai1-hook.mjs', import.meta.url));

function runEntrypoint(eventName, stdinText, environment = {}) {
  return spawnSync(process.execPath, [HOOK_ENTRYPOINT, eventName], {
    input: stdinText,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...environment },
  });
}

test('entrypoint prints the decision JSON and exits 0', () => {
  const projectRoot = createTemporaryProject({});
  const hookRun = runEntrypoint('PreToolUse', JSON.stringify(bashPayload(projectRoot, 'git push --force')));
  assert.equal(hookRun.status, 0);
  assert.equal(JSON.parse(hookRun.stdout).hookSpecificOutput.permissionDecision, 'ask');
});

test('entrypoint fails open on garbage input', () => {
  const hookRun = runEntrypoint('PreToolUse', '{ this is not json');
  assert.equal(hookRun.status, 0);
  assert.equal(hookRun.stdout, '');
  assert.match(hookRun.stderr, /failed open/);
});
