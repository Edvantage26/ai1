// `jig worktree <command>`: the engine behind the per-project worktree recipe.
//   create <name> [--mode auto|full|light|<extra>] [--base <branch>]
//   list [--size]
//   run <name> <command> [args]   setup, or a name from the recipe's `commands` (args fill {{args}} or are appended)
//   finish <name> [--merge] [--ack "<why no concept changes>"]
//   drop <name> --confirm [--discard-uncommitted]
// Every command takes --json. Runs from anywhere inside the repo or one of its worktrees.

import { createWorktree } from '../worktrees/worktree-create.mjs';
import { listWorktrees, runWorktreeCommand, dropWorktree } from '../worktrees/worktree-ops.mjs';
import { finishWorktree } from '../worktrees/worktree-finish.mjs';
import { formatBytes } from '../worktrees/worktree-disk.mjs';

export const WORKTREE_USAGE = 'usage: jig worktree create <name> [--mode auto|full|light|<extra>] [--base <branch>] | list [--size] | run <name> <command> [args...] | finish <name> [--merge] [--ack "<reason>"] | drop <name> --confirm [--discard-uncommitted]  (all take --json)';

function describeCreated(created) {
  const trimmedText = created.trimmed.length
    ? created.trimmed.map((trimmedEntry) => `${trimmedEntry.path} ${trimmedEntry.strategy} (${formatBytes(trimmedEntry.bytes)})`).join(', ')
    : 'nothing';
  return [
    `worktree ${created.name} ready at ${created.path}`,
    `branch ${created.branch} from ${created.base} | mode ${created.mode} (${created.mode_reason}) | ${formatBytes(created.size_bytes)}${created.port ? ` | port ${created.port}` : ''}`,
    `trimmed: ${trimmedText}`,
    ...(created.setup_commands.length ? [`next: jig worktree run ${created.name} setup  (${created.setup_commands.join(' && ')})`] : []),
    `enter it: EnterWorktree with path ${created.path} (or work with absolute paths under it)`,
    ...created.warnings.map((warningText) => `warning: ${warningText}`),
  ].join('\n');
}

function describeListed(listedWorktrees) {
  if (listedWorktrees.length === 0) return 'no worktrees (jig worktree create <name>)';
  return listedWorktrees.map((listedWorktree) => [
    `${listedWorktree.name}  ${listedWorktree.branch} <- ${listedWorktree.base}`,
    `ahead ${listedWorktree.ahead ?? '?'} behind ${listedWorktree.behind ?? '?'}`,
    listedWorktree.present ? (listedWorktree.uncommitted ? `${listedWorktree.uncommitted} uncommitted` : 'clean') : 'MISSING on disk',
    `mode ${listedWorktree.mode}`,
    ...(listedWorktree.port ? [`port ${listedWorktree.port}`] : []),
    ...(listedWorktree.size_bytes !== null ? [formatBytes(listedWorktree.size_bytes)] : []),
    ...(listedWorktree.last_run ? [`last ${listedWorktree.last_run.command}: exit ${listedWorktree.last_run.exit_code}`] : []),
  ].join(' | ')).join('\n');
}

// Returns { output, exitCode }; throws with a readable message on refusal.
export function runWorktreeCli(workingDirectory, commandArguments) {
  const [subcommandName, ...restArguments] = commandArguments;
  const readOption = (optionName) => {
    const optionIndex = restArguments.indexOf(optionName);
    return optionIndex >= 0 ? restArguments[optionIndex + 1] : undefined;
  };
  const optionsWithValue = new Set(['--mode', '--base', '--ack']);
  const positionalArguments = restArguments.filter((argumentText, argumentIndex) => !argumentText.startsWith('--') && !optionsWithValue.has(restArguments[argumentIndex - 1]));
  const wantsJson = restArguments.includes('--json');
  const respond = (resultValue, describeResult) => ({ output: wantsJson ? JSON.stringify(resultValue, null, 2) : describeResult(resultValue), exitCode: 0 });

  if (subcommandName === 'create') {
    if (!positionalArguments[0]) throw new Error('usage: jig worktree create <name> [--mode ...] [--base <branch>]');
    return respond(createWorktree(workingDirectory, positionalArguments[0], { mode: readOption('--mode'), base: readOption('--base') }), describeCreated);
  }
  if (subcommandName === 'list') return respond(listWorktrees(workingDirectory, { withSize: restArguments.includes('--size') }), describeListed);
  if (subcommandName === 'run') {
    const [worktreeName, commandName] = positionalArguments;
    if (!worktreeName || !commandName) throw new Error('usage: jig worktree run <name> <command> [args...]');
    const commandIndex = restArguments.indexOf(commandName, restArguments.indexOf(worktreeName) + 1);
    const extraArguments = restArguments.slice(commandIndex + 1).filter((argumentText) => argumentText !== '--json');
    const runResult = runWorktreeCommand(workingDirectory, worktreeName, commandName, { extraArguments });
    return {
      output: wantsJson ? JSON.stringify(runResult) : (runResult.exitCode === 0 ? `jig: ${commandName} passed in ${worktreeName}` : `jig: \`${runResult.failedCommand}\` failed (exit ${runResult.exitCode}) in ${worktreeName}`),
      exitCode: runResult.exitCode,
    };
  }
  if (subcommandName === 'finish') {
    if (!positionalArguments[0]) throw new Error('usage: jig worktree finish <name> [--merge] [--ack "<reason>"]');
    return respond(finishWorktree(workingDirectory, positionalArguments[0], { merge: restArguments.includes('--merge'), acknowledgement: readOption('--ack') }), (finishResult) => [
      `worktree ${finishResult.name} integrated into ${finishResult.base}:`,
      ...finishResult.steps.map((stepText) => `  - ${stepText}`),
      ...finishResult.notes.map((noteText) => `note: ${noteText}`),
      ...(finishResult.removed_ignored.length ? [`removed with it (ignored files): ${finishResult.removed_ignored.slice(0, 10).join(', ')}${finishResult.removed_ignored.length > 10 ? ', ...' : ''}`] : []),
      'If this session was inside the worktree, leave it with ExitWorktree (keep).',
    ].join('\n'));
  }
  if (subcommandName === 'drop') {
    if (!positionalArguments[0]) throw new Error('usage: jig worktree drop <name> --confirm [--discard-uncommitted]');
    return respond(dropWorktree(workingDirectory, positionalArguments[0], {
      confirm: restArguments.includes('--confirm'), discardUncommitted: restArguments.includes('--discard-uncommitted'),
    }), (dropResult) => `worktree ${dropResult.name} dropped (branch ${dropResult.branch} deleted)${dropResult.bundlePath ? `; its commits are in ${dropResult.bundlePath} (git fetch <bundle> ${dropResult.branch})` : ''}`);
  }
  return { output: WORKTREE_USAGE, exitCode: subcommandName ? 1 : 0 };
}
