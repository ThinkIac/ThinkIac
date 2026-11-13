import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import AdmZip from 'adm-zip';

const MAX_ROWS = 500;
const MAX_COLUMNS = 100;

function decodeXml(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function parseDelimited(content, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < content.length && rows.length < MAX_ROWS; i += 1) {
    const char = content[i];
    if (char === '"') {
      if (quoted && content[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      if (row.length < MAX_COLUMNS) row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[i + 1] === '\n') i += 1;
      if (row.length < MAX_COLUMNS) row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    if (row.length < MAX_COLUMNS) row.push(cell);
    rows.push(row);
  }
  return rows;
}

function columnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function xmlTexts(xml = '') {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join('');
}

function odsText(xml = '') {
  return [...xml.matchAll(/<text:p(?:\s[^>]*)?>([\s\S]*?)<\/text:p>/g)]
    .map((match) => decodeXml(match[1].replace(/<[^>]+>/g, '')))
    .join('\n');
}

function parseXlsx(path) {
  const zip = new AdmZip(path);
  const sharedXml = zip.getEntry('xl/sharedStrings.xml')?.getData().toString('utf8') || '';
  const shared = [...sharedXml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => xmlTexts(match[1]));
  const workbookXml = zip.getEntry('xl/workbook.xml')?.getData().toString('utf8') || '';
  const firstSheet = workbookXml.match(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/);
  const sheetName = decodeXml(firstSheet?.[1] || 'Sheet 1');
  const relId = firstSheet?.[2];
  const relsXml = zip.getEntry('xl/_rels/workbook.xml.rels')?.getData().toString('utf8') || '';
  const relations = new Map([...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((match) => [match[1], match[2]]));
  const target = relations.get(relId) || 'worksheets/sheet1.xml';
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheetXml = zip.getEntry(sheetPath)?.getData().toString('utf8');
  if (!sheetXml) throw new Error('The first worksheet was not found');

  const rows = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS) break;
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = attrs.match(/\br="([^"]+)"/)?.[1] || 'A1';
      const index = columnIndex(reference);
      if (index >= MAX_COLUMNS) continue;
      const kind = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
      const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] || '';
      let value = decodeXml(raw);
      if (kind === 's') value = shared[Number(raw)] ?? '';
      else if (kind === 'inlineStr') value = xmlTexts(body);
      else if (kind === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      while (row.length < index) row.push('');
      row[index] = value;
    }
    rows.push(row);
  }
  return { sheets: [{ name: sheetName, rows }], truncated: rows.length >= MAX_ROWS };
}

function parseOds(path) {
  const zip = new AdmZip(path);
  const xml = zip.getEntry('content.xml')?.getData().toString('utf8');
  if (!xml) throw new Error('ODS spreadsheet content was not found');
  const table = xml.match(/<table:table\b[^>]*table:name="([^"]*)"[^>]*>([\s\S]*?)<\/table:table>/);
  if (!table) throw new Error('The ODS spreadsheet is empty');
  const rows = [];
  for (const rowMatch of table[2].matchAll(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g)) {
    if (rows.length >= MAX_ROWS) break;
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<table:table-cell\b([^>]*)>([\s\S]*?)<\/table:table-cell>/g)) {
      const repeated = Math.min(Number(cellMatch[1].match(/table:number-columns-repeated="(\d+)"/)?.[1] || 1), MAX_COLUMNS - row.length);
      const value = odsText(cellMatch[2]);
      for (let i = 0; i < repeated && row.length < MAX_COLUMNS; i += 1) row.push(value);
    }
    rows.push(row);
  }
  return { sheets: [{ name: decodeXml(table[1]), rows }], truncated: rows.length >= MAX_ROWS };
}

export function readSpreadsheet(path) {
  const extension = extname(path).toLowerCase();
  if (extension === '.xlsx' || extension === '.xlsm') return parseXlsx(path);
  if (extension === '.ods') return parseOds(path);
  if (extension === '.csv' || extension === '.tsv') {
    const content = readFileSync(path, 'utf8');
    const delimiter = extension === '.tsv' ? '\t' : ',';
    const rows = parseDelimited(content, delimiter);
    return { sheets: [{ name: extension === '.tsv' ? 'TSV' : 'CSV', rows }], truncated: rows.length >= MAX_ROWS };
  }
  throw new Error(`Unsupported spreadsheet format: ${extension || 'no extension'}`);
}
