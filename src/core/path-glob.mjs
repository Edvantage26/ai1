// Minimal glob matching for repo-relative paths, so jig.json can list paths without a dependency.
// `**` matches any number of directories, `*` anything but `/`, `?` one character but `/`.
// A pattern without `/` matches the file name at any depth (`*.md` == `**/*.md`).

export function globToRegExp(globPattern) {
  const normalizedPattern = String(globPattern).replace(/^\.\//, '');
  const anchoredPattern = normalizedPattern.includes('/') ? normalizedPattern : `**/${normalizedPattern}`;
  let regexSource = '';
  for (let characterIndex = 0; characterIndex < anchoredPattern.length; characterIndex += 1) {
    const character = anchoredPattern[characterIndex];
    if (character === '*' && anchoredPattern[characterIndex + 1] === '*') {
      const isDirectoryWildcard = anchoredPattern[characterIndex + 2] === '/';
      regexSource += isDirectoryWildcard ? '(?:.*/)?' : '.*';
      characterIndex += isDirectoryWildcard ? 2 : 1;
    } else if (character === '*') regexSource += '[^/]*';
    else if (character === '?') regexSource += '[^/]';
    else regexSource += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${regexSource}$`);
}

export function matchesAnyGlob(relativePath, globPatterns) {
  return globPatterns.some((globPattern) => globToRegExp(globPattern).test(relativePath));
}
