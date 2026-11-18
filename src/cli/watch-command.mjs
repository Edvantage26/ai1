// `ai1 watch`: follow something shipped to production. Definitions are committed (.ai1/watches/);
// subscriptions and results are the person's own (.ai1/local/). Commands run here, never from a hook.

import { findMainCheckout } from '../core/project-roots.mjs';
import { readGitUserEmail } from '../core/person-project.mjs';
import { DEFAULT_WATCH_EVERY, findWatchDefinition, listWatchDefinitions, writeWatchDefinition, isCountsWatch } from '../watches/watch-definitions.mjs';
import {
  readSubscriptions, subscribeToWatch, updateSubscription, removeSubscription, readWatchRecords, recordWatchResult,
  confirmWatch, isSubscriptionActive, isWatchDue, describeWatchResults,
} from '../watches/watch-state.mjs';
import { runWatchCommand } from '../watches/watch-run.mjs';

export const WATCH_USAGE = 'ai1 watch list [--json] | ai1 watch add <id> --title "<what>" (--run "<command>" | --run-json \'["cmd","arg"]\' | --prompt "<what the agent checks>") [--counts] [--every 1d] [--for 14d] [--no-subscribe] | ai1 watch subscribe <id> [--for 14d] [--every 12h] | ai1 watch unsubscribe|pause|resume <id> | ai1 watch run [<id>] [--due] | ai1 watch record <id> ok|fail ["note"] | ai1 watch confirm <id> ["note"]';
const VALUE_OPTIONS = new Set(['--title', '--run', '--run-json', '--prompt', '--every', '--for', '--description']);

function splitArguments(commandArguments) {
  const positionalArguments = [];
  const optionValues = {};
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (VALUE_OPTIONS.has(commandArgument)) {
      optionValues[commandArgument] = commandArguments[argumentIndex + 1];
      argumentIndex += 1;
    } else if (commandArgument.startsWith('--')) optionValues[commandArgument] = true;
    else positionalArguments.push(commandArgument);
  }
  return { positionalArguments, optionValues };
}

function requireWatch(repoRoot, watchId) {
  const watchEntry = watchId ? findWatchDefinition(repoRoot, watchId) : null;
  if (!watchEntry) throw new Error(`no watch "${watchId}" in .ai1/watches/ (ai1 watch list)`);
  if (watchEntry.errors.length) throw new Error(`watch ${watchId} is invalid: ${watchEntry.errors.join('; ')}`);
  return watchEntry.definition;
}

export function describeWatches(repoRoot, now = new Date()) {
  const sharedRoot = findMainCheckout(repoRoot);
  const subscriptions = readSubscriptions(sharedRoot);
  const watchRecords = readWatchRecords(sharedRoot);
  return listWatchDefinitions(repoRoot).map((watchEntry) => {
    const subscription = subscriptions[watchEntry.id] || null;
    const watchRecord = watchRecords[watchEntry.id] || null;
    return {
      id: watchEntry.id,
      title: watchEntry.definition?.title || null,
      kind: watchEntry.definition?.check?.kind || null,
      counts: isCountsWatch(watchEntry.definition),
      errors: watchEntry.errors,
      subscription,
      following: isSubscriptionActive(subscription, now),
      due: isWatchDue(subscription, watchRecord, watchEntry.definition, now),
      lastResult: watchRecord?.lastResult || null,
      results: describeWatchResults(watchRecord, subscription),
      confirmedAt: watchRecord?.confirmedAt || null,
    };
  });
}

function formatWatchLine(watchDescription) {
  if (watchDescription.errors.length) return `  ${watchDescription.id}: invalid - ${watchDescription.errors.join('; ')}`;
  const followText = !watchDescription.subscription ? 'not followed'
    : watchDescription.following ? `followed until ${watchDescription.subscription.until.slice(0, 10)}${watchDescription.due ? ', due' : ''}`
      : watchDescription.subscription.paused ? 'paused' : 'follow-up ended';
  const confirmText = watchDescription.subscription ? (watchDescription.confirmedAt ? `, confirmed by you ${watchDescription.confirmedAt.slice(0, 10)}` : ', not confirmed by you yet') : '';
  return `  ${watchDescription.id} (${watchDescription.kind}${watchDescription.counts ? ', counts' : ''}): ${watchDescription.title} - ${followText}; ${watchDescription.results}${confirmText}`;
}

function runWatches(repoRoot, sharedRoot, { watchId, onlyDue, now }) {
  const subscriptions = readSubscriptions(sharedRoot);
  const watchRecords = readWatchRecords(sharedRoot);
  const selectedEntries = listWatchDefinitions(repoRoot).filter((watchEntry) => (watchId ? watchEntry.id === watchId : isSubscriptionActive(subscriptions[watchEntry.id], now)));
  if (watchId && !selectedEntries.length) throw new Error(`no watch "${watchId}" in .ai1/watches/ (ai1 watch list)`);
  const outputLines = [];
  for (const watchEntry of selectedEntries) {
    if (watchEntry.errors.length) { outputLines.push(`${watchEntry.id}: invalid - ${watchEntry.errors.join('; ')}`); continue; }
    const subscription = subscriptions[watchEntry.id];
    if (onlyDue && !isWatchDue(subscription, watchRecords[watchEntry.id], watchEntry.definition, now)) continue;
    if (watchEntry.definition.check.kind === 'agent') {
      outputLines.push(`${watchEntry.id}: an agent check - follow its prompt, then ai1 watch record ${watchEntry.id} ok|fail "<what you saw>": ${watchEntry.definition.check.prompt}`);
      continue;
    }
    const sinceDate = watchRecords[watchEntry.id]?.lastRun || subscription?.since || now.toISOString();
    const runResult = runWatchCommand(watchEntry.definition, { repoRoot, sinceDate });
    const watchRecord = recordWatchResult(sharedRoot, watchEntry.id, runResult, now);
    const countsText = Number.isInteger(runResult.succeeded) ? ` (${runResult.succeeded} ok, ${runResult.failed} failed this time)` : '';
    outputLines.push(`${watchEntry.id}: ${runResult.result}${countsText}${runResult.note ? ` - ${runResult.note}` : ''}; ${describeWatchResults(watchRecord, subscription)}`);
  }
  return outputLines.length ? outputLines.join('\n') : onlyDue ? 'no watch is due' : 'you follow no watch here (ai1 watch list)';
}

export function runWatchCommandLine(repoRoot, commandArguments, now = new Date()) {
  const { positionalArguments, optionValues } = splitArguments(commandArguments);
  const [subcommandName, watchId, ...restArguments] = positionalArguments;
  const sharedRoot = findMainCheckout(repoRoot);
  if (!subcommandName || subcommandName === 'list') {
    const watchDescriptions = describeWatches(repoRoot, now);
    if (optionValues['--json']) return { output: JSON.stringify(watchDescriptions, null, 2), exitCode: 0 };
    return { output: watchDescriptions.length ? ['watches (.ai1/watches/):', ...watchDescriptions.map(formatWatchLine)].join('\n') : 'no watches in .ai1/watches/ yet (ai1 watch add)', exitCode: 0 };
  }
  if (subcommandName === 'add') {
    if (!watchId || !optionValues['--title']) return { output: `usage: ${WATCH_USAGE}`, exitCode: 1 };
    const runCommand = optionValues['--run-json'] ? JSON.parse(optionValues['--run-json']) : optionValues['--run'];
    const watchCheck = optionValues['--prompt'] ? { kind: 'agent', prompt: optionValues['--prompt'] } : { kind: 'command', run: runCommand };
    if (optionValues['--counts']) watchCheck.expect = 'counts';
    const watchDefinition = {
      title: optionValues['--title'],
      ...(optionValues['--description'] ? { description: optionValues['--description'] } : {}),
      check: watchCheck,
      every: optionValues['--every'] || DEFAULT_WATCH_EVERY,
      ...(optionValues['--for'] ? { suggestedFor: optionValues['--for'] } : {}),
      ...(readGitUserEmail(repoRoot) ? { createdBy: readGitUserEmail(repoRoot) } : {}),
    };
    writeWatchDefinition(repoRoot, watchId, watchDefinition);
    const outputLines = [`wrote .ai1/watches/${watchId}.json (commit it so the team can follow it too)`];
    if (!optionValues['--no-subscribe']) {
      const subscription = subscribeToWatch(sharedRoot, watchId, watchDefinition, { now });
      outputLines.push(`you follow it until ${subscription.until.slice(0, 10)}; once you have tried it in production: ai1 watch confirm ${watchId}`);
    }
    return { output: outputLines.join('\n'), exitCode: 0 };
  }
  if (subcommandName === 'run') return { output: runWatches(repoRoot, sharedRoot, { watchId, onlyDue: Boolean(optionValues['--due']), now }), exitCode: 0 };
  if (!watchId) return { output: `usage: ${WATCH_USAGE}`, exitCode: 1 };
  if (subcommandName === 'subscribe') {
    const subscription = subscribeToWatch(sharedRoot, watchId, requireWatch(repoRoot, watchId), { forDuration: optionValues['--for'], every: optionValues['--every'], now });
    return { output: `${watchId}: you follow it until ${subscription.until.slice(0, 10)} (.ai1/local/subscriptions.json, only yours)`, exitCode: 0 };
  }
  if (subcommandName === 'unsubscribe') return { output: removeSubscription(sharedRoot, watchId) ? `${watchId}: you no longer follow it` : `${watchId}: you did not follow it`, exitCode: 0 };
  if (subcommandName === 'pause' || subcommandName === 'resume') {
    updateSubscription(sharedRoot, watchId, { paused: subcommandName === 'pause' });
    return { output: `${watchId}: ${subcommandName === 'pause' ? 'paused' : 'resumed'}`, exitCode: 0 };
  }
  if (subcommandName === 'record') {
    const [resultName, ...noteWords] = restArguments;
    if (!['ok', 'fail'].includes(resultName)) return { output: `usage: ai1 watch record ${watchId} ok|fail ["note"]`, exitCode: 1 };
    requireWatch(repoRoot, watchId);
    const watchRecord = recordWatchResult(sharedRoot, watchId, { result: resultName, note: noteWords.join(' ') || undefined }, now);
    return { output: `${watchId}: ${resultName} recorded; ${describeWatchResults(watchRecord, readSubscriptions(sharedRoot)[watchId])}`, exitCode: 0 };
  }
  if (subcommandName === 'confirm') {
    requireWatch(repoRoot, watchId);
    confirmWatch(sharedRoot, watchId, restArguments.join(' ') || undefined, now);
    return { output: `${watchId}: confirmed by you on ${now.toISOString().slice(0, 10)} - you tried it in production and it works`, exitCode: 0 };
  }
  return { output: `usage: ${WATCH_USAGE}`, exitCode: 1 };
}
