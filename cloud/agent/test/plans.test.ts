import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createMapAgentRunner } from '../src/agent/map-agent.js';
import { historyContents } from '../src/agent/prompts.js';
import { staticVerifier } from '../src/auth/verifier.js';
import { UserEventService } from '../src/events/service.js';
import { InMemoryUserEventStore } from '../src/events/store.js';
import { FeedService } from '../src/feeds/service.js';
import { InMemoryFeedStore } from '../src/feeds/store.js';
import { PLAN_LIMITS, type SavedPlan } from '../src/plans/schemas.js';
import { PlanService } from '../src/plans/service.js';
import { InMemoryPlanStore } from '../src/plans/store.js';
import { type Card, type Question, type StopParking, type StoredTurn, zeroUsage } from '../src/protocol/schemas.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createAgentHttpServer, type TurnContext, type TurnRunner } from '../src/server.js';
import { InMemorySessionStore } from '../src/sessions/store.js';
import { ScriptedLlm, eventItem, fakeReader, functionCall, streamedText, turnContext, usage } from './support.js';

const NOW = new Date('2026-10-16T07:00:00.000Z');
const ORIGIN = 'http://localhost:8000';
const context = { viewport: { north: -37.80, south: -37.82, east: 144.98, west: 144.95 }, zoom: 15, layers: ['event'], localTime: '2026-10-16T18:00:00+11:00' };

const ROUTE = { polyline: 'abc', mode: 'walk', distance_m: 1200, duration_min: 16, waypoints: [] };

function planCard(turnId: string, n = 1, type: Card['type'] = 'plan'): Card {
  return { id: `c_${turnId}_${n}`, type, title: 'An evening of music', items: [
    { title: 'Mahler 5', source: { feature_id: 'event:1' }, getting_there: 'Start here' },
    { title: 'Jazz on the lane', source: { url: 'https://example.org/jazz' }, getting_there: '8 min walk' },
  ] };
}

/** Each turn stores the cards and actions the test queued for it, and records what the server handed the runner. */
function cardRunner(seen: TurnContext[], queue: { cards: (turnId: string) => Card[]; uiActions?: StoredTurn['uiActions'];
  questions?: (turnId: string) => Question[] }[]): TurnRunner {
  return { async run(turn) {
    seen.push(turn);
    const next = queue.shift() ?? { cards: () => [] };
    const questions = next.questions?.(turn.turnId) ?? [];
    const stop = questions.length > 0 ? 'asked' : 'end';
    turn.sink.emit({ event: 'done', stop, usage: { ...zeroUsage(), complete: true } });
    return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input, attachments: [], text: '',
      cards: next.cards(turn.turnId), uiActions: next.uiActions ?? [], question: questions[0] ?? null, questions, stop, trace: [],
      usage: { ...zeroUsage(), complete: true, perCall: [] } };
  } };
}

async function start(runner: TurnRunner, options: { writesPerHour?: number; refreshParking?: ConstructorParameters<typeof PlanService>[0]['refreshParking'] } = {}) {
  const sessions = new InMemorySessionStore();
  const plans = new PlanService({ store: new InMemoryPlanStore(), sessions, writeLimiter: createRateLimiter(options.writesPerHour ?? 100), clock: () => NOW,
    ...(options.refreshParking === undefined ? {} : { refreshParking: options.refreshParking }) });
  const server = createAgentHttpServer({ store: sessions, runner, plans,
    events: new UserEventService({ store: new InMemoryUserEventStore(), writeLimiter: createRateLimiter(100) }),
    feeds: new FeedService({ store: new InMemoryFeedStore(), writeLimiter: createRateLimiter(100) }),
    verifier: staticVerifier({ 'token-a': 'uid-a', 'token-b': 'uid-b' }), rateLimiter: createRateLimiter(100), allowedOrigins: [ORIGIN], turnTimeoutMs: 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'token-a') => fetch(`${base}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) } });
  const newSession = async (token = 'token-a') => ((await (await call('/v1/sessions', { method: 'POST' }, token)).json()) as { session: { id: string } }).session.id;
  /** Runs one turn to the end and returns the stored turn's id. */
  const turn = async (sessionId: string, input: Record<string, unknown>, token = 'token-a') => {
    const response = await call(`/v1/sessions/${sessionId}/turns`, { method: 'POST', body: JSON.stringify({ input, context }) }, token);
    const body = await response.text();
    return { status: response.status, body };
  };
  const lastTurnId = (sessionId: string, uid = 'uid-a') => sessions.listTurns(uid, sessionId).then((turns) => turns.at(-1)!.id);
  const save = (sessionId: string, cardId: string, token = 'token-a') =>
    call('/v1/plans', { method: 'POST', body: JSON.stringify({ sessionId, cardId }) }, token);
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return { call, newSession, turn, lastTurnId, save, close };
}

test('a plan card is saved from the stored turn with its route, listed newest first, saved once, and removed', async () => {
  const seen: TurnContext[] = [];
  const { call, newSession, turn, lastTurnId, save, close } = await start(cardRunner(seen, [
    { cards: (id) => [planCard(id)], uiActions: [{ action: 'draw_route', args: ROUTE }] },
  ]));
  try {
    const sessionId = await newSession();
    await turn(sessionId, { kind: 'text', text: 'Plan my evening' });
    const turnId = await lastTurnId(sessionId);
    const cardId = `c_${turnId}_1`;
    assert.deepEqual(await (await call('/v1/plans')).json(), { plans: [] });

    const saved = await save(sessionId, cardId);
    assert.equal(saved.status, 201);
    const { plan } = await saved.json() as { plan: SavedPlan };
    assert.deepEqual(plan, { id: cardId, sessionId, turnId, savedAt: NOW.toISOString(), card: planCard(turnId), route: ROUTE });
    assert.deepEqual(await (await call('/v1/plans')).json(), { plans: [plan] });
    // Saving the same card again is the same plan, not a second one.
    assert.deepEqual(await (await save(sessionId, cardId)).json(), { plan });
    assert.equal(((await (await call('/v1/plans')).json()) as { plans: unknown[] }).plans.length, 1);
    assert.deepEqual(await (await call('/v1/plans', {}, 'token-b')).json(), { plans: [] }, 'another uid sees none of it');
    assert.equal((await call(`/v1/plans/${cardId}`, { method: 'DELETE' }, 'token-b')).status, 404);

    assert.equal((await call(`/v1/plans/${cardId}`, { method: 'DELETE' })).status, 204);
    assert.deepEqual(await (await call('/v1/plans')).json(), { plans: [] });
    assert.equal((await call(`/v1/plans/${cardId}`, { method: 'DELETE' })).status, 404);
  } finally { await close(); }
});

test('only a plan card of the uid\'s own session can be saved, and only up to the limit', async () => {
  const seen: TurnContext[] = [];
  const queue = [{ cards: (id: string) => [planCard(id, 1, 'list')] },
    ...Array.from({ length: PLAN_LIMITS.maxPlans + 1 }, () => ({ cards: (id: string) => [planCard(id)] }))];
  const { newSession, turn, lastTurnId, save, close } = await start(cardRunner(seen, queue), { writesPerHour: 1_000 });
  try {
    const sessionId = await newSession();
    await turn(sessionId, { kind: 'text', text: 'What is around?' });
    const listCard = `c_${await lastTurnId(sessionId)}_1`;
    const notAPlan = await save(sessionId, listCard);
    assert.equal(notAPlan.status, 400);
    assert.equal(((await notAPlan.json()) as { error: { messageKey: string } }).error.messageKey, 'agent.error.invalidRequest.not_a_plan');
    assert.equal((await save(sessionId, 'c_t_missing_1')).status, 404);
    assert.equal((await save(sessionId, 'not-a-card-id')).status, 404);
    assert.equal((await save('s_other', listCard)).status, 404);
    assert.equal((await save(sessionId, listCard, 'token-b')).status, 404, 'another uid cannot copy the card');
    assert.equal((await save(sessionId, '')).status, 400);

    for (let index = 0; index < PLAN_LIMITS.maxPlans; index += 1) {
      await turn(sessionId, { kind: 'text', text: `Plan ${index}` });
      assert.equal((await save(sessionId, `c_${await lastTurnId(sessionId)}_1`)).status, 201);
    }
    await turn(sessionId, { kind: 'text', text: 'One more plan' });
    const full = await save(sessionId, `c_${await lastTurnId(sessionId)}_1`);
    assert.equal(full.status, 409);
    assert.equal(((await full.json()) as { error: { messageKey: string } }).error.messageKey, 'agent.error.conflict.plan_limit');
  } finally { await close(); }
});

test('a refine turn hands the runner the stored plan card; an unknown or non-plan card is refused before the turn runs', async () => {
  const seen: TurnContext[] = [];
  const { call, newSession, turn, lastTurnId, close } = await start(cardRunner(seen, [
    { cards: (id) => [planCard(id), planCard(id, 2, 'list')] },
    { cards: () => [] },
  ]));
  try {
    const sessionId = await newSession();
    await turn(sessionId, { kind: 'text', text: 'Plan my evening' });
    const turnId = await lastTurnId(sessionId);

    const refined = await turn(sessionId, { kind: 'refine', cardId: `c_${turnId}_1`, text: 'Swap the jazz for a café' });
    assert.equal(refined.status, 200);
    assert.deepEqual(seen.at(-1)?.planCard, planCard(turnId));
    assert.deepEqual(seen.at(-1)?.request.input, { kind: 'refine', cardId: `c_${turnId}_1`, text: 'Swap the jazz for a café' });

    // A refine turn may carry photos, like a text turn.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString('base64');
    const withPhoto = await call(`/v1/sessions/${sessionId}/turns`, { method: 'POST', body: JSON.stringify({ context,
      input: { kind: 'refine', cardId: `c_${turnId}_1`, text: 'Somewhere like this' }, attachments: [{ kind: 'image', mimeType: 'image/png', data: png }] }) });
    assert.equal(withPhoto.status, 200);
    await withPhoto.text();
    assert.equal(seen.at(-1)?.images.length, 1);

    const runs = seen.length;
    assert.equal((await turn(sessionId, { kind: 'refine', cardId: `c_${turnId}_2`, text: 'Shorter' })).status, 400);
    assert.equal((await turn(sessionId, { kind: 'refine', cardId: `c_${turnId}_9`, text: 'Shorter' })).status, 404);
    assert.equal((await turn(sessionId, { kind: 'refine', cardId: `c_${turnId}_1`, text: '  ' })).status, 400);
    assert.equal(seen.length, runs, 'no refused refine reached the runner');
  } finally { await close(); }
});

test('a refine turn sends the whole plan to the model, and the revised card may cite the plan\'s sources without a search', async () => {
  const card = planCard('t_earlier');
  const items = [eventItem('event:3', 'Late show', 144.9700, -37.8190, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z')];
  const llm = new ScriptedLlm([
    () => functionCall('show_card', { type: 'plan', title: 'Shorter evening', items: [card.items[1]] }, usage(300, 30)),
    () => streamedText('Done: one stop.', usage(400, 10)),
  ]);
  const input = { kind: 'refine' as const, cardId: card.id, text: 'Only the jazz, please' };
  const turn: TurnContext = { ...turnContext('', { input }), planCard: card };
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 8, tools: { features: fakeReader(items), grounding: null },
    clock: () => new Date('2026-10-10T07:40:00Z') });
  const stored = await runner.run(turn);

  const parts = llm.seen[0]?.contents.at(-1)?.parts ?? [];
  assert.match(parts[1]?.text ?? '', /^Current plan/);
  assert.match(parts[1]?.text ?? '', /"source":\{"url":"https:\/\/example.org\/jazz"\}/);
  assert.equal(parts[2]?.text, `Change the plan ${card.id}: Only the jazz, please`);
  assert.equal(stored.trace[0]?.error, null, 'show_card accepted the earlier source');
  assert.deepEqual(stored.cards.map((revised) => [revised.type, revised.title, revised.items.length]), [['plan', 'Shorter evening', 1]]);

  // Later turns see the refine request and name the cards by id.
  const history = historyContents([stored]);
  assert.equal(history[0]?.parts?.[0]?.text, `Change the plan ${card.id}: Only the jazz, please`);
  assert.match(history[1]?.parts?.[0]?.text ?? '', /\[card c_t_test_1 plan "Shorter evening": Jazz on the lane\]/);
});

test('without a refine card, an earlier plan\'s sources still need a search in this turn', async () => {
  const card = planCard('t_earlier');
  const llm = new ScriptedLlm([
    () => functionCall('show_card', { type: 'plan', title: 'Again', items: card.items }, usage(300, 30)),
    () => streamedText('I need to search first.', usage(400, 10)),
  ]);
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 8, tools: { features: fakeReader([]), grounding: null },
    clock: () => new Date('2026-10-10T07:40:00Z') });
  const stored = await runner.run(turnContext('same again'));
  assert.equal(stored.trace[0]?.error, 'unverified_sources');
  assert.deepEqual(stored.cards, []);
});

function planQuestions(turnId: string, about: string | undefined = `c_${turnId}_1`): Question[] {
  return [{ id: `q_${turnId}_1`, text: 'When will you leave?', options: ['Now', 'In an hour'], allowFreeText: true, ...(about === undefined ? {} : { planCardId: about }) },
    { id: `q_${turnId}_2`, text: 'How will you get there?', options: ['Walk', 'Drive'], allowFreeText: true, ...(about === undefined ? {} : { planCardId: about }) }];
}

test('after questions about a plan, the answer, several answers or a typed reply carries the stored plan to the runner', async () => {
  const seen: TurnContext[] = [];
  const plan = { cards: (id: string) => [planCard(id)], questions: (id: string) => planQuestions(id) };
  const { newSession, turn, lastTurnId, close } = await start(cardRunner(seen, [
    plan, { cards: () => [] }, plan, { cards: () => [] }, plan, { cards: () => [] },
    { cards: () => [], questions: (id: string) => planQuestions(id, undefined) }, { cards: () => [] },
  ]));
  try {
    const sessionId = await newSession();
    await turn(sessionId, { kind: 'text', text: 'Plan my evening' });
    let turnId = await lastTurnId(sessionId);
    assert.equal(seen.at(-1)?.planCard, undefined);
    const many = await turn(sessionId, { kind: 'answers', answers: [{ questionId: `q_${turnId}_1`, value: 'Now' }, { questionId: `q_${turnId}_2`, value: 'Drive' }] });
    assert.equal(many.status, 200);
    assert.deepEqual(seen.at(-1)?.planCard, planCard(turnId));

    await turn(sessionId, { kind: 'text', text: 'Plan my evening again' });
    turnId = await lastTurnId(sessionId);
    await turn(sessionId, { kind: 'answer', questionId: `q_${turnId}_2`, value: 'Drive' });
    assert.deepEqual(seen.at(-1)?.planCard, planCard(turnId));

    await turn(sessionId, { kind: 'text', text: 'One more plan' });
    turnId = await lastTurnId(sessionId);
    await turn(sessionId, { kind: 'text', text: 'We will take the car' });
    assert.deepEqual(seen.at(-1)?.planCard, planCard(turnId), 'a typed reply may answer too');

    // A question that is not about a plan brings no card.
    await turn(sessionId, { kind: 'text', text: 'Take me to the gardens' });
    await turn(sessionId, { kind: 'text', text: 'Fitzroy' });
    assert.equal(seen.at(-1)?.planCard, undefined);

    assert.equal((await turn(sessionId, { kind: 'answers', answers: [] })).status, 400);
    assert.equal((await turn(sessionId, { kind: 'answers', answers: [{ questionId: 'q_1', value: 'a' }, { questionId: 'q_1', value: 'b' }] })).status, 400,
      'one answer per question');
  } finally { await close(); }
});

const FRESH: StopParking = { checked_at: '2026-10-16T18:30:00+11:00', radius_m: 400, vacant: 4, occupied: 6, no_data: 1,
  bays: [{ feature_id: 'parking:kerbside:1', location: { lat: -37.8101, lng: 144.9627 }, distance_m: 80, walk_min: 1, reported_at: '2026-10-16T18:29:00+11:00' }],
  fee: '$7.10 an hour', time_limit: '2P', hours: null, payment: null, policy_scope: 'area', policy_url: 'https://example.org/fees' };

test('a saved plan refreshes the live parking of one stop, keeps it, and refuses stops it cannot place', async () => {
  const seen: TurnContext[] = [];
  const asked: { name: string; point: unknown; previous: unknown }[] = [];
  const located = (turnId: string): Card => ({ ...planCard(turnId), travel_mode: 'drive',
    items: [{ ...planCard(turnId).items[0]!, location: { lat: -37.8102, lng: 144.9628 } }, planCard(turnId).items[1]!] });
  const { call, newSession, turn, lastTurnId, save, close } = await start(cardRunner(seen, [{ cards: (id) => [located(id)] }]), {
    refreshParking: async (request) => { asked.push({ name: request.name, point: request.point, previous: request.previous }); return FRESH; } });
  try {
    const sessionId = await newSession();
    await turn(sessionId, { kind: 'text', text: 'Plan my evening by car' });
    const cardId = `c_${await lastTurnId(sessionId)}_1`;
    await save(sessionId, cardId);
    const refresh = (index: number, body: unknown = { part: 'parking' }, token = 'token-a', planId = cardId) =>
      call(`/v1/plans/${planId}/stops/${index}/refresh`, { method: 'POST', body: JSON.stringify(body) }, token);

    const response = await refresh(0);
    assert.equal(response.status, 200);
    const { plan } = await response.json() as { plan: SavedPlan };
    assert.deepEqual(plan.card.items[0]?.stop_parking, FRESH);
    assert.equal(plan.card.items[1]?.stop_parking, undefined);
    assert.deepEqual(asked, [{ name: 'Mahler 5', point: { lat: -37.8102, lng: 144.9628 }, previous: undefined }]);
    assert.deepEqual(((await (await call('/v1/plans')).json()) as { plans: SavedPlan[] }).plans[0], plan, 'the refreshed reading is kept');
    await refresh(0);
    assert.deepEqual(asked[1]?.previous, FRESH, 'the next refresh starts from the kept reading');

    const unplaced = await refresh(1);
    assert.equal(unplaced.status, 400);
    assert.equal(((await unplaced.json()) as { error: { messageKey: string } }).error.messageKey, 'agent.error.invalidRequest.no_location');
    assert.equal((await refresh(5)).status, 404);
    assert.equal((await refresh(0, { part: 'weather' })).status, 400);
    assert.equal((await refresh(0, {}, 'token-b')).status, 400);
    assert.equal((await refresh(0, { part: 'parking' }, 'token-b')).status, 404, 'another uid cannot refresh it');
    assert.equal((await refresh(0, { part: 'parking' }, 'token-a', 'c_t_nope_1')).status, 404);
    assert.equal(asked.length, 2, 'no refused refresh read the sensors');
  } finally { await close(); }

  const without = await start(cardRunner([], [{ cards: (id) => [{ ...planCard(id), items: [{ ...planCard(id).items[0]!, location: { lat: -37.81, lng: 144.96 } }] }] }]));
  try {
    const sessionId = await without.newSession();
    await without.turn(sessionId, { kind: 'text', text: 'Plan' });
    const cardId = `c_${await without.lastTurnId(sessionId)}_1`;
    await without.save(sessionId, cardId);
    const response = await without.call(`/v1/plans/${cardId}/stops/0/refresh`, { method: 'POST', body: JSON.stringify({ part: 'parking' }) });
    assert.equal(response.status, 503);
  } finally { await without.close(); }
});
