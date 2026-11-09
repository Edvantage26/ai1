// `ai1 walkthrough ...`: the storyboard of a visual change (see .ai1/okf/features/walkthrough.md).
//   add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail ...] [--id ...] [--title ...] [--base ...]
//   build [--pdf]                index.html + SUMMARY.md (+ walkthrough.pdf)
//   serve [--host <h>] [--port <n>] [--ttl <hours>] | stop | list
// Every subcommand takes --slug <name>; without it the slug is the worktree or the only open plan.

import { findMainCheckout } from '../core/project-roots.mjs';
import { addCapture, resolveStoryboardSlug, storyboardDirectory } from '../walkthrough/walkthrough-storyboard.mjs';
import { buildStoryboard } from '../walkthrough/walkthrough-build.mjs';
import { printStoryboardPdf } from '../walkthrough/walkthrough-pdf.mjs';
import { listStoryboards, serveStoryboard, stopStoryboardServer } from '../walkthrough/walkthrough-serve.mjs';

export const WALKTHROUGH_USAGE = 'ai1 walkthrough add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail "..."] [--id <step-id>] [--title "..."] [--base <branch>] | build [--pdf] | serve [--host <host>] [--port <n>] [--ttl <hours>] | stop | list  (all take --slug <name>)';

// Prints the result and returns the exit code.
export function runWalkthroughCommand(treeRoot, commandArguments, { readOption }) {
  const [subcommandName] = commandArguments;
  const mainRoot = findMainCheckout(treeRoot);
  const resolveStoryboard = () => {
    const slug = resolveStoryboardSlug({ treeRoot, mainRoot, requestedSlug: readOption('--slug') });
    return { slug, storyboardPath: storyboardDirectory(mainRoot, slug) };
  };

  if (subcommandName === 'add') {
    const { slug, storyboardPath } = resolveStoryboard();
    const { storyboard, step, imagePath } = addCapture(storyboardPath, slug, {
      caption: readOption('--step'), imageFile: readOption('--image'), variant: readOption('--variant'), viewport: readOption('--viewport'),
      detail: readOption('--detail'), stepId: readOption('--id'), title: readOption('--title'), base: readOption('--base'),
    });
    const stepNumber = storyboard.steps.indexOf(step) + 1;
    console.log(`step ${stepNumber} "${step.caption}" (id ${step.id}): ${imagePath} | storyboard ${slug}, ${storyboard.steps.length} steps`);
    return 0;
  }
  if (subcommandName === 'build') {
    const { storyboardPath } = resolveStoryboard();
    const buildResult = buildStoryboard(storyboardPath);
    console.log(`built ${buildResult.stepCount} steps: ${buildResult.htmlPath}`);
    console.log(`summary: ${buildResult.summaryPath}`);
    if (buildResult.warning) console.log(`warning: ${buildResult.warning}`);
    if (commandArguments.includes('--pdf')) {
      const printResult = printStoryboardPdf(storyboardPath, buildResult.htmlPath);
      if (printResult.pdfPath) console.log(`pdf: ${printResult.pdfPath}`);
      else console.log(`pdf not written: ${printResult.error}. Print ${buildResult.htmlPath} to ${storyboardPath}/walkthrough.pdf with your browser tool (print media, one step per page).`);
    }
    return 0;
  }
  if (subcommandName === 'serve') {
    const { slug } = resolveStoryboard();
    const { serverInfo, alreadyRunning } = serveStoryboard(mainRoot, slug, { host: readOption('--host'), port: readOption('--port'), ttlHours: readOption('--ttl') });
    console.log(`${alreadyRunning ? 'already serving' : 'serving'} ${slug} at ${serverInfo.url} (until ${serverInfo.expires_at}, or \`ai1 walkthrough stop\`, or when its worktree is finished or dropped)`);
    return 0;
  }
  if (subcommandName === 'stop') {
    const { slug } = resolveStoryboard();
    const releasedUrl = stopStoryboardServer(mainRoot, slug);
    console.log(releasedUrl ? `stopped ${releasedUrl}` : `no server running for ${slug}`);
    return 0;
  }
  if (subcommandName === 'list') {
    const storyboards = listStoryboards(mainRoot);
    console.log(storyboards.length
      ? storyboards.map((storyboard) => `${storyboard.slug}: ${storyboard.steps} steps${storyboard.built ? ', built' : ''}${storyboard.url ? `, at ${storyboard.url}` : ''}`).join('\n')
      : 'no storyboards in this repo');
    return 0;
  }
  console.log(`usage: ${WALKTHROUGH_USAGE}`);
  return 1;
}
