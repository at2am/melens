import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import type { z } from 'zod';

import { createMapAgentRunner } from '../src/agent/map-agent.js';
import { INSTRUCTION } from '../src/agent/prompts.js';
import type { StructuredModel } from '../src/agent/structured.js';
import { staticVerifier } from '../src/auth/verifier.js';
import { UserEventService } from '../src/events/service.js';
import { InMemoryUserEventStore } from '../src/events/store.js';
import { FeedService } from '../src/feeds/service.js';
import { InMemoryFeedStore } from '../src/feeds/store.js';
import { memoryBlock, userWords } from '../src/memory/prompt.js';
import { MEMORY_LIMITS, browsingSummary, decayed, emptyMemory, type MemoryFact } from '../src/memory/schemas.js';
import { MemoryService, applyChanges } from '../src/memory/service.js';
import { InMemoryMemoryStore } from '../src/memory/store.js';
import { PlanService } from '../src/plans/service.js';
import { InMemoryPlanStore } from '../src/plans/store.js';
import { AgentServiceError, zeroUsage } from '../src/protocol/schemas.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { createAgentHttpServer, type TurnContext, type TurnRunner } from '../src/server.js';
import { InMemorySessionStore } from '../src/sessions/store.js';
import { ScriptedLlm, fakeReader, streamedText, turnContext, usage } from './support.js';

const NOW = new Date('2026-10-17T07:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1_000;
const ORIGIN = 'http://localhost:8000';

const fact = (id: string, text: string, updatedAt = NOW.toISOString(), kind: MemoryFact['kind'] = 'interest'): MemoryFact =>
  ({ id, kind, text, updatedAt });

/** A memory model that answers from a script and records its prompts. */
function structuredModel(answers: unknown[]): StructuredModel & { readonly prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, async generate<S extends z.ZodType>(request: { prompt: string; schema: S }) {
    prompts.push(request.prompt);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('Unscripted structured call');
    return { value: request.schema.parse(answer) as z.output<S>, usage: usage(300, 20), model: 'gemini-test' };
  } };
}

const nothing = { add: [], update: [], remove: [] };

function service(options: { answers?: unknown[]; clock?: () => Date; writesPerHour?: number } = {}) {
  const store = new InMemoryMemoryStore();
  const structured = structuredModel(options.answers ?? []);
  const logs: Record<string, unknown>[] = [];
  const memory = new MemoryService({ store, structured, writeLimiter: createRateLimiter(options.writesPerHour ?? 100),
    clock: options.clock ?? (() => NOW), log: (line) => logs.push(line) });
  return { store, structured, memory, logs };
}

test('changes remove and update by id, ignore ids that are gone, skip duplicates and keep the newest facts when full', () => {
  const facts = [fact('m_a', 'Enjoys live jazz'), fact('m_b', 'Takes trams', NOW.toISOString(), 'travel')];
  const later = new Date(NOW.getTime() + 1_000);
  const next = applyChanges(facts, { add: [{ kind: 'interest', text: '  enjoys LIVE jazz ' }, { kind: 'preference', text: 'Prefers quiet cafés' }],
    update: [{ id: 'm_b', kind: 'travel', text: 'Drives into the city' }, { id: 'm_gone', kind: 'other', text: 'x' }], remove: ['m_a', 'm_none'] }, later);
  assert.deepEqual(next.map(({ kind, text }) => ({ kind, text })), [{ kind: 'travel', text: 'Drives into the city' },
    { kind: 'interest', text: 'enjoys LIVE jazz' }, { kind: 'preference', text: 'Prefers quiet cafés' }]);
  assert.equal(next[0]?.id, 'm_b');
  assert.equal(next[0]?.updatedAt, later.toISOString());

  const full = Array.from({ length: MEMORY_LIMITS.maxFacts }, (_, index) =>
    fact(`m_${index}`, `Fact ${index}`, new Date(NOW.getTime() - (MEMORY_LIMITS.maxFacts - index) * DAY_MS).toISOString()));
  const kept = applyChanges(full, { add: [{ kind: 'other', text: 'x'.repeat(400) }], update: [], remove: [] }, NOW);
  assert.equal(kept.length, MEMORY_LIMITS.maxFacts);
  assert.equal(kept[0]?.id, 'm_1', 'the fact changed longest ago made room');
  assert.equal(kept.at(-1)?.text.length, MEMORY_LIMITS.factChars);
});

test('browsing weights halve every half-life and the summary keeps the heaviest layers and categories', () => {
  const twoHalfLives = new Date(NOW.getTime() + 2 * MEMORY_LIMITS.halfLifeDays * DAY_MS);
  assert.deepEqual(decayed({ parking: 8, news: 0.1 }, NOW.toISOString(), twoHalfLives), { parking: 2 });
  const record = { ...emptyMemory(NOW), layers: { parking: 6, event: 3, news: 1 }, categories: { music: 4, sport: 1 }, browsedAt: NOW.toISOString() };
  assert.deepEqual(browsingSummary(record, NOW), { layers: [{ layer: 'parking', share: 0.6 }, { layer: 'event', share: 0.3 }], categories: ['music'] });
  assert.deepEqual(browsingSummary(record, twoHalfLives).layers, [], 'old browsing fades out of the summary');
});

test('signals add to the weights; switched off, the memory drops them and the agent gets no block', async () => {
  const { memory } = service();
  await memory.recordSignals('u', { signals: [{ kind: 'show', layer: 'parking' }, { kind: 'open', layer: 'parking' },
    { kind: 'open', layer: 'event', category: ' Music ' }, { kind: 'open', layer: 'community' }] });
  const view = await memory.view('u');
  assert.deepEqual(view.browsing, { layers: [{ layer: 'parking', share: 0.43 }], categories: ['music'] });
  assert.match(await memory.promptBlock('u') ?? '', /Often browses: parking \(43%\); event categories: music/);

  await memory.configure('u', { enabled: false });
  await memory.recordSignals('u', { signals: [{ kind: 'open', layer: 'news' }, { kind: 'open', layer: 'news' }] });
  assert.equal((await memory.view('u')).browsing.layers.some((entry) => entry.layer === 'news'), false);
  assert.equal(await memory.promptBlock('u'), null);

  await assert.rejects(memory.recordSignals('u', { signals: [{ kind: 'open', layer: 'nowhere' }] }), (error: AgentServiceError) => error.code === 'invalidRequest');
  await assert.rejects(memory.recordSignals('u', { signals: [{ kind: 'open', layer: 'news', lat: -37.8 }] }), (error: AgentServiceError) => error.code === 'invalidRequest',
    'signals carry no place');
});

test('learning reads the exchange with the memory, stores the changes and logs the call outside the turn', async () => {
  const { memory, structured, logs } = service({ answers: [
    { add: [{ kind: 'travel', text: 'Drives into the city' }], update: [], remove: [] },
    nothing,
  ] });
  await memory.learn('u', { turnId: 't_1', said: 'Answer to your question "How will you get around?": Drive', answer: 'Here is the plan.' });
  const [learned] = (await memory.view('u')).facts;
  assert.deepEqual({ kind: learned?.kind, text: learned?.text }, { kind: 'travel', text: 'Drives into the city' });
  assert.match(structured.prompts[0] ?? '', /User: Answer to your question "How will you get around\?": Drive/);
  assert.match(structured.prompts[0] ?? '', /\(nothing yet\)/);

  await memory.learn('u', { turnId: 't_2', said: 'what is on tonight?', answer: '' });
  assert.match(structured.prompts[1] ?? '', new RegExp(`${learned?.id} \\[travel\\] Drives into the city`));
  assert.equal((await memory.view('u')).facts.length, 1);
  assert.deepEqual(logs.map((line) => [line.event, line.changes, line.total]), [['memoryLearned', 1, 320], ['memoryLearned', 0, 320]]);

  assert.match(await memory.promptBlock('u') ?? '', /^User memory .*\n- Drives into the city \(travel\)$/);
});

test('learning stays quiet when memory is off and never throws when the model fails', async () => {
  const { memory, structured, logs } = service({ answers: [] });
  await memory.configure('u', { enabled: false });
  await memory.learn('u', { turnId: 't_1', said: 'I always cycle', answer: '' });
  assert.equal(structured.prompts.length, 0);
  await memory.configure('u', { enabled: true });
  await memory.learn('u', { turnId: 't_2', said: 'I always cycle', answer: '' });
  assert.equal(logs.at(-1)?.event, 'memoryLearnFailed');
});

test('a fact is deleted by id, clearing keeps the setting, and writes are rate limited', async () => {
  const { memory, store } = service({ writesPerHour: 4 });
  await store.update('u', () => ({ ...emptyMemory(NOW), enabled: false, facts: [fact('m_a', 'Enjoys live jazz'), fact('m_b', 'Has a dog')] }));
  await memory.removeFact('u', 'm_a');
  assert.deepEqual((await memory.view('u')).facts.map((entry) => entry.id), ['m_b']);
  await assert.rejects(memory.removeFact('u', 'm_a'), (error: AgentServiceError) => error.code === 'notFound');
  await memory.clear('u');
  assert.deepEqual(await memory.view('u'), { enabled: false, facts: [], browsing: { layers: [], categories: [] }, updatedAt: NOW.toISOString() });
  await memory.configure('u', { enabled: true });
  await assert.rejects(memory.clear('u'), (error: AgentServiceError) => error.code === 'rateLimited');
});

test('only the user\'s own words are learned from', () => {
  assert.equal(userWords({ kind: 'area', lat: -37.8, lng: 144.9 }, new Map()), null);
  assert.equal(userWords({ kind: 'analyse', featureId: 'anomaly:1' }, new Map()), null);
  assert.equal(userWords({ kind: 'text', text: '' }, new Map()), null);
  assert.equal(userWords({ kind: 'text', text: 'I drive in from Geelong' }, new Map()), 'I drive in from Geelong');
  assert.equal(memoryBlock({ enabled: true, facts: [], browsing: { layers: [], categories: [] }, updatedAt: null }), null);
});

test('the memory goes in the turn message after the map context, and the instruction stays the same for every user', async () => {
  const llm = new ScriptedLlm([() => streamedText('Since you usually drive, here is parking.', usage(120, 8))]);
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 16, tools: { features: fakeReader([]), grounding: null }, clock: () => NOW });
  const block = 'User memory (from earlier conversations and what they browse; use it, do not recite it)\n- Drives into the city (travel)';
  const turn: TurnContext = { ...turnContext('dinner in Carlton?'), memory: block };
  await runner.run(turn);
  const parts = llm.seen[0]?.contents.at(-1)?.parts ?? [];
  assert.match(parts[0]?.text ?? '', /^Map context/);
  assert.equal(parts[1]?.text, block);
  assert.equal(parts[2]?.text, 'dinner in Carlton?');
  assert.doesNotMatch(INSTRUCTION, /Drives into the city/);
});

async function start(answers: unknown[]) {
  const ran: TurnContext[] = [];
  const runner: TurnRunner = { async run(turn) {
    ran.push(turn);
    turn.sink.emit({ event: 'done', stop: 'end', usage: { ...zeroUsage(), complete: true } });
    return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input, attachments: [], text: 'Sure.', cards: [],
      uiActions: [], question: null, questions: [], stop: 'end', trace: [], usage: { ...zeroUsage(), complete: true, perCall: [] } };
  } };
  const sessions = new InMemorySessionStore();
  const { memory, structured, store } = service({ answers });
  const server = createAgentHttpServer({ store: sessions, runner, memory,
    events: new UserEventService({ store: new InMemoryUserEventStore(), writeLimiter: createRateLimiter(100) }),
    feeds: new FeedService({ store: new InMemoryFeedStore(), writeLimiter: createRateLimiter(100) }),
    plans: new PlanService({ store: new InMemoryPlanStore(), sessions, writeLimiter: createRateLimiter(100) }),
    verifier: staticVerifier({ 'token-a': 'uid-a', 'token-b': 'uid-b' }), rateLimiter: createRateLimiter(100), allowedOrigins: [ORIGIN], turnTimeoutMs: 5_000 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, init: RequestInit = {}, token = 'token-a') => fetch(`${base}${path}`, { ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.headers ?? {}) } });
  const close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return { call, close, ran, structured, store, memory };
}

const context = { viewport: { north: -37.80, south: -37.82, east: 144.98, west: 144.95 }, zoom: 15, layers: [], localTime: '2026-10-17T18:00:00+11:00' };

test('the memory routes show, switch, clear and delete per uid, and take browsing signals', async () => {
  const { call, close, store } = await start([]);
  try {
    assert.deepEqual(await (await call('/v1/memory')).json(), { memory: { enabled: true, facts: [], browsing: { layers: [], categories: [] }, updatedAt: null } });
    const signals = await call('/v1/memory/signals', { method: 'POST', body: JSON.stringify({ signals: [{ kind: 'open', layer: 'parking' }, { kind: 'show', layer: 'parking' }] }) });
    assert.equal(signals.status, 204);
    const shown = await (await call('/v1/memory')).json() as { memory: { browsing: unknown } };
    assert.deepEqual(shown.memory.browsing, { layers: [{ layer: 'parking', share: 1 }], categories: [] });
    assert.deepEqual((await (await call('/v1/memory', {}, 'token-b')).json() as { memory: { browsing: unknown } }).memory.browsing, { layers: [], categories: [] });

    await store.update('uid-a', (current) => ({ ...current!, facts: [fact('m_a', 'Enjoys live jazz')] }));
    assert.equal((await call('/v1/memory/facts/m_a', { method: 'DELETE' }, 'token-b')).status, 404);
    assert.equal((await call('/v1/memory/facts/m_a', { method: 'DELETE' })).status, 204);
    const off = await call('/v1/memory', { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    assert.equal(((await off.json()) as { memory: { enabled: boolean } }).memory.enabled, false);
    assert.equal((await call('/v1/memory', { method: 'PATCH', body: JSON.stringify({ enabled: 'no' }) })).status, 400);
    assert.equal((await call('/v1/memory', { method: 'DELETE' })).status, 204);
    assert.deepEqual((await store.get('uid-a'))?.layers, {});
  } finally { await close(); }
});

test('a turn reads the memory into its context and learns from what the user said, not from the map\'s entry points', async () => {
  const { call, close, ran, structured, memory } = await start([{ add: [{ kind: 'travel', text: 'Drives into the city' }], update: [], remove: [] }]);
  try {
    const session = ((await (await call('/v1/sessions', { method: 'POST' })).json()) as { session: { id: string } }).session.id;
    const turn = (input: unknown) => call(`/v1/sessions/${session}/turns`, { method: 'POST', body: JSON.stringify({ input, context }) }).then((response) => response.text());
    await turn({ kind: 'text', text: 'I drive in most weekends, where can I park near the MCG?' });
    // The update runs after the turn.
    await memory.idle('uid-a');
    assert.equal(ran[0]?.memory, undefined, 'nothing remembered before the first turn');
    assert.match(structured.prompts[0] ?? '', /User: I drive in most weekends/);
    assert.match(structured.prompts[0] ?? '', /Assistant: Sure\./);
    await turn({ kind: 'area', lat: -37.81, lng: 144.96 });
    await memory.idle('uid-a');
    assert.match(ran[1]?.memory ?? '', /- Drives into the city \(travel\)/);
    assert.equal(structured.prompts.length, 1, 'the area turn is not read');
  } finally { await close(); }
});
