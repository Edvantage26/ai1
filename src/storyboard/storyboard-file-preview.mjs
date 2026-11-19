// The preview of an evidence file, worked out when it is added and stored in `steps.json`:
// { kind: 'generic' } for types ai1 does not read. Short on purpose: few rows, short cells.

export const MAX_PREVIEW_ROWS = 10;
export const MAX_PREVIEW_COLUMNS = 12;
export const MAX_PREVIEW_SHEETS = 5;
export const MAX_CELL_LENGTH = 40;

export function buildFilePreview() {
  return { kind: 'generic' };
}
