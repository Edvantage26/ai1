// The person's side of watches, in their ignored `.ai1/local/`: which watches they follow and until when
// (subscriptions.json), and what each check gave (state.json `watches`): last run and result, a short
// history, totals since the subscription started (counts watches), their own confirmation that it works
// in production, and when they were last told.

import { readLocalJson, writeLocalJson, readPersonState, writePersonState } from '../core/person-project.mjs';
import { DEFAULT_WATCH_EVERY, DEFAULT_WATCH_FOR, parseDuration } from './watch-definitions.mjs';

export const SUBSCRIPTIONS_FILE_NAME = 'subscriptions.json';
export const MAX_HISTORY_ENTRIES = 20;
export const MAX_KEPT_OUTPUT_CHARACTERS = 500;

export function readSubscriptions(sharedRoot) {
  return readLocalJson(sharedRoot, SUBSCRIPTIONS_FILE_NAME);
}

function writeSubscriptions(sharedRoot, subscriptions) {
  writeLocalJson(sharedRoot, SUBSCRIPTIONS_FILE_NAME, subscriptions);
}

// A new subscription (or a renewed one) starts its totals from now.
export function subscribeToWatch(sharedRoot, watchId, watchDefinition, { forDuration, every, now = new Date() } = {}) {
  const followMilliseconds = parseDuration(forDuration ?? watchDefinition?.suggestedFor ?? DEFAULT_WATCH_FOR);
  if (followMilliseconds === null) throw new Error(`--for must be a duration like 7d or 12h, not "${forDuration}"`);
  if (every !== undefined && parseDuration(every) === null) throw new Error(`--every must be a duration like 1d or 12h, not "${every}"`);
  const subscription = { since: now.toISOString(), until: new Date(now.getTime() + followMilliseconds).toISOString(), ...(every ? { every } : {}) };
  writeSubscriptions(sharedRoot, { ...readSubscriptions(sharedRoot), [watchId]: subscription });
  const personState = readPersonState(sharedRoot);
  const watchRecords = { ...personState.watches };
  delete watchRecords[watchId];
  writePersonState(sharedRoot, { ...personState, watches: watchRecords });
  return subscription;
}

export function updateSubscription(sharedRoot, watchId, subscriptionChanges) {
  const subscriptions = readSubscriptions(sharedRoot);
  if (!subscriptions[watchId]) throw new Error(`you do not follow the watch "${watchId}" (ai1 watch subscribe ${watchId})`);
  subscriptions[watchId] = { ...subscriptions[watchId], ...subscriptionChanges };
  writeSubscriptions(sharedRoot, subscriptions);
  return subscriptions[watchId];
}

export function removeSubscription(sharedRoot, watchId) {
  const subscriptions = readSubscriptions(sharedRoot);
  const wasSubscribed = Boolean(subscriptions[watchId]);
  delete subscriptions[watchId];
  writeSubscriptions(sharedRoot, subscriptions);
  return wasSubscribed;
}

export function readWatchRecords(sharedRoot) {
  const watchRecords = readPersonState(sharedRoot).watches;
  return watchRecords && typeof watchRecords === 'object' ? watchRecords : {};
}

export function updateWatchRecord(sharedRoot, watchId, updateRecord) {
  const personState = readPersonState(sharedRoot);
  const watchRecords = { ...personState.watches };
  watchRecords[watchId] = updateRecord({ ...watchRecords[watchId] });
  writePersonState(sharedRoot, { ...personState, watches: watchRecords });
  return watchRecords[watchId];
}

export function isSubscriptionActive(subscription, now = new Date()) {
  return Boolean(subscription) && !subscription.paused && Date.parse(subscription.until) > now.getTime();
}

export function isWatchDue(subscription, watchRecord, watchDefinition, now = new Date()) {
  if (!isSubscriptionActive(subscription, now)) return false;
  if (!watchRecord?.lastRun) return true;
  const everyMilliseconds = parseDuration(subscription.every ?? watchDefinition?.every ?? DEFAULT_WATCH_EVERY);
  return now.getTime() - Date.parse(watchRecord.lastRun) >= everyMilliseconds;
}

// One run's result ({ result: ok|fail|error, succeeded?, failed?, note?, output? }) added to the record.
export function recordWatchResult(sharedRoot, watchId, runResult, now = new Date()) {
  return updateWatchRecord(sharedRoot, watchId, (watchRecord) => {
    const historyEntry = { at: now.toISOString(), result: runResult.result };
    for (const countField of ['succeeded', 'failed']) if (Number.isInteger(runResult[countField])) historyEntry[countField] = runResult[countField];
    if (runResult.note) historyEntry.note = runResult.note;
    const updatedRecord = {
      ...watchRecord,
      lastRun: historyEntry.at,
      lastResult: runResult.result,
      history: [...(watchRecord.history || []), historyEntry].slice(-MAX_HISTORY_ENTRIES),
      runs: (watchRecord.runs || 0) + 1,
      results: { ...watchRecord.results, [runResult.result]: (watchRecord.results?.[runResult.result] || 0) + 1 },
    };
    if (Number.isInteger(runResult.succeeded) || Number.isInteger(runResult.failed)) {
      updatedRecord.totals = {
        succeeded: (watchRecord.totals?.succeeded || 0) + (runResult.succeeded || 0),
        failed: (watchRecord.totals?.failed || 0) + (runResult.failed || 0),
      };
    }
    if (runResult.result !== 'ok' && runResult.output) updatedRecord.lastProblemOutput = String(runResult.output).slice(-MAX_KEPT_OUTPUT_CHARACTERS);
    return updatedRecord;
  });
}

export function confirmWatch(sharedRoot, watchId, confirmNote, now = new Date()) {
  return updateWatchRecord(sharedRoot, watchId, (watchRecord) => ({ ...watchRecord, confirmedAt: now.toISOString(), ...(confirmNote ? { confirmNote } : {}) }));
}

// "6 ok, 2 failed since 2026-11-18" for counts watches; "3 runs: 2 ok, 1 fail" otherwise.
export function describeWatchResults(watchRecord, subscription) {
  if (!watchRecord?.lastRun) return 'not checked yet';
  const sinceText = subscription?.since ? ` since ${subscription.since.slice(0, 10)}` : '';
  if (watchRecord.totals) return `${watchRecord.totals.succeeded} ok, ${watchRecord.totals.failed} failed${sinceText}`;
  const resultCounts = Object.entries(watchRecord.results || {}).map(([resultName, resultCount]) => `${resultCount} ${resultName}`).join(', ');
  return `${watchRecord.runs} check${watchRecord.runs === 1 ? '' : 's'}${sinceText}: ${resultCounts}`;
}
