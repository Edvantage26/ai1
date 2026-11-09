// `ai1 walkthrough ...`: the storyboard of a visual change (see .ai1/okf/features/walkthrough.md).
//   add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail ...] [--id ...] [--title ...] [--base ...]
//   build [--pdf]                index.html + SUMMARY.md (+ walkthrough.pdf)
// Every subcommand takes --slug <name>; without it the slug is the worktree or the only open plan.

import { findMainCheckout } from '../core/project-roots.mjs';
import { addCapture, resolveStoryboardSlug, storyboardDirectory } from '../walkthrough/walkthrough-storyboard.mjs';
import { buildStoryboard } from '../walkthrough/walkthrough-build.mjs';

export const WALKTHROUGH_USAGE = 'ai1 walkthrough add --step "<caption>" --image <file> [--variant before|after] [--viewport desktop|mobile] [--detail "..."] [--id <step-id>] [--title "..."] [--base <branch>] | build  (all take --slug <name>)';

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
    return 0;
  }
  console.log(`usage: ${WALKTHROUGH_USAGE}`);
  return 1;
}
