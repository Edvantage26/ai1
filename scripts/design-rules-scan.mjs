#!/usr/bin/env node
// Development script for the `design` feature: runs the design-detect rules over the tracked UI files of
// real repositories and prints, per rule, how many lines it flags, a few examples and how long it took.
// Use it after adding or changing a rule to measure false positives and speed before shipping
// (see .ai1/okf/features/design.md, "Verified").
//
//   node scripts/design-rules-scan.mjs <repo-path>... [--rules id,id] [--examples 4] [--json]
//
// Only files tracked by git (no node_modules or build output), up to the size design-detect scans.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { DESIGN_RULES, classifyUiFile } from '../src/design/design-rules.mjs';

const MAX_SCANNED_FILE_BYTES = 512 * 1024;

export function parseScanArguments(commandArguments) {
  const scanOptions = { repositoryPaths: [], ruleIds: null, examplesPerRule: 4, asJson: false };
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (commandArgument === '--rules') scanOptions.ruleIds = String(commandArguments[++argumentIndex] || '').split(',').filter(Boolean);
    else if (commandArgument === '--examples') scanOptions.examplesPerRule = Number(commandArguments[++argumentIndex]);
    else if (commandArgument === '--json') scanOptions.asJson = true;
    else scanOptions.repositoryPaths.push(resolve(commandArgument));
  }
  const knownRuleIds = new Set(DESIGN_RULES.map((designRule) => designRule.id));
  const unknownRuleIds = (scanOptions.ruleIds || []).filter((ruleId) => !knownRuleIds.has(ruleId));
  if (unknownRuleIds.length) throw new Error(`unknown rule ids: ${unknownRuleIds.join(', ')}`);
  if (!scanOptions.repositoryPaths.length) throw new Error('usage: design-rules-scan.mjs <repo-path>... [--rules id,id] [--examples 4] [--json]');
  if (!Number.isInteger(scanOptions.examplesPerRule) || scanOptions.examplesPerRule < 0) throw new Error('--examples takes a whole number');
  return scanOptions;
}

function listTrackedUiFiles(repositoryPath) {
  const trackedFiles = execFileSync('git', ['-C', repositoryPath, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
  return trackedFiles.filter((trackedFile) => classifyUiFile(trackedFile)).map((trackedFile) => join(repositoryPath, trackedFile));
}

// { scannedFiles, rules: [{ id, hits, totalMilliseconds, slowestMilliseconds, slowestFile, examples: [{ file, line, text }] }] }
export function scanRepositories({ repositoryPaths, ruleIds, examplesPerRule }) {
  const selectedRules = DESIGN_RULES.filter((designRule) => !ruleIds || ruleIds.includes(designRule.id));
  const ruleStatistics = new Map(selectedRules.map((designRule) => [designRule.id, { id: designRule.id, hits: 0, totalMilliseconds: 0, slowestMilliseconds: 0, slowestFile: null, allExamples: [] }]));
  let scannedFiles = 0;
  for (const repositoryPath of repositoryPaths) {
    for (const filePath of listTrackedUiFiles(repositoryPath)) {
      let fileText;
      try {
        if (statSync(filePath).size > MAX_SCANNED_FILE_BYTES) continue;
        fileText = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      scannedFiles += 1;
      const uiFile = { kind: classifyUiFile(filePath), text: fileText, lines: fileText.split('\n') };
      const displayPath = relative(resolve(repositoryPath, '..'), filePath).split('\\').join('/');
      for (const designRule of selectedRules) {
        if (!designRule.fileKinds.includes(uiFile.kind)) continue;
        const startTime = performance.now();
        const findingLines = [...new Set(designRule.findLines(uiFile))];
        const elapsedMilliseconds = performance.now() - startTime;
        const statistics = ruleStatistics.get(designRule.id);
        statistics.totalMilliseconds += elapsedMilliseconds;
        if (elapsedMilliseconds > statistics.slowestMilliseconds) Object.assign(statistics, { slowestMilliseconds: elapsedMilliseconds, slowestFile: displayPath });
        statistics.hits += findingLines.length;
        for (const findingLine of findingLines) statistics.allExamples.push({ file: displayPath, line: findingLine, text: uiFile.lines[findingLine - 1].trim().slice(0, 120) });
      }
    }
  }
  // Examples spread over the whole list, so one big file does not fill them all.
  const rules = [...ruleStatistics.values()].map(({ allExamples, ...statistics }) => {
    const exampleStep = Math.max(1, Math.ceil(allExamples.length / Math.max(1, examplesPerRule)));
    return { ...statistics, examples: allExamples.filter((_, exampleIndex) => exampleIndex % exampleStep === 0).slice(0, examplesPerRule) };
  });
  return { scannedFiles, rules };
}

export function formatScanReport({ scannedFiles, rules }) {
  const reportLines = [`${scannedFiles} UI files scanned`, '', 'rule | hits | total ms | slowest ms (file)'];
  for (const ruleReport of [...rules].sort((first, second) => second.hits - first.hits)) {
    reportLines.push(`${ruleReport.id} | ${ruleReport.hits} | ${Math.round(ruleReport.totalMilliseconds)} | ${Math.round(ruleReport.slowestMilliseconds)}${ruleReport.slowestFile ? ` (${ruleReport.slowestFile})` : ''}`);
  }
  for (const ruleReport of rules.filter((candidateReport) => candidateReport.examples.length)) {
    reportLines.push('', `## ${ruleReport.id}`);
    for (const example of ruleReport.examples) reportLines.push(`  ${example.file}:${example.line}: ${example.text}`);
  }
  return reportLines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const scanOptions = parseScanArguments(process.argv.slice(2));
    const scanResult = scanRepositories(scanOptions);
    console.log(scanOptions.asJson ? JSON.stringify(scanResult, null, 2) : formatScanReport(scanResult));
  } catch (scanError) {
    console.error(`design-rules-scan: ${scanError.message}`);
    process.exit(1);
  }
}
