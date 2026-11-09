// YAML frontmatter of markdown files, read and written with plain regexes (no YAML parser: ai1 has
// zero dependencies). Enough for the flat fields ai1 uses: scalars, inline lists and block lists.
// Shared by okf (bundle concepts), lanes (work plans) and proposals.
// Files may have CRLF line endings (a Windows checkout with autocrlf).

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/;

// { frontmatterText, bodyText }; frontmatterText is null when the file has no frontmatter.
export function splitFrontmatter(markdownText) {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(markdownText);
  return frontmatterMatch
    ? { frontmatterText: frontmatterMatch[1], bodyText: frontmatterMatch[2] }
    : { frontmatterText: null, bodyText: markdownText };
}

// The field's value without quotes or list brackets; a block list is joined with spaces; '' when absent.
export function readFrontmatterField(frontmatterText, fieldName) {
  // `[ \t]*`, not `\s*`: the value must not run into the next line, or a block list reads as "- a".
  const fieldMatch = new RegExp(`^${fieldName}:[ \\t]*(.*)$`, 'm').exec(frontmatterText || '');
  if (!fieldMatch) return '';
  const inlineValue = fieldMatch[1].trim();
  if (inlineValue) return inlineValue.replace(/^\[|\]$/g, '').replace(/^['"]|['"]$/g, '');
  // Block list: "tags:\n  - a\n  - b"
  const blockStart = fieldMatch.index + fieldMatch[0].length;
  const blockItems = [];
  for (const blockLine of frontmatterText.slice(blockStart).split(/\r?\n/).slice(1)) {
    const itemMatch = /^\s*-\s*(.+)$/.exec(blockLine);
    if (!itemMatch) break;
    blockItems.push(itemMatch[1]);
  }
  return blockItems.join(' ');
}

// Sets a scalar field, replacing it or appending it; adds a frontmatter block when there is none.
export function writeFrontmatterField(markdownText, fieldName, fieldValue) {
  const frontmatterMatch = /^---(\r?\n)([\s\S]*?)\r?\n---/.exec(markdownText);
  if (!frontmatterMatch) return `---\n${fieldName}: ${fieldValue}\n---\n\n${markdownText}`;
  const [matchedBlock, lineEnding, currentFrontmatterText] = frontmatterMatch;
  const fieldPattern = new RegExp(`^${fieldName}:.*$`, 'm');
  // A replacer function, so `$&` or `$$` in the value are written as they are.
  const frontmatterText = fieldPattern.test(currentFrontmatterText)
    ? currentFrontmatterText.replace(fieldPattern, () => `${fieldName}: ${fieldValue}`)
    : `${currentFrontmatterText}${lineEnding}${fieldName}: ${fieldValue}`;
  return `---${lineEnding}${frontmatterText}${lineEnding}---${markdownText.slice(matchedBlock.length)}`;
}
