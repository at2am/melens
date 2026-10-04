import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type IncomingMessage } from 'node:http';
import { z } from 'zod';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, errorResponseSchema, MapContractError, sourceReferenceSchema } from './contracts/map-contract.js';
import { loadMapConfig } from './config.js';
import { createMapService, type MapService } from './map-service.js';
import { MapQueryError } from './query/query-runner.js';
import { MapServiceError, type MapServiceErrorCode } from './services/snapshot-store.js';

const status: Record<MapServiceErrorCode, number> = { invalidRequest: 400, cursorMismatch: 400,
  notFound: 404, notAvailable: 410, snapshotExpired: 409, rateLimited: 429, budgetExceeded: 503,
  queryTimeout: 504, serviceUnavailable: 503 };
const retryable = new Set<MapServiceErrorCode>(['rateLimited', 'queryTimeout', 'serviceUnavailable']);
const requestIdSchema = z.string().min(1).max(256).regex(/^\S+$/);
function safeId(value: unknown): string | null { const parsed = requestIdSchema.safeParse(value); return parsed.success ? parsed.data : null; }
function code(error: unknown): MapServiceErrorCode {
  if (error instanceof MapServiceError || error instanceof MapQueryError || error instanceof MapContractError) return error.code;
  return 'serviceUnavailable';
}
function params(url: URL, allowed: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw new MapServiceError('invalidRequest');
    values[key] = value;
  }
  return values;
}
async function body(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) throw new MapServiceError('invalidRequest');
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    || request.headers['content-encoding'] !== undefined) throw new MapServiceError('invalidRequest');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    if (signal.aborted) throw new MapServiceError('queryTimeout');
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new MapServiceError('invalidRequest');
    chunks.push(buffer);
  }
  try { return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new MapServiceError('invalidRequest'); }
}

/** Exact frozen transport, safe errors, configured CORS and bounded concurrent requests. */
export function createMapHttpServer(options: {
  readonly service: MapService; readonly allowedOrigins: readonly string[];
  readonly maxConcurrentRequests?: number; readonly requestTimeoutMs?: number;
}) {
  const origins = new Set(options.allowedOrigins.map((origin) => {
    const parsed = new URL(origin);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.origin !== origin) throw new TypeError('CORS requires exact origins');
    return origin;
  }));
  const maxConcurrent = options.maxConcurrentRequests ?? 8;
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 128
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('Invalid HTTP bounds');
  let active = 0;
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    let requestId: string | null = null;
    let admitted = false;
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', () => { if (!response.writableEnded) abort(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const writeError = (errorCode: MapServiceErrorCode) => {
      const error = errorResponseSchema.parse({ schemaVersion: 1, error: { code: errorCode,
        messageKey: `map.error.${errorCode}`, requestId, retryable: retryable.has(errorCode) } });
      if (!response.writableEnded && !response.destroyed) { response.setHeader('Connection', 'close'); response.writeHead(status[errorCode]); response.end(JSON.stringify(error)); }
    };
    try {
      if (request.url === undefined || Buffer.byteLength(request.url, 'utf8') > MAX_REQUEST_BYTES) throw new MapServiceError('invalidRequest');
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!origins.has(origin)) throw new MapServiceError('invalidRequest');
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      const url = new URL(request.url, 'http://map.invalid');
      if (url.pathname === '/healthz') {
        if (request.method !== 'GET' || url.search !== '') throw new MapServiceError('invalidRequest');
        response.writeHead(200); response.end(JSON.stringify({ service: 'melens-map', status: 'ok' })); return;
      }
      const viewport = url.pathname === '/v1/map/viewport';
      const layers = url.pathname === '/v1/map/layers';
      const unlocated = url.pathname === '/v1/map/unlocated';
      const item = /^\/v1\/map\/items\/([^/]+)$/.exec(url.pathname);
      const members = /^\/v1\/map\/aggregates\/([^/]+)\/members$/.exec(url.pathname);
      if (!viewport && !layers && !unlocated && item === null && members === null) throw new MapServiceError('notFound');
      if (request.method === 'OPTIONS') {
        if (origin === undefined || request.headers['access-control-request-method'] !== (viewport ? 'POST' : 'GET')) throw new MapServiceError('invalidRequest');
        const requestedHeaders = request.headers['access-control-request-headers'];
        if (requestedHeaders !== undefined && requestedHeaders.toLowerCase().split(',').some((h) => h.trim() !== 'content-type')) throw new MapServiceError('invalidRequest');
        response.writeHead(204, { 'Access-Control-Allow-Methods': viewport ? 'POST, OPTIONS' : 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }); response.end(); return;
      }
      if (request.method !== (viewport ? 'POST' : 'GET')) throw new MapServiceError('invalidRequest');
      if (!viewport && (request.headers['transfer-encoding'] !== undefined || Number(request.headers['content-length'] ?? '0') !== 0)) throw new MapServiceError('invalidRequest');
      if (active >= maxConcurrent) throw new MapServiceError('rateLimited');
      active += 1; admitted = true;
      timer = setTimeout(() => { controller.abort(); writeError('queryTimeout'); }, timeoutMs);
      const execution = { signal: controller.signal };
      let result: unknown;
      if (layers) { params(url, []); result = await options.service.getCatalog(execution); }
      else if (viewport) {
        params(url, []); const value = await body(request, controller.signal);
        if (value !== null && typeof value === 'object') requestId = safeId(Reflect.get(value, 'requestId'));
        result = await options.service.queryViewport(value, execution);
      } else if (unlocated) {
        const values = params(url, ['query']);
        let value: unknown;
        try { if (values.query === undefined) throw new Error(); value = JSON.parse(values.query); }
        catch { throw new MapServiceError('invalidRequest'); }
        if (value !== null && typeof value === 'object') requestId = safeId(Reflect.get(value, 'requestId'));
        result = await options.service.queryUnlocated(value, execution);
      } else {
        const values = params(url, members === null ? ['requestId', 'snapshotId'] : ['requestId', 'snapshotId', 'cursor', 'pageSize']);
        requestId = safeId(values.requestId);
        const context = { ...values, ...(values.pageSize === undefined ? {} : { pageSize: /^\d+$/.test(values.pageSize) ? Number(values.pageSize) : Number.NaN }) };
        let id: string;
        try { id = decodeURIComponent((item ?? members)![1]!); }
        catch { throw new MapServiceError('invalidRequest'); }
        if (!requestIdSchema.safeParse(id).success) throw new MapServiceError('invalidRequest');
        result = members === null ? await options.service.getItem(id, context, execution) : await options.service.getMembers(id, context, execution);
      }
      if (controller.signal.aborted) throw new MapServiceError('queryTimeout');
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE_BYTES) throw new MapServiceError('budgetExceeded');
      if (!response.writableEnded && !response.destroyed) { response.writeHead(200); response.end(encoded); }
    } catch (error) { writeError(code(error)); }
    finally { if (timer !== undefined) clearTimeout(timer); request.off('aborted', abort); if (admitted) active -= 1; }
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) {
      const encoded = JSON.stringify({ schemaVersion: 1, error: { code: 'invalidRequest', messageKey: 'map.error.invalidRequest', requestId: null, retryable: false } });
      socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json; charset=utf-8\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(encoded)}\r\n\r\n${encoded}`);
    }
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs, 10_000);
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  return server;
}

/** Production entry point; imported test/service modules never start a listener. */
export async function startMapServer(env: Readonly<Record<string, string | undefined>> = process.env) {
  const port = z.coerce.number().int().min(0).max(65_535).parse(env.PORT ?? '8080');
  const allowedOrigins = (env.MAP_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  let publicSources: ReturnType<typeof sourceReferenceSchema.parse>[] = [];
  if (env.MAP_PUBLIC_SOURCES_FILE !== undefined) {
    const contents = await readFile(env.MAP_PUBLIC_SOURCES_FILE);
    if (contents.byteLength > 256 * 1024) throw new TypeError('Public source registry exceeds bounds');
    publicSources = z.array(sourceReferenceSchema).max(1_000).parse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(contents)));
    if (new Set(publicSources.map((source) => source.sourceId)).size !== publicSources.length) throw new TypeError('Duplicate public source registry entry');
  }
  const server = createMapHttpServer({ service: createMapService({ config: loadMapConfig(env), publicSources }), allowedOrigins });
  server.on('error', () => { process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'mapServerFailed' })}\n`); process.exitCode = 1; });
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    if (address !== null && typeof address !== 'string') process.stdout.write(`${JSON.stringify({ severity: 'INFO', event: 'mapServerListening', port: address.port })}\n`);
  });
  return server;
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void startMapServer().catch(() => { process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'mapServerStartupFailed' })}\n`); process.exitCode = 1; });
}
