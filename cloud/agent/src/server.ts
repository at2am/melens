import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { IdTokenVerifier } from './auth/verifier.js';
import { AGENT_ERROR_CODES, AgentServiceError, errorResponseSchema, turnRequestSchema, zeroUsage,
  type AgentErrorCode, type StoredTurn, type TurnRequest } from './protocol/schemas.js';
import { openSseStream, type EventSink } from './protocol/sse.js';
import type { RateLimiter } from './rate-limit.js';
import { SESSION_LIMITS, newId, summaryOf, type SessionRecord, type SessionStore } from './sessions/store.js';

/** A turn request is the user's text plus the map context; 64 KiB is far above any real one. */
export const MAX_REQUEST_BYTES = 64 * 1024;

export interface TurnContext {
  readonly uid: string;
  readonly session: SessionRecord;
  readonly turnId: string;
  readonly seq: number;
  readonly request: TurnRequest;
  /** The most recent stored turns, oldest first; the prompt carries them. */
  readonly history: readonly StoredTurn[];
  readonly sink: EventSink;
  readonly signal: AbortSignal;
  readonly startedAt: Date;
}

/** Runs one turn: emits the events, including `done` or `error`, and returns what to store. */
export interface TurnRunner {
  run(turn: TurnContext): Promise<StoredTurn>;
}

type Route =
  | { readonly kind: 'health' }
  | { readonly kind: 'sessions'; readonly method: 'GET' | 'POST' }
  | { readonly kind: 'session'; readonly method: 'GET' | 'DELETE'; readonly sessionId: string }
  | { readonly kind: 'turn'; readonly sessionId: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function matchRoute(method: string, pathname: string): Route | null {
  if (pathname === '/healthz' && method === 'GET') return { kind: 'health' };
  if (pathname === '/v1/sessions' && (method === 'GET' || method === 'POST')) return { kind: 'sessions', method };
  const session = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
  if (session !== null && ID.test(session[1]!) && (method === 'GET' || method === 'DELETE')) {
    return { kind: 'session', method, sessionId: session[1]! };
  }
  const turn = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(pathname);
  if (turn !== null && ID.test(turn[1]!) && method === 'POST') return { kind: 'turn', sessionId: turn[1]! };
  return null;
}

/** Bounded, unencoded JSON body; the limit is checked both as declared and as received. */
async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)) {
    throw new AgentServiceError('invalidRequest');
  }
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    || request.headers['content-encoding'] !== undefined) throw new AgentServiceError('invalidRequest');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new AgentServiceError('invalidRequest');
    chunks.push(buffer);
  }
  try { return JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new AgentServiceError('invalidRequest'); }
}

function errorCodeOf(error: unknown): AgentErrorCode {
  return error instanceof AgentServiceError ? error.code : 'serviceUnavailable';
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, code: AgentErrorCode): void {
  const body = errorResponseSchema.parse({ schemaVersion: 1,
    error: { code, messageKey: `agent.error.${code}`, retryable: AGENT_ERROR_CODES[code].retryable } });
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(AGENT_ERROR_CODES[code].status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
  response.end(JSON.stringify(body));
}

export interface AgentServerOptions {
  readonly store: SessionStore;
  readonly verifier: IdTokenVerifier;
  readonly runner: TurnRunner;
  readonly rateLimiter: RateLimiter;
  /** Exact origins the Web app is served from; the agent additionally allows the Authorization header. */
  readonly allowedOrigins: readonly string[];
  readonly turnTimeoutMs: number;
  readonly clock?: () => Date;
}

/** Frozen protocol transport: Firebase-authenticated session routes and the SSE turn route. */
export function createAgentHttpServer(options: AgentServerOptions) {
  const clock = options.clock ?? (() => new Date());
  const allowed = new Set(options.allowedOrigins);

  function cors(request: IncomingMessage, response: ServerResponse): boolean {
    const origin = request.headers.origin;
    if (origin === undefined) return true;
    if (!allowed.has(origin)) return false;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    return true;
  }

  async function authenticate(request: IncomingMessage): Promise<string> {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (token === '') throw new AgentServiceError('unauthorized');
    const identity = await options.verifier.verify(token);
    if (identity === null) throw new AgentServiceError('unauthorized');
    return identity.uid;
  }

  async function runTurn(uid: string, sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request);
    const parsed = turnRequestSchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const now = clock();
    if (!options.rateLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    const session = await options.store.get(uid, sessionId);
    if (session === null) throw new AgentServiceError('notFound');
    const turnId = newId('t');
    const lease = await options.store.acquireTurn(uid, sessionId, turnId, now);
    if (lease === 'missing') throw new AgentServiceError('notFound');
    if (lease === 'busy') throw new AgentServiceError('turnInProgress');
    const history = await options.store.listTurns(uid, sessionId, SESSION_LIMITS.promptTurns);

    // The client leaving or the Cloud Run deadline cancels the run, so it stops spending tokens.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.on('close', onClose);
    const timer = setTimeout(() => controller.abort(), options.turnTimeoutMs);
    const sink = openSseStream(response, turnId);
    try {
      const turn = await options.runner.run({ uid, session, turnId, seq: session.turnCount + 1, request: parsed.data,
        history, sink, signal: controller.signal, startedAt: now });
      await options.store.completeTurn(uid, sessionId, turn, clock());
    } catch (error) {
      if (!sink.sent.some((event) => event.event === 'done' || event.event === 'error')) {
        sink.emit({ event: 'error', message: controller.signal.aborted ? 'The turn was cancelled or timed out' : 'The agent could not finish this turn',
          retryable: true, usage: { ...zeroUsage(), complete: false } });
      }
      await options.store.releaseTurn(uid, sessionId, turnId);
      process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'turnFailed', turnId, reason: error instanceof Error ? error.name : 'unknown' })}\n`);
    } finally {
      clearTimeout(timer);
      response.off('close', onClose);
      sink.close();
    }
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!cors(request, response)) { writeError(response, 'invalidRequest'); return; }
    if (method === 'OPTIONS') {
      const requested = request.headers['access-control-request-method'];
      if (request.headers.origin === undefined || requested === undefined) { writeError(response, 'invalidRequest'); return; }
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' });
      response.end();
      return;
    }
    const route = matchRoute(method, url.pathname);
    if (route === null) { writeError(response, 'notFound'); return; }
    if (route.kind === 'health') { writeJson(response, 200, { service: 'melens-agent', status: 'ok' }); return; }
    try {
      const uid = await authenticate(request);
      switch (route.kind) {
        case 'sessions': {
          if (route.method === 'POST') {
            const session = await options.store.create(uid, clock());
            writeJson(response, 201, { session: summaryOf(session) });
          } else {
            writeJson(response, 200, { sessions: await options.store.list(uid) });
          }
          return;
        }
        case 'session': {
          if (route.method === 'DELETE') {
            if (!await options.store.delete(uid, route.sessionId)) throw new AgentServiceError('notFound');
            response.writeHead(204); response.end();
            return;
          }
          const session = await options.store.get(uid, route.sessionId);
          if (session === null) throw new AgentServiceError('notFound');
          const turns = await options.store.listTurns(uid, route.sessionId);
          writeJson(response, 200, { session: summaryOf(session), pendingQuestion: session.pendingQuestion, turns });
          return;
        }
        case 'turn':
          await runTurn(uid, route.sessionId, request, response);
          return;
      }
    } catch (error) {
      writeError(response, errorCodeOf(error));
    }
  }

  const server = createServer((request, response) => { void handle(request, response); });
  server.requestTimeout = options.turnTimeoutMs + 10_000;
  server.headersTimeout = 30_000;
  return server;
}
