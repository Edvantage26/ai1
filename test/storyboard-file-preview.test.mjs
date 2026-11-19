import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { buildFilePreview, maskValue, parseDelimitedText, readZipEntries } from '../src/storyboard/storyboard-file-preview.mjs';

function writeFixture(fileName, fileContent) {
  const fixturePath = join(mkdtempSync(join(tmpdir(), 'ai1-preview-')), fileName);
  writeFileSync(fixturePath, fileContent);
  return fixturePath;
}

// A minimal zip writer for fixtures: deflated entries (stored for names ending in .stored), CRC left
// at 0 (the reader does not check it).
function buildZip(zipEntries) {
  const localParts = [];
  const directoryParts = [];
  let localOffset = 0;
  for (const [entryName, entryText] of Object.entries(zipEntries)) {
    const nameBytes = Buffer.from(entryName, 'utf8');
    const rawBytes = Buffer.from(entryText, 'utf8');
    const isStored = entryName.endsWith('.stored');
    const dataBytes = isStored ? rawBytes : deflateRawSync(rawBytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(isStored ? 0 : 8, 8);
    localHeader.writeUInt32LE(dataBytes.length, 18);
    localHeader.writeUInt32LE(rawBytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    const directoryHeader = Buffer.alloc(46);
    directoryHeader.writeUInt32LE(0x02014b50, 0);
    directoryHeader.writeUInt16LE(isStored ? 0 : 8, 10);
    directoryHeader.writeUInt32LE(dataBytes.length, 20);
    directoryHeader.writeUInt32LE(rawBytes.length, 24);
    directoryHeader.writeUInt16LE(nameBytes.length, 28);
    directoryHeader.writeUInt32LE(localOffset, 42);
    localParts.push(localHeader, nameBytes, dataBytes);
    directoryParts.push(directoryHeader, nameBytes);
    localOffset += localHeader.length + nameBytes.length + dataBytes.length;
  }
  const directoryBytes = Buffer.concat(directoryParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(Object.keys(zipEntries).length, 8);
  endRecord.writeUInt16LE(Object.keys(zipEntries).length, 10);
  endRecord.writeUInt32LE(directoryBytes.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directoryBytes, endRecord]);
}

function buildClientsWorkbook(clientRowCount) {
  const clientRows = Array.from({ length: clientRowCount }, (unused, clientIndex) => `<row r="${clientIndex + 2}"><c r="A${clientIndex + 2}" t="s"><v>2</v></c><c r="B${clientIndex + 2}"><v>${612345678 + clientIndex}</v></c><c r="D${clientIndex + 2}" t="inlineStr"><is><t>Nota &amp; ${clientIndex}</t></is></c></row>`).join('');
  return buildZip({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="Clientes" sheetId="1" r:id="rId1"/><sheet name="Vacía" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Nombre</t></si><si><r><t>Telé</t></r><r><t xml:space="preserve">fono</t></r></si><si><t>Juan Pérez</t></si></sst>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="b"><v>1</v></c><c r="D1" t="str"><v>Notas</v></c></row>${clientRows}<row r="99"><c r="A99" s="1"/></row></sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
  });
}

test('an xlsx previews each sheet: first 10 rows (header included), row and column counts [storyboard-files:S2]', () => {
  const workbookPath = writeFixture('clientes.xlsx', buildClientsWorkbook(14));
  const workbookPreview = buildFilePreview(workbookPath);
  assert.equal(workbookPreview.kind, 'table');
  assert.equal(workbookPreview.sheets_total, 2);
  const [clientsSheet, emptySheet] = workbookPreview.sheets;
  assert.deepEqual({ name: clientsSheet.name, rows_total: clientsSheet.rows_total, columns_total: clientsSheet.columns_total }, { name: 'Clientes', rows_total: 15, columns_total: 4 });
  assert.equal(clientsSheet.rows.length, 10);
  assert.deepEqual(clientsSheet.rows[0], ['Nombre', 'Teléfono', 'TRUE', 'Notas']);
  assert.deepEqual(clientsSheet.rows[1], ['Juan Pérez', '612345678', '', 'Nota & 0']);
  assert.deepEqual(emptySheet, { name: 'Vacía', rows_total: 0, columns_total: 0, rows: [] });
});

test('the zip reader takes stored and deflated entries and refuses what is not a zip', () => {
  const zipEntries = readZipEntries(buildZip({ 'a.stored': 'plain', 'b.xml': 'deflated' }));
  assert.equal(zipEntries.get('a.stored')().toString(), 'plain');
  assert.equal(zipEntries.get('b.xml')().toString(), 'deflated');
  assert.throws(() => readZipEntries(Buffer.from('not a zip at all, just some text bytes')), /not a zip/);
  assert.throws(() => buildFilePreview(writeFixture('roto.xlsx', 'not a zip at all, just text')), /not a zip/);
});

test('csv, text, image, pdf and other types get their own short preview [storyboard-files:S3]', () => {
  assert.deepEqual(parseDelimitedText('a;"b;c"\n"say ""hi"""\r\n\n1;2', ';'), [['a', 'b;c'], ['say "hi"'], ['1', '2']]);
  const csvPreview = buildFilePreview(writeFixture('pedidos.csv', '﻿id;cliente;importe\n1;"Ana, S.L.";10,5\n2;Luis;' + 'x'.repeat(60) + '\n'));
  assert.deepEqual(csvPreview.sheets[0].rows[1], ['1', 'Ana, S.L.', '10,5']);
  assert.equal(csvPreview.sheets[0].rows[2][2], `${'x'.repeat(39)}…`);
  assert.deepEqual([csvPreview.sheets[0].rows_total, csvPreview.sheets[0].columns_total, csvPreview.sheets[0].name], [3, 3, undefined]);

  const textPreview = buildFilePreview(writeFixture('salida.log', Array.from({ length: 30 }, (unused, lineIndex) => `line ${lineIndex + 1}`).join('\n') + '\n'));
  assert.deepEqual({ kind: textPreview.kind, total: textPreview.lines_total, shown: textPreview.lines.length, first: textPreview.lines[0] }, { kind: 'lines', total: 30, shown: 20, first: 'line 1' });

  assert.deepEqual(buildFilePreview(writeFixture('logo.png', 'png bytes')), { kind: 'image' });
  assert.deepEqual(buildFilePreview(writeFixture('factura.pdf', '%PDF-1.4\n1 0 obj <</Type /Pages /Count 2>>\n2 0 obj <</Type /Page>>\n3 0 obj <</Type/Page>>\n')), { kind: 'pdf', pages: 2 });
  assert.throws(() => buildFilePreview(writeFixture('falso.pdf', 'hello')), /not a PDF/);
  assert.deepEqual(buildFilePreview(writeFixture('informe.docx', 'x')), { kind: 'generic' });
});

const MULTIPART_EMAIL = [
  'From: =?utf-8?B?Sm9zw6kgR2FyY8OtYQ==?= <jose@example.com>',
  'To: ana@example.com',
  'Subject: =?iso-8859-1?Q?Informe_de_pedidos_=F1?=',
  'Date: Tue, 18 Nov 2026 10:00:00 +0100',
  'Content-Type: multipart/mixed; boundary="outer"',
  '',
  '--outer',
  'Content-Type: multipart/alternative; boundary="inner"',
  '',
  '--inner',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hola Ana,=0A',
  'adjunto el informe de pedidos de ma=C3=B1ana.',
  '--inner',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Hola Ana</p>',
  '--inner--',
  '--outer',
  'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name="pedidos.xlsx"',
  'Content-Disposition: attachment; filename="pedidos.xlsx"',
  'Content-Transfer-Encoding: base64',
  '',
  'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==',
  '--outer--',
  '',
].join('\r\n');

test('an eml previews its headers, the first lines of the text body and the attachment names [storyboard-files:S3]', () => {
  const emailPreview = buildFilePreview(writeFixture('aviso.eml', MULTIPART_EMAIL));
  assert.deepEqual(emailPreview, {
    kind: 'eml',
    headers: { from: 'José García <jose@example.com>', to: 'ana@example.com', subject: 'Informe de pedidos ñ', date: 'Tue, 18 Nov 2026 10:00:00 +0100' },
    body_lines: ['Hola Ana,', 'adjunto el informe de pedidos de mañana.'],
    attachments: ['pedidos.xlsx'],
  });
  const htmlOnly = buildFilePreview(writeFixture('html.eml', 'Subject: x\nContent-Type: text/html\n\n<html><style>p{}</style><p>Primera</p><p>Segunda &nbsp;línea</p></html>\n'));
  assert.deepEqual(htmlOnly.body_lines, ['Primera', 'Segunda  línea']);
});

test('--mask replaces every value by its shape, keeping headers, punctuation and the email date [storyboard-files:S6]', () => {
  assert.equal(maskValue('Juan Pérez'), 'Xxxx Xxxxx');
  assert.equal(maskValue('612345678'), '999999999');
  assert.equal(maskValue('ana@example.com, 10,5 €'), 'xxx@xxxxxxx.xxx, 99,9 €');
  const workbookPreview = buildFilePreview(writeFixture('clientes.xlsx', buildClientsWorkbook(2)), { mask: true });
  assert.deepEqual(workbookPreview.sheets[0].rows, [['Nombre', 'Teléfono', 'TRUE', 'Notas'], ['Xxxx Xxxxx', '999999999', '', 'Xxxx & 9'], ['Xxxx Xxxxx', '999999999', '', 'Xxxx & 9']]);
  const emailPreview = buildFilePreview(writeFixture('aviso.eml', MULTIPART_EMAIL), { mask: true });
  assert.equal(emailPreview.headers.from, 'Xxxx Xxxxxx <xxxx@xxxxxxx.xxx>');
  assert.equal(emailPreview.headers.date, 'Tue, 18 Nov 2026 10:00:00 +0100');
  assert.deepEqual(emailPreview.body_lines, ['Xxxx Xxx,', 'xxxxxxx xx xxxxxxx xx xxxxxxx xx xxxxxx.']);
  assert.deepEqual(emailPreview.attachments, ['xxxxxxx.xxxx']);
});
