// `ai1 config ...`: the person's config repo (src/config/). Works from any folder.
//   init [--remote <url>]   a new repo in ~/.config/ai1/config-repo/ with what is already in ~/.claude
//   clone <remote>          a new machine: clone and put every file in place (a different one kept as .bak)
//   adopt <dir> [--auto-push]  an existing config repo wired with symlinks (an install script): reordered
//                           to ai1's layout, moved to ~/.config/ai1/config-repo/, symlinks turned into copies
//   status [--json]         what is in sync, changed, in conflict; unpushed commits
//   sync                    pull (rebase), apply, capture, commit; push when autoPush
//   commit [-m "..."] [--include <repo path>]...   capture and commit now (a file with a secret-like line is held back)
//   push                    push the commits
//   new-skill <name>        a skill for one technology from the template, in ~/.claude/skills/<name>/
//   machine <name> | off | on

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { runGit, tryGit } from '../core/git.mjs';
import {
  CONFIG_OPTIONS_FILE, DEFAULT_SETTINGS_KEYS, configDirectory, configRepoDirectory, expandHome, hasConfigRepo, machineName,
  planConfigSync, readConfigOptions, readConfigState, writeConfigState,
} from './config-repo.mjs';
import { planSettingsSync, settingsTargetPath } from './config-settings.mjs';
import { applyFromRepo, captureAndCommit, countUnpushedCommits, hasRemote, pushToRemote, syncConfig, withConfigLock } from './config-sync.mjs';

export const CONFIG_USAGE = 'ai1 config init [--remote <url>] | clone <remote> | adopt <dir> [--auto-push] | status [--json] | sync | commit [-m "..."] [--include <repo path>]... | push | new-skill <name> | machine <name> | off | on';

const toRepoPath = (relativePath) => relativePath.split(sep).join('/');

function readOptionValues(commandArguments, optionName) {
  return commandArguments.flatMap((commandArgument, argumentIndex) => (commandArgument === optionName && commandArguments[argumentIndex + 1] !== undefined ? [commandArguments[argumentIndex + 1]] : []));
}

function positionalArguments(commandArguments) {
  const valued = new Set(['--remote', '-m', '--include']);
  return commandArguments.filter((commandArgument, argumentIndex) => !commandArgument.startsWith('-') && !valued.has(commandArguments[argumentIndex - 1]));
}

function writeOptionsFile(repoDirectory, options) {
  writeFileSync(join(repoDirectory, CONFIG_OPTIONS_FILE), `${JSON.stringify(options, null, 2)}\n`);
}

const DEFAULT_OPTIONS = (autoPush) => ({ autoPush, settingsKeys: DEFAULT_SETTINGS_KEYS, exclude: [], files: [], links: [] });

function describeConflicts(outcome) {
  const conflictLines = [
    ...(outcome.conflicts || []).map((conflict) => `  conflict: ${conflict.key} changed in the repo and in ${conflict.targetPath}; keep one by copying it over the other, then ai1 config commit`),
    ...(outcome.settingsConflicts || []).map((conflict) => `  conflict: settings.json key "${conflict.key}" changed in the repo and in ~/.claude/settings.json`),
  ];
  return conflictLines;
}

// --- init / clone ------------------------------------------------------------------------------

function initConfigRepo(pathOptions, { remote, autoPush = false }) {
  const repoDirectory = configRepoDirectory(pathOptions);
  if (existsSync(repoDirectory)) throw new Error(`${repoDirectory} already exists`);
  mkdirSync(repoDirectory, { recursive: true });
  runGit(repoDirectory, ['init', '--quiet', '-b', 'main']);
  writeOptionsFile(repoDirectory, DEFAULT_OPTIONS(autoPush));
  writeFileSync(join(repoDirectory, '.gitignore'), '*.bak\n*.local.json\n.env\n');
  writeFileSync(join(repoDirectory, 'README.md'), '# My Claude Code config\n\nKept by ai1 (`ai1 config`): `claude/` -> ~/.claude, `home/` -> ~, `ai1/` -> ~/.config/ai1, `machines/<host>/` for one machine only.\n');
  if (remote) runGit(repoDirectory, ['remote', 'add', 'origin', remote]);
  const outcome = withConfigLock(pathOptions, () => captureAndCommit(pathOptions, { message: 'config: first capture' }));
  return { repoDirectory, outcome };
}

function cloneConfigRepo(pathOptions, remote) {
  const repoDirectory = configRepoDirectory(pathOptions);
  if (existsSync(repoDirectory)) throw new Error(`${repoDirectory} already exists`);
  mkdirSync(dirname(repoDirectory), { recursive: true });
  runGit(dirname(repoDirectory), ['clone', '--quiet', remote, repoDirectory]);
  const outcome = withConfigLock(pathOptions, () => applyFromRepo(pathOptions));
  writeConfigState({ ...readConfigState(pathOptions), lastSyncAt: new Date().toISOString() }, pathOptions);
  return { repoDirectory, outcome };
}

// --- adopt -------------------------------------------------------------------------------------

// Symlinks under the person's folders that point into `sourceDirectory`: [{ linkPath, targetInSource }].
function findSymlinksInto(sourceDirectory, pathOptions) {
  const homeDirectory = pathOptions.homeDirectory || homedir();
  const realSource = realpathSync(sourceDirectory);
  const scanFolders = [[homeDirectory, 1], [join(homeDirectory, '.claude'), 1], [join(homeDirectory, '.claude', 'scripts'), 1], [configDirectory(pathOptions), 4], [join(homeDirectory, '.local', 'bin'), 1]];
  const foundLinks = new Map();
  const scan = (folderPath, depthLeft) => {
    if (depthLeft < 1 || !existsSync(folderPath)) return;
    for (const directoryEntry of readdirSync(folderPath, { withFileTypes: true })) {
      const entryPath = join(folderPath, directoryEntry.name);
      if (directoryEntry.isSymbolicLink()) {
        let realTarget;
        try {
          realTarget = realpathSync(entryPath);
        } catch {
          continue;
        }
        if (realTarget.startsWith(`${realSource}${sep}`)) foundLinks.set(entryPath, { linkPath: entryPath, targetInSource: toRepoPath(relative(realSource, realTarget)), linkText: readlinkSync(entryPath) });
      } else if (directoryEntry.isDirectory() && depthLeft > 1) {
        scan(entryPath, depthLeft - 1);
      }
    }
  };
  for (const [folderPath, depth] of scanFolders) scan(folderPath, depth);
  return [...foundLinks.values()];
}

// Where a link location goes in ai1's layout: claude/... , home/... , ai1/... or null (a link elsewhere).
function treePathForLocation(linkPath, pathOptions) {
  const homeDirectory = pathOptions.homeDirectory || homedir();
  const roots = [['claude', join(homeDirectory, '.claude')], ['ai1', configDirectory(pathOptions)]];
  for (const [treeName, rootPath] of roots) {
    if (linkPath.startsWith(`${rootPath}${sep}`)) return `${treeName}/${toRepoPath(relative(rootPath, linkPath))}`;
  }
  if (dirname(linkPath) === homeDirectory) return `home/${relative(homeDirectory, linkPath)}`;
  return null;
}

// Reorders a config repo wired with symlinks into ai1's layout and takes it over.
export function adoptConfigRepo(sourceDirectory, pathOptions, { autoPush = false } = {}) {
  const repoDirectory = configRepoDirectory(pathOptions);
  if (hasConfigRepo(pathOptions)) throw new Error(`${repoDirectory} already exists: there is a config repo already`);
  if (!existsSync(join(sourceDirectory, '.git'))) throw new Error(`${sourceDirectory} is not a git repo`);
  const homeDirectory = pathOptions.homeDirectory || homedir();
  const symlinks = findSymlinksInto(sourceDirectory, pathOptions);
  const moves = [];
  const links = [];
  for (const symlink of symlinks) {
    const treePath = treePathForLocation(symlink.linkPath, pathOptions);
    if (treePath) moves.push({ from: symlink.targetInSource, to: treePath.replace(/\/overlay\.md$/, '/customization.md'), symlink });
    else links.push(symlink);
  }
  // A link elsewhere (e.g. ~/.local/bin) keeps pointing at its file, wherever that file moves.
  const newPathOf = (oldPath) => {
    const move = moves.find((candidateMove) => oldPath === candidateMove.from || oldPath.startsWith(`${candidateMove.from}/`));
    return move ? `${move.to}${oldPath.slice(move.from.length)}` : oldPath;
  };
  // Settings: the full file now lives in the repo; the target keeps it whole, the repo only the person's keys.
  const settingsMove = moves.find((move) => move.to === 'claude/settings.json');
  const fullSettingsText = settingsMove ? readFileSync(join(sourceDirectory, settingsMove.from), 'utf8') : null;
  for (const move of moves) {
    if (move.from === move.to) continue;
    mkdirSync(dirname(join(sourceDirectory, move.to)), { recursive: true });
    runGit(sourceDirectory, ['mv', '-k', move.from, move.to]);
  }
  if (fullSettingsText) {
    const fullSettings = JSON.parse(fullSettingsText);
    const personSettings = Object.fromEntries(DEFAULT_SETTINGS_KEYS.filter((key) => key in fullSettings).map((key) => [key, fullSettings[key]]));
    writeFileSync(join(sourceDirectory, 'claude', 'settings.json'), `${JSON.stringify(personSettings, null, 2)}\n`);
  }
  const options = { ...DEFAULT_OPTIONS(autoPush), links: links.map((symlink) => ({ repo: newPathOf(symlink.targetInSource), target: `~/${toRepoPath(relative(homeDirectory, symlink.linkPath))}` })) };
  writeOptionsFile(sourceDirectory, options);
  runGit(sourceDirectory, ['add', '--all']);
  runGit(sourceDirectory, ['commit', '--quiet', '-m', 'config: adopt ai1 config layout (claude/, home/, ai1/)']);
  // The symlinks become copies: remove them, move the repo, keep the old path as a link, then install.
  for (const symlink of symlinks) rmSync(symlink.linkPath, { force: true });
  mkdirSync(dirname(repoDirectory), { recursive: true });
  renameSync(sourceDirectory, repoDirectory);
  symlinkSync(repoDirectory, sourceDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const outcome = withConfigLock(pathOptions, () => applyFromRepo(pathOptions));
  if (fullSettingsText) writeFileSync(settingsTargetPath(pathOptions), fullSettingsText);
  const linkNotes = createLinks(repoDirectory, options.links, pathOptions);
  writeConfigState({ ...readConfigState(pathOptions), lastSyncAt: new Date().toISOString() }, pathOptions);
  const leftInRepo = (tryGit(repoDirectory, ['ls-files']) || '').split('\n').filter((repoPath) => repoPath && !/^(claude|home|ai1|machines)\//.test(repoPath) && repoPath !== CONFIG_OPTIONS_FILE);
  return { repoDirectory, moves, links: options.links, outcome, linkNotes, leftInRepo };
}

// The `links` of ai1-config.json: symlinks, where the OS allows them; skipped with a note otherwise.
export function createLinks(repoDirectory, linkEntries, pathOptions) {
  const homeDirectory = pathOptions.homeDirectory || homedir();
  const notes = [];
  for (const linkEntry of linkEntries) {
    const linkPath = expandHome(linkEntry.target, homeDirectory);
    const repoFilePath = join(repoDirectory, ...linkEntry.repo.split('/'));
    try {
      if (existsSync(linkPath) || isBrokenLink(linkPath)) {
        if (!lstatSync(linkPath).isSymbolicLink()) {
          notes.push(`${linkEntry.target}: a file is there, left as it is`);
          continue;
        }
        rmSync(linkPath, { force: true });
      }
      mkdirSync(dirname(linkPath), { recursive: true });
      symlinkSync(repoFilePath, linkPath);
    } catch (linkError) {
      notes.push(`${linkEntry.target}: not linked (${linkError.code || linkError.message})`);
    }
  }
  return notes;
}

function isBrokenLink(linkPath) {
  try {
    return lstatSync(linkPath).isSymbolicLink();
  } catch {
    return false;
  }
}

// --- new-skill ---------------------------------------------------------------------------------

export function technologySkillTemplate(skillName) {
  return `---
name: ${skillName}
description: <What this technology is and when to use this skill - integrate it into a project, audit it, operate it. Use when ... (the person's own words, in their languages).>
---

# ${skillName}

## When it applies
<Which projects need it: e.g. "every project with a backend". What it does not cover.>

## Integrate
<How it goes into a project: the code (a shared package, the call at start-up), the infrastructure, the
secrets (only where they live), the environment variables. Ask only what the repo does not answer.>

## Audit
<Each check, read-only, with the exact command or query, and what "passes" means.>

## Operate
<How to see its state and logs, how to reach it, what to do when it fails. This is what goes into the
project's \`.ai1/okf/operations.md\`, in the section of its area.>

## When done
In a repo with ai1: run the checks of "Audit"; only if they pass, \`ai1 okf stack set <piece id> integrated
--note "<what, how it was checked, date>"\` (\`ai1 okf stack adopt <piece id>\` first if the project does not
have it); write "Operate" into \`.ai1/okf/operations.md\`.
`;
}

function createTechnologySkill(skillName, pathOptions) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName || '')) throw new Error('new-skill needs a name in lowercase with dashes (the technology: kuma-monitors, o2-observability)');
  const skillPath = join(pathOptions.homeDirectory || homedir(), '.claude', 'skills', skillName, 'SKILL.md');
  if (existsSync(skillPath)) throw new Error(`${skillPath} already exists`);
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, technologySkillTemplate(skillName));
  return skillPath;
}

// --- status ------------------------------------------------------------------------------------

export function describeConfigStatus(pathOptions) {
  const repoDirectory = configRepoDirectory(pathOptions);
  const state = readConfigState(pathOptions);
  const plan = planConfigSync(repoDirectory, { pathOptions, state });
  const settingsPlan = planSettingsSync(repoDirectory, { pathOptions, state });
  const countByKind = {};
  for (const action of [...plan.actions, ...settingsPlan.actions]) countByKind[action.kind] = (countByKind[action.kind] || 0) + 1;
  return {
    repoDirectory,
    machine: plan.machine,
    off: state.off === true,
    lastSyncAt: state.lastSyncAt || null,
    remote: hasRemote(repoDirectory),
    unpushedCommits: countUnpushedCommits(repoDirectory),
    uncommitted: (tryGit(repoDirectory, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length,
    autoPush: readConfigOptions(repoDirectory).autoPush,
    countByKind,
    pending: [...plan.actions, ...settingsPlan.actions].filter((action) => action.kind !== 'in-sync').map((action) => ({ kind: action.kind, key: action.key })),
  };
}

function formatConfigStatus(configStatus) {
  const countText = Object.entries(configStatus.countByKind).map(([kind, count]) => `${count} ${kind}`).join(', ') || 'nothing managed yet';
  return [
    `config repo: ${configStatus.repoDirectory} (machine ${configStatus.machine}${configStatus.off ? ', sync OFF' : ''})`,
    `files: ${countText}`,
    ...configStatus.pending.map((pendingAction) => `  ${pendingAction.kind}: ${pendingAction.key}`),
    `last sync: ${configStatus.lastSyncAt || 'never'}; uncommitted: ${configStatus.uncommitted}; unpushed: ${configStatus.remote ? configStatus.unpushedCommits ?? '?' : 'no remote'}; autoPush: ${configStatus.autoPush}`,
  ].join('\n');
}

// --- entry -------------------------------------------------------------------------------------

export function runConfigCommand(commandArguments, { pathOptions = { environment: process.env, homeDirectory: homedir() }, writeOutput = console.log, writeError = console.error } = {}) {
  const [subcommandName, ...restArguments] = commandArguments;
  const [firstArgument] = positionalArguments(restArguments);
  const needsRepo = !['init', 'clone', 'adopt', 'off', 'on', undefined].includes(subcommandName);
  try {
    if (needsRepo && !hasConfigRepo(pathOptions)) {
      writeError(`no config repo yet: ai1 config init | clone <remote> | adopt <dir> (or /ai1:core-setup-config)`);
      return 1;
    }
    const repoDirectory = configRepoDirectory(pathOptions);
    if (subcommandName === 'init') {
      const { repoDirectory: createdDirectory, outcome } = initConfigRepo(pathOptions, { remote: readOptionValues(restArguments, '--remote')[0], autoPush: restArguments.includes('--auto-push') });
      writeOutput([`config repo created: ${createdDirectory}`, outcome.commit?.committed ? `first commit: ${outcome.commit.changedPaths.length} files` : 'nothing to capture yet', ...heldBackLines(outcome.commit)].join('\n'));
      return 0;
    }
    if (subcommandName === 'clone') {
      if (!firstArgument) throw new Error('clone needs the remote: ai1 config clone <git url or owner/repo>');
      const remote = /^[\w.-]+\/[\w.-]+$/.test(firstArgument) ? `https://github.com/${firstArgument}.git` : firstArgument;
      const { repoDirectory: clonedDirectory, outcome } = cloneConfigRepo(pathOptions, remote);
      writeOutput([`config repo cloned: ${clonedDirectory}`, `installed: ${outcome.done?.length ?? 0} files${outcome.backups?.length ? `; kept as .bak: ${outcome.backups.length}` : ''}`, ...describeConflicts(outcome)].join('\n'));
      return 0;
    }
    if (subcommandName === 'adopt') {
      if (!firstArgument) throw new Error('adopt needs the folder of the existing config repo');
      const sourceDirectory = resolve(isAbsolute(firstArgument) ? firstArgument : join(process.cwd(), firstArgument));
      const adopted = adoptConfigRepo(sourceDirectory, pathOptions, { autoPush: restArguments.includes('--auto-push') });
      writeOutput([
        `adopted: ${sourceDirectory} -> ${adopted.repoDirectory} (the old path is a link to it)`,
        `moved into the layout: ${adopted.moves.length} entries; links kept: ${adopted.links.length}`,
        ...adopted.linkNotes.map((note) => `  note: ${note}`),
        adopted.leftInRepo.length ? `left in the repo as they are (not synced): ${adopted.leftInRepo.join(', ')}` : '',
        ...describeConflicts(adopted.outcome),
      ].filter(Boolean).join('\n'));
      return 0;
    }
    if (subcommandName === 'status') {
      const configStatus = describeConfigStatus(pathOptions);
      writeOutput(restArguments.includes('--json') ? JSON.stringify(configStatus, null, 2) : formatConfigStatus(configStatus));
      return 0;
    }
    if (subcommandName === 'sync') {
      const synced = syncConfig(pathOptions);
      if (!synced.locked) throw new Error('another session is syncing the config repo; try again in a moment');
      writeOutput([
        synced.pull.error && synced.pull.error !== 'no remote' ? `pull failed, nothing applied: ${synced.pull.error}` : synced.pull.pulled ? 'pulled' : 'no remote',
        synced.applied ? `applied: ${synced.applied.done.length} files` : '',
        synced.captured.commit.committed ? `committed: ${synced.captured.commit.message}` : 'nothing to commit',
        ...heldBackLines(synced.captured.commit),
        synced.push ? (synced.push.pushed ? 'pushed' : `push failed: ${synced.push.error}`) : '',
        ...describeConflicts(synced.applied || {}),
        ...describeConflicts(synced.captured),
      ].filter(Boolean).join('\n'));
      return 0;
    }
    if (subcommandName === 'commit') {
      const committed = withConfigLock(pathOptions, () => captureAndCommit(pathOptions, { message: readOptionValues(restArguments, '-m')[0], include: readOptionValues(restArguments, '--include') }));
      if (!committed.locked) throw new Error('another session is writing the config repo; try again in a moment');
      writeOutput([committed.commit.committed ? `committed: ${committed.commit.message}` : 'nothing to commit', ...heldBackLines(committed.commit), ...describeConflicts(committed)].join('\n'));
      return 0;
    }
    if (subcommandName === 'push') {
      const pushed = pushToRemote(repoDirectory);
      writeOutput(pushed.pushed ? 'pushed' : `push failed: ${pushed.error}`);
      return pushed.pushed ? 0 : 1;
    }
    if (subcommandName === 'new-skill') {
      const skillPath = createTechnologySkill(firstArgument, pathOptions);
      writeOutput(`${skillPath} created from the technology template. Fill it in; it is committed at the end of the session. Its piece in your stack: ai1 okf stack add --scope user --id <id> --title "..." --area "..." --applies "..." --setup "${firstArgument}" --check "..."`);
      return 0;
    }
    if (subcommandName === 'machine') {
      if (!firstArgument) throw new Error(`this machine is "${machineName(readConfigState(pathOptions))}"; ai1 config machine <name> changes it`);
      writeConfigState({ ...readConfigState(pathOptions), machine: firstArgument }, pathOptions);
      writeOutput(`this machine is now "${machineName({ machine: firstArgument })}": machines/${machineName({ machine: firstArgument })}/ in the repo`);
      return 0;
    }
    if (subcommandName === 'off' || subcommandName === 'on') {
      writeConfigState({ ...readConfigState(pathOptions), off: subcommandName === 'off' }, pathOptions);
      writeOutput(subcommandName === 'off' ? 'config sync off: sessions no longer apply or commit it, nor offer to set it up (ai1 config on brings it back)' : 'config sync on');
      return 0;
    }
  } catch (commandError) {
    writeError(`ai1 config: ${commandError.message}`);
    return 1;
  }
  writeError(`usage: ${CONFIG_USAGE}`);
  return 2;
}

function heldBackLines(commit) {
  return (commit?.heldBack || []).map((repoPath) => `  held back (a line looks like a secret): ${repoPath}; check it, then ai1 config commit --include ${repoPath}`);
}
