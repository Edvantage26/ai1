// Lists inside a module's context text (index lines, concepts to check, unfinished plans, later
// entries, related repositories) that can lose items when the texts of one hook event go over the
// budget of core/hook-io.mjs: the list then says how many items it left out and where the full list is,
// and no rule text around it is cut. A module builds its context as parts - strings and lists - with
// `contextDecision(moduleId, parts)`.

export const MAX_LIST_TITLE_CHARACTERS = 60;

// `items`: one string per item (it may span several lines). `describeLeftOut(count)`: the line that
// replaces the items left out, e.g. (count) => `- ... and ${count} more in .ai1/later/README.md`.
// `shownAtMost`: the items shown even when there is room (the rest are left out from the start).
export function contextList(items, describeLeftOut, { shownAtMost = Infinity } = {}) {
  return { kind: 'list', items: [...items], describeLeftOut, shownCount: Math.min(items.length, shownAtMost) };
}

export function isContextList(contextPart) {
  return typeof contextPart === 'object' && contextPart?.kind === 'list';
}

export function renderContextPart(contextPart) {
  if (!isContextList(contextPart)) return contextPart;
  const shownItems = contextPart.items.slice(0, contextPart.shownCount);
  const leftOutCount = contextPart.items.length - contextPart.shownCount;
  return [...shownItems, ...(leftOutCount > 0 ? [contextPart.describeLeftOut(leftOutCount)] : [])].join('\n');
}

export function renderContextParts(contextParts) {
  return contextParts.map(renderContextPart).filter((renderedPart) => renderedPart !== '').join('\n');
}

// A title as a list shows it: at most MAX_LIST_TITLE_CHARACTERS, cut at a word with "...".
export function shortenListTitle(titleText) {
  if (titleText.length <= MAX_LIST_TITLE_CHARACTERS) return titleText;
  const keptText = titleText.slice(0, MAX_LIST_TITLE_CHARACTERS - 3);
  const lastSpace = keptText.lastIndexOf(' ');
  return `${(lastSpace > MAX_LIST_TITLE_CHARACTERS / 2 ? keptText.slice(0, lastSpace) : keptText).trimEnd()}...`;
}
