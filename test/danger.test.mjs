import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import dangerGuard, { findDangerousCommands, DANGER_RULES } from '../src/guards/danger.mjs';

const EXPECTED_DECISIONS = [
  // Routine work passes.
  ['git status', 'allow'],
  ['git commit -m "refactor: remove --no-verify mention"', 'allow'],
  ['git push origin feature/x', 'allow'],
  ['git checkout -b feature/new', 'allow'],
  ['git restore --staged src/app.ts', 'allow'],
  ['git clean -n', 'allow'],
  ['rm -rf node_modules dist', 'allow'],
  ['rm -rf /tmp/build-cache', 'allow'],
  ['rm file.txt', 'allow'],
  ['psql -c "DELETE FROM sessions WHERE expired"', 'allow'],
  ['docker compose down', 'allow'],
  ['find . -name "*.pyc" -print', 'allow'],
  ['find node_modules -name "*.map" -delete', 'allow'],
  ['find . -name "*.ts" -exec grep -l TODO {} \\;', 'allow'],
  ['ls | xargs cat', 'allow'],
  ['truncate -s +1M disk.img', 'allow'],
  // Destructive but sometimes intended: the person confirms.
  ['git reset --hard origin/main', 'ask'],
  ['git push --force', 'ask'],
  ['git push -f origin main', 'ask'],
  ['git push origin +main', 'ask'],
  ['git push --force-with-lease', 'ask'],
  ['git clean -fd', 'ask'],
  ['git checkout -- .', 'ask'],
  ['git restore src/app.ts', 'ask'],
  ['git stash drop', 'ask'],
  ['git branch -D old-feature', 'ask'],
  ['rm -rf src', 'ask'],
  ['rm -r -f ./data', 'ask'],
  ['psql -c "DROP TABLE users"', 'ask'],
  ['psql -c "truncate orders"', 'ask'],
  ['psql -c "DELETE FROM orders;"', 'ask'],
  ['docker volume rm pgdata', 'ask'],
  ['docker compose down -v', 'ask'],
  ['cd repo && git fetch && git reset --hard', 'ask'],
  ['bash -c "git reset --hard"', 'ask'],
  ['eval git reset --hard', 'ask'],
  ['eval "rm -rf src"', 'ask'],
  ['xargs rm -rf < list', 'ask'],
  ['cat list | xargs -I {} rm -r {}', 'ask'],
  ['find . -name "*.log" -delete', 'ask'],
  ['find . -type d -exec rm -rf {} +', 'ask'],
  ['truncate -s0 db.sqlite', 'ask'],
  ['truncate --size=0 app.log', 'ask'],
  ['truncate -s 10K data.csv', 'ask'],
  ['sudo rm -rf /var/lib/app', 'ask'],
  ['git worktree remove --force .claude/worktrees/feature', 'ask'],
  ['git worktree remove -f ../feature', 'ask'],
  ['ai1 worktree drop feature --confirm', 'ask'],
  ['ai1 worktree finish feature', 'ask'],
  ['ai1 later new prod-guard --idea --title "Guard production writes"', 'ask'],
  ['ai1 later set 1 accepted', 'allow'],
  ['git worktree list', 'allow'],
  ['ai1 worktree list', 'allow'],
  // Bypassing safety or wiping everything: refused.
  ['git commit --no-verify -m "wip"', 'deny'],
  ['git commit -nm "wip"', 'deny'],
  ['git push --no-verify', 'deny'],
  ['git -c core.hooksPath=/dev/null commit -m x', 'deny'],
  ['rm -rf /', 'deny'],
  ['rm -rf ~', 'deny'],
  ['mkfs.ext4 /dev/sdb1', 'deny'],
  ['dd if=/dev/zero of=/dev/sda', 'deny'],
];

for (const [commandLine, expectedDecision] of EXPECTED_DECISIONS) {
  test(`danger: ${expectedDecision} <- ${commandLine}`, () => {
    const moduleDecision = dangerGuard.run({ hookInput: { tool_input: { command: commandLine } }, moduleOptions: {} });
    assert.equal(moduleDecision.kind, expectedDecision, JSON.stringify(moduleDecision));
  });
}

test('every non-allow decision explains itself', () => {
  const moduleDecision = dangerGuard.run({ hookInput: { tool_input: { command: 'git reset --hard' } }, moduleOptions: {} });
  assert.match(moduleDecision.reason, /git-reset-hard/);
  assert.match(moduleDecision.reason, /stash/);
});

test('ignore_rules switches a rule off for the repo', () => {
  assert.equal(findDangerousCommands('rm -rf src', ['rm-recursive-force']).length, 0);
  assert.equal(findDangerousCommands('rm -rf src').length, 1);
});

test('plain git worktree remove asks only when the worktree holds ignored files', () => {
  const mainRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-danger-wt-')));
  const runGit = (gitArguments) => execFileSync('git', ['-C', mainRoot, ...gitArguments], { stdio: 'ignore' });
  writeFileSync(join(mainRoot, '.gitignore'), '.env\n');
  runGit(['init', '-q']);
  runGit(['add', '.']);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  runGit(['worktree', 'add', '-q', '-b', 'feature', join(mainRoot, '..', `${basename(mainRoot)}-feature`)]);
  const removeCommand = `git worktree remove ../${basename(mainRoot)}-feature`;
  const runGuard = () => dangerGuard.run({ hookInput: { cwd: mainRoot, tool_input: { command: removeCommand } }, moduleOptions: {} });
  assert.equal(runGuard().kind, 'allow');
  writeFileSync(join(mainRoot, '..', `${basename(mainRoot)}-feature`, '.env'), 'SECRET=1\n');
  const askDecision = runGuard();
  assert.equal(askDecision.kind, 'ask');
  assert.match(askDecision.reason, /\.env/);
});

test('rule ids are unique', () => {
  const ruleIds = DANGER_RULES.map((dangerRule) => dangerRule.id);
  assert.equal(new Set(ruleIds).size, ruleIds.length);
});
