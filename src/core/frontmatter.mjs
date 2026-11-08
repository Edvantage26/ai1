// YAML frontmatter of markdown files, read and written with plain regexes (no YAML parser: jig has
// zero dependencies). Enough for the flat fields jig uses: scalars, inline lists and block lists.
// Shared by okf (bundle concepts), lanes (work plans) and rfc (proposals).

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

// { frontmatterText, bodyText }; frontmatterText is null when the file has no frontmatter.
export function splitFrontmatter(markdownText) {
  const frontmatterMatch = FRONTMATTER_PATTERN.exec(markdownText);
  return frontmatterMatch
    ? { frontmatterText: frontmatterMatch[1], bodyText: frontmatterMatch[2] }
    : { frontmatterText: null, bodyText: markdownText };
}

// The field's value without quotes or list brackets; a block list is joined with spaces; '' when absent.
export function readFrontmatterField(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:\\s*(.*)$`, 'm').exec(frontmatterText || '');
  if (!fieldMatch) return '';
  const inlineValue = fieldMatch[1].trim();
  if (inlineValue) return inlineValue.replace(/^\[|\]$/g, '').replace(/^['"]|['"]$/g, '');
  // Block list: "tags:\n  - a\n  - b"
  const blockStart = fieldMatch.index + fieldMatch[0].length;
  const blockItems = [];
  for (const blockLine of frontmatterText.slice(blockStart).split('\n').slice(1)) {
    const itemMatch = /^\s*-\s*(.+)$/.exec(blockLine);
    if (!itemMatch) break;
    blockItems.push(itemMatch[1]);
  }
  return blockItems.join(' ');
}

// Sets a scalar field, replacing it or appending it; adds a frontmatter block when there is none.
export function writeFrontmatterField(markdownText, fieldName, fieldValue) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(markdownText);
  if (!frontmatterMatch) return `---\n${fieldName}: ${fieldValue}\n---\n\n${markdownText}`;
  const fieldPattern = new RegExp(`^${fieldName}:.*$`, 'm');
  const frontmatterText = fieldPattern.test(frontmatterMatch[1])
    ? frontmatterMatch[1].replace(fieldPattern, `${fieldName}: ${fieldValue}`)
    : `${frontmatterMatch[1]}\n${fieldName}: ${fieldValue}`;
  return `---\n${frontmatterText}\n---${markdownText.slice(frontmatterMatch[0].length)}`;
}
