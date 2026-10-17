import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { IdTokenVerifier } from './auth/verifier.js';
import type { UserEventService } from './events/service.js';
import type { FeedService } from './feeds/service.js';
import { decodeImages, type TurnImage } from './protocol/attachments.js';
import { askedIn } from './agent/prompts.js';
import type { PlanService } from './plans/service.js';
import { turnIdOfCard } from './plans/schemas.js';
import { AGENT_ERROR_CODES, ATTACHMENT_LIMITS, AgentServiceError, errorResponseSchema, turnRequestSchema, zeroUsage,
  type AgentErrorCode, type Card, type StoredTurn, type TurnRequest } from './protocol/schemas.js';
import { openSseStream, type EventSink } from './protocol/sse.js';
import type { RateLimiter } from './rate-limit.js';
import { SESSION_LIMITS, newId, summaryOf, type SessionRecord, type SessionStore } from './sessions/store.js';

/** A turn request is the user's text, the map context (64 KiB is far above any real one) and up to four photos in base64. */
export const MAX_REQUEST_BYTES = 64 * 1024 + ATTACHMENT_LIMITS.perTurn * Math.ceil(ATTACHMENT_LIMITS.bytes / 3) * 4;

/** How long a new message waits for the running turn it interrupts to stop and store itself before taking its lease. */
export const SUPERSEDE_WAIT_MS = 5_000;

/** The longest a saved plan's stop refresh may read the sensors and the area's rules, or an edit compute its route. */
const STOP_REFRESH_TIMEOUT_MS = 60_000;

export interface TurnContext {
  readonly uid: string;
  readonly session: SessionRecord;
  readonly turnId: string;
  readonly seq: number;
  readonly request: TurnRequest;
  /** The photos attached to this turn, decoded and checked. */
  readonly images: readonly TurnImage[];
  /** The most recent stored turns, oldest first; the prompt carries them. */
  readonly history: readonly StoredTurn[];
  /** The photos of the last `SESSION_LIMITS.promptImageTurns` history turns, by attachment id. */
  readonly historyImages: ReadonlyMap<string, TurnImage>;
  /**
   * The plan card this turn changes, as stored: the card a `refine` input names, or the plan the pending question was
   * about when the input may answer it (an `answer`, `answers` or `text` input).
   */
  readonly planCard?: Card;
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
  | { readonly kind: 'turn'; readonly sessionId: string }
  | { readonly kind: 'cancel'; readonly sessionId: string }
  | { readonly kind: 'attachment'; readonly sessionId: string; readonly attachmentId: string }
  | { readonly kind: 'events'; readonly method: 'GET' | 'POST' }
  | { readonly kind: 'eventsMine' }
  | { readonly kind: 'event'; readonly method: 'GET' | 'PATCH' | 'DELETE'; readonly eventId: string }
  | { readonly kind: 'eventCancel'; readonly eventId: string }
  | { readonly kind: 'eventJoin'; readonly method: 'POST' | 'DELETE'; readonly eventId: string }
  | { readonly kind: 'eventMembers'; readonly eventId: string }
  | { readonly kind: 'eventMember'; readonly eventId: string; readonly memberId: string }
  | { readonly kind: 'feeds'; readonly method: 'GET' | 'PUT' }
  | { readonly kind: 'plans'; readonly method: 'GET' | 'POST' }
  | { readonly kind: 'plan'; readonly method: 'PATCH' | 'DELETE'; readonly planId: string }
  | { readonly kind: 'planStopRefresh'; readonly planId: string; readonly index: number };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The user events routes (agent-protocol.md, User events); `mine` is matched before an event id. */
function matchEventRoute(method: string, pathname: string): Route | null {
  if (pathname === '/v1/events' && (method === 'GET' || method === 'POST')) return { kind: 'events', method };
  if (pathname === '/v1/events/mine' && method === 'GET') return { kind: 'eventsMine' };
  const event = /^\/v1\/events\/([^/]+)$/.exec(pathname);
  if (event !== null && ID.test(event[1]!) && (method === 'GET' || method === 'PATCH' || method === 'DELETE')) {
    return { kind: 'event', method, eventId: event[1]! };
  }
  const cancel = /^\/v1\/events\/([^/]+)\/cancel$/.exec(pathname);
  if (cancel !== null && ID.test(cancel[1]!) && method === 'POST') return { kind: 'eventCancel', eventId: cancel[1]! };
  const join = /^\/v1\/events\/([^/]+)\/join$/.exec(pathname);
  if (join !== null && ID.test(join[1]!) && (method === 'POST' || method === 'DELETE')) return { kind: 'eventJoin', method, eventId: join[1]! };
  const members = /^\/v1\/events\/([^/]+)\/members$/.exec(pathname);
  if (members !== null && ID.test(members[1]!) && method === 'GET') return { kind: 'eventMembers', eventId: members[1]! };
  const member = /^\/v1\/events\/([^/]+)\/members\/([^/]+)$/.exec(pathname);
  if (member !== null && ID.test(member[1]!) && ID.test(member[2]!) && method === 'DELETE') {
    return { kind: 'eventMember', eventId: member[1]!, memberId: member[2]! };
  }
  return null;
}

function matchRoute(method: string, pathname: string): Route | null {
  if (pathname === '/healthz' && method === 'GET') return { kind: 'health' };
  if (pathname.startsWith('/v1/events')) return matchEventRoute(method, pathname);
  if (pathname === '/v1/feeds' && (method === 'GET' || method === 'PUT')) return { kind: 'feeds', method };
  if (pathname === '/v1/plans' && (method === 'GET' || method === 'POST')) return { kind: 'plans', method };
  const plan = /^\/v1\/plans\/([^/]+)$/.exec(pathname);
  if (plan !== null && ID.test(plan[1]!) && (method === 'PATCH' || method === 'DELETE')) return { kind: 'plan', method, planId: plan[1]! };
  const stop = /^\/v1\/plans\/([^/]+)\/stops\/(\d{1,2})\/refresh$/.exec(pathname);
  if (stop !== null && ID.test(stop[1]!) && method === 'POST') return { kind: 'planStopRefresh', planId: stop[1]!, index: Number(stop[2]) };
  if (pathname === '/v1/sessions' && (method === 'GET' || method === 'POST')) return { kind: 'sessions', method };
  const session = /^\/v1\/sessions\/([^/]+)$/.exec(pathname);
  if (session !== null && ID.test(session[1]!) && (method === 'GET' || method === 'DELETE')) {
    return { kind: 'session', method, sessionId: session[1]! };
  }
  const turn = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(pathname);
  if (turn !== null && ID.test(turn[1]!) && method === 'POST') return { kind: 'turn', sessionId: turn[1]! };
  const cancel = /^\/v1\/sessions\/([^/]+)\/cancel$/.exec(pathname);
  if (cancel !== null && ID.test(cancel[1]!) && method === 'POST') return { kind: 'cancel', sessionId: cancel[1]! };
  const attachment = /^\/v1\/sessions\/([^/]+)\/attachments\/([^/]+)$/.exec(pathname);
  if (attachment !== null && ID.test(attachment[1]!) && ID.test(attachment[2]!) && method === 'GET') {
    return { kind: 'attachment', sessionId: attachment[1]!, attachmentId: attachment[2]! };
  }
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

/** A body that may be absent: a route like `join` takes options but needs none. */
async function readOptionalJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length'];
  if (declared === '0' || (declared === undefined && request.headers['content-type'] === undefined)) return {};
  return readJsonBody(request);
}

function errorOf(error: unknown): { readonly code: AgentErrorCode; readonly reason: string | null } {
  return error instanceof AgentServiceError ? { code: error.code, reason: error.reason } : { code: 'serviceUnavailable', reason: null };
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function writeNoContent(response: ServerResponse): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(204);
  response.end();
}

function writeError(response: ServerResponse, code: AgentErrorCode, reason: string | null = null): void {
  const body = errorResponseSchema.parse({ schemaVersion: 1,
    error: { code, messageKey: `agent.error.${code}${reason === null ? '' : `.${reason}`}`, retryable: AGENT_ERROR_CODES[code].retryable } });
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(AGENT_ERROR_CODES[code].status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
  response.end(JSON.stringify(body));
}

export interface AgentServerOptions {
  readonly store: SessionStore;
  readonly verifier: IdTokenVerifier;
  readonly runner: TurnRunner;
  readonly rateLimiter: RateLimiter;
  /** User events (UC-09), with their own write limit. */
  readonly events: UserEventService;
  /** Feed subscriptions (UC-14), with their own write limit. */
  readonly feeds: FeedService;
  /** Saved plans (UC-03), with their own write limit. */
  readonly plans: PlanService;
  /** Exact origins the Web app is served from; the agent additionally allows the Authorization header. */
  readonly allowedOrigins: readonly string[];
  readonly turnTimeoutMs: number;
  /** Defaults to `SUPERSEDE_WAIT_MS`. */
  readonly supersedeWaitMs?: number;
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

  /** Resolves once `turnId` no longer holds the session's lease, or after the supersede wait. */
  function waitForRelease(uid: string, sessionId: string, turnId: string): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let unwatch: (() => void) | null = null;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unwatch?.();
        resolve();
      };
      const timer = setTimeout(settle, options.supersedeWaitMs ?? SUPERSEDE_WAIT_MS);
      unwatch = options.store.watchSession(uid, sessionId, (record) => {
        if (record === null || record.activeTurn?.turnId !== turnId) settle();
      });
      if (settled) unwatch();
    });
  }

  /**
   * One turn runs per session, and a new message interrupts it: the running turn is asked to stop, gets a
   * moment to store what it has (so the new turn's history includes it), and then loses its lease either way.
   */
  async function acquireLease(uid: string, sessionId: string, turnId: string): Promise<void> {
    const first = await options.store.acquireTurn(uid, sessionId, turnId, clock());
    if (first === 'acquired') return;
    if (first === 'missing') throw new AgentServiceError('notFound');
    const running = await options.store.requestCancel(uid, sessionId, clock());
    if (running !== null) await waitForRelease(uid, sessionId, running);
    const second = await options.store.acquireTurn(uid, sessionId, turnId, clock(), running ?? undefined);
    if (second === 'missing') throw new AgentServiceError('notFound');
    if (second === 'busy') throw new AgentServiceError('turnInProgress');
  }

  /** Photos of the most recent turns go back to the model; one that cannot be read is left out, not fatal. */
  async function loadHistoryImages(uid: string, sessionId: string, history: readonly StoredTurn[]): Promise<Map<string, TurnImage>> {
    const ids = history.slice(-SESSION_LIMITS.promptImageTurns).flatMap((turn) => turn.attachments.map((attachment) => attachment.id));
    const images = await Promise.all(ids.map((id) => options.store.getAttachment(uid, sessionId, id).catch(() => null)));
    return new Map(images.filter((image) => image !== null).map((image) => [image.id, image]));
  }

  /**
   * The plan card a `refine` turn changes, read from the session's stored turn, or from the uid's saved plan `planId`
   * when the user changes a plan they kept; never from the request.
   */
  async function storedPlanCard(uid: string, sessionId: string, cardId: string, planId?: string): Promise<Card> {
    let card: Card | undefined;
    if (planId === undefined) {
      const turnId = turnIdOfCard(cardId);
      const turn = turnId === null ? null : await options.store.getTurn(uid, sessionId, turnId);
      card = turn?.cards.find((candidate) => candidate.id === cardId);
    } else {
      card = (await options.plans.card(uid, planId)) ?? undefined;
    }
    if (card?.id !== cardId) throw new AgentServiceError('notFound');
    if (card.type !== 'plan') throw new AgentServiceError('invalidRequest', 'not_a_plan');
    return card;
  }

  async function runTurn(uid: string, sessionId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readJsonBody(request);
    const parsed = turnRequestSchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const images = decodeImages(parsed.data.attachments ?? [], ATTACHMENT_LIMITS.bytes);
    if (!options.rateLimiter.allow(uid, clock())) throw new AgentServiceError('rateLimited');
    const input = parsed.data.input;
    let planCard = input.kind === 'refine' ? await storedPlanCard(uid, sessionId, input.cardId, input.planId) : undefined;

    // The client leaving, the stop button, a newer message or the Cloud Run deadline cancels the run, so it
    // stops spending tokens. The client may already leave while this request waits for an interrupted turn.
    const controller = new AbortController();
    const onClose = () => controller.abort();
    response.on('close', onClose);
    const turnId = newId('t');
    let session: SessionRecord;
    let history: StoredTurn[];
    let historyImages: Map<string, TurnImage>;
    try {
      await acquireLease(uid, sessionId, turnId);
    } catch (error) {
      response.off('close', onClose);
      throw error;
    }
    if (controller.signal.aborted) {
      // The client left while the turn it interrupted wound down; there is nobody to answer.
      response.off('close', onClose);
      await options.store.releaseTurn(uid, sessionId, turnId);
      return;
    }
    try {
      const record = await options.store.get(uid, sessionId);
      if (record === null) throw new AgentServiceError('notFound');
      session = record;
      history = await options.store.listTurns(uid, sessionId, SESSION_LIMITS.promptTurns);
      // An answer to a question about a plan changes that plan, so the model gets the whole card, as for a refine turn.
      // A question asked while changing a saved plan is about the plan's card, which the refine input named.
      const pending = record.pendingQuestion;
      const aboutPlan = pending?.planCardId;
      if (planCard === undefined && aboutPlan !== undefined && ['answer', 'answers', 'text'].includes(input.kind)) {
        const asking = history.findLast((turn) => askedIn(turn).some((question) => question.id === pending!.id))?.input;
        const savedPlan = asking?.kind === 'refine' && asking.cardId === aboutPlan ? asking.planId : undefined;
        planCard = await storedPlanCard(uid, sessionId, aboutPlan, savedPlan).catch(() => undefined);
      }
      historyImages = await loadHistoryImages(uid, sessionId, history);
    } catch (error) {
      response.off('close', onClose);
      await options.store.releaseTurn(uid, sessionId, turnId);
      throw error;
    }

    // The stop button and a newer message reach the turn through its lease, whichever instance runs it.
    const unwatch = options.store.watchSession(uid, sessionId, (record) => {
      const active = record?.activeTurn ?? null;
      if (record === null || (active !== null && (active.turnId !== turnId || active.cancelRequested === true))) controller.abort();
    });
    const startedAt = clock();
    const timer = setTimeout(() => controller.abort(), options.turnTimeoutMs);
    const sink = openSseStream(response, turnId);
    try {
      const turn = await options.runner.run({ uid, session, turnId, seq: session.turnCount + 1, request: parsed.data, images,
        history, historyImages, sink, signal: controller.signal, startedAt, ...(planCard === undefined ? {} : { planCard }) });
      await options.store.completeTurn(uid, sessionId, turn, clock(), images);
    } catch (error) {
      if (!sink.sent.some((event) => event.event === 'done' || event.event === 'error')) {
        sink.emit({ event: 'error', message: controller.signal.aborted ? 'The turn was cancelled or timed out' : 'The agent could not finish this turn',
          retryable: true, usage: { ...zeroUsage(), complete: false } });
      }
      await options.store.releaseTurn(uid, sessionId, turnId);
      process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'turnFailed', turnId, reason: error instanceof Error ? error.name : 'unknown' })}\n`);
    } finally {
      clearTimeout(timer);
      unwatch();
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
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
        case 'cancel': {
          // The stop button: the running turn stops wherever it runs and is stored as cancelled.
          if (await options.store.get(uid, route.sessionId) === null) throw new AgentServiceError('notFound');
          await options.store.requestCancel(uid, route.sessionId, clock());
          response.writeHead(204); response.end();
          return;
        }
        case 'attachment': {
          const image = await options.store.getAttachment(uid, route.sessionId, route.attachmentId);
          if (image === null) throw new AgentServiceError('notFound');
          response.writeHead(200, { 'Content-Type': image.mimeType, 'Content-Length': image.data.length,
            'Cache-Control': 'private, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' });
          response.end(image.data);
          return;
        }
        case 'events': {
          if (route.method === 'POST') {
            writeJson(response, 201, { event: await options.events.publish(uid, await readJsonBody(request)) });
          } else {
            writeJson(response, 200, { events: await options.events.discover(uid, Object.fromEntries(url.searchParams)) });
          }
          return;
        }
        case 'eventsMine':
          writeJson(response, 200, await options.events.mine(uid));
          return;
        case 'event': {
          if (route.method === 'GET') writeJson(response, 200, { event: await options.events.get(uid, route.eventId) });
          else if (route.method === 'PATCH') writeJson(response, 200, { event: await options.events.update(uid, route.eventId, await readJsonBody(request)) });
          else { await options.events.remove(uid, route.eventId); writeNoContent(response); }
          return;
        }
        case 'eventCancel':
          writeJson(response, 200, { event: await options.events.cancel(uid, route.eventId) });
          return;
        case 'eventJoin': {
          const event = route.method === 'POST' ? await options.events.join(uid, route.eventId, await readOptionalJsonBody(request))
            : await options.events.leave(uid, route.eventId);
          writeJson(response, 200, { event });
          return;
        }
        case 'eventMembers':
          writeJson(response, 200, await options.events.members(uid, route.eventId));
          return;
        case 'eventMember':
          await options.events.removeMember(uid, route.eventId, route.memberId);
          writeNoContent(response);
          return;
        case 'feeds': {
          if (route.method === 'PUT') writeJson(response, 200, { feeds: await options.feeds.replace(uid, await readJsonBody(request)) });
          else writeJson(response, 200, { feeds: await options.feeds.list(uid) });
          return;
        }
        case 'plans': {
          if (route.method === 'POST') writeJson(response, 201, { plan: await options.plans.save(uid, await readJsonBody(request)) });
          else writeJson(response, 200, { plans: await options.plans.list(uid) });
          return;
        }
        case 'plan': {
          if (route.method === 'DELETE') {
            await options.plans.remove(uid, route.planId);
            writeNoContent(response);
            return;
          }
          // An edit that computes the route again stops when the caller leaves, and after a minute in any case.
          const controller = new AbortController();
          const onClose = () => { if (!response.writableEnded) controller.abort(); };
          response.on('close', onClose);
          try {
            const body = await readJsonBody(request);
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(STOP_REFRESH_TIMEOUT_MS)]);
            writeJson(response, 200, { plan: await options.plans.edit(uid, route.planId, body, signal) });
          } finally { response.off('close', onClose); }
          return;
        }
        case 'planStopRefresh': {
          // The read stops when the caller leaves, and after a minute in any case.
          const controller = new AbortController();
          const onClose = () => { if (!response.writableEnded) controller.abort(); };
          response.on('close', onClose);
          try {
            const body = await readJsonBody(request);
            const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(STOP_REFRESH_TIMEOUT_MS)]);
            writeJson(response, 200, { plan: await options.plans.refreshStop(uid, route.planId, route.index, body, signal) });
          } finally { response.off('close', onClose); }
          return;
        }
      }
    } catch (error) {
      const { code, reason } = errorOf(error);
      writeError(response, code, reason);
    }
  }

  const server = createServer((request, response) => { void handle(request, response); });
  server.requestTimeout = options.turnTimeoutMs + 10_000;
  server.headersTimeout = 30_000;
  return server;
}
