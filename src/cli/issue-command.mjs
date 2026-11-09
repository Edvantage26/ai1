// `ai1 issue`: the facts a bug report on the ai1 repo needs, for /ai1:core-report-issue.
//   env [--json]                          ai1, Claude Code, Node, OS, host and this repo's features (no paths)
//   url --title "<t>" --body-file <f>     a prefilled "new issue" link, for when `gh` cannot create it

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFileIfValid } from '../core/json-file.mjs';
import { CONFIG_RELATIVE_PATH, listUnknownConfigEntries } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/module-index.mjs';
import { detectForkHost } from '../session/fork-host.mjs';
import { runExternalCommand } from '../session/fork-session.mjs';
import { describeRepo, AI1_MARKETPLACE } from './setup-repo.mjs';
import { listStateDirectoriesToRead } from '../core/decision-log.mjs';
import { readPendingErrorsFrom } from '../core/pending-errors.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';

export const ISSUE_USAGE = 'usage: ai1 issue env [--json] | url --title "<t>" --body-file <body.md>';
export const ISSUE_REPOSITORY = AI1_MARKETPLACE.source.repo;
// GitHub rejects longer "new issue" URLs; past it the link carries only the title.
const MAX_ISSUE_URL_LENGTH = 8000;

export function collectIssueEnvironment(repoRoot, { environment = process.env, runCommand = runExternalCommand, platformName = process.platform, architectureName = process.arch, nodeVersion = process.version, homeDirectory } = {}) {
  const pluginManifest = JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const claudeVersionResult = runCommand('claude', ['--version'], { timeoutMilliseconds: 10_000 });
  const repoDescription = describeRepo(repoRoot);
  return {
    ai1Version: pluginManifest.version,
    claudeCodeVersion: claudeVersionResult.status === 0 ? claudeVersionResult.stdout.trim() : 'unknown',
    nodeVersion,
    operatingSystem: `${platformName} ${architectureName}`,
    host: detectForkHost(environment, platformName).id,
    repoHasAi1Config: repoDescription.hasAi1Config,
    enabledFeatures: repoDescription.features.filter((featureStatus) => featureStatus.enabled).map((featureStatus) => featureStatus.id),
    unknownConfigEntries: listUnknownConfigEntries(readJsonFileIfValid(join(repoRoot, CONFIG_RELATIVE_PATH)), KNOWN_MODULE_IDS),
    // ai1's own failures in this repo: module and plugin-relative signature only, never a repo path.
    pendingErrors: readPendingErrorsFrom(listStateDirectoriesToRead(environment, homeDirectory), findMainCheckout(repoRoot))
      .map(({ module: moduleId, error, count, first, last }) => ({ module: moduleId, error, count, first, last })),
  };
}

export function formatIssueEnvironment(issueEnvironment) {
  const repoLine = issueEnvironment.repoHasAi1Config
    ? `features ${issueEnvironment.enabledFeatures.join(', ') || 'none'}${issueEnvironment.unknownConfigEntries.length ? ` (unknown to this version: ${issueEnvironment.unknownConfigEntries.join(', ')})` : ''}`
    : 'no .ai1/config.json';
  return [
    `- ai1: ${issueEnvironment.ai1Version}`,
    `- Claude Code: ${issueEnvironment.claudeCodeVersion}`,
    `- Node: ${issueEnvironment.nodeVersion}`,
    `- OS: ${issueEnvironment.operatingSystem}`,
    `- Host: ${issueEnvironment.host}`,
    `- Repo: ${repoLine}`,
    ...(issueEnvironment.pendingErrors?.length
      ? ['- ai1 errors in this repo:', ...issueEnvironment.pendingErrors.map((pendingError) => `  - \`${pendingError.module}\`: ${pendingError.error} (${pendingError.count}x, ${pendingError.first.slice(0, 10)} to ${pendingError.last.slice(0, 10)})`)]
      : []),
  ].join('\n');
}

export function buildNewIssueUrl(issueTitle, issueBody) {
  const newIssueBaseUrl = `https://github.com/${ISSUE_REPOSITORY}/issues/new`;
  const fullUrl = `${newIssueBaseUrl}?${new URLSearchParams({ title: issueTitle, body: issueBody })}`;
  if (fullUrl.length <= MAX_ISSUE_URL_LENGTH) return { url: fullUrl, includesBody: true };
  return { url: `${newIssueBaseUrl}?${new URLSearchParams({ title: issueTitle })}`, includesBody: false };
}

export function runIssueCommand(repoRoot, commandArguments, { readOption, environment = process.env, runCommand = runExternalCommand, writeOutput = console.log }) {
  const [subcommandName] = commandArguments;
  const wantsJson = commandArguments.includes('--json');
  if (subcommandName === 'env') {
    const issueEnvironment = collectIssueEnvironment(repoRoot, { environment, runCommand });
    writeOutput(wantsJson ? JSON.stringify(issueEnvironment, null, 2) : formatIssueEnvironment(issueEnvironment));
    return 0;
  }
  if (subcommandName === 'url') {
    const issueTitle = readOption('--title');
    const bodyPath = readOption('--body-file');
    if (!issueTitle || !bodyPath) throw new Error('usage: ai1 issue url --title "<t>" --body-file <body.md>');
    const newIssueLink = buildNewIssueUrl(issueTitle, readFileSync(bodyPath, 'utf8'));
    writeOutput(wantsJson ? JSON.stringify(newIssueLink, null, 2) : `${newIssueLink.url}${newIssueLink.includesBody ? '' : '\n(the body is too long for a link: paste it from the file)'}`);
    return 0;
  }
  writeOutput(ISSUE_USAGE);
  return 1;
}
