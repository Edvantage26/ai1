import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import issueGuard, { readOptionValue } from '../src/core/issue-guard.mjs';
import { ALL_MODULES } from '../src/core/registry.mjs';
import { createFakeRepo } from './helpers.mjs';

const clientRepo = createFakeRepo('acme-portal', 'git@github.com:acme-corp/acme-portal.git');
const runGuard = (command, workingDirectory = clientRepo) => issueGuard.run({ hookInput: { tool_input: { command }, cwd: workingDirectory }, projectRoot: clientRepo, environment: {} });

function writeDraft(fileName, bodyText) {
  writeFileSync(join(clientRepo, fileName), bodyText);
  return fileName;
}

test('issue-guard: registered as a core Bash guard', () => {
  assert.ok(ALL_MODULES.some((loadedModule) => loadedModule.id === 'issue-guard' && loadedModule.feature === 'core'));
});

test('issue-guard: refuses a private name, path, email, IP, host or token in the title or body, listing each with its placeholder [issue-privacy-check:S2]', () => {
  const draftFile = writeDraft('draft-private.md', 'Seen in /home/tester/x, mail ops@acme.dev, host 10.1.2.3 and https://ci.acme.tech.\n');
  const fileDecision = runGuard(`gh issue create -R Edvantage26/ai1 --title "sizing: refused in acme-portal" --body-file ${draftFile} --label bug`);
  assert.equal(fileDecision.kind, 'deny');
  for (const expectedLine of ['- title: repo name `acme-portal` -> `<repo>`', 'home path `/home/tester` -> `<home>`', 'email `ops@acme.dev` -> `<email>`', 'ip `10.1.2.3` -> `<ip>`', 'host `ci.acme.tech` -> `<host>`']) {
    assert.ok(fileDecision.reason.includes(expectedLine), `${expectedLine} in ${fileDecision.reason}`);
  }
  assert.equal(runGuard('gh issue comment 6 --repo=https://github.com/Edvantage26/ai1 --body "token ghp_abcdefghijklmnopqrstuvwxyz0123456789"').kind, 'deny');
  assert.equal(runGuard(`ai1 issue url --title "x" --body-file ${draftFile}`).kind, 'deny');
  assert.equal(runGuard(`GH_REPO=Edvantage26/ai1 gh pr create -t "fix acme-portal" -b "x"`).kind, 'deny');
});

test('issue-guard: refuses a body it cannot read [issue-privacy-check:S3]', () => {
  const heredocDecision = runGuard('gh issue create -R Edvantage26/ai1 --title "x" --body "$(cat <<\'EOF\'\nhello\nEOF\n)"');
  assert.equal(heredocDecision.kind, 'deny');
  assert.match(heredocDecision.reason, /Write the body to a file first, then publish in a separate command with `--body-file <file>`/);
  assert.equal(runGuard('gh issue create -R Edvantage26/ai1 --title "x" -F -').kind, 'deny');
  assert.match(runGuard('cat > new.md <<EOF\nx\nEOF\ngh issue create -R Edvantage26/ai1 -t "x" -F new.md').reason, /does not exist yet/);
});

test('issue-guard: a clean body and the fixed-facts comment go through [issue-privacy-check:S4]', () => {
  const draftFile = writeDraft('draft-clean.md', '## What happened\nIn <repo>, `cd <repo>/.ai1/work/<slug> && sed -i s/a/b/ plan.md` was not recognised.\n\n- ai1: 0.54.0\n- Node: v22.22.3\n');
  assert.equal(runGuard(`gh issue create -R Edvantage26/ai1 --title "sizing: a plan written from Bash is refused" --body-file ${draftFile}`).kind, 'allow');
  assert.equal(runGuard('gh issue comment 6 -R Edvantage26/ai1 --body "Seen again on ai1 0.54.0."').kind, 'allow');
});

test('issue-guard: other repositories and other commands are left alone [issue-privacy-check:S5]', () => {
  const draftFile = writeDraft('draft-other.md', 'acme-portal at /home/tester\n');
  assert.equal(runGuard(`gh issue create -R acme-corp/acme-portal --title "acme-portal" --body-file ${draftFile}`).kind, 'allow');
  assert.equal(runGuard(`gh issue create --title "acme-portal" --body-file ${draftFile}`).kind, 'allow', 'cwd remote is not ai1');
  assert.equal(runGuard('gh issue list -R Edvantage26/ai1 --search acme-portal').kind, 'allow');
  assert.equal(runGuard('git status').kind, 'allow');
  const ai1Checkout = createFakeRepo('ai1', 'https://github.com/Edvantage26/ai1.git');
  assert.equal(runGuard(`gh issue create --title "acme-portal" --body "x"`, ai1Checkout).kind, 'deny', 'no -R inside an ai1 checkout targets ai1');
});

test('readOptionValue: separate, = and attached short forms', () => {
  assert.equal(readOptionValue(['gh', '--title', 'a b'], ['-t', '--title']), 'a b');
  assert.equal(readOptionValue(['gh', '--title=a'], ['-t', '--title']), 'a');
  assert.equal(readOptionValue(['gh', '-Fdraft.md'], ['-F', '--body-file']), 'draft.md');
  assert.equal(readOptionValue(['gh', 'issue'], ['-t', '--title']), undefined);
});
