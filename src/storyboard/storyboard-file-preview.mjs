// The preview of an evidence file, worked out when it is added and stored in `steps.json`. Short on
// purpose: few rows, short cells, the first lines. Plain Node, no dependencies:
//   table  .csv .tsv .xlsx  { sheets: [{ name, rows_total, columns_total, rows }], sheets_total }  (rows[0] is the header row)
//   lines  text files       { lines_total, lines }
//   eml    .eml             { headers: { from, to, subject, date }, body_lines, attachments }
//   pdf    .pdf             { pages }
//   image  images           {}  (shown from the copied file)
//   generic anything else   {}
// With `mask`, every value except table headers and the email date is replaced by its shape.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const MAX_PREVIEW_ROWS = 10;
export const MAX_PREVIEW_COLUMNS = 12;
export const MAX_PREVIEW_SHEETS = 5;
export const MAX_CELL_LENGTH = 40;
export const MAX_TEXT_LINES = 20;
export const MAX_EML_BODY_LINES = 10;
const MAX_LINE_LENGTH = 160;
const TEXT_EXTENSIONS = ['.txt', '.json', '.md', '.xml', '.log', '.yml', '.yaml', '.html', '.htm', '.sql', '.ini', '.toml'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// Letters to X/x, digits to 9; punctuation and spaces stay, so the shape of the value is still seen.
export function maskValue(rawText) {
  return String(rawText).replace(/\p{Lu}/gu, 'X').replace(/[\p{Ll}\p{Lo}\p{Lt}\p{Lm}]/gu, 'x').replace(/\p{Nd}/gu, '9');
}

function cutText(rawText, maxLength) {
  const singleLineText = String(rawText).replace(/\s*\n\s*/g, ' ');
  return singleLineText.length > maxLength ? `${singleLineText.slice(0, maxLength - 1)}…` : singleLineText;
}

function shownValue(rawText, maxLength, mask) {
  const cutValue = cutText(rawText, maxLength);
  return mask ? maskValue(cutValue) : cutValue;
}

// rows: all non-empty rows of a sheet as arrays of strings. Keeps the first MAX_PREVIEW_ROWS rows
// (header included) and MAX_PREVIEW_COLUMNS columns; the header row is never masked.
function previewSheet(sheetName, sheetRows, mask) {
  const columnsTotal = sheetRows.reduce((widest, sheetRow) => Math.max(widest, sheetRow.length), 0);
  const shownColumns = Math.min(columnsTotal, MAX_PREVIEW_COLUMNS);
  const shownRows = sheetRows.slice(0, MAX_PREVIEW_ROWS).map((sheetRow, rowIndex) => Array.from({ length: shownColumns }, (unused, columnIndex) => {
    const cellText = sheetRow[columnIndex] ?? '';
    return shownValue(cellText, MAX_CELL_LENGTH, mask && rowIndex > 0);
  }));
  const previewedSheet = { rows_total: sheetRows.length, columns_total: columnsTotal, rows: shownRows };
  return sheetName === null ? previewedSheet : { name: sheetName, ...previewedSheet };
}

const isEmptyRow = (sheetRow) => sheetRow.every((cellText) => cellText === '');

// --- delimited text (.csv .tsv) ---

function guessDelimiter(firstLine) {
  const candidateCounts = [',', ';', '\t'].map((candidate) => [candidate, firstLine.split(candidate).length - 1]);
  return candidateCounts.sort((left, right) => right[1] - left[1])[0][0];
}

export function parseDelimitedText(fileText, delimiter) {
  const parsedRows = [];
  let currentRow = [];
  let currentCell = '';
  let insideQuotes = false;
  for (let characterIndex = 0; characterIndex < fileText.length; characterIndex += 1) {
    const character = fileText[characterIndex];
    if (insideQuotes) {
      if (character === '"' && fileText[characterIndex + 1] === '"') { currentCell += '"'; characterIndex += 1; }
      else if (character === '"') insideQuotes = false;
      else currentCell += character;
    } else if (character === '"' && currentCell === '') insideQuotes = true;
    else if (character === delimiter) { currentRow.push(currentCell); currentCell = ''; }
    else if (character === '\n' || character === '\r') {
      if (character === '\r' && fileText[characterIndex + 1] === '\n') characterIndex += 1;
      currentRow.push(currentCell);
      parsedRows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else currentCell += character;
  }
  if (currentCell !== '' || currentRow.length) { currentRow.push(currentCell); parsedRows.push(currentRow); }
  return parsedRows.filter((parsedRow) => !isEmptyRow(parsedRow));
}

function previewDelimitedFile(filePath, fileExtension, mask) {
  const fileText = readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  const delimiter = fileExtension === '.tsv' ? '\t' : guessDelimiter(fileText.split(/\r?\n/, 1)[0]);
  return { kind: 'table', sheets: [previewSheet(null, parseDelimitedText(fileText, delimiter), mask)], sheets_total: 1 };
}

// --- zip (for .xlsx): central directory, stored or deflated entries; no zip64 ---

export function readZipEntries(zipBytes) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let scanOffset = zipBytes.length - 22; scanOffset >= Math.max(0, zipBytes.length - 65557); scanOffset -= 1) {
    if (zipBytes.readUInt32LE(scanOffset) === endSignature) { endOffset = scanOffset; break; }
  }
  if (endOffset < 0) throw new Error('not a zip file');
  const entryCount = zipBytes.readUInt16LE(endOffset + 10);
  let directoryOffset = zipBytes.readUInt32LE(endOffset + 16);
  if (directoryOffset === 0xffffffff) throw new Error('zip64 files are not supported');
  const zipEntries = new Map();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    if (zipBytes.readUInt32LE(directoryOffset) !== 0x02014b50) throw new Error('broken zip central directory');
    const compressionMethod = zipBytes.readUInt16LE(directoryOffset + 10);
    const compressedSize = zipBytes.readUInt32LE(directoryOffset + 20);
    const nameLength = zipBytes.readUInt16LE(directoryOffset + 28);
    const extraLength = zipBytes.readUInt16LE(directoryOffset + 30);
    const commentLength = zipBytes.readUInt16LE(directoryOffset + 32);
    const localHeaderOffset = zipBytes.readUInt32LE(directoryOffset + 42);
    const entryName = zipBytes.toString('utf8', directoryOffset + 46, directoryOffset + 46 + nameLength);
    zipEntries.set(entryName, () => {
      const dataOffset = localHeaderOffset + 30 + zipBytes.readUInt16LE(localHeaderOffset + 26) + zipBytes.readUInt16LE(localHeaderOffset + 28);
      const compressedBytes = zipBytes.subarray(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 0) return compressedBytes;
      if (compressionMethod === 8) return inflateRawSync(compressedBytes);
      throw new Error(`zip compression method ${compressionMethod} is not supported`);
    });
    directoryOffset += 46 + nameLength + extraLength + commentLength;
  }
  return zipEntries;
}

// --- .xlsx: sheet names, shared and inline strings, cell values as stored; date cells as dates ---

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXmlText(xmlText) {
  return xmlText.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entityText, entityName) => {
    if (entityName[0] !== '#') return XML_ENTITIES[entityName.toLowerCase()];
    return String.fromCodePoint(entityName[1].toLowerCase() === 'x' ? parseInt(entityName.slice(2), 16) : Number(entityName.slice(1)));
  });
}

function joinTextRuns(xmlFragment) {
  return [...xmlFragment.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((textRun) => decodeXmlText(textRun[1])).join('');
}

function readXmlAttribute(attributesText, attributeName) {
  const attributeMatch = attributesText.match(new RegExp(`(?:^|\\s)${attributeName}="([^"]*)"`));
  return attributeMatch ? decodeXmlText(attributeMatch[1]) : undefined;
}

function columnIndexFromReference(cellReference) {
  const columnLetters = (cellReference ?? '').match(/^[A-Z]+/)?.[0];
  if (!columnLetters) return null;
  return [...columnLetters].reduce((columnNumber, columnLetter) => columnNumber * 26 + columnLetter.charCodeAt(0) - 64, 0) - 1;
}

// Built-in number formats that are dates or times (ECMA-376 18.8.30): 14-22 and 45-47.
const BUILT_IN_DATE_FORMAT_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const MILLISECONDS_PER_DAY = 86_400_000;

// Whether a number format code shows a date or time: a d, m, y, h or s outside quoted text,
// escapes and [colour]/[$-locale] brackets (`[h]:mm` elapsed time counts).
function isDateFormatCode(formatCode) {
  const unquotedCode = formatCode.replace(/"[^"]*"|\\.|_.|\*./g, '').replace(/\[(?![hms]+\])[^\]]*\]/gi, '');
  return /[dmyhs]/i.test(unquotedCode);
}

// Per cell style index (the `s` of a cell), whether it shows a date, read from xl/styles.xml.
export function readDateStyleIndexes(stylesXml) {
  const customFormats = new Map([...stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)]
    .map((formatMatch) => [Number(readXmlAttribute(formatMatch[1], 'numFmtId')), readXmlAttribute(formatMatch[1], 'formatCode') ?? '']));
  const cellFormatsXml = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...cellFormatsXml.matchAll(/<xf\b([^>]*?)\/?>/g)].map((formatMatch) => {
    const formatId = Number(readXmlAttribute(formatMatch[1], 'numFmtId') ?? 0);
    return customFormats.has(formatId) ? isDateFormatCode(customFormats.get(formatId)) : BUILT_IN_DATE_FORMAT_IDS.has(formatId);
  });
}

// An Excel date serial as `YYYY-MM-DD`, with `HH:MM` (`:SS` when not zero) when it has a time of day,
// or only the time for a serial below 1. The 1900 system counts the nonexistent 1900-02-29 (serial 60).
export function formatExcelDate(serialText, uses1904DateSystem = false) {
  const serialNumber = Number(serialText);
  if (!Number.isFinite(serialNumber) || serialNumber < 0) return serialText;
  const epochMilliseconds = uses1904DateSystem ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serialNumber < 60 ? 31 : 30);
  const isoText = new Date(epochMilliseconds + Math.round(serialNumber * MILLISECONDS_PER_DAY / 1000) * 1000).toISOString();
  const datePart = isoText.slice(0, 10);
  const timePart = isoText.slice(11, 19).replace(/:00$/, '');
  if (serialNumber < 1 && !uses1904DateSystem) return timePart;
  return timePart === '00:00' ? datePart : `${datePart} ${timePart}`;
}

function readSheetRows(sheetXml, sharedStrings, dateStyleIndexes = [], uses1904DateSystem = false) {
  const sheetRows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const sheetRow = [];
    let nextColumnIndex = 0;
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellType = readXmlAttribute(cellMatch[1], 't');
      const cellContent = cellMatch[2] ?? '';
      const rawValue = cellContent.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const cellText = cellType === 's' ? sharedStrings[Number(rawValue)] ?? ''
        : cellType === 'inlineStr' ? joinTextRuns(cellContent)
          : cellType === 'b' ? (rawValue === '1' ? 'TRUE' : 'FALSE')
            : rawValue === undefined ? ''
              : (cellType === undefined || cellType === 'n') && dateStyleIndexes[Number(readXmlAttribute(cellMatch[1], 's') ?? 0)] ? formatExcelDate(rawValue, uses1904DateSystem)
                : decodeXmlText(rawValue);
      const columnIndex = columnIndexFromReference(readXmlAttribute(cellMatch[1], 'r')) ?? nextColumnIndex;
      sheetRow[columnIndex] = cellText;
      nextColumnIndex = columnIndex + 1;
    }
    const filledRow = Array.from(sheetRow, (cellText) => cellText ?? '');
    if (filledRow.length && !isEmptyRow(filledRow)) sheetRows.push(filledRow);
  }
  return sheetRows;
}

function previewXlsxFile(filePath, mask) {
  const zipEntries = readZipEntries(readFileSync(filePath));
  const readEntryText = (entryName) => zipEntries.get(entryName)?.().toString('utf8');
  const workbookXml = readEntryText('xl/workbook.xml');
  if (!workbookXml) throw new Error('no xl/workbook.xml: not an Excel workbook');
  const relationshipsXml = readEntryText('xl/_rels/workbook.xml.rels') ?? '';
  const sheetTargets = new Map([...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((relationshipMatch) => [readXmlAttribute(relationshipMatch[1], 'Id'), readXmlAttribute(relationshipMatch[1], 'Target')]));
  const sharedStringsXml = readEntryText('xl/sharedStrings.xml') ?? '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((stringItem) => joinTextRuns(stringItem[1]));
  const dateStyleIndexes = readDateStyleIndexes(readEntryText('xl/styles.xml') ?? '');
  const uses1904DateSystem = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbookXml);
  const workbookSheets = [...workbookXml.matchAll(/<sheet\b([^>]*)\/?>/g)].map((sheetMatch) => {
    const sheetTarget = sheetTargets.get(readXmlAttribute(sheetMatch[1], 'r:id')) ?? '';
    return { name: readXmlAttribute(sheetMatch[1], 'name'), entryName: sheetTarget.startsWith('/') ? sheetTarget.slice(1) : `xl/${sheetTarget}` };
  });
  const previewedSheets = workbookSheets.slice(0, MAX_PREVIEW_SHEETS)
    .map((workbookSheet) => previewSheet(workbookSheet.name, readSheetRows(readEntryText(workbookSheet.entryName) ?? '', sharedStrings, dateStyleIndexes, uses1904DateSystem), mask));
  return { kind: 'table', sheets: previewedSheets, sheets_total: workbookSheets.length };
}

// --- text ---

function previewTextFile(filePath, mask) {
  const fileLines = readFileSync(filePath, 'utf8').replace(/^﻿/, '').replace(/\r?\n$/, '').split(/\r?\n/);
  return { kind: 'lines', lines_total: fileLines.length, lines: fileLines.slice(0, MAX_TEXT_LINES).map((fileLine) => shownValue(fileLine, MAX_LINE_LENGTH, mask)) };
}

// --- .eml: headers, the first text part, attachment names ---

function decodeCharset(contentBytes, charsetName) {
  try {
    return new TextDecoder(charsetName || 'utf-8').decode(contentBytes);
  } catch {
    return contentBytes.toString('utf8');
  }
}

function decodeQuotedPrintableBytes(encodedText) {
  const softBreaksRemoved = encodedText.replace(/=\r?\n/g, '');
  const decodedBytes = [];
  for (let characterIndex = 0; characterIndex < softBreaksRemoved.length; characterIndex += 1) {
    const hexPair = softBreaksRemoved.slice(characterIndex + 1, characterIndex + 3);
    if (softBreaksRemoved[characterIndex] === '=' && /^[0-9A-F]{2}$/i.test(hexPair)) {
      decodedBytes.push(parseInt(hexPair, 16));
      characterIndex += 2;
    } else decodedBytes.push(softBreaksRemoved.charCodeAt(characterIndex) & 0xff);
  }
  return Buffer.from(decodedBytes);
}

// RFC 2047 encoded words: =?utf-8?B?...?= and =?iso-8859-1?Q?...?=
function decodeHeaderValue(headerValue) {
  return headerValue.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=(\s+(?==\?))?/gi, (encodedWord, charsetName, encodingName, encodedText) => {
    const wordBytes = encodingName.toUpperCase() === 'B' ? Buffer.from(encodedText, 'base64') : decodeQuotedPrintableBytes(encodedText.replace(/_/g, ' '));
    return decodeCharset(wordBytes, charsetName);
  });
}

function parseMimePart(partText) {
  const headerEnd = partText.search(/\r?\n\r?\n/);
  const headerText = headerEnd < 0 ? partText : partText.slice(0, headerEnd);
  const bodyText = headerEnd < 0 ? '' : partText.slice(headerEnd).replace(/^\r?\n\r?\n/, '');
  const partHeaders = {};
  for (const headerLine of headerText.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const separatorIndex = headerLine.indexOf(':');
    if (separatorIndex > 0) partHeaders[headerLine.slice(0, separatorIndex).trim().toLowerCase()] = headerLine.slice(separatorIndex + 1).trim();
  }
  return { partHeaders, bodyText };
}

function readHeaderParameter(headerValue, parameterName) {
  const parameterMatch = (headerValue ?? '').match(new RegExp(`(?:^|;)\\s*${parameterName}\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'));
  return parameterMatch ? decodeHeaderValue(parameterMatch[1] ?? parameterMatch[2]) : undefined;
}

function decodePartBody({ partHeaders, bodyText }) {
  const transferEncoding = (partHeaders['content-transfer-encoding'] ?? '').toLowerCase();
  const bodyBytes = transferEncoding === 'base64' ? Buffer.from(bodyText.replace(/\s+/g, ''), 'base64')
    : transferEncoding === 'quoted-printable' ? decodeQuotedPrintableBytes(bodyText)
      : Buffer.from(bodyText, 'latin1');
  return decodeCharset(bodyBytes, readHeaderParameter(partHeaders['content-type'], 'charset'));
}

// Leaf parts of a MIME message, depth first.
function listLeafParts(mimePart) {
  const contentType = mimePart.partHeaders['content-type'] ?? 'text/plain';
  const boundary = readHeaderParameter(contentType, 'boundary');
  if (!/^multipart\//i.test(contentType) || !boundary) return [mimePart];
  const boundaryLine = `--${boundary}`;
  return mimePart.bodyText.split(boundaryLine).slice(1)
    .filter((childText) => !childText.startsWith('--'))
    .flatMap((childText) => listLeafParts(parseMimePart(childText.replace(/^\r?\n/, ''))));
}

function attachmentName(leafPart) {
  const isAttachment = /^attachment/i.test(leafPart.partHeaders['content-disposition'] ?? '');
  const declaredName = readHeaderParameter(leafPart.partHeaders['content-disposition'], 'filename') ?? readHeaderParameter(leafPart.partHeaders['content-type'], 'name');
  return isAttachment || declaredName ? declaredName ?? 'unnamed attachment' : null;
}

function previewEmlFile(filePath, mask) {
  const rootPart = parseMimePart(readFileSync(filePath, 'latin1'));
  const leafParts = listLeafParts(rootPart);
  const bodyParts = leafParts.filter((leafPart) => !attachmentName(leafPart));
  const plainPart = bodyParts.find((leafPart) => /^text\/plain/i.test(leafPart.partHeaders['content-type'] ?? 'text/plain'));
  const htmlPart = bodyParts.find((leafPart) => /^text\/html/i.test(leafPart.partHeaders['content-type'] ?? ''));
  const bodyText = plainPart ? decodePartBody(plainPart)
    : htmlPart ? decodePartBody(htmlPart).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
      : '';
  const bodyLines = bodyText.split(/\r?\n/).map((bodyLine) => bodyLine.trim()).filter(Boolean);
  // The message is read as latin1 (one char per byte); raw 8-bit headers are UTF-8 in practice.
  const readHeader = (headerName) => decodeHeaderValue(Buffer.from(rootPart.partHeaders[headerName] ?? '', 'latin1').toString('utf8'));
  const shownHeader = (headerName) => (readHeader(headerName) ? shownValue(readHeader(headerName), MAX_LINE_LENGTH, mask) : '');
  return {
    kind: 'eml',
    headers: { from: shownHeader('from'), to: shownHeader('to'), subject: shownHeader('subject'), date: readHeader('date') },
    body_lines: bodyLines.slice(0, MAX_EML_BODY_LINES).map((bodyLine) => shownValue(bodyLine, MAX_LINE_LENGTH, mask)),
    attachments: leafParts.map(attachmentName).filter(Boolean).map((fileName) => (mask ? maskValue(fileName) : fileName)),
  };
}

// --- pdf: page count only (the agent passes a screenshot of the first page with --preview) ---

function previewPdfFile(filePath) {
  const pdfText = readFileSync(filePath, 'latin1');
  if (!pdfText.startsWith('%PDF')) throw new Error('not a PDF file');
  return { kind: 'pdf', pages: (pdfText.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length };
}

export function buildFilePreview(filePath, { mask = false } = {}) {
  const fileExtension = extname(filePath).toLowerCase();
  if (fileExtension === '.csv' || fileExtension === '.tsv') return previewDelimitedFile(filePath, fileExtension, mask);
  if (fileExtension === '.xlsx') return previewXlsxFile(filePath, mask);
  if (fileExtension === '.eml') return previewEmlFile(filePath, mask);
  if (fileExtension === '.pdf') return previewPdfFile(filePath);
  if (TEXT_EXTENSIONS.includes(fileExtension)) return previewTextFile(filePath, mask);
  if (IMAGE_EXTENSIONS.includes(fileExtension)) return { kind: 'image' };
  return { kind: 'generic' };
}
