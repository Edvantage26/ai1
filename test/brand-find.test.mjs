import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBrandOwner, readBrandSection } from '../src/design/brand-find.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));

function createRepo(parentDirectory, repoName, designSystemText) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(join(repoRoot, '.ai1', 'okf', 'design'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n# x\n');
  if (designSystemText) writeFileSync(join(repoRoot, '.ai1', 'okf', 'design', 'design-system.md'), designSystemText);
  execFileSync('git', ['init', '-q', repoRoot]);
  return repoRoot;
}

// A decision log and its `.repo` sidecar, as the hooks leave them, so the repo is known on this machine.
function registerRepo(pluginDataDirectory, repoRoot, logHash) {
  const stateDirectory = join(pluginDataDirectory, 'state');
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(join(stateDirectory, `decisions-${logHash}.jsonl`), '');
  writeFileSync(join(stateDirectory, `decisions-${logHash}.repo`), JSON.stringify({ name: logHash, path: repoRoot }));
}

const CLINIC_DESIGN_SYSTEM = `---
type: DesignSystem
title: Clinic web design system
brand_owner: Clínica Sol
---

# Palette

Not the brand.

## Brand

- Logo: \`public/logo.svg\` (source: https://clinicasol.example)
- Colours: #0E7C66 primary, #F4B400 accent (source: the logo)

## Spacing

8px grid.
`;

test('names match ignoring case, accents and punctuation; the Brand section is read up to the next heading', () => {
  assert.equal(normalizeBrandOwner('Clínica  Sol, S.L.'), normalizeBrandOwner('clinica sol s l'));
  assert.notEqual(normalizeBrandOwner('Clínica Sol'), normalizeBrandOwner('Clínica Solar'));
  assert.equal(readBrandSection('# A\n## Brand\n- Logo: x\n## Next\ny'), '- Logo: x');
  assert.equal(readBrandSection('# A\nno brand'), null);
});

test('ai1 brand find lists the client brand recorded in other repos on this machine, never the current one [design-client-brand:S3]', () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'ai1-brand-'));
  const pluginDataDirectory = join(workspaceRoot, '.plugin-data');
  const clinicRepo = createRepo(workspaceRoot, 'clinic-web', CLINIC_DESIGN_SYSTEM);
  mkdirSync(join(clinicRepo, 'public'));
  writeFileSync(join(clinicRepo, 'public', 'logo.svg'), '<svg/>');
  const otherClientRepo = createRepo(workspaceRoot, 'other-web', CLINIC_DESIGN_SYSTEM.replace('brand_owner: Clínica Sol', 'brand_owner: Clínica Solar'));
  const currentRepo = createRepo(workspaceRoot, 'clinic-app', CLINIC_DESIGN_SYSTEM);
  registerRepo(pluginDataDirectory, clinicRepo, 'aaa111');
  registerRepo(pluginDataDirectory, otherClientRepo, 'bbb222');
  registerRepo(pluginDataDirectory, currentRepo, 'ccc333');
  registerRepo(pluginDataDirectory, join(workspaceRoot, 'gone'), 'ddd444');
  const environment = { ...process.env, CLAUDE_PLUGIN_DATA: pluginDataDirectory };

  const findRun = spawnSync(process.execPath, [AI1_CLI, 'brand', 'find', 'clinica sol'], { cwd: currentRepo, encoding: 'utf8', env: environment });
  assert.equal(findRun.status, 0, findRun.stderr);
  assert.match(findRun.stdout, new RegExp(`^Clínica Sol in ${clinicRepo.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\nconcept: .*design-system\\.md\n- Logo: \`${join(clinicRepo, 'public', 'logo.svg').replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}\``));
  assert.match(findRun.stdout, /#0E7C66 primary/);
  assert.doesNotMatch(findRun.stdout, /8px grid|other-web|clinic-app/);

  const jsonRun = spawnSync(process.execPath, [AI1_CLI, 'brand', 'find', 'Clínica Sol', '--json'], { cwd: currentRepo, encoding: 'utf8', env: environment });
  assert.deepEqual(JSON.parse(jsonRun.stdout).map((recordedBrand) => recordedBrand.repoRoot), [clinicRepo]);

  const noMatch = spawnSync(process.execPath, [AI1_CLI, 'brand', 'find', 'Panadería Luna'], { cwd: currentRepo, encoding: 'utf8', env: environment });
  assert.match(noMatch.stdout, /no brand of "Panadería Luna" recorded in other repos/);
  const usageRun = spawnSync(process.execPath, [AI1_CLI, 'brand'], { cwd: currentRepo, encoding: 'utf8', env: environment });
  assert.equal(usageRun.status, 1);
  assert.match(usageRun.stdout, /usage: ai1 brand find/);
});
