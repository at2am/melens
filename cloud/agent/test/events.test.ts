import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { staticVerifier } from '../src/auth/verifier.js';
import { eventViewSchema, membersViewSchema, type EventView } from '../src/events/schemas.js';
import { UserEventService, memberIdOf } from '../src/events/service.js';
import { InMemoryUserEventStore } from '../src/events/store.js';
import { FeedService } from '../src/feeds/service.js';
import { InMemoryFeedStore } from '../src/feeds/store.js';
import { PlanService } from '../src/plans/service.js';
import { InMemoryPlanStore } from '../src/plans/store.js';
import { AgentServiceError, zeroUsage } from '../src/protocol/schemas.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createAgentHttpServer, type TurnRunner } from '../src/server.js';
import { InMemorySessionStore } from '../src/sessions/store.js';

const NOW = new Date('2026-10-10T07:00:00.000Z');
const draft = {
  title: 'Sunset run along the Yarra', description: 'Easy 5 km, all paces welcome.', point: { lat: -37.8206, lng: 144.9775 },
  placeName: 'Boathouse Drive steps', startAt: '2026-10-12T18:00:00+11:00', endAt: '2026-10-12T19:00:00+11:00',
  anonymousAttendance: false, capacity: 2,
};
const box = { north: -37.80, south: -37.83, east: 144.99, west: 144.95 };

function service(options: { writesPerHour?: number; clock?: () => Date } = {}) {
  const store = new InMemoryUserEventStore();
  const events = new UserEventService({ store, writeLimiter: createRateLimiter(options.writesPerHour ?? 100), clock: options.clock ?? (() => NOW) });
  return { store, events };
}

async function refused(action: Promise<unknown>, code: string, reason: string | null = null): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof AgentServiceError && error.code === code && error.reason === reason,
    `expected ${code}${reason === null ? '' : `.${reason}`}`);
}

test('a published event is returned in UTC with the viewer flags and validated against the protocol', async () => {
  const { events } = service();
  const event = await events.publish('owner', draft);
  assert.ok(eventViewSchema.safeParse(event).success);
  assert.match(event.id, /^ue_/);
  assert.equal(event.startAt, '2026-10-12T07:00:00.000Z');
  assert.equal(event.endAt, '2026-10-12T08:00:00.000Z');
  assert.equal(event.timezone, 'Australia/Melbourne');
  assert.deepEqual(event.viewer, { isOwner: true, joined: false });
  assert.equal(event.attendeeCount, 0);
  assert.equal(event.version, 1);
  const seen = await events.get('stranger', event.id);
  assert.deepEqual(seen.viewer, { isOwner: false, joined: false });
});

test('a draft outside the limits is invalid: service area, order of times, length and horizon', async () => {
  const { events } = service();
  await refused(events.publish('owner', { ...draft, point: { lat: 51.5, lng: -0.12 } }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, endAt: '2026-10-12T17:00:00+11:00' }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, endAt: '2026-10-20T19:00:00+11:00' }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, startAt: '2026-10-10T15:00:00+11:00' }), 'invalidRequest', null);
  await refused(events.publish('owner', { ...draft, startAt: '2027-11-12T18:00:00+11:00' }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, title: '' }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, title: 'x'.repeat(121) }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, capacity: 1 }), 'invalidRequest');
  await refused(events.publish('owner', { ...draft, extra: true }), 'invalidRequest');
  const open = await events.publish('owner', { title: 'Open end', description: '', point: draft.point, startAt: '2026-10-10T17:30:00+11:00' });
  assert.equal(open.endAt, null);
  assert.equal(open.capacity, null);
  assert.equal(open.placeName, null);
  assert.equal(open.anonymousAttendance, false);
});

test('discovery keeps published and cancelled events in the box and the window, soonest first', async () => {
  const { events } = service();
  const later = await events.publish('a', { ...draft, title: 'Later', startAt: '2026-10-13T18:00:00+11:00', endAt: null });
  const soon = await events.publish('a', { ...draft, title: 'Soon' });
  const far = await events.publish('a', { ...draft, title: 'Far away', point: { lat: -37.90, lng: 145.10 } });
  const past = await events.publish('a', { ...draft, title: 'Already over', startAt: '2026-10-10T17:30:00+11:00', endAt: '2026-10-10T17:55:00+11:00' });
  const cancelled = await events.publish('a', { ...draft, title: 'Cancelled', startAt: '2026-10-12T20:00:00+11:00', endAt: '2026-10-12T21:00:00+11:00' });
  await events.cancel('a', cancelled.id);
  const removed = await events.publish('a', { ...draft, title: 'Removed' });
  await events.remove('a', removed.id);
  const found = await events.discover('b', { ...box });
  assert.deepEqual(found.map((event) => [event.title, event.status]), [['Soon', 'published'], ['Cancelled', 'cancelled'], ['Later', 'published']]);
  assert.ok(!found.some((event) => [far.id, past.id, removed.id].includes(event.id)));
  const window = await events.discover('b', { ...box, from: '2026-10-13T00:00:00+11:00', to: '2026-10-14T00:00:00+11:00' });
  assert.deepEqual(window.map((event) => event.id), [later.id]);
  assert.equal(soon.title, 'Soon');
  await refused(events.discover('b', { north: -37.0, south: -38.0, east: 145.5, west: 144.5 }), 'invalidRequest');
  await refused(events.discover('b', { ...box, from: '2026-10-14T00:00:00+11:00', to: '2026-10-13T00:00:00+11:00' }), 'invalidRequest');
  await refused(events.discover('b', { north: 'x', south: -37.83, east: 144.99, west: 144.95 }), 'invalidRequest');
});

test('joining follows the rules: own event, cancelled, ended, twice and full; leaving needs a membership', async () => {
  const { events } = service();
  const event = await events.publish('owner', draft);
  await refused(events.join('owner', event.id, {}), 'conflict', 'ownEvent');
  const joined = await events.join('sam', event.id, { displayName: 'Sam' });
  assert.deepEqual(joined.viewer, { isOwner: false, joined: true });
  assert.equal(joined.attendeeCount, 1);
  assert.equal(joined.version, 2);
  await refused(events.join('sam', event.id, {}), 'conflict', 'alreadyJoined');
  await events.join('kim', event.id, null);
  await refused(events.join('lee', event.id, {}), 'conflict', 'eventFull');
  await refused(events.leave('lee', event.id), 'conflict', 'notJoined');
  const left = await events.leave('kim', event.id);
  assert.equal(left.attendeeCount, 1);
  assert.deepEqual(left.viewer, { isOwner: false, joined: false });
  await events.join('lee', event.id, { displayName: '  ' });
  await events.cancel('owner', event.id);
  await refused(events.join('pat', event.id, {}), 'conflict', 'eventCancelled');
  const stillLeaves = await events.leave('lee', event.id);
  assert.equal(stillLeaves.status, 'cancelled');
  const over = await events.publish('owner', { ...draft, capacity: null, startAt: '2026-10-10T17:30:00+11:00', endAt: '2026-10-10T17:55:00+11:00' });
  await refused(events.join('pat', over.id, {}), 'conflict', 'eventEnded');
  await refused(events.join('pat', 'ue_missing', {}), 'notFound');
  await refused(events.join('pat', event.id, { displayName: 'x'.repeat(41) }), 'invalidRequest');
});

test('the owner sees members by a per-event id and can remove one; an anonymous event shows only the count', async () => {
  const { events } = service();
  const open = await events.publish('owner', { ...draft, capacity: null });
  await events.join('sam', open.id, { displayName: 'Sam' });
  await events.join('kim', open.id, {});
  const members = await events.members('owner', open.id);
  assert.ok(membersViewSchema.safeParse(members).success);
  assert.equal(members.count, 2);
  assert.deepEqual(members.members?.map((member) => [member.memberId, member.displayName]),
    [[memberIdOf(open.id, 'sam'), 'Sam'], [memberIdOf(open.id, 'kim'), null]]);
  assert.ok(members.members!.every((member) => !member.memberId.includes('sam') && !member.memberId.includes('kim')));
  await refused(events.members('sam', open.id), 'forbidden');
  await refused(events.removeMember('sam', open.id, memberIdOf(open.id, 'kim')), 'forbidden');
  await refused(events.removeMember('owner', open.id, 'm_nobody'), 'notFound');
  await events.removeMember('owner', open.id, memberIdOf(open.id, 'kim'));
  assert.equal((await events.get('kim', open.id)).viewer.joined, false);
  assert.equal((await events.members('owner', open.id)).count, 1);
  await refused(events.leave('kim', open.id), 'conflict', 'notJoined');

  const anonymous = await events.publish('owner', { ...draft, anonymousAttendance: true, capacity: null });
  await events.join('sam', anonymous.id, { displayName: 'Sam' });
  assert.deepEqual(await events.members('owner', anonymous.id), { count: 1, members: null });
  await refused(events.removeMember('owner', anonymous.id, memberIdOf(anonymous.id, 'sam')), 'conflict', 'anonymousEvent');
  assert.equal((await events.get('sam', anonymous.id)).viewer.joined, true, 'the viewer still knows they joined');
});

test('the owner edits, cancels and removes; strangers get forbidden on a visible event and not_found on a removed one', async () => {
  const { events, store } = service();
  const event = await events.publish('owner', draft);
  await events.join('sam', event.id, {});
  await refused(events.update('sam', event.id, { title: 'Hijacked' }), 'forbidden');
  await refused(events.cancel('sam', event.id), 'forbidden');
  await refused(events.remove('sam', event.id), 'forbidden');
  await refused(events.update('owner', event.id, {}), 'invalidRequest');
  const edited = await events.update('owner', event.id, { title: 'Sunrise run', endAt: null, placeName: '', capacity: 5 });
  assert.equal(edited.title, 'Sunrise run');
  assert.equal(edited.endAt, null);
  assert.equal(edited.placeName, null);
  assert.equal(edited.capacity, 5);
  assert.equal(edited.description, draft.description);
  assert.equal(edited.version, 3);
  assert.equal(edited.attendeeCount, 1);
  await refused(events.update('owner', event.id, { capacity: 1 }), 'invalidRequest');
  await refused(events.update('owner', event.id, { startAt: '2026-10-01T18:00:00+11:00' }), 'invalidRequest');
  const record = await store.get(event.id);
  assert.equal(record?.activeUntil, '2026-10-12T10:00:00.000Z', 'without an end the event takes place for three hours');
  const cancelled = await events.cancel('owner', event.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await events.cancel('owner', event.id)).version, cancelled.version, 'cancelling twice changes nothing');
  await events.remove('owner', event.id);
  await refused(events.get('owner', event.id), 'notFound');
  await refused(events.update('owner', event.id, { title: 'Back' }), 'notFound');
  await refused(events.cancel('sam', event.id), 'notFound');
  assert.equal((await store.get(event.id))?.status, 'removed', 'a removed event stays for the export to withdraw');
});

test('mine lists owned and joined events soonest first; a hidden event stays with its owner', async () => {
  const { events, store } = service();
  const late = await events.publish('owner', { ...draft, title: 'Late', startAt: '2026-10-14T18:00:00+11:00', endAt: null });
  const early = await events.publish('owner', { ...draft, title: 'Early' });
  const other = await events.publish('other', { ...draft, title: 'Other', capacity: null });
  await events.join('owner', other.id, {});
  const hidden = await events.publish('owner', { ...draft, title: 'Hidden', capacity: null, startAt: '2026-10-13T10:00:00+11:00', endAt: null });
  await store.transact(hidden.id, (record) => ({ record: { ...record!, visibility: 'hidden' }, result: undefined }));
  const mine = await events.mine('owner');
  assert.deepEqual(mine.owned.map((event) => event.title), ['Early', 'Hidden', 'Late']);
  assert.deepEqual(mine.joined.map((event) => event.id), [other.id]);
  assert.deepEqual((await events.mine('other')).joined, []);
  assert.ok(!(await events.discover('other', { ...box })).some((event) => event.id === hidden.id));
  await refused(events.get('other', hidden.id), 'notFound');
  assert.equal((await events.get('owner', hidden.id)).title, 'Hidden');
  assert.equal(late.title, 'Late');
  assert.equal(early.title, 'Early');
});

test('writes count against the per-uid limit; reads do not', async () => {
  const { events } = service({ writesPerHour: 2 });
  const event = await events.publish('owner', { ...draft, capacity: null });
  await events.cancel('owner', event.id);
  await refused(events.publish('owner', draft), 'rateLimited');
  await events.get('owner', event.id);
  await events.mine('owner');
  await events.join('sam', event.id, {}).catch(() => undefined);
  assert.ok(await events.discover('owner', { ...box }));
});

const ORIGIN = 'http://localhost:8000';

async function start() {
  const runner: TurnRunner = { async run(turn) {
    turn.sink.emit({ event: 'done', stop: 'end', usage: { ...zeroUsage(), complete: true } });
    return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input, attachments: [], text: '', cards: [],
      uiActions: [], question: null, stop: 'end', trace: [], usage: { ...zeroUsage(), complete: true, perCall: [] } };
  } };
  const { events } = service();
  const feeds = new FeedService({ store: new InMemoryFeedStore(), writeLimiter: createRateLimiter(100) });
  const sessions = new InMemorySessionStore();
  const plans = new PlanService({ store: new InMemoryPlanStore(), sessions, writeLimiter: createRateLimiter(100) });
  const server = createAgentHttpServer({ store: sessions, runner, events, feeds, plans, verifier: staticVerifier({ 'token-a': 'uid-a', 'token-b': 'uid-b' }),
    rateLimiter: createRateLimiter(100), allowedOrigins: [ORIGIN], turnTimeoutMs: 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'token-a') => fetch(`${base}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) } });
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return { base, call, close };
}

test('the routes publish, discover, join, list members and remove, with the error envelope carrying the reason', async () => {
  const { base, call, close } = await start();
  try {
    assert.equal((await fetch(`${base}/v1/events`)).status, 401);
    const created = await call('/v1/events', { method: 'POST', body: JSON.stringify(draft) });
    assert.equal(created.status, 201);
    const { event } = await created.json() as { event: EventView };
    assert.ok(eventViewSchema.safeParse(event).success);
    // The query exactly as the app sends it: six-decimal coordinates and UTC instants with milliseconds.
    const query = new URLSearchParams({ north: '-37.800000', south: '-37.830000', east: '144.990000', west: '144.950000',
      from: '2026-10-10T07:40:00.000Z', to: '2026-10-24T07:40:00.000Z' });
    const found = await (await call(`/v1/events?${query}`, {}, 'token-b')).json() as { events: EventView[] };
    assert.deepEqual(found.events.map((item) => [item.id, item.viewer.isOwner]), [[event.id, false]]);
    const appDraft = { ...draft, placeName: null, endAt: null, capacity: null, startAt: '2026-10-12T07:00:00.000Z' };
    const explicitNulls = await call('/v1/events', { method: 'POST', body: JSON.stringify(appDraft) });
    assert.equal(explicitNulls.status, 201, 'explicit nulls and UTC instants are a valid draft');
    const secondId = ((await explicitNulls.json()) as { event: EventView }).event.id;
    const emptyJoin = await call(`/v1/events/${secondId}/join`, { method: 'POST', body: '{}' }, 'token-b');
    assert.equal(emptyJoin.status, 200);
    assert.equal((await call(`/v1/events/${secondId}/join`, { method: 'DELETE' }, 'token-b')).status, 200);
    assert.equal((await call(`/v1/events/${event.id}`, {}, 'token-b')).status, 200);
    const joined = await call(`/v1/events/${event.id}/join`, { method: 'POST' }, 'token-b');
    assert.equal(joined.status, 200, 'a join needs no body');
    const left = await call(`/v1/events/${event.id}/join`, { method: 'DELETE' }, 'token-b');
    assert.equal(left.status, 200);
    const rejoined = await call(`/v1/events/${event.id}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, 'token-b');
    assert.equal(rejoined.status, 200, 'a JSON content type with an empty body is an empty object');
    assert.equal(((await joined.json()) as { event: EventView }).event.viewer.joined, true);
    const again = await call(`/v1/events/${event.id}/join`, { method: 'POST', body: JSON.stringify({ displayName: 'B' }) }, 'token-b');
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { schemaVersion: 1, error: { code: 'conflict', messageKey: 'agent.error.conflict.alreadyJoined', retryable: false } });
    const mine = await (await call('/v1/events/mine', {}, 'token-b')).json() as { owned: EventView[]; joined: EventView[] };
    assert.deepEqual([mine.owned.length, mine.joined.map((item) => item.id)], [0, [event.id]]);
    const forbidden = await call(`/v1/events/${event.id}/members`, {}, 'token-b');
    assert.equal(forbidden.status, 403);
    assert.equal(((await forbidden.json()) as { error: { messageKey: string } }).error.messageKey, 'agent.error.forbidden');
    const members = await (await call(`/v1/events/${event.id}/members`)).json() as { count: number; members: { memberId: string }[] };
    assert.equal(members.count, 1);
    const patched = await call(`/v1/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) });
    assert.equal(patched.status, 200);
    assert.equal(((await patched.json()) as { event: EventView }).event.title, 'Renamed');
    assert.equal((await call(`/v1/events/${event.id}/members/${members.members[0]!.memberId}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/v1/events/${event.id}/join`, { method: 'DELETE' }, 'token-b')).status, 409);
    const cancelled = await call(`/v1/events/${event.id}/cancel`, { method: 'POST' });
    assert.equal(((await cancelled.json()) as { event: EventView }).event.status, 'cancelled');
    assert.equal((await call(`/v1/events/${event.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await call(`/v1/events/${event.id}`)).status, 404);
    assert.equal((await call('/v1/events', { method: 'POST', body: '{"title":' })).status, 400);
    assert.equal((await call('/v1/events/mine', { method: 'POST' })).status, 404, 'mine is read-only');
    const preflight = await fetch(`${base}/v1/events/${event.id}`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PATCH' } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /PATCH/);
  } finally { await close(); }
});
