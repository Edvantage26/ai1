import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateHarnessConfig } from '../src/core/config.mjs';
import {
  resolvePersonRole, isPersonMaintainer, writePersonProfile, readPersonProfile, localDirectoryPath, normalizeEmail,
} from '../src/core/person-project.mjs';
import { createTemporaryProject } from './helpers.mjs';

// The person's own git config must not decide these tests (an email set globally would be read).
const emptyGitConfigPath = join(mkdtempSync(join(tmpdir(), 'ai1-gitconfig-')), 'gitconfig');
writeFileSync(emptyGitConfigPath, '');
process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';

// A git repo whose local `user.email` is the given one (none when null).
function createRepoWithEmail(personEmail, ai1Config = {}) {
  const projectRoot = createTemporaryProject(ai1Config);
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'ignore' });
  if (personEmail) execFileSync('git', ['-C', projectRoot, 'config', 'user.email', personEmail], { stdio: 'ignore' });
  return projectRoot;
}

test('config: maintainers must be a list of git emails', () => {
  assert.deepEqual(validateHarnessConfig({ maintainers: ['ana@x.com'] }), []);
  assert.deepEqual(validateHarnessConfig({ maintainers: 'ana@x.com' }), ['"maintainers" must be a list of git emails']);
  assert.deepEqual(validateHarnessConfig({ maintainers: ['ana'] }), ['"maintainers" must be a list of git emails']);
});

test('person role: listed emails are maintainers, case-insensitive; the rest developers [person-project:S1]', () => {
  const config = { maintainers: ['ana@x.com'] };
  const anaRoot = createRepoWithEmail('Ana@X.com');
  const bobRoot = createRepoWithEmail('bob@x.com');
  assert.deepEqual(resolvePersonRole({ config, sharedRoot: anaRoot }), { role: 'maintainer', source: 'maintainers' });
  assert.deepEqual(resolvePersonRole({ config, sharedRoot: bobRoot }), { role: 'developer', source: 'maintainers' });
});

test('person role: without a maintainers list everyone is a maintainer, as before [person-project:S1]', () => {
  const projectRoot = createRepoWithEmail('bob@x.com');
  assert.deepEqual(resolvePersonRole({ config: {}, sharedRoot: projectRoot }), { role: 'maintainer', source: 'default' });
});

test('person role: no git email with a list is a developer', () => {
  const projectRoot = createRepoWithEmail(null);
  assert.equal(resolvePersonRole({ config: { maintainers: ['ana@x.com'] }, sharedRoot: projectRoot }).role, 'developer');
});

test('person role: the local profile wins over the list, and .ai1/local ignores itself', () => {
  const projectRoot = createRepoWithEmail('bob@x.com');
  writePersonProfile(projectRoot, { role: 'maintainer' });
  assert.equal(isPersonMaintainer({ config: { maintainers: ['ana@x.com'] }, sharedRoot: projectRoot }), true);
  assert.deepEqual(readPersonProfile(projectRoot), { role: 'maintainer' });
  assert.equal(readFileSync(join(localDirectoryPath(projectRoot), '.gitignore'), 'utf8'), '*\n');
  assert.equal(existsSync(join(localDirectoryPath(projectRoot), 'profile.json')), true);
});

test('normalizeEmail trims and lower-cases, null for empty', () => {
  assert.equal(normalizeEmail('  Ana@X.COM\n'), 'ana@x.com');
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail(undefined), null);
});
