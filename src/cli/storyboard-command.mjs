// `ai1 storyboard ...`: the storyboard of a visual change (see .ai1/okf/features/storyboard.md).
//   add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail ...] [--id ...] [--title ...] [--base ...]
//   note --step <id> --severity P0|P1|P2|P3 --text "..." [--profile <name>] [--fix "..."] [--viewport desktop|mobile] | note --clear
//                                findings on a step (from /ai1:design-review-usability); --clear removes them all
//   build [--pdf]                index.html + SUMMARY.md (+ storyboard.pdf)
//   serve [--host <h>] [--port <n>] [--ttl <hours>] | stop | list
//   clean                        delete the screenshots `add` copied from (worktree finish/drop do it too)
// Every subcommand takes --slug <name>; without it the slug is the worktree or the only open plan.

import { findMainCheckout } from '../core/project-roots.mjs';
import { addCapture, addStepNote, clearStepNotes, cleanResidualScreenshots, resolveStoryboardSlug, storyboardDirectory } from '../storyboard/storyboard-steps.mjs';
import { buildStoryboard } from '../storyboard/storyboard-build.mjs';
import { printStoryboardPdf } from '../storyboard/storyboard-pdf.mjs';
import { listStoryboards, serveStoryboard, stopStoryboardServer } from '../storyboard/storyboard-serve.mjs';

export const STORYBOARD_USAGE = 'ai1 storyboard add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail "..."] [--id <step-id>] [--title "..."] [--base <branch>] | note --step <step-id> --severity P0|P1|P2|P3 --text "..." [--profile <name>] [--fix "..."] [--viewport desktop|mobile] | note --clear | build [--pdf] | serve [--host <host>] [--port <n>] [--ttl <hours>] | stop | list | clean  (all take --slug <name>)';

// Prints the result and returns the exit code.
export function runStoryboardCommand(treeRoot, commandArguments, { readOption }) {
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
  if (subcommandName === 'note') {
    const { slug, storyboardPath } = resolveStoryboard();
    if (commandArguments.includes('--clear')) {
      console.log(`removed ${clearStepNotes(storyboardPath)} note(s) from storyboard ${slug}`);
      return 0;
    }
    const { storyboard, step, note } = addStepNote(storyboardPath, {
      stepId: readOption('--step'), severity: readOption('--severity'), text: readOption('--text'),
      profile: readOption('--profile'), fix: readOption('--fix'), viewport: readOption('--viewport'),
    });
    console.log(`note ${note.id} (${note.severity}) on step ${storyboard.steps.indexOf(step) + 1} "${step.caption}" | rebuild with \`ai1 storyboard build\``);
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
      else console.log(`pdf not written: ${printResult.error}. Print ${buildResult.htmlPath} to ${storyboardPath}/storyboard.pdf with your browser tool (print media, one step per page).`);
    }
    return 0;
  }
  if (subcommandName === 'serve') {
    const { slug } = resolveStoryboard();
    const { serverInfo, alreadyRunning } = serveStoryboard(mainRoot, slug, { host: readOption('--host'), port: readOption('--port'), ttlHours: readOption('--ttl') });
    console.log(`${alreadyRunning ? 'already serving' : 'serving'} ${slug} at ${serverInfo.url} (until ${serverInfo.expires_at}, or \`ai1 storyboard stop\`, or when its worktree is finished or dropped)`);
    return 0;
  }
  if (subcommandName === 'stop') {
    const { slug } = resolveStoryboard();
    const releasedUrl = stopStoryboardServer(mainRoot, slug);
    console.log(releasedUrl ? `stopped ${releasedUrl}` : `no server running for ${slug}`);
    return 0;
  }
  if (subcommandName === 'clean') {
    const { storyboardPath } = resolveStoryboard();
    const { deleted, kept } = cleanResidualScreenshots(storyboardPath);
    console.log(`deleted ${deleted.length} residual screenshot(s)${deleted.length ? `:\n${deleted.map((deletedPath) => `  ${deletedPath}`).join('\n')}` : ''}`);
    for (const keptSource of kept) console.log(`kept ${keptSource.path} (${keptSource.reason})`);
    return 0;
  }
  if (subcommandName === 'list') {
    const storyboards = listStoryboards(mainRoot);
    console.log(storyboards.length
      ? storyboards.map((storyboard) => `${storyboard.slug}: ${storyboard.steps} steps${storyboard.built ? ', built' : ''}${storyboard.url ? `, at ${storyboard.url}` : ''}`).join('\n')
      : 'no storyboards in this repo');
    return 0;
  }
  console.log(`usage: ${STORYBOARD_USAGE}`);
  return 1;
}
