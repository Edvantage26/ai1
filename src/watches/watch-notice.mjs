// watch-notice (SessionStart, feature `watches`): one line for the person about the watches they follow,
// only with news since the last time they were told: new failures or a recovery (with the totals), a
// follow-up that ended (its subscription is removed, the definition stays), a release not confirmed by
// them yet (asked at most once a day), and the checks that are due. It only reads and writes the
// person's .ai1/local/ state; checks run from `ai1 watch run`, never here.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listWatchDefinitions } from './watch-definitions.mjs';
import {
  readSubscriptions, readWatchRecords, removeSubscription, updateWatchRecord, isSubscriptionActive, isWatchDue, describeWatchResults,
} from './watch-state.mjs';

const MODULE_ID = 'watch-notice';
const CONFIRM_ASK_INTERVAL_MILLISECONDS = 24 * 60 * 60 * 1000;

// News since the last notice: a run that was not ok, or a change back to ok.
function hasNewResults(watchRecord) {
  if (!watchRecord?.lastRun) return false;
  const lastNotified = watchRecord.lastNotified ? Date.parse(watchRecord.lastNotified) : 0;
  const newRuns = (watchRecord.history || []).filter((historyEntry) => Date.parse(historyEntry.at) > lastNotified);
  if (!newRuns.length) return false;
  return newRuns.some((historyEntry) => historyEntry.result !== 'ok') || (watchRecord.lastNotifiedResult && watchRecord.lastNotifiedResult !== watchRecord.lastResult);
}

export function runWatchNotice({ hookInput = {}, projectRoot, sharedRoot, now = new Date() }) {
  if (hookInput.source === 'resume' || hookInput.source === 'compact') return allowDecision();
  const subscriptions = readSubscriptions(sharedRoot);
  if (!Object.keys(subscriptions).length) return allowDecision();
  const watchRecords = readWatchRecords(sharedRoot);
  const noticeParts = [];
  const dueWatchIds = [];
  for (const watchEntry of listWatchDefinitions(projectRoot)) {
    const subscription = subscriptions[watchEntry.id];
    if (!subscription || watchEntry.errors.length) continue;
    const watchRecord = watchRecords[watchEntry.id];
    if (Date.parse(subscription.until) <= now.getTime()) {
      removeSubscription(sharedRoot, watchEntry.id);
      noticeParts.push(`${watchEntry.id} follow-up ended (${describeWatchResults(watchRecord, subscription)}${watchRecord?.confirmedAt ? ', confirmed by the person' : ''})`);
      continue;
    }
    if (!isSubscriptionActive(subscription, now)) continue;
    const recordChanges = {};
    if (hasNewResults(watchRecord)) {
      noticeParts.push(`${watchEntry.id}: last check ${watchRecord.lastResult}; ${describeWatchResults(watchRecord, subscription)}`);
      Object.assign(recordChanges, { lastNotified: now.toISOString(), lastNotifiedResult: watchRecord.lastResult });
    }
    const lastConfirmAsk = watchRecord?.confirmAskedAt ? Date.parse(watchRecord.confirmAskedAt) : 0;
    if (!watchRecord?.confirmedAt && now.getTime() - lastConfirmAsk >= CONFIRM_ASK_INTERVAL_MILLISECONDS) {
      noticeParts.push(`${watchEntry.id} is not confirmed by the person yet: ask whether they tried it in production and it works (then \`ai1 watch confirm ${watchEntry.id}\`)`);
      recordChanges.confirmAskedAt = now.toISOString();
    }
    if (isWatchDue(subscription, watchRecord, watchEntry.definition, now)) dueWatchIds.push(watchEntry.id);
    if (Object.keys(recordChanges).length) updateWatchRecord(sharedRoot, watchEntry.id, (currentRecord) => ({ ...currentRecord, ...recordChanges }));
  }
  if (dueWatchIds.length) noticeParts.push(`due: ${dueWatchIds.join(', ')} (offer \`ai1 watch run --due\`; an agent check is done by following its prompt)`);
  if (!noticeParts.length) return allowDecision();
  return contextDecision(MODULE_ID, `ai1/watches (what the person follows after shipping it): ${noticeParts.join('; ')}. Tell the person in one line.`);
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'watches',
  description: 'Tells the person in one line what changed in the watches they follow: failures, totals, follow-ups ended, releases to confirm, checks due.',
  run: runWatchNotice,
};
