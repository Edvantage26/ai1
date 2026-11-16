// Knowledge catch-up after merging a branch that had no knowledge bundle (feature `okf`). A joining
// merge is a merge commit reachable from HEAD where one parent has the bundle and another has none:
// a branch that never had the documentation folder (forked before it existed) came in, and its changes
// reached the history without concepts. okf-upkeep only sees what a session changed, and a merge done in
// a terminal or on a forge is no session's, so this module finds them from git alone (no LLM, a few
// git calls) and the agent hands the catch-up to an independent background agent.
// A merge is caught up when a commit reachable from HEAD carries the trailer `Knowledge-Catch-Up: <sha>`
// (full or at least 7 hex characters): the record travels with the repo, in every clone and branch.

import { join } from 'node:path';
import { runGit, tryGit } from '../core/git.mjs';
import {
  resolveStateDirectory, sessionStatePath, readStateText, readStateJson, writeStateText, shortHash,
} from '../core/session-state.mjs';
import { readGitHead } from '../core/session-base.mjs';
import { resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, buildMaintenanceRules } from './okf-bundle.mjs';
import { buildFileMap, findConceptsForFile, loadFileMap } from './okf-file-map.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

export const CATCH_UP_TRAILER = 'Knowledge-Catch-Up';
// The legacy `.okf/` counts: a branch forked before a repo moved its bundle to `.ai1/okf/` had documentation.
const BUNDLE_INDEX_PATHS = [`${KNOWLEDGE_BUNDLE_PATH}/index.md`, '.okf/index.md'];
// Not project changes: the bundle itself and harness configuration.
const NON_CODE_PREFIXES = ['.ai1/', '.okf/', '.claude/'];
const MAX_EXAMINED_MERGES = 30;
const MAX_WALKED_COMMITS = 2000;
const MAX_EXAMINED_TRAILER_COMMITS = 2000;
const MAX_LISTED_MERGES = 3;
const MAX_LISTED_CONCEPTS = 5;
const MAX_BRIEF_COMMITS = 30;
const MAX_BRIEF_FILES = 60;
export const CLAIM_MILLISECONDS = 2 * 60 * 60 * 1000;

// The commits (of `commitShas`) that have a bundle, in one `git cat-file --batch-check` call.
function listCommitsWithBundle(projectRoot, commitShas) {
  const objectNames = commitShas.flatMap((commitSha) => BUNDLE_INDEX_PATHS.map((indexPath) => `${commitSha}:${indexPath}`));
  let checkOutput = '';
  try {
    checkOutput = runGit(projectRoot, ['cat-file', '--batch-check=%(objectname)'], { input: `${objectNames.join('\n')}\n` });
  } catch {
    return new Set();
  }
  const checkLines = checkOutput.split('\n');
  return new Set(commitShas.filter((commitSha, commitPosition) => BUNDLE_INDEX_PATHS.some((indexPath, pathPosition) => {
    const checkLine = checkLines[commitPosition * BUNDLE_INDEX_PATHS.length + pathPosition] || '';
    return checkLine && !checkLine.endsWith(' missing');
  })));
}

// Shas (full or abbreviated) named by a Knowledge-Catch-Up trailer in the recent history of HEAD.
export function listCaughtUpShas(projectRoot) {
  const trailerOutput = tryGit(projectRoot, ['log', '-n', String(MAX_EXAMINED_TRAILER_COMMITS), `--format=%(trailers:key=${CATCH_UP_TRAILER},valueonly)`, 'HEAD']) || '';
  return trailerOutput.split('\n')
    .map((trailerValue) => trailerValue.trim().split(/\s+/)[0].toLowerCase())
    .filter((trailerValue) => /^[0-9a-f]{7,40}$/.test(trailerValue));
}

function isCaughtUp(mergeSha, caughtUpShas) {
  return caughtUpShas.some((caughtUpSha) => mergeSha.startsWith(caughtUpSha));
}

// Files the merge brought, against the parent that had the bundle: its real effect, conflict
// resolution included, without the bundle and harness configuration.
export function listMergeChanges(projectRoot, documentedParent, mergeSha) {
  return (tryGit(projectRoot, ['diff', '--name-only', documentedParent, mergeSha]) || '').split('\n')
    .filter((changedPath) => changedPath && !NON_CODE_PREFIXES.some((prefix) => changedPath.startsWith(prefix)));
}

// The newest joining merges of HEAD not yet caught up, newest first:
// [{ sha, shortSha, subject, documentedParent, foreignParents, changedPaths }].
// Without a bundle at HEAD, or outside git, nothing.
// `revisionRange`: where to look for merges (default HEAD; okf-upkeep passes `<session base>..HEAD`).
export function listPendingCatchUps(projectRoot, { revisionRange = 'HEAD' } = {}) {
  const headSha = tryGit(projectRoot, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!headSha || !listCommitsWithBundle(projectRoot, [headSha]).size) return [];
  // The walk is bounded too (`--merges -n` alone walks the whole history of a repo with few merges).
  const parentShasByMerge = (tryGit(projectRoot, ['rev-list', '--parents', '-n', String(MAX_WALKED_COMMITS), revisionRange]) || '').split('\n')
    .map((commitLine) => commitLine.split(' '))
    .filter((commitShas) => commitShas.length > 2)
    .slice(0, MAX_EXAMINED_MERGES);
  if (!parentShasByMerge.length) return [];
  const commitsWithBundle = listCommitsWithBundle(projectRoot, [...new Set(parentShasByMerge.flatMap(([, ...parentShas]) => parentShas))]);
  const joiningMerges = [];
  for (const [mergeSha, ...parentShas] of parentShasByMerge) {
    const documentedParent = parentShas.find((parentSha) => commitsWithBundle.has(parentSha));
    if (!documentedParent) continue;
    const foreignParents = parentShas.filter((parentSha) => !commitsWithBundle.has(parentSha));
    if (!foreignParents.length) continue;
    const changedPaths = listMergeChanges(projectRoot, documentedParent, mergeSha);
    if (changedPaths.length) joiningMerges.push({ sha: mergeSha, documentedParent, foreignParents, changedPaths });
  }
  if (!joiningMerges.length) return [];
  const caughtUpShas = listCaughtUpShas(projectRoot);
  return joiningMerges
    .filter((joiningMerge) => !isCaughtUp(joiningMerge.sha, caughtUpShas))
    .map((joiningMerge) => ({
      ...joiningMerge,
      shortSha: joiningMerge.sha.slice(0, 7),
      subject: tryGit(projectRoot, ['log', '-1', '--format=%s', joiningMerge.sha]) || '',
    }));
}

// The concepts the file map names for the merge's files, and the files no concept describes.
export function mapMergeToConcepts(fileMap, changedPaths) {
  const affectedConceptPaths = new Set();
  const uncoveredPaths = [];
  for (const changedPath of changedPaths) {
    const conceptMatches = fileMap ? findConceptsForFile(fileMap, changedPath) : [];
    if (!conceptMatches.length) uncoveredPaths.push(changedPath);
    for (const conceptMatch of conceptMatches) affectedConceptPaths.add(conceptMatch.repoPath);
  }
  return { affectedConceptPaths: [...affectedConceptPaths].sort(), uncoveredPaths };
}

function describeMerge(pendingMerge, fileMap) {
  const { affectedConceptPaths, uncoveredPaths } = mapMergeToConcepts(fileMap, pendingMerge.changedPaths);
  const conceptText = affectedConceptPaths.length
    ? `; probably affected: ${affectedConceptPaths.slice(0, MAX_LISTED_CONCEPTS).map((conceptPath) => `\`${conceptPath}\``).join(', ')}${affectedConceptPaths.length > MAX_LISTED_CONCEPTS ? ` and ${affectedConceptPaths.length - MAX_LISTED_CONCEPTS} more` : ''}`
    : '';
  const uncoveredText = uncoveredPaths.length ? `; ${uncoveredPaths.length} of them described by no concept` : '';
  return `- merge ${pendingMerge.shortSha} "${pendingMerge.subject}": ${pendingMerge.changedPaths.length} file(s)${conceptText}${uncoveredText}`;
}

// What the agent is told: one line to the person, then an independent background agent per merge.
export function buildCatchUpInstruction(pendingMerges, fileMap) {
  const listedMerges = pendingMerges.slice(0, MAX_LISTED_MERGES);
  return [
    'ai1/okf: a branch that had no knowledge bundle was merged here, so its changes reached the history without documentation:',
    ...listedMerges.map((pendingMerge) => describeMerge(pendingMerge, fileMap)),
    ...(pendingMerges.length > MAX_LISTED_MERGES ? [`- ... and ${pendingMerges.length - MAX_LISTED_MERGES} more (\`ai1 okf catch-up\` lists them)`] : []),
    'Tell the person in one line that merging that branch brought undocumented changes and that an agent is documenting them in the background.',
    `Then launch an independent agent in the background (Agent tool, run_in_background) per merge, whose prompt is the output of \`ai1 okf catch-up --brief <sha>\` (${listedMerges.map((pendingMerge) => pendingMerge.shortSha).join(', ')}), and carry on with the person's task without waiting for it.`,
  ].join('\n');
}

// The brief for the background agent: what came in, which concepts it touches, how to close it.
export function buildCatchUpBrief(projectRoot, pendingMerge, fileMap) {
  const { sha, shortSha, subject, documentedParent, changedPaths } = pendingMerge;
  const incomingCommits = (tryGit(projectRoot, ['log', '--oneline', '--no-merges', '-n', String(MAX_BRIEF_COMMITS), `${documentedParent}..${sha}`]) || '').split('\n').filter(Boolean);
  const { affectedConceptPaths, uncoveredPaths } = mapMergeToConcepts(fileMap, changedPaths);
  const listFiles = (filePaths) => [...filePaths.slice(0, MAX_BRIEF_FILES).map((filePath) => `  - ${filePath}`),
    ...(filePaths.length > MAX_BRIEF_FILES ? [`  - ... and ${filePaths.length - MAX_BRIEF_FILES} more`] : [])];
  return [
    `Bring the knowledge bundle (\`${KNOWLEDGE_BUNDLE_PATH}/\`) up to date with merge ${sha} ("${subject}").`,
    'The branch it merged had no knowledge bundle, so nobody documented its changes.',
    '',
    `Commits that came in (\`git log ${documentedParent.slice(0, 7)}..${shortSha}\`):`,
    ...incomingCommits.map((commitLine) => `  - ${commitLine}`),
    '',
    `Files the merge changed (\`git diff ${documentedParent.slice(0, 7)} ${shortSha}\`), ${changedPaths.length} in total:`,
    ...listFiles(changedPaths),
    '',
    affectedConceptPaths.length ? `Concepts that describe some of them: ${affectedConceptPaths.map((conceptPath) => `\`${conceptPath}\``).join(', ')}.` : 'No concept describes any of them yet.',
    ...(uncoveredPaths.length ? [`Files no concept describes (${uncoveredPaths.length}): decide whether they are a new asset that deserves a concept, belong in an existing one, or are not knowledge (tests, fixtures, formatting).`] : []),
    '',
    'Steps:',
    '1. Create a worktree for this work (`ai1 worktree create <name>`) and work only inside it.',
    `2. Read \`${KNOWLEDGE_BUNDLE_PATH}/index.md\` and the concepts above, then the diff of the merge, and work out what changed in the system (behaviour, APIs, data, decisions), not a list of edits.`,
    '3. Update the affected concepts and create concepts for new assets (with `description` and `tags`, linked from the index.md of their folder). Behaviour, APIs, data and rules are worth a concept even when nothing calls them yet; tests, formatting and renames alone are not. What the code does not show, write as unknown; never invent intent. The bundle\'s rules:',
    ...buildMaintenanceRules(KNOWLEDGE_BUNDLE_PATH, readBundleSpecVersion(readBundleIndex(resolveBundleDirectory(projectRoot)) || '')).map((maintenanceRule) => `   - ${maintenanceRule}`),
    `4. Validate (\`ai1 okf validate ${KNOWLEDGE_BUNDLE_PATH}\`) and fix every ERROR.`,
    `5. Commit in the worktree with this trailer as the last line of the message: \`${CATCH_UP_TRAILER}: ${sha}\`. If nothing was worth documenting, make an empty commit (\`git commit --allow-empty\`) with the reason and the same trailer: it records that the merge was reviewed.`,
    '6. Integrate it with `ai1 worktree finish <name>` (nothing is pushed).',
    'Report in a few lines which concepts you changed or created and what you left as unknown.',
  ].join('\n');
}

// The hook side, shared by the SessionStart and UserPromptSubmit modules: the HEAD last checked for the
// session is kept, so a message checks again only after HEAD moved (a merge or pull in a terminal while
// the session is open); otherwise it costs one `git rev-parse`. Null when there is nothing to tell.
export function findCatchUpInstruction({ hookInput, projectRoot, environment, onlyWhenHeadMoved }) {
  const bundleDirectory = resolveBundleDirectory(projectRoot);
  if (readBundleIndex(bundleDirectory) === null) return null;
  const currentHead = readGitHead(projectRoot);
  if (!currentHead) return null;
  const stateDirectory = resolveStateDirectory(environment);
  const checkedHeadPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'catch-up-head');
  if (onlyWhenHeadMoved && readStateText(checkedHeadPath) === currentHead) return null;
  writeStateText(checkedHeadPath, currentHead);
  const pendingMerges = listPendingCatchUps(projectRoot);
  if (!pendingMerges.length) return null;
  const mergesToTell = claimPendingCatchUps(catchUpClaimsPath(stateDirectory, projectRoot), pendingMerges, hookInput.session_id);
  if (!mergesToTell.length) return null;
  let fileMap = null;
  try {
    fileMap = loadFileMap(bundleDirectory, KNOWLEDGE_BUNDLE_PATH, projectRoot, stateDirectory);
  } catch {
    // A broken map only drops the concept names from the instruction.
  }
  return buildCatchUpInstruction(mergesToTell, fileMap);
}

export const OKF_CATCH_UP_USAGE = 'ai1 okf catch-up [--json] [--brief <sha>]';

// `ai1 okf catch-up`: the pending merges of the current branch, one line each (or JSON); `--brief <sha>`
// prints the brief for the agent that catches one up. Exit 0, or 1 when `--brief` names no pending merge.
export function runOkfCatchUpCommand(workingDirectory, catchUpArguments, writeOutput = console.log, writeError = console.error) {
  const projectRoot = tryGit(workingDirectory, ['rev-parse', '--show-toplevel']);
  if (!projectRoot) {
    writeError('ai1 okf catch-up: not inside a git repository');
    return 2;
  }
  const briefPosition = catchUpArguments.indexOf('--brief');
  const briefSha = briefPosition >= 0 ? catchUpArguments[briefPosition + 1] : null;
  if (briefPosition >= 0 && !/^[0-9a-f]{4,40}$/i.test(briefSha || '')) {
    writeError(`usage: ${OKF_CATCH_UP_USAGE}`);
    return 2;
  }
  const pendingMerges = listPendingCatchUps(projectRoot);
  const bundleDirectory = resolveBundleDirectory(projectRoot);
  const fileMap = readBundleIndex(bundleDirectory) === null ? null : buildFileMap(bundleDirectory, KNOWLEDGE_BUNDLE_PATH);
  if (briefSha) {
    const pendingMerge = pendingMerges.find((candidateMerge) => candidateMerge.sha.startsWith(briefSha.toLowerCase()));
    if (!pendingMerge) {
      writeError(`ai1 okf catch-up: ${briefSha} is not a pending merge of a branch without bundle here (\`ai1 okf catch-up\` lists them)`);
      return 1;
    }
    writeOutput(buildCatchUpBrief(projectRoot, pendingMerge, fileMap));
    return 0;
  }
  if (catchUpArguments.includes('--json')) {
    writeOutput(JSON.stringify(pendingMerges.map((pendingMerge) => ({
      sha: pendingMerge.sha, subject: pendingMerge.subject, files: pendingMerge.changedPaths,
      ...mapMergeToConcepts(fileMap, pendingMerge.changedPaths),
    })), null, 2));
    return 0;
  }
  if (!pendingMerges.length) writeOutput('No merge of a branch without knowledge bundle is pending here.');
  for (const pendingMerge of pendingMerges) writeOutput(describeMerge(pendingMerge, fileMap).replace(/^- /, ''));
  return 0;
}

// Per repo (worktrees share it): which merges a session was already told about, and when. A merge told
// in the last 2 hours is not told again (another session is catching it up); after that, if the
// trailer has not appeared, it is told again.
export function catchUpClaimsPath(stateDirectory, projectRoot) {
  const repoIdentity = tryGit(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']) || projectRoot;
  return join(stateDirectory, `${shortHash(repoIdentity)}.catch-up`);
}

// The pending merges no session has claimed recently; the returned ones are claimed for this session.
export function claimPendingCatchUps(claimsPath, pendingMerges, sessionId, nowMilliseconds = Date.now()) {
  const claims = readStateJson(claimsPath, {});
  const unclaimedMerges = pendingMerges.filter((pendingMerge) => {
    const claim = claims[pendingMerge.sha];
    return !claim || nowMilliseconds - claim.at >= CLAIM_MILLISECONDS;
  });
  if (!unclaimedMerges.length) return [];
  for (const unclaimedMerge of unclaimedMerges) claims[unclaimedMerge.sha] = { session: sessionId || 'unknown', at: nowMilliseconds };
  writeStateText(claimsPath, JSON.stringify(claims));
  return unclaimedMerges;
}
