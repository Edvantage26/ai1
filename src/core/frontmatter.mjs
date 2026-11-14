// YAML frontmatter of markdown files: the one splitter of the repo, and flat field reads and writes
// with plain regexes. Shared by okf (bundle concepts, the validator), sizing (work plans) and later
// entries. Files may have CRLF line endings (a Windows checkout with autocrlf).
// Two levels of reading on purpose: readFrontmatterField is enough for the flat fields the hooks use
// (scalars, inline and block lists) and costs nothing on every tool call; the OKF toolkit, which runs
// on request, parses the whole block as YAML (src/okf/okf-yaml.mjs, js-yaml).

// str.splitlines() of Python: the line breaks it knows, no trailing empty line.
const PYTHON_LINE_BREAK_PATTERN = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;
export function splitLines(text) {
  if (text === '') return [];
  const lines = text.split(PYTHON_LINE_BREAK_PATTERN);
  if (PYTHON_LINE_BREAK_PATTERN.test(text.at(-1))) lines.pop();
  return lines;
}

// Like splitLines, keeping each line's ending.
function splitLinesKeepingEnds(text) {
  const lines = [];
  const lineBreakPattern = new RegExp(PYTHON_LINE_BREAK_PATTERN.source, 'g');
  let lineStart = 0;
  for (const lineBreak of text.matchAll(lineBreakPattern)) {
    lines.push(text.slice(lineStart, lineBreak.index + lineBreak[0].length));
    lineStart = lineBreak.index + lineBreak[0].length;
  }
  if (lineStart < text.length) lines.push(text.slice(lineStart));
  return lines;
}

// { frontmatterText, bodyText }; frontmatterText is null when the file has no (terminated) block.
// The block opens and closes on a line that is `---` once trimmed (trailing spaces, CRLF), read line
// by line as the OKF toolkit always did; frontmatterText keeps its last line ending.
export function splitFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatterText: null, bodyText: text };
  const lines = splitLinesKeepingEnds(text);
  if (lines[0].trim() !== '---') return { frontmatterText: null, bodyText: text };
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (lines[lineIndex].trim() === '---') {
      return { frontmatterText: lines.slice(1, lineIndex).join(''), bodyText: lines.slice(lineIndex + 1).join('') };
    }
  }
  return { frontmatterText: null, bodyText: text };
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
