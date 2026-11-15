// Lines of a text that look like they hold a literal secret: a known token prefix, a URL with a
// password, or a secret label (password, token, API key...) next to a literal value. Used where ai1
// would otherwise suggest copying text somewhere else (the CLAUDE.md drift check proposes moving
// sections into the bundle): a section with a secret must be cleaned, not moved. Only line numbers
// leave this module, never the value. Heuristic and conservative: placeholders (`$VAR`, `<key>`,
// `op://...`, `***`), environment variable names and paths (any value with a `/`) are not secrets.

const KNOWN_TOKEN_PATTERN = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abposr]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const URL_PASSWORD_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@/i;
// A label word on its own (`DOKPLOY_API_KEY` counts, `passing` or `tokens` do not).
const SECRET_LABEL_PATTERN = /(?<![A-Za-z])(pass(?:word|wd)?|pwd|secret|token|api[\s_-]?key|access[\s_-]?key|private[\s_-]?key|credential)(?![a-z])/i;
// A candidate value: a backticked or quoted literal, or what follows `:`, `=` or a table cell bar.
const CANDIDATE_VALUE_PATTERN = /`([^`\s]+)`|"([^"\s]+)"|'([^'\s]+)'|[:=|]\s*([^\s`"'|,;)]+)/g;
const PLACEHOLDER_VALUE_PATTERN = /[$<>{}]|^op:\/\/|\*\*\*|\.\.\.|^x+$/i;
const ENVIRONMENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MIN_SECRET_LENGTH = 12;

function looksLikeLiteralSecret(candidateValue) {
  if (!candidateValue || candidateValue.length < MIN_SECRET_LENGTH) return false;
  if (PLACEHOLDER_VALUE_PATTERN.test(candidateValue) || ENVIRONMENT_NAME_PATTERN.test(candidateValue)) return false;
  if (candidateValue.includes('/')) return false;
  const hasDigitAndLetter = /\d/.test(candidateValue) && /[A-Za-z]/.test(candidateValue);
  // A value with no digit (some API keys are letters only) counts when long, mixed case and unbroken.
  const isLongMixedCase = candidateValue.length >= 20 && /[a-z]/.test(candidateValue) && /[A-Z]/.test(candidateValue) && !/[\s_.-]/.test(candidateValue);
  return hasDigitAndLetter || isLongMixedCase;
}

function lineHoldsSecret(textLine) {
  if (KNOWN_TOKEN_PATTERN.test(textLine)) return true;
  const urlMatch = URL_PASSWORD_PATTERN.exec(textLine);
  if (urlMatch && !PLACEHOLDER_VALUE_PATTERN.test(urlMatch[1])) return true;
  const labelMatch = SECRET_LABEL_PATTERN.exec(textLine);
  if (!labelMatch) return false;
  const textAfterLabel = textLine.slice(labelMatch.index + labelMatch[0].length);
  for (const valueMatch of textAfterLabel.matchAll(CANDIDATE_VALUE_PATTERN)) {
    if (looksLikeLiteralSecret(valueMatch[1] || valueMatch[2] || valueMatch[3] || valueMatch[4])) return true;
  }
  return false;
}

// 1-based numbers of the lines that look like they hold a secret.
export function findSecretLines(text) {
  return (text || '').split(/\r?\n/).flatMap((textLine, lineIndex) => (lineHoldsSecret(textLine) ? [lineIndex + 1] : []));
}
