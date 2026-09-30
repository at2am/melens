import readXlsxFile, { type Row } from 'read-excel-file/node';

import type { HomesVictoriaRentRawRecord } from './index.js';
import { parseQuarter } from './index.js';

const PROPERTY_TYPES = new Map([
  ['1br flat', '1 bedroom flat'],
  ['2br flat', '2 bedroom flat'],
  ['3br flat', '3 bedroom flat'],
  ['2br house', '2 bedroom house'],
  ['3br house', '3 bedroom house'],
  ['4br house', '4 bedroom house'],
  ['all properties', 'all properties'],
]);

function label(value: Row[number] | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function rentalCell(value: Row[number] | undefined): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new Error('Unexpected Homes Victoria rental cell type');
}

/** The official workbook has one sheet per property type and paired Count/Median columns. */
export async function parseHomesVictoriaWorkbook(
  bytes: Uint8Array,
  expectedPeriodEnd: string,
): Promise<HomesVictoriaRentRawRecord[]> {
  if (bytes.byteLength < 4 || bytes.byteLength > 8_000_000
    || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Homes Victoria resource is not a bounded XLSX archive');
  }
  const catalogEnd = new Date(`${expectedPeriodEnd}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedPeriodEnd)
    || !Number.isFinite(catalogEnd.valueOf())
    || catalogEnd.toISOString().slice(0, 10) !== expectedPeriodEnd) {
    throw new Error('Invalid Homes Victoria catalog period end');
  }
  const expectedQuarter = `${catalogEnd.getUTCFullYear()}-Q${Math.floor(catalogEnd.getUTCMonth() / 3) + 1}`;
  const sheets = await readXlsxFile(Buffer.from(bytes));
  const seenTypes = new Set<string>();
  const rows: HomesVictoriaRentRawRecord[] = [];
  let latestQuarter: string | null = null;

  for (const sheet of sheets) {
    const propertyType = PROPERTY_TYPES.get(sheet.sheet.trim().toLowerCase());
    if (!propertyType || seenTypes.has(propertyType)) {
      throw new Error(`Unexpected or duplicate Homes Victoria workbook sheet: ${sheet.sheet}`);
    }
    seenTypes.add(propertyType);
    const quarterRow = sheet.data[1];
    const measureRow = sheet.data[2];
    if (!quarterRow || !measureRow || sheet.data.length < 5) {
      throw new Error(`Missing Homes Victoria headers: ${sheet.sheet}`);
    }
    const columns: Array<{ index: number; quarter: string; code: string }> = [];
    for (let index = 2; index < quarterRow.length; index += 2) {
      const quarter = label(quarterRow[index]);
      const medianQuarter = label(quarterRow[index + 1]);
      if (!quarter || quarter !== medianQuarter
        || label(measureRow[index])?.toLowerCase() !== 'count'
        || label(measureRow[index + 1])?.toLowerCase() !== 'median') {
        throw new Error(`Changed Homes Victoria Count/Median columns: ${sheet.sheet}`);
      }
      const code = parseQuarter(quarter).quarterCode;
      columns.push({ index, quarter, code });
    }
    if (columns.length === 0) throw new Error(`No quarterly columns: ${sheet.sheet}`);
    const finalQuarter = columns.at(-1)?.code ?? null;
    if (finalQuarter !== expectedQuarter || (latestQuarter && latestQuarter !== finalQuarter)) {
      throw new Error(`Homes Victoria workbook quarter does not match catalog: ${sheet.sheet}`);
    }
    latestQuarter = finalQuarter;

    let regionGroup: string | null = null;
    let reachedTotal = false;
    let sheetLgaCount = 0;
    for (const row of sheet.data.slice(3)) {
      const group = label(row[0]);
      const lga = label(row[1]);
      if (group === 'Table Total') { reachedTotal = true; break; }
      if (group) regionGroup = group;
      if (!lga || lga === 'Group Total') continue;
      if (!regionGroup) throw new Error(`Missing Homes Victoria region group: ${sheet.sheet}`);
      sheetLgaCount += 1;
      for (const column of columns) {
        rows.push({ quarter: column.quarter, lga_name: lga,
          region_group: regionGroup, property_type: propertyType,
          raw_count: rentalCell(row[column.index]),
          raw_median: rentalCell(row[column.index + 1]) });
      }
    }
    if (!reachedTotal || sheetLgaCount < 70 || sheetLgaCount > 100) {
      throw new Error(`Homes Victoria LGA section is incomplete: ${sheet.sheet}`);
    }
  }
  if (seenTypes.size !== PROPERTY_TYPES.size || rows.length === 0) {
    throw new Error('Homes Victoria workbook is missing property type sheets');
  }
  return rows;
}
