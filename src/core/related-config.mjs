// The `related` field of .ai1/config.json: other repositories whose knowledge this one needs (see
// src/okf/okf-related.mjs). Like `rules`, a bad entry is dropped with a notice and only a `related` that
// is not a list is an error, so a typo never switches the guards off.

const ENTRY_FIELDS = new Set(['name', 'path', 'remote', 'branch', 'bundle', 'read_without_clone', 'owns']);

// What is wrong with one `related` entry (empty when it is valid).
export function listRelatedEntryProblems(relatedEntry) {
  if (relatedEntry === null || typeof relatedEntry !== 'object' || Array.isArray(relatedEntry)) return ['must be an object'];
  const entryProblems = Object.keys(relatedEntry).filter((fieldName) => !ENTRY_FIELDS.has(fieldName)).map((fieldName) => `unknown field "${fieldName}"`);
  if (typeof relatedEntry.name !== 'string' || !relatedEntry.name.trim()) entryProblems.push('"name" must be a non-empty string');
  const hasPath = typeof relatedEntry.path === 'string' && relatedEntry.path.trim();
  const hasRemote = typeof relatedEntry.remote === 'string' && relatedEntry.remote.trim();
  if (!hasPath && !hasRemote) entryProblems.push('needs "path" or "remote"');
  for (const textField of ['path', 'remote', 'branch', 'bundle', 'read_without_clone']) {
    if (relatedEntry[textField] !== undefined && (typeof relatedEntry[textField] !== 'string' || !relatedEntry[textField].trim())) entryProblems.push(`"${textField}" must be a non-empty string`);
  }
  if (relatedEntry.owns !== undefined && !(Array.isArray(relatedEntry.owns) && relatedEntry.owns.every((ownedItem) => typeof ownedItem === 'string' && ownedItem.trim()))) {
    entryProblems.push('"owns" must be a list of non-empty strings');
  }
  return entryProblems;
}

// { validEntries, notices }: an entry that does not validate is dropped with a notice.
export function splitRelatedEntries(rawRelated) {
  if (!Array.isArray(rawRelated)) return { validEntries: [], notices: [] };
  const validEntries = [];
  const notices = [];
  rawRelated.forEach((relatedEntry, entryIndex) => {
    const entryProblems = listRelatedEntryProblems(relatedEntry);
    if (entryProblems.length === 0) validEntries.push(relatedEntry);
    else notices.push(`.ai1/config.json related[${entryIndex}]${typeof relatedEntry?.name === 'string' ? ` (${relatedEntry.name})` : ''} is ignored: ${entryProblems.join('; ')}. Tell the person so it can be fixed.`);
  });
  return { validEntries, notices };
}

