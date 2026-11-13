// What the reuse feature knows about this repo: its own past sessions (Claude Code transcripts of the
// main checkout and of its ai1 worktrees, never another repo's), the project's skills, commands and
// MCP servers, and the proposals the person declined (.ai1/reuse.json, committed).
// Deterministic keyword search, no model: the agent picks the keywords and judges the result.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectFolderName } from '../core/project-paths.mjs';
import { splitFrontmatter } from '../core/frontmatter.mjs';

export const REUSE_FILE = '.ai1/reuse.json';
export const DEFAULT_SEARCH_DAYS = 90;
const WORKTREE_FOLDER_SUFFIX = '--claude-worktrees-';
const FIRST_PROMPT_LENGTH = 120;
const MAX_LISTED_SESSIONS = 10;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'how', 'what', 'una', 'uno', 'los', 'las',
  'del', 'con', 'para', 'por', 'que', 'como', 'esto', 'esta', 'este', 'hay', 'sus', 'mas', 'pero',
]);

// Lowercased words of 3+ characters (2 when they hold a digit: o2, s3), without stopwords and repeats.
export function searchTerms(queryText) {
  const words = String(queryText || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9_-]+/).filter((word) => (word.length >= 3 || (word.length === 2 && /\d/.test(word))) && !STOPWORDS.has(word));
  return [...new Set(words)];
}

function requiredTermCount(terms) {
  return Math.ceil(terms.length / 2);
}

// This repo's transcript folders: the main checkout's and those of its worktrees under .claude/worktrees.
export function listRepoTranscriptFolders(mainCheckout, homeDirectory = homedir()) {
  const projectsDirectory = join(homeDirectory, '.claude', 'projects');
  if (!existsSync(projectsDirectory)) return [];
  const mainFolderName = claudeProjectFolderName(mainCheckout);
  return readdirSync(projectsDirectory)
    .filter((folderName) => folderName === mainFolderName || folderName.startsWith(`${mainFolderName}${WORKTREE_FOLDER_SUFFIX}`))
    .map((folderName) => join(projectsDirectory, folderName));
}

// A real prompt typed by the person: text, not a tool result, not meta, not a command or hook wrapper.
function readUserPromptText(transcriptEvent) {
  if (transcriptEvent?.type !== 'user' || transcriptEvent.isMeta) return null;
  const messageContent = transcriptEvent.message?.content;
  const promptText = typeof messageContent === 'string'
    ? messageContent
    : Array.isArray(messageContent) ? messageContent.filter((contentBlock) => contentBlock?.type === 'text').map((contentBlock) => contentBlock.text).join('\n') : '';
  const trimmedText = promptText.trim();
  return trimmedText && !trimmedText.startsWith('<') ? trimmedText : null;
}

// The searchable text of a tool call: shell commands, MCP tools with their input, skill names.
function readToolCallText(contentBlock) {
  if (contentBlock?.type !== 'tool_use') return null;
  if (contentBlock.name === 'Bash') return String(contentBlock.input?.command || '');
  if (String(contentBlock.name).startsWith('mcp__')) return `${contentBlock.name} ${JSON.stringify(contentBlock.input || {})}`;
  if (contentBlock.name === 'Skill') return `Skill ${contentBlock.input?.skill || ''}`;
  return null;
}

function countMatchedTerms(text, terms) {
  const lowerText = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return terms.filter((term) => lowerText.includes(term));
}

// One transcript: { sessionId, startedAt, firstPrompt, matchingPrompts, matchingToolCalls, matchedTerms }.
function searchTranscript(transcriptPath, terms) {
  const sessionMatch = { sessionId: transcriptPath.split('/').pop().replace(/\.jsonl$/, ''), startedAt: null, firstPrompt: null, matchingPrompts: 0, matchingToolCalls: 0, matchedTerms: new Set() };
  for (const transcriptLine of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!transcriptLine.includes('"type":"user"') && !transcriptLine.includes('"tool_use"')) continue;
    let transcriptEvent;
    try {
      transcriptEvent = JSON.parse(transcriptLine);
    } catch {
      continue;
    }
    const promptText = readUserPromptText(transcriptEvent);
    if (promptText) {
      if (!sessionMatch.firstPrompt) {
        sessionMatch.firstPrompt = promptText.replace(/\s+/g, ' ').slice(0, FIRST_PROMPT_LENGTH);
        sessionMatch.startedAt = transcriptEvent.timestamp || null;
      }
      const promptTerms = countMatchedTerms(promptText, terms);
      if (promptTerms.length) sessionMatch.matchingPrompts += 1;
      promptTerms.forEach((term) => sessionMatch.matchedTerms.add(term));
    }
    if (transcriptEvent.type !== 'assistant') continue;
    for (const contentBlock of Array.isArray(transcriptEvent.message?.content) ? transcriptEvent.message.content : []) {
      const toolCallText = readToolCallText(contentBlock);
      if (!toolCallText) continue;
      const toolTerms = countMatchedTerms(toolCallText, terms);
      if (toolTerms.length) sessionMatch.matchingToolCalls += 1;
      toolTerms.forEach((term) => sessionMatch.matchedTerms.add(term));
    }
  }
  return sessionMatch;
}

// Past sessions of this repo that contain half or more of the terms, newest first.
export function searchRepoSessions(mainCheckout, terms, { homeDirectory = homedir(), currentSessionId, days = DEFAULT_SEARCH_DAYS, nowMilliseconds = Date.now() } = {}) {
  if (!terms.length) return [];
  const oldestMilliseconds = nowMilliseconds - days * 24 * 60 * 60 * 1000;
  const sessionMatches = [];
  for (const transcriptFolder of listRepoTranscriptFolders(mainCheckout, homeDirectory)) {
    for (const fileName of readdirSync(transcriptFolder)) {
      if (!fileName.endsWith('.jsonl') || fileName === `${currentSessionId}.jsonl`) continue;
      const transcriptPath = join(transcriptFolder, fileName);
      if (statSync(transcriptPath).mtimeMs < oldestMilliseconds) continue;
      const sessionMatch = searchTranscript(transcriptPath, terms);
      if (sessionMatch.matchedTerms.size >= requiredTermCount(terms)) sessionMatches.push({ ...sessionMatch, matchedTerms: [...sessionMatch.matchedTerms] });
    }
  }
  return sessionMatches.sort((first, second) => String(second.startedAt).localeCompare(String(first.startedAt)));
}

function readSkillDescription(skillFilePath) {
  const { frontmatterText } = splitFrontmatter(readFileSync(skillFilePath, 'utf8'));
  return /^description:\s*(.+)$/m.exec(frontmatterText || '')?.[1]?.trim() || '';
}

// The project-level pieces: .claude/skills/<name>/SKILL.md, .claude/commands/*.md, .mcp.json servers.
export function listProjectInventory(repoRoot) {
  const inventory = [];
  const skillsDirectory = join(repoRoot, '.claude', 'skills');
  if (existsSync(skillsDirectory)) {
    for (const skillName of readdirSync(skillsDirectory)) {
      const skillFilePath = join(skillsDirectory, skillName, 'SKILL.md');
      if (existsSync(skillFilePath)) inventory.push({ kind: 'skill', name: skillName, path: `.claude/skills/${skillName}/SKILL.md`, description: readSkillDescription(skillFilePath) });
    }
  }
  const commandsDirectory = join(repoRoot, '.claude', 'commands');
  if (existsSync(commandsDirectory)) {
    for (const commandFileName of readdirSync(commandsDirectory).filter((fileName) => fileName.endsWith('.md'))) {
      const commandPath = join(commandsDirectory, commandFileName);
      inventory.push({ kind: 'command', name: commandFileName.replace(/\.md$/, ''), path: `.claude/commands/${commandFileName}`, description: readSkillDescription(commandPath) || readFileSync(commandPath, 'utf8').slice(0, 200) });
    }
  }
  const mcpConfigPath = join(repoRoot, '.mcp.json');
  if (existsSync(mcpConfigPath)) {
    try {
      const mcpServers = JSON.parse(readFileSync(mcpConfigPath, 'utf8')).mcpServers || {};
      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        inventory.push({ kind: 'mcp', name: serverName, path: '.mcp.json', description: [serverConfig?.description, serverConfig?.url, serverConfig?.command, ...(serverConfig?.args || [])].filter(Boolean).join(' ') });
      }
    } catch {
      // A broken .mcp.json lists no servers.
    }
  }
  return inventory;
}

export function searchProjectInventory(repoRoot, terms) {
  if (!terms.length) return [];
  return listProjectInventory(repoRoot)
    .map((inventoryItem) => ({ ...inventoryItem, matchedTerms: countMatchedTerms(`${inventoryItem.name} ${inventoryItem.description}`, terms) }))
    .filter((inventoryItem) => inventoryItem.matchedTerms.length >= requiredTermCount(terms));
}

export function readDismissals(repoRoot) {
  try {
    const reuseState = JSON.parse(readFileSync(join(repoRoot, REUSE_FILE), 'utf8'));
    return Array.isArray(reuseState?.dismissed) ? reuseState.dismissed : [];
  } catch {
    return [];
  }
}

export function recordDismissal(repoRoot, { slug, keywords, reason, today = new Date().toISOString().slice(0, 10) }) {
  const dismissals = readDismissals(repoRoot).filter((dismissal) => dismissal.slug !== slug);
  dismissals.push({ slug, keywords: searchTerms(keywords), reason, date: today });
  writeFileSync(join(repoRoot, REUSE_FILE), `${JSON.stringify({ dismissed: dismissals }, null, 2)}\n`);
  return dismissals;
}

// Declined proposals whose keywords share half or more of theirs with the query.
export function matchingDismissals(repoRoot, terms) {
  return readDismissals(repoRoot).filter((dismissal) => {
    const dismissalTerms = Array.isArray(dismissal.keywords) ? dismissal.keywords : [];
    return dismissalTerms.length && dismissalTerms.filter((term) => terms.includes(term)).length >= requiredTermCount(dismissalTerms);
  });
}

export function formatSearchReport({ terms, sessionMatches, inventoryMatches, dismissalMatches, days }) {
  if (!terms.length) return 'ai1 reuse: give a few keywords of the task (3+ letters, or 2 with a digit).';
  const reportLines = [`ai1 reuse search: ${terms.join(' ')} (this repo, last ${days} days)`];
  for (const dismissal of dismissalMatches) reportLines.push(`dismissed: ${dismissal.slug} - ${dismissal.reason} (${dismissal.date}); do not propose it again`);
  const matchingCount = sessionMatches.reduce((total, sessionMatch) => total + sessionMatch.matchingPrompts + sessionMatch.matchingToolCalls, 0);
  reportLines.push(sessionMatches.length
    ? `seen in ${sessionMatches.length} past session(s), ${matchingCount} matching prompts and tool calls:`
    : 'not seen in past sessions of this repo.');
  for (const sessionMatch of sessionMatches.slice(0, MAX_LISTED_SESSIONS)) {
    reportLines.push(`- ${String(sessionMatch.startedAt || '?').slice(0, 10)} ${sessionMatch.sessionId}: "${sessionMatch.firstPrompt || ''}" (${sessionMatch.matchingPrompts} prompts, ${sessionMatch.matchingToolCalls} tool calls; ${sessionMatch.matchedTerms.join(', ')})`);
  }
  if (sessionMatches.length > MAX_LISTED_SESSIONS) reportLines.push(`- ... and ${sessionMatches.length - MAX_LISTED_SESSIONS} more`);
  reportLines.push(inventoryMatches.length ? 'already in this project (complete or merge before creating a new one):' : 'nothing in this project\'s skills, commands or MCP servers covers it.');
  for (const inventoryItem of inventoryMatches) reportLines.push(`- ${inventoryItem.kind} ${inventoryItem.name} (${inventoryItem.path}): ${inventoryItem.description.slice(0, 160)}`);
  return reportLines.join('\n');
}
