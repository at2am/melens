import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { staticVerifier } from '../src/auth/verifier.js';
import { UserEventService } from '../src/events/service.js';
import { InMemoryUserEventStore } from '../src/events/store.js';
import { FEED_LIMITS, type FeedSubscription } from '../src/feeds/schemas.js';
import { FeedService } from '../src/feeds/service.js';
import { InMemoryFeedStore } from '../src/feeds/store.js';
import { AgentServiceError, zeroUsage } from '../src/protocol/schemas.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createAgentHttpServer, type TurnRunner } from '../src/server.js';
import { InMemorySessionStore } from '../src/sessions/store.js';

const NOW = new Date('2026-10-15T07:00:00.000Z');
const ORIGIN = 'http://localhost:8000';

const cbd: FeedSubscription = { id: 'f_cbd', name: 'Melbourne CBD', topics: ['community', 'events', 'disruptions'],
  scope: { kind: 'area', areaId: 'melbourne-cbd' }, includeUnlocated: false, communityHorizonDays: 7, enabled: true };
const office: FeedSubscription = { id: 'f_office', name: 'Near the office', topics: ['planning'],
  scope: { kind: 'bbox', bbox: [144.95, -37.83, 144.98, -37.80] }, includeUnlocated: true, communityHorizonDays: 1, enabled: false };
const city: FeedSubscription = { id: 'f_city', name: 'All of Melbourne', topics: ['news', 'anomalies'],
  scope: { kind: 'city' }, includeUnlocated: false, communityHorizonDays: 14, enabled: true };

async function start(options: { writesPerHour?: number } = {}) {
  const runner: TurnRunner = { async run(turn) {
    turn.sink.emit({ event: 'done', stop: 'end', usage: { ...zeroUsage(), complete: true } });
    return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input, attachments: [], text: '', cards: [],
      uiActions: [], question: null, stop: 'end', trace: [], usage: { ...zeroUsage(), complete: true, perCall: [] } };
  } };
  const events = new UserEventService({ store: new InMemoryUserEventStore(), writeLimiter: createRateLimiter(100) });
  const store = new InMemoryFeedStore();
  const feeds = new FeedService({ store, writeLimiter: createRateLimiter(options.writesPerHour ?? 100), clock: () => NOW });
  const server = createAgentHttpServer({ store: new InMemorySessionStore(), runner, events, feeds,
    verifier: staticVerifier({ 'token-a': 'uid-a', 'token-b': 'uid-b' }), rateLimiter: createRateLimiter(100), allowedOrigins: [ORIGIN], turnTimeoutMs: 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'token-a') => fetch(`${base}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) } });
  const put = (feeds: unknown, token = 'token-a') => call('/v1/feeds', { method: 'PUT', body: JSON.stringify({ feeds }) }, token);
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return { base, call, put, close, store };
}

test('a uid that never saved reads null; a saved list reads back in its order, per uid', async () => {
  const { call, put, close, store } = await start();
  try {
    const before = await call('/v1/feeds');
    assert.equal(before.status, 200);
    assert.deepEqual(await before.json(), { feeds: null });
    const saved = await put([office, cbd, city]);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { feeds: [office, cbd, city] });
    assert.deepEqual(await (await call('/v1/feeds')).json(), { feeds: [office, cbd, city] });
    assert.equal((await store.get('uid-a'))?.updatedAt, NOW.toISOString());
    assert.deepEqual(await (await call('/v1/feeds', {}, 'token-b')).json(), { feeds: null }, 'another uid sees none of it');
    // An empty list is a saved choice, not "never saved".
    assert.equal((await put([])).status, 200);
    assert.deepEqual(await (await call('/v1/feeds')).json(), { feeds: [] });
  } finally { await close(); }
});

test('a name is trimmed when stored', async () => {
  const { call, put, close } = await start();
  try {
    assert.equal((await put([{ ...cbd, name: '  Carlton  ' }])).status, 200);
    const { feeds } = await (await call('/v1/feeds')).json() as { feeds: FeedSubscription[] };
    assert.equal(feeds[0]!.name, 'Carlton');
  } finally { await close(); }
});

test('the routes need a token', async () => {
  const { base, close } = await start();
  try {
    assert.equal((await fetch(`${base}/v1/feeds`)).status, 401);
    assert.equal((await fetch(`${base}/v1/feeds`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"feeds":[]}' })).status, 401);
    assert.equal((await fetch(`${base}/v1/feeds`, { headers: { Authorization: 'Bearer nobody' } })).status, 401);
  } finally { await close(); }
});

test('a list outside the shape or the limits is invalid and stores nothing', async () => {
  const { call, put, close } = await start();
  try {
    const invalid: unknown[] = [
      [{ ...cbd, colour: 'red' }],
      [{ ...cbd, topics: ['parking'] }],
      [{ ...cbd, topics: [] }],
      [{ ...cbd, topics: ['events', 'events'] }],
      [cbd, { ...office, id: cbd.id }],
      [{ ...cbd, id: 'not an id' }],
      [{ ...cbd, name: '' }],
      [{ ...cbd, name: '   ' }],
      [{ ...cbd, name: 'x'.repeat(FEED_LIMITS.name + 1) }],
      [{ ...office, scope: { kind: 'bbox', bbox: [140, -37.83, 144.98, -37.80] } }],
      [{ ...office, scope: { kind: 'bbox', bbox: [144.98, -37.83, 144.95, -37.80] } }],
      [{ ...office, scope: { kind: 'bbox', bbox: [144.95, -37.80, 144.98, -37.83] } }],
      [{ ...office, scope: { kind: 'bbox', bbox: [144.95, -37.83, 144.98] } }],
      [{ ...cbd, scope: { kind: 'area' } }],
      [{ ...cbd, scope: { kind: 'suburb', areaId: 'carlton' } }],
      [{ ...city, scope: { kind: 'city', bbox: [144.95, -37.83, 144.98, -37.80] } }],
      [{ ...cbd, communityHorizonDays: 3 }],
      [{ ...cbd, enabled: undefined }],
      Array.from({ length: FEED_LIMITS.maxFeeds + 1 }, (_, index) => ({ ...cbd, id: `f_${index}` })),
    ];
    for (const feeds of invalid) {
      const response = await put(feeds);
      assert.equal(response.status, 400, JSON.stringify(feeds).slice(0, 200));
      assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'invalidRequest');
    }
    assert.equal((await call('/v1/feeds', { method: 'PUT', body: JSON.stringify({ feeds: [cbd], extra: 1 }) })).status, 400);
    assert.equal((await call('/v1/feeds', { method: 'PUT', body: '{"feeds":' })).status, 400);
    assert.equal((await call('/v1/feeds', { method: 'POST', body: '{"feeds":[]}' })).status, 404);
    assert.deepEqual(await (await call('/v1/feeds')).json(), { feeds: null });
    const full = Array.from({ length: FEED_LIMITS.maxFeeds }, (_, index) => ({ ...cbd, id: `f_${index}` }));
    assert.equal((await put(full)).status, 200, 'exactly the limit is accepted');
  } finally { await close(); }
});

test('saves are rate limited per uid; an invalid save does not count and reads stay free', async () => {
  const { call, put, close } = await start({ writesPerHour: 2 });
  try {
    assert.equal((await put([{ ...cbd, topics: [] }])).status, 400);
    assert.equal((await put([cbd])).status, 200);
    assert.equal((await put([office])).status, 200);
    const limited = await put([city]);
    assert.equal(limited.status, 429);
    assert.equal(((await limited.json()) as { error: { code: string } }).error.code, 'rateLimited');
    assert.equal((await put([city], 'token-b')).status, 200);
    assert.deepEqual(await (await call('/v1/feeds')).json(), { feeds: [office] });
  } finally { await close(); }
});

test('the preflight allows PUT from a known origin', async () => {
  const { base, close } = await start();
  try {
    const preflight = await fetch(`${base}/v1/feeds`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /\bPUT\b/);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  } finally { await close(); }
});

test('the service refuses a malformed body before it spends a write', async () => {
  const feeds = new FeedService({ store: new InMemoryFeedStore(), writeLimiter: createRateLimiter(1), clock: () => NOW });
  await assert.rejects(feeds.replace('uid', { feeds: 'nope' }), (error: unknown) => error instanceof AgentServiceError && error.code === 'invalidRequest');
  assert.deepEqual(await feeds.replace('uid', { feeds: [cbd] }), [cbd]);
  assert.deepEqual(await feeds.list('uid'), [cbd]);
});
