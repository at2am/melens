import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoredTurn } from '../src/protocol/schemas.js';
import { InMemorySessionStore, SESSION_LIMITS, type SessionRecord } from '../src/sessions/store.js';

function turn(seq: number, text = `turn ${seq}`): StoredTurn {
  return { id: `t_${seq}`, seq, createdAt: '2026-10-09T00:00:00.000Z', input: { kind: 'text', text }, attachments: [], text: 'ok',
    cards: [], uiActions: [], question: null, stop: 'end', trace: [],
    usage: { calls: 1, input: 10, cachedInput: 0, output: 2, thoughts: 0, toolUseInput: 0, total: 12, complete: true, perCall: [] } };
}

test('a user keeps at most the newest sessions and a session its newest turns', async () => {
  const store = new InMemorySessionStore();
  const base = Date.parse('2026-10-09T00:00:00Z');
  let first: string | null = null;
  for (let i = 0; i <= SESSION_LIMITS.sessionsPerUser; i += 1) {
    const session = await store.create('u1', new Date(base + i * 1_000));
    first ??= session.id;
  }
  assert.equal((await store.list('u1')).length, SESSION_LIMITS.sessionsPerUser);
  assert.equal(await store.get('u1', first!), null);
  const session = await store.create('u1', new Date(base + 100_000));
  for (let seq = 1; seq <= SESSION_LIMITS.turnsPerSession + 1; seq += 1) {
    await store.completeTurn('u1', session.id, turn(seq), new Date(base + 200_000 + seq));
  }
  const turns = await store.listTurns('u1', session.id);
  assert.equal(turns.length, SESSION_LIMITS.turnsPerSession);
  assert.equal(turns[0]!.seq, 2);
  assert.equal((await store.listTurns('u1', session.id, 20)).length, 20);
  const record = await store.get('u1', session.id);
  assert.equal(record!.turnCount, SESSION_LIMITS.turnsPerSession + 1);
  assert.equal(record!.title, 'turn 1');
});

test('one turn at a time per session, and an expired lease is taken over', async () => {
  const store = new InMemorySessionStore();
  const now = new Date('2026-10-09T00:00:00Z');
  const session = await store.create('u1', now);
  assert.equal(await store.acquireTurn('u1', session.id, 't_a', now), 'acquired');
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', now), 'busy');
  assert.equal(await store.acquireTurn('u2', session.id, 't_c', now), 'missing');
  await store.releaseTurn('u1', session.id, 't_b');
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', now), 'busy', 'releasing a foreign turn id changes nothing');
  const later = new Date(now.getTime() + SESSION_LIMITS.leaseMs + 1);
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', later), 'acquired');
  await store.completeTurn('u1', session.id, { ...turn(1), id: 't_b', question: { id: 'q1', text: 'Which?', options: ['a', 'b'], allowFreeText: true } }, later);
  const record = await store.get('u1', session.id);
  assert.equal(record!.activeTurn, null);
  assert.equal(record!.pendingQuestion?.id, 'q1');
  assert.equal(await store.acquireTurn('u1', session.id, 't_d', later), 'acquired');
});

test('a stop request reaches the watching turn, and a taken-over turn leaves the lease to the newer one', async () => {
  const store = new InMemorySessionStore();
  const now = new Date('2026-10-09T00:00:00Z');
  const session = await store.create('u1', now);
  assert.equal(await store.requestCancel('u1', session.id, now), null, 'nothing runs yet');
  assert.equal(await store.acquireTurn('u1', session.id, 't_a', now), 'acquired');
  const seen: (SessionRecord | null)[] = [];
  const unwatch = store.watchSession('u1', session.id, (record) => seen.push(record));
  assert.equal(await store.requestCancel('u1', session.id, now), 't_a');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen[0]?.activeTurn?.cancelRequested, undefined, 'the watch starts with the current state');
  assert.equal(seen.at(-1)?.activeTurn?.cancelRequested, true);
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', now), 'busy', 'asking to stop does not free the lease');
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', now, 't_other'), 'busy', 'only the named turn is taken over');
  assert.equal(await store.acquireTurn('u1', session.id, 't_b', now, 't_a'), 'acquired');
  await store.completeTurn('u1', session.id, { ...turn(1), id: 't_a', stop: 'cancelled',
    question: { id: 'q_late', text: 'Which?', options: ['a', 'b'], allowFreeText: true } }, now);
  let record = await store.get('u1', session.id);
  assert.equal(record!.activeTurn?.turnId, 't_b', 'the late turn is stored without touching the newer lease');
  assert.equal(record!.pendingQuestion, null);
  await store.completeTurn('u1', session.id, { ...turn(1), id: 't_b' }, now);
  record = await store.get('u1', session.id);
  assert.equal(record!.activeTurn, null);
  assert.deepEqual((await store.listTurns('u1', session.id)).map((stored) => [stored.id, stored.seq]), [['t_a', 1], ['t_b', 2]], 'the store numbers turns as they finish');
  await store.delete('u1', session.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.at(-1), null, 'deleting the session tells the watcher');
  unwatch();
});

test('photos are stored with their turn and dropped with it', async () => {
  const store = new InMemorySessionStore();
  const now = new Date('2026-10-09T00:00:00Z');
  const session = await store.create('u1', now);
  const image = { id: 'a_1', mimeType: 'image/png' as const, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
  await store.completeTurn('u1', session.id, { ...turn(1), attachments: [{ id: 'a_1', kind: 'image', mimeType: 'image/png', bytes: 4 }] }, now, [image]);
  assert.deepEqual((await store.getAttachment('u1', session.id, 'a_1'))?.data, image.data);
  assert.equal(await store.getAttachment('u2', session.id, 'a_1'), null);
  for (let seq = 2; seq <= SESSION_LIMITS.turnsPerSession + 1; seq += 1) await store.completeTurn('u1', session.id, turn(seq), now);
  assert.equal(await store.getAttachment('u1', session.id, 'a_1'), null, 'the photo goes with the oldest turn');
});
