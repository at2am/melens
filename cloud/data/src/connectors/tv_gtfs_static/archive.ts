import { createHash } from 'node:crypto';
import { crc32, inflateRawSync } from 'node:zlib';

import { HttpClient, type HttpResponse } from '../../core/http.js';

export const ARCHIVE_URL = 'https://opendata.transport.vic.gov.au/dataset/3f4e292e-7f8a-4ffe-831f-1953be0fe448/resource/fb152201-859f-4882-9206-b768060b50ad/download/gtfs.zip';

const TAIL_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRY_BYTES = 300 * 1024 * 1024;
const decoder = new TextDecoder();

interface ZipEntry {
  name: string;
  compression: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface OfficialGtfsArchive {
  raw: {
    feed_info: Record<string, string>[];
    routes: Record<string, string>[];
    stops: Record<string, string>[];
    trips: Record<string, string>[];
    stop_times: Record<string, string>[];
  };
  archiveVersion: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  routeStopPairs: number;
  /** Sparse stop_times preserve route/stop membership, not every trip/stop pair. */
  tripStopMembershipComplete: false;
}

function invalid(message: string): never {
  throw new Error(`Invalid GTFS Schedule archive: ${message}`);
}

async function readRange(http: HttpClient, url: string, range: string, limit: number,
  validator?: string): Promise<HttpResponse<Uint8Array<ArrayBuffer>>> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await http.getStream({ url, headers: {
      Range: range, ...(validator ? { 'If-Range': validator } : {}),
    }, timeoutMs: 120_000, signal: controller.signal });
    if (response.status !== 206) {
      await response.body.cancel();
      invalid('archive changed or server ignored byte range');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > limit) invalid('range response exceeded byte limit');
        chunks.push(part.value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return { ...response, body };
  } finally {
    clearTimeout(deadline);
  }
}

function verifyRange(response: HttpResponse<Uint8Array>, start: number, end: number, size: number): void {
  if (response.body.length !== end - start + 1
    || response.contentRange !== `bytes ${start}-${end}/${size}`) {
    invalid('Content-Range or response length mismatch');
  }
}

function directory(zipTail: Uint8Array, fullSize?: number): { entries: ZipEntry[]; size: number } {
  const view = new DataView(zipTail.buffer, zipTail.byteOffset, zipTail.byteLength);
  let eocd = -1;
  for (let i = zipTail.length - 22; i >= Math.max(0, zipTail.length - 65_557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === zipTail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) invalid('ZIP end-of-central-directory missing');
  if (view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) invalid('multi-disk ZIP unsupported');
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) invalid('ZIP64 unsupported');
  const size = centralOffset + centralSize + 22 + view.getUint16(eocd + 20, true);
  if (size > MAX_ARCHIVE_BYTES || (fullSize !== undefined && size !== fullSize)) invalid('ZIP size mismatch');
  const tailOffset = size - zipTail.length;
  if (tailOffset < 0 || centralOffset < tailOffset || centralOffset + centralSize !== tailOffset + eocd) {
    invalid('central directory outside bounded ZIP tail');
  }
  const entries: ZipEntry[] = [];
  let offset = centralOffset - tailOffset;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > zipTail.length || view.getUint32(offset, true) !== 0x02014b50) invalid('central directory entry missing');
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > zipTail.length || flags & 1 || compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff || localOffset === 0xffffffff
      || compressedSize > MAX_ENTRY_BYTES || uncompressedSize > MAX_ENTRY_BYTES) invalid('unsupported or oversized ZIP entry');
    const name = decoder.decode(zipTail.subarray(offset + 46, offset + 46 + nameLength));
    entries.push({ name, compression, crc, compressedSize, uncompressedSize, localOffset });
    offset = end;
  }
  if (offset !== centralOffset - tailOffset + centralSize) invalid('central directory length mismatch');
  return { entries, size };
}

function localDataOffset(bytes: Uint8Array, entry: ZipEntry): number {
  if (bytes.length < 30) invalid(`local header missing for ${entry.name}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== entry.compression) {
    invalid(`local header mismatch for ${entry.name}`);
  }
  return 30 + view.getUint16(26, true) + view.getUint16(28, true);
}

function decompress(entry: ZipEntry, compressed: Uint8Array): Uint8Array {
  if (compressed.length !== entry.compressedSize) invalid(`compressed length mismatch for ${entry.name}`);
  const output = entry.compression === 0 ? compressed
    : entry.compression === 8 ? inflateRawSync(compressed, { maxOutputLength: MAX_ENTRY_BYTES })
      : invalid(`compression method ${entry.compression} unsupported`);
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.crc) {
    invalid(`checksum or size mismatch for ${entry.name}`);
  }
  return output;
}

function innerEntry(zip: Uint8Array, entry: ZipEntry): Uint8Array {
  const offset = entry.localOffset;
  const header = zip.subarray(offset, offset + 30);
  const dataStart = offset + localDataOffset(header, entry);
  if (dataStart + entry.compressedSize > zip.length) invalid(`truncated ${entry.name}`);
  return decompress(entry, zip.subarray(dataStart, dataStart + entry.compressedSize));
}

function csvCells(line: Uint8Array): string[] {
  const cells: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i <= line.length; i += 1) {
    if (i < line.length && line[i] === 34) {
      if (quoted && line[i + 1] === 34) i += 1;
      else quoted = !quoted;
    } else if (i === line.length || (line[i] === 44 && !quoted)) {
      let value = decoder.decode(line.subarray(start, i)).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replaceAll('""', '"');
      cells.push(value);
      start = i + 1;
    }
  }
  if (quoted) invalid('unterminated CSV quote');
  return cells;
}

function csvRows(bytes: Uint8Array, onRow: (header: readonly string[], values: readonly string[]) => void): void {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let start = 0;
  let header: string[] | null = null;
  while (start < buffer.length) {
    const lineEnd = buffer.indexOf(10, start);
    const end = lineEnd < 0 ? buffer.length : lineEnd;
    const line = buffer.subarray(start, end > start && buffer[end - 1] === 13 ? end - 1 : end);
    if (line.length > 0) {
      if (header === null) header = csvCells(line).map(value => value.replace(/^\uFEFF/, ''));
      else onRow(header, csvCells(line));
    }
    start = end + 1;
  }
  if (header === null) invalid('empty GTFS CSV');
}

function records(bytes: Uint8Array): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  csvRows(bytes, (header, values) => {
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      const key = header[i];
      if (key) row[key] = values[i] ?? '';
    }
    rows.push(row);
  });
  return rows;
}

function sparseStopTimes(bytes: Uint8Array, tripRoutes: Map<string, string>): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  csvRows(bytes, (header, values) => {
    const tripId = values[header.indexOf('trip_id')] ?? '';
    const stopId = values[header.indexOf('stop_id')] ?? '';
    const routeId = tripRoutes.get(tripId);
    if (!routeId || !stopId) invalid('stop_times references missing trip or stop');
    const pair = `${routeId}\u0000${stopId}`;
    if (!seen.has(pair)) {
      seen.add(pair);
      rows.push({ trip_id: tripId, stop_id: stopId });
    }
  });
  return rows;
}

function parseMode(zip: Uint8Array): OfficialGtfsArchive['raw'] {
  const entries = new Map(directory(zip, zip.length).entries.map(entry => [entry.name.split('/').pop(), entry]));
  const required = ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'] as const;
  for (const name of required) if (!entries.has(name)) invalid(`nested mode ZIP missing ${name}`);
  const get = (name: string): Uint8Array => innerEntry(zip, entries.get(name)!);
  const routes = records(get('routes.txt'));
  const stops = records(get('stops.txt'));
  const trips = records(get('trips.txt'));
  const tripRoutes = new Map(trips.map(row => [row.trip_id ?? '', row.route_id ?? '']));
  const stop_times = sparseStopTimes(get('stop_times.txt'), tripRoutes);
  const feedInfoEntry = entries.get('feed_info.txt');
  const feed_info = feedInfoEntry ? records(innerEntry(zip, feedInfoEntry)) : [];
  return { feed_info, routes, stops, trips, stop_times };
}

/** Fetch only train and tram members from Transport Victoria's nested mode archive. */
export async function fetchOfficialGtfsArchive(http: HttpClient = new HttpClient(), url = ARCHIVE_URL): Promise<OfficialGtfsArchive> {
  const tail = await readRange(http, url, `bytes=-${TAIL_BYTES}`, TAIL_BYTES);
  if (!tail.etag && !tail.lastModified) invalid('server did not provide archive validator');
  const outer = directory(tail.body);
  verifyRange(tail, outer.size - tail.body.length, outer.size - 1, outer.size);
  const validator = tail.etag?.startsWith('W/') ? tail.lastModified : (tail.etag ?? tail.lastModified);
  if (!validator) invalid('strong archive validator unavailable');
  const selected = ['2/google_transit.zip', '3/google_transit.zip'];
  const modes: OfficialGtfsArchive['raw'][] = [];
  for (const name of selected) {
    const entry = outer.entries.find(candidate => candidate.name === name);
    if (!entry) invalid(`outer ZIP missing ${name}`);
    const headerEnd = Math.min(outer.size - 1, entry.localOffset + 4095);
    const header = await readRange(http, url, `bytes=${entry.localOffset}-${headerEnd}`,
      headerEnd - entry.localOffset + 1, validator);
    verifyRange(header, entry.localOffset, headerEnd, outer.size);
    if (header.etag && tail.etag && header.etag !== tail.etag) invalid('archive changed during ranged fetch');
    const dataStart = entry.localOffset + localDataOffset(header.body, entry);
    const end = dataStart + entry.compressedSize - 1;
    if (end >= outer.size) invalid('ZIP entry exceeds archive size');
    const part = await readRange(http, url, `bytes=${dataStart}-${end}`,
      entry.compressedSize, validator);
    verifyRange(part, dataStart, end, outer.size);
    if (part.etag && tail.etag && part.etag !== tail.etag) invalid('archive changed during ranged fetch');
    modes.push(parseMode(decompress(entry, part.body)));
  }
  const lastModifiedMs = tail.lastModified === null ? NaN : Date.parse(tail.lastModified);
  const sourceUpdatedAt = Number.isFinite(lastModifiedMs) ? new Date(lastModifiedMs).toISOString() : null;
  const archiveVersion = `archive-sha256:${createHash('sha256').update(`${validator}\n${outer.size}`).digest('hex')}`;
  const combined = { feed_info: modes.flatMap(mode => mode.feed_info),
    routes: modes.flatMap(mode => mode.routes), stops: modes.flatMap(mode => mode.stops),
    trips: modes.flatMap(mode => mode.trips), stop_times: modes.flatMap(mode => mode.stop_times) };
  return { raw: combined, archiveVersion, sourceUpdatedAt, fetchedAt: tail.fetchedAt,
    routeStopPairs: combined.stop_times.length, tripStopMembershipComplete: false };
}
