import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { staticVerifier } from '../src/auth/verifier.js';
import { type AgentEvent, type StoredTurn, zeroUsage } from '../src/protocol/schemas.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createAgentHttpServer, type TurnRunner } from '../src/server.js';
import { InMemorySessionStore } from '../src/sessions/store.js';

const ORIGIN = 'http://localhost:8000';
const context = { viewport: { north: -37.80, south: -37.82, east: 144.98, west: 144.95 }, zoom: 15,
  layers: ['event'], localTime: '2026-10-10T18:40:00+11:00' };

function scriptedRunner(script: (turn: Parameters<TurnRunner['run']>[0]) => Promise<void> | void): TurnRunner {
  return { async run(turn) {
    await script(turn);
    if (!turn.sink.sent.some((event) => event.event === 'done')) {
      turn.sink.emit({ event: 'done', stop: 'end', usage: { ...zeroUsage(), complete: true } });
    }
    const text = turn.sink.sent.flatMap((event) => event.event === 'text' ? [event.delta] : []).join('');
    const question = turn.sink.sent.find((event) => event.event === 'question');
    const turnRecord: StoredTurn = { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input,
      text, cards: [], uiActions: [], question: question?.event === 'question' ? question.question : null,
      stop: question === undefined ? 'end' : 'asked', trace: [], usage: { ...zeroUsage(), complete: true, perCall: [] } };
    return turnRecord;
  } };
}

async function start(runner: TurnRunner, options: { turnsPerHour?: number; turnTimeoutMs?: number } = {}) {
  const store = new InMemorySessionStore();
  const server = createAgentHttpServer({ store, runner, verifier: staticVerifier({ 'token-a': 'uid-a', 'token-b': 'uid-b' }),
    rateLimiter: createRateLimiter(options.turnsPerHour ?? 100), allowedOrigins: [ORIGIN], turnTimeoutMs: options.turnTimeoutMs ?? 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'token-a') => fetch(`${base}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return { base, call, close, store };
}

function parseSse(text: string): AgentEvent[] {
  return text.split('\n\n').filter((block) => block.startsWith('event:'))
    .map((block) => JSON.parse(block.split('\n').find((line) => line.startsWith('data:'))!.slice(5)) as AgentEvent);
}

test('health needs no token; everything else does', async () => {
  const { base, call, close } = await start(scriptedRunner(() => {}));
  try {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { service: 'melens-agent', status: 'ok' });
    const denied = await fetch(`${base}/v1/sessions`);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { schemaVersion: 1, error: { code: 'unauthorized', messageKey: 'agent.error.unauthorized', retryable: false } });
    assert.equal((await call('/v1/sessions', {}, 'token-x')).status, 401);
    assert.equal((await call('/v1/nothing')).status, 404);
  } finally { await close(); }
});

test('sessions are created, listed, read and deleted per user', async () => {
  const { call, close } = await start(scriptedRunner(() => {}));
  try {
    const created = await call('/v1/sessions', { method: 'POST' });
    assert.equal(created.status, 201);
    const { session } = await created.json() as { session: { id: string; turnCount: number } };
    assert.equal(session.turnCount, 0);
    const listed = await call('/v1/sessions');
    assert.deepEqual(((await listed.json()) as { sessions: { id: string }[] }).sessions.map((s) => s.id), [session.id]);
    assert.equal((await call(`/v1/sessions/${session.id}`, {}, 'token-b')).status, 404, 'another user sees not_found, never forbidden');
    const detail = await call(`/v1/sessions/${session.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json() as { turns: unknown[] }).turns, []);
    assert.equal((await call(`/v1/sessions/${session.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/v1/sessions/${session.id}`)).status, 404);
  } finally { await close(); }
});

test('a turn streams numbered events and is stored with its question', async () => {
  const { call, close } = await start(scriptedRunner((turn) => {
    turn.sink.emit({ event: 'status', stepId: 's_1', state: 'running', tool: 'search_features', text: 'Searching the map' });
    turn.sink.emit({ event: 'text', delta: 'Hello ' });
    turn.sink.emit({ event: 'text', delta: 'there.' });
    turn.sink.emit({ event: 'question', stepId: 's_2', question: { id: 'q_1', text: 'Which garden?', options: ['Fitzroy', 'Carlton'], allowFreeText: true } });
    turn.sink.emit({ event: 'done', stop: 'asked', usage: { ...zeroUsage(), calls: 1, input: 5, output: 2, total: 7, complete: true } });
  }));
  try {
    const { session } = await (await call('/v1/sessions', { method: 'POST' })).json() as { session: { id: string } };
    const reply = await call(`/v1/sessions/${session.id}/turns`, { method: 'POST',
      body: JSON.stringify({ input: { kind: 'text', text: 'Take me to the gardens' }, context }) });
    assert.equal(reply.status, 200);
    assert.match(reply.headers.get('content-type') ?? '', /^text\/event-stream/);
    const events = parseSse(await reply.text());
    assert.deepEqual(events.map((event) => [event.event, event.seq]), [['status', 0], ['text', 1], ['text', 2], ['question', 3], ['done', 4]]);
    assert.ok(events.every((event) => event.turnId === events[0]!.turnId));
    const detail = await (await call(`/v1/sessions/${session.id}`)).json() as { session: { turnCount: number; title: string }; pendingQuestion: { id: string } | null; turns: StoredTurn[] };
    assert.equal(detail.session.turnCount, 1);
    assert.equal(detail.session.title, 'Take me to the gardens');
    assert.equal(detail.pendingQuestion?.id, 'q_1');
    assert.equal(detail.turns[0]!.text, 'Hello there.');
    assert.equal(detail.turns[0]!.stop, 'asked');
    assert.equal((await call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body: JSON.stringify({ input: { kind: 'text', text: '' }, context }) })).status, 400);
    assert.equal((await call('/v1/sessions/s_missing/turns', { method: 'POST', body: JSON.stringify({ input: { kind: 'text', text: 'x' }, context }) })).status, 404);
  } finally { await close(); }
});

test('a second concurrent turn on one session is rejected and a failed runner frees the lease', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const runner: TurnRunner = { async run(turn) {
    calls += 1;
    if (calls === 1) { await gate; throw new Error('model unavailable'); }
    turn.sink.emit({ event: 'done', stop: 'end', usage: { ...zeroUsage(), complete: true } });
    return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input, text: '', cards: [],
      uiActions: [], question: null, stop: 'end', trace: [], usage: { ...zeroUsage(), complete: true, perCall: [] } };
  } };
  const { call, close } = await start(runner);
  try {
    const { session } = await (await call('/v1/sessions', { method: 'POST' })).json() as { session: { id: string } };
    const body = JSON.stringify({ input: { kind: 'text', text: 'first' }, context });
    const first = call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body });
    assert.equal(second.status, 409);
    release();
    const events = parseSse(await (await first).text());
    assert.equal(events.at(-1)?.event, 'error');
    const third = await call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body });
    assert.equal(third.status, 200);
    assert.equal(parseSse(await third.text()).at(-1)?.event, 'done');
    const detail = await (await call(`/v1/sessions/${session.id}`)).json() as { session: { turnCount: number } };
    assert.equal(detail.session.turnCount, 1, 'the failed turn was not stored');
  } finally { await close(); }
});

test('CORS allows only the configured origin and the Authorization header; the rate limit answers 429', async () => {
  const { base, call, close } = await start(scriptedRunner(() => {}), { turnsPerHour: 1 });
  try {
    const preflight = await fetch(`${base}/v1/sessions`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');
    assert.equal((await fetch(`${base}/v1/sessions`, { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' } })).status, 400);
    const { session } = await (await call('/v1/sessions', { method: 'POST' })).json() as { session: { id: string } };
    const body = JSON.stringify({ input: { kind: 'text', text: 'hi' }, context });
    assert.equal((await call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body })).status, 200);
    assert.equal((await call(`/v1/sessions/${session.id}/turns`, { method: 'POST', body })).status, 429);
  } finally { await close(); }
});
