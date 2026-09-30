import { crc32, inflateRawSync } from 'node:zlib';

import { HttpClient, type HttpResponse } from '../../core/http.js';

export type AbsGeography = 'SA1' | 'SA2' | 'LGA';

const TAIL_BYTES = 131_072;
const MAX_ARCHIVE_BYTES = 150_000_000;
const MAX_CSV_BYTES = 15_000_000;
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface AbsArchiveTables {
  geography: AbsGeography;
  url: string;
  validator: string;
  files: ReadonlyMap<'G01' | 'G02', string>;
}

function invalid(message: string): never {
  throw new Error(`Invalid ABS DataPack archive: ${message}`);
}

function officialUrl(geography: AbsGeography): string {
  return `https://www.abs.gov.au/census/find-census-data/datapacks/download/2021_GCP_${geography}_for_VIC_short-header.zip`;
}

async function ranged(http: HttpClient, url: string, range: string, maxBytes: number,
  validator?: string): Promise<HttpResponse<Uint8Array>> {
  const response = await http.getStream({ url,
    headers: { Range: range, ...(validator ? { 'If-Range': validator } : {}) },
    timeoutMs: 60_000, maxAttempts: 3 });
  if (response.status !== 206) {
    await response.body.cancel();
    invalid('server ignored byte range or archive changed');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > maxBytes) invalid('range exceeded byte limit');
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return { ...response, body };
}

function parseContentRange(value: string | null | undefined, bytes: number): {
  start: number; end: number; size: number;
} {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) invalid('missing Content-Range');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const size = Number(match[3]);
  if (!Number.isSafeInteger(size) || size > MAX_ARCHIVE_BYTES || size <= 0
    || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
    || start < 0 || end < start || end >= size || end - start + 1 !== bytes) {
    invalid('invalid Content-Range');
  }
  return { start, end, size };
}

function centralDirectory(tail: Uint8Array, start: number, size: number): ZipEntry[] {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let index = tail.length - 22; index >= Math.max(0, tail.length - 65_557); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50
      && index + 22 + view.getUint16(index + 20, true) === tail.length) {
      eocd = index; break;
    }
  }
  if (eocd < 0) invalid('ZIP central directory end missing');
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset < start || centralOffset + centralSize !== start + eocd
    || start + tail.length !== size) invalid('ZIP64 or unbounded central directory');
  const entries: ZipEntry[] = [];
  let offset = centralOffset - start;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > tail.length || view.getUint32(offset, true) !== 0x02014b50) {
      invalid('truncated ZIP entry');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > tail.length || flags & 1 || localOffset >= size
      || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff) invalid('unsupported ZIP entry');
    entries.push({ name: decoder.decode(tail.subarray(offset + 46, offset + 46 + nameLength)),
      method, crc, compressedSize, uncompressedSize, localOffset });
    offset = end;
  }
  if (offset !== centralOffset - start + centralSize) invalid('central directory length mismatch');
  return entries;
}

async function entryText(http: HttpClient, url: string, entry: ZipEntry, size: number,
  validator: string): Promise<string> {
  if (![0, 8].includes(entry.method) || entry.compressedSize > MAX_CSV_BYTES
    || entry.uncompressedSize > MAX_CSV_BYTES) invalid(`selected CSV too large: ${entry.name}`);
  const header = await ranged(http, url, `bytes=${entry.localOffset}-${entry.localOffset + 29}`, 30, validator);
  const headerRange = parseContentRange(header.contentRange, header.body.length);
  if (headerRange.start !== entry.localOffset || headerRange.size !== size) invalid('local header range mismatch');
  const view = new DataView(header.body.buffer, header.body.byteOffset, header.body.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== entry.method) {
    invalid('local header mismatch');
  }
  const dataStart = entry.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize - 1;
  if (dataEnd >= size) invalid('selected CSV outside archive');
  const compressed = await ranged(http, url, `bytes=${dataStart}-${dataEnd}`,
    entry.compressedSize, validator);
  const dataRange = parseContentRange(compressed.contentRange, compressed.body.length);
  if (dataRange.start !== dataStart || dataRange.end !== dataEnd || dataRange.size !== size) {
    invalid('selected CSV range mismatch');
  }
  const plain = entry.method === 0 ? compressed.body
    : inflateRawSync(compressed.body, { maxOutputLength: MAX_CSV_BYTES });
  if (plain.length !== entry.uncompressedSize || crc32(plain) !== entry.crc) {
    invalid('selected CSV checksum mismatch');
  }
  return decoder.decode(plain);
}

/** Fetch G01 and G02 only; SA1's complete official archive is about 97 MB. */
export async function fetchAbsArchiveTables(geography: AbsGeography,
  http = new HttpClient()): Promise<AbsArchiveTables> {
  const url = officialUrl(geography);
  const tail = await ranged(http, url, `bytes=-${TAIL_BYTES}`, TAIL_BYTES);
  const range = parseContentRange(tail.contentRange, tail.body.length);
  if (range.end !== range.size - 1) invalid('ZIP tail is not the archive end');
  const validator = tail.etag && !tail.etag.startsWith('W/') ? tail.etag : tail.lastModified;
  if (!validator) invalid('ABS archive has no stable HTTP validator');
  const entries = centralDirectory(tail.body, range.start, range.size);
  const files = new Map<'G01' | 'G02', string>();
  for (const table of ['G01', 'G02'] as const) {
    const exact = `2021Census_${table}_VIC_${geography}.csv`;
    const matches = entries.filter(entry => entry.name.endsWith(`/${exact}`));
    if (matches.length !== 1) invalid(`missing or duplicate ${exact}`);
    files.set(table, await entryText(http, url, matches[0]!, range.size, validator));
  }
  return { geography, url, validator, files };
}
