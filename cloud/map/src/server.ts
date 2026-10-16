import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, errorResponseSchema, identifierSchema, sourceReferenceSchema }
  from '@melens/shared/contracts/map-contract';
import { loadMapConfig } from '@melens/shared/config';
import { MAP_ERROR_CODES, MapServiceError, mapErrorCode, type MapServiceErrorCode } from '@melens/shared/errors';
import { createMapService, type MapService } from './map-service.js';

/** The five contract routes and the health probe; every other path is notFound. */
type Route =
  | { readonly kind: 'health' | 'layers' | 'viewport' | 'unlocated' }
  | { readonly kind: 'item' | 'members'; readonly encodedId: string };
type ServiceRoute = Exclude<Route, { kind: 'health' }>;
type Execution = { readonly signal: AbortSignal };

function matchRoute(pathname: string): Route | null {
  if (pathname === '/healthz') return { kind: 'health' };
  if (pathname === '/v1/map/layers') return { kind: 'layers' };
  if (pathname === '/v1/map/viewport') return { kind: 'viewport' };
  if (pathname === '/v1/map/unlocated') return { kind: 'unlocated' };
  const item = /^\/v1\/map\/items\/([^/]+)$/.exec(pathname);
  if (item !== null) return { kind: 'item', encodedId: item[1]! };
  const members = /^\/v1\/map\/aggregates\/([^/]+)\/members$/.exec(pathname);
  if (members !== null) return { kind: 'members', encodedId: members[1]! };
  return null;
}
const routeMethod = (route: ServiceRoute) => route.kind === 'viewport' ? 'POST' : 'GET';

function safeId(value: unknown): string | null {
  const parsed = identifierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
/** The request id a client sent, taken as soon as the body is parsed so errors can echo it. */
function requestIdOf(value: unknown): string | null {
  return value !== null && typeof value === 'object' ? safeId(Reflect.get(value, 'requestId')) : null;
}
/** Only the listed query parameters, each at most once. */
function queryParams(url: URL, allowed: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(values, key)) throw new MapServiceError('invalidRequest');
    values[key] = value;
  }
  return values;
}
function parseJsonParam(value: string | undefined): unknown {
  try {
    if (value === undefined) throw new Error();
    return JSON.parse(value);
  } catch { throw new MapServiceError('invalidRequest'); }
}
function decodeId(encoded: string): string {
  let id: string;
  try { id = decodeURIComponent(encoded); } catch { throw new MapServiceError('invalidRequest'); }
  if (!identifierSchema.safeParse(id).success) throw new MapServiceError('invalidRequest');
  return id;
}
/** Bounded, unencoded JSON body; the limit is checked both as declared and as received. */
async function readJsonBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new MapServiceError('invalidRequest');
  }
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    || request.headers['content-encoding'] !== undefined) throw new MapServiceError('invalidRequest');
  const chunks: Buffer[] = [];
  let size = 0;
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

/** CORS preflight for one route: the exact method, and at most the Content-Type header. */
function preflight(request: IncomingMessage, response: ServerResponse, route: ServiceRoute, origin: string | undefined): void {
  const method = routeMethod(route);
  if (origin === undefined || request.headers['access-control-request-method'] !== method) {
    throw new MapServiceError('invalidRequest');
  }
  const requested = request.headers['access-control-request-headers'];
  if (requested !== undefined && requested.toLowerCase().split(',').some((header) => header.trim() !== 'content-type')) {
    throw new MapServiceError('invalidRequest');
  }
  response.writeHead(204, { 'Access-Control-Allow-Methods': `${method}, OPTIONS`,
    'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
  response.end();
}

/** Route one admitted request to the service. `context.requestId` is set before the service call so errors echo it. */
async function dispatch(route: ServiceRoute, url: URL, request: IncomingMessage, service: MapService,
  execution: Execution, context: { requestId: string | null }): Promise<unknown> {
  switch (route.kind) {
    case 'layers':
      queryParams(url, []);
      return service.getCatalog(execution);
    case 'viewport': {
      queryParams(url, []);
      const value = await readJsonBody(request, execution.signal);
      context.requestId = requestIdOf(value);
      return service.queryViewport(value, execution);
    }
    case 'unlocated': {
      const value = parseJsonParam(queryParams(url, ['query']).query);
      context.requestId = requestIdOf(value);
      return service.queryUnlocated(value, execution);
    }
    case 'item':
    case 'members': {
      const values = queryParams(url, route.kind === 'item'
        ? ['requestId', 'snapshotId'] : ['requestId', 'snapshotId', 'cursor', 'pageSize']);
      context.requestId = safeId(values.requestId);
      const readContext = { ...values, ...(values.pageSize === undefined ? {}
        : { pageSize: /^\d+$/.test(values.pageSize) ? Number(values.pageSize) : Number.NaN }) };
      const id = decodeId(route.encodedId);
      return route.kind === 'item' ? service.getItem(id, readContext, execution) : service.getMembers(id, readContext, execution);
    }
  }
}

function writeError(response: ServerResponse, code: MapServiceErrorCode, requestId: string | null): void {
  const body = errorResponseSchema.parse({ schemaVersion: 1, error: { code,
    messageKey: `map.error.${code}`, requestId, retryable: MAP_ERROR_CODES[code].retryable } });
  if (response.writableEnded || response.destroyed) return;
  response.setHeader('Connection', 'close');
  response.writeHead(MAP_ERROR_CODES[code].status);
  response.end(JSON.stringify(body));
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
  // Requests are answered from memory in milliseconds, so one vCPU serves many at once (map-serving-stateless.md).
  const maxConcurrent = options.maxConcurrentRequests ?? 32;
  const timeoutMs = options.requestTimeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 128
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('Invalid HTTP bounds');
  let active = 0;

  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    const context = { requestId: null as string | null };
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once('aborted', abort);
    response.once('close', () => { if (!response.writableEnded) abort(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let admitted = false;
    try {
      if (request.url === undefined || Buffer.byteLength(request.url, 'utf8') > MAX_REQUEST_BYTES) {
        throw new MapServiceError('invalidRequest');
      }
      const origin = request.headers.origin;
      if (origin !== undefined) {
        if (!origins.has(origin)) throw new MapServiceError('invalidRequest');
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      const url = new URL(request.url, 'http://map.invalid');
      const route = matchRoute(url.pathname);
      if (route === null) throw new MapServiceError('notFound');
      if (route.kind === 'health') {
        if (request.method !== 'GET' || url.search !== '') throw new MapServiceError('invalidRequest');
        response.writeHead(200);
        response.end(JSON.stringify({ service: 'melens-map', status: 'ok' }));
        return;
      }
      if (request.method === 'OPTIONS') { preflight(request, response, route, origin); return; }
      if (request.method !== routeMethod(route)) throw new MapServiceError('invalidRequest');
      if (route.kind !== 'viewport' && (request.headers['transfer-encoding'] !== undefined
        || Number(request.headers['content-length'] ?? '0') !== 0)) throw new MapServiceError('invalidRequest');
      if (active >= maxConcurrent) {
        process.stderr.write(`${JSON.stringify({ severity: 'WARNING', event: 'mapRateLimited',
          reason: 'concurrentRequests', active, limit: maxConcurrent })}\n`);
        throw new MapServiceError('rateLimited');
      }
      active += 1;
      admitted = true;
      timer = setTimeout(() => { controller.abort(); writeError(response, 'queryTimeout', context.requestId); }, timeoutMs);
      const result = await dispatch(route, url, request, options.service, { signal: controller.signal }, context);
      if (controller.signal.aborted) throw new MapServiceError('queryTimeout');
      const encoded = JSON.stringify(result);
      if (Buffer.byteLength(encoded, 'utf8') > MAX_RESPONSE_BYTES) throw new MapServiceError('budgetExceeded');
      if (!response.writableEnded && !response.destroyed) { response.writeHead(200); response.end(encoded); }
    } catch (error) {
      writeError(response, mapErrorCode(error), context.requestId);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      request.off('aborted', abort);
      if (admitted) active -= 1;
    }
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

/** The reviewed public URL/attribution registry; it is the only file the service reads. */
async function loadPublicSources(path: string) {
  const contents = await readFile(path);
  if (contents.byteLength > 256 * 1024) throw new TypeError('Public source registry exceeds bounds');
  const sources = z.array(sourceReferenceSchema).max(1_000)
    .parse(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(contents)));
  if (new Set(sources.map((source) => source.sourceId)).size !== sources.length) {
    throw new TypeError('Duplicate public source registry entry');
  }
  return sources;
}

/** Production entry point; imported test/service modules never start a listener. */
export async function startMapServer(env: Readonly<Record<string, string | undefined>> = process.env) {
  const port = z.coerce.number().int().min(0).max(65_535).parse(env.PORT ?? '8080');
  const allowedOrigins = (env.MAP_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const publicSources = env.MAP_PUBLIC_SOURCES_FILE === undefined ? [] : await loadPublicSources(env.MAP_PUBLIC_SOURCES_FILE);
  const service = createMapService({ config: loadMapConfig(env), publicSources, prewarmNewsAreas: true });
  const server = createMapHttpServer({ service, allowedOrigins });
  server.on('error', () => {
    process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'mapServerFailed' })}\n`);
    process.exitCode = 1;
  });
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.listen(port, '0.0.0.0', () => {
    // Startup has CPU; the cached layers and the first news copy load before the first request.
    service.warmNewsAreas();
    service.warmLayers();
    const address = server.address();
    if (address !== null && typeof address !== 'string') {
      process.stdout.write(`${JSON.stringify({ severity: 'INFO', event: 'mapServerListening', port: address.port })}\n`);
    }
  });
  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void startMapServer().catch(() => {
    process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'mapServerStartupFailed' })}\n`);
    process.exitCode = 1;
  });
}
