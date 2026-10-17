import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import type { MapItem } from '@melens/shared/contracts/map-contract';
import type { LlmResponse } from '@google/adk';

import { createMapAgentRunner } from '../src/agent/map-agent.js';
import type { GroundingModel } from '../src/agent/grounding.js';
import { historyContents, instructionFor } from '../src/agent/prompts.js';
import type { StructuredModel } from '../src/agent/structured.js';
import { createMemoryCache } from '../src/cache.js';
import type { Card, Question, StopParking, StoredTurn } from '../src/protocol/schemas.js';
import { collectingSink } from '../src/protocol/sse.js';
import { toolSpecs, type ToolDependencies } from '../src/tools/catalog.js';
import { TurnRegistry, runTool } from '../src/tools/define.js';
import { refreshStopParking } from '../src/workflows/workflows.js';
import { CONTEXT, ScriptedLlm, eventItem, fakeReader, functionCall, streamedText, turnContext, usage } from './support.js';

const clock = () => new Date('2026-10-10T07:40:00Z');

function parkingItem(id: string, lng: number, lat: number, details: Record<string, unknown> = {}): MapItem {
  return { id: `parking:kerbside:${id}`, versionId: `v-${id}`, layerId: 'parking', kind: 'parking', title: `Parking sensor ${id}`,
    geometry: { type: 'Point', coordinates: [lng, lat] }, location: { precision: 'point', role: 'sensor', evidence: null },
    assertionKind: 'observation', lifecycle: 'active',
    time: { observedAt: null, reportedAt: null, validFrom: null, validTo: null, periodLabel: null, fetchedAt: null, sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId: 'melbourne.parking.sensors', url: null, attribution: 'City of Melbourne', versionRef: null }],
    details: { sensorId: `kerbside:${id}`, state: 'vacant', noDataReason: null, reading: 'current', lastReportedAt: '2026-10-10T07:38:00.000Z',
      statusChangedAt: '2026-10-10T07:30:00.000Z', zoneNumber: 7012, legalParking: 'unknown', mayBeObstructed: true, ...details } } as MapItem;
}

// Two stops near Melbourne Central; bays about 60 m, 150 m and 250 m north of the first.
const STOPS = [
  eventItem('event:1', 'Gallery late opening', 144.9628, -37.8102, '2026-10-10T08:30:00Z', '2026-10-10T09:30:00Z'),
  eventItem('event:2', 'Jazz on the lane', 144.9640, -37.8110, '2026-10-10T10:00:00Z', '2026-10-10T11:00:00Z'),
];
const BAYS = [
  parkingItem('occupied', 144.9628, -37.8098, { state: 'occupied' }),
  parkingItem('a', 144.9628, -37.80966),
  parkingItem('b', 144.9628, -37.8089),
  parkingItem('c', 144.9628, -37.8080),
];
const RULES_URL = 'https://www.melbourne.vic.gov.au/parking-fees';

function structuredModel(answers: unknown[]): StructuredModel & { readonly prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, async generate<S extends z.ZodType>(request: { prompt: string; schema: S }) {
    prompts.push(request.prompt);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('Unscripted structured call');
    return { value: request.schema.parse(answer) as z.output<S>, usage: usage(300, 60, 10), model: 'gemini-test' };
  } };
}

function grounding(): GroundingModel & { calls: number } {
  const model = { calls: 0, async ground() {
    model.calls += 1;
    return { answer: 'On-street parking costs $7.10 an hour.', sources: [{ title: 'City of Melbourne parking fees', url: RULES_URL }], places: [],
      searchEntryPoint: null, usage: usage(50, 20), model: 'gemini-test' };
  } };
  return model;
}

const RULES = { ref: 'W1', fee: '$7.10 an hour', time_limit: 'Mostly 1P to 2P', hours: 'Mon to Sat, 7:30 am to 6:30 pm', payment: 'PayStay app or meter' };

function registry(deps: ToolDependencies) {
  const sink = collectingSink('t_test');
  const turn = new TurnRegistry({ turnId: 't_test', uid: 'u', request: { input: { kind: 'text', text: 'x' }, context: CONTEXT }, sink,
    signal: new AbortController().signal, clock });
  const spec = (name: string) => toolSpecs(deps).find((candidate) => candidate.name === name)!;
  return { turn, sink, spec };
}

const planItems = [
  { title: 'Gallery late opening', source: { feature_id: 'event:1' }, getting_there: 'Drive from home' },
  { title: 'Jazz on the lane', source: { feature_id: 'event:2' }, location: { lat: -37.8110, lng: 144.9640 }, getting_there: '3 min drive' },
  { title: 'Dessert at Brunetti', source: { url: 'https://example.org/brunetti' }, getting_there: '5 min drive' },
];

test('a plan the user drives to shows the live parking near each located stop, read in a step of its own', async () => {
  const ground = grounding();
  const structured = structuredModel([RULES]);
  const deps: ToolDependencies = { features: fakeReader(BAYS), grounding: ground, structured, cache: createMemoryCache(clock) };
  const { turn, sink, spec } = registry(deps);
  turn.rememberFeatures(STOPS);
  turn.urls.add('https://example.org/brunetti');

  const result = await runTool(spec('show_card'), turn, { type: 'plan', title: 'Gallery and jazz by car', travel_mode: 'drive', items: planItems }) as
    { card_id: string; parking: { stop: string; vacant: number; nearest_vacant_m: number | null }[] };
  const card = turn.cards[0]!;
  assert.equal(card.travel_mode, 'drive');
  const first = card.items[0]!.stop_parking!;
  assert.deepEqual(card.items[0]!.location, { lat: -37.8102, lng: 144.9628 }, 'a stop placed from its feature keeps that point');
  assert.equal(first.checked_at, '2026-10-10T18:40:00+11:00');
  assert.equal(first.vacant, 3);
  assert.equal(first.occupied, 1);
  assert.deepEqual(first.bays.map((bay) => [bay.feature_id, bay.distance_m, bay.walk_min]),
    [['parking:kerbside:a', 60, 1], ['parking:kerbside:b', 145, 2], ['parking:kerbside:c', 245, 3]]);
  assert.equal(first.fee, '$7.10 an hour');
  assert.equal(first.policy_scope, 'area');
  assert.equal(first.policy_url, RULES_URL);
  assert.ok(card.items[1]!.stop_parking !== undefined);
  assert.equal(card.items[2]!.stop_parking, undefined, 'a stop with no place gets no parking');
  assert.equal(ground.calls, 1, 'stops in the same area share one lookup of the rules');
  assert.deepEqual(result.parking.map((stop) => stop.stop), ['Gallery late opening', 'Jazz on the lane']);
  assert.equal(result.parking[0]?.nearest_vacant_m, 60);

  // The parking read is a step of its own, inside the card's step, and the card follows it.
  const steps = sink.sent.flatMap((event) => event.event === 'status' ? [[event.tool, event.state]] : []);
  assert.deepEqual(steps, [['show_card', 'running'], ['plan_parking', 'running'], ['plan_parking', 'done'], ['show_card', 'done']]);
  assert.deepEqual(turn.trace.map((entry) => entry.tool), ['plan_parking', 'show_card']);
});

test('a walking plan has no parking, and a list ignores travel_mode', async () => {
  const deps: ToolDependencies = { features: fakeReader(BAYS), grounding: null };
  const { turn, spec } = registry(deps);
  turn.rememberFeatures(STOPS);
  await runTool(spec('show_card'), turn, { type: 'plan', title: 'On foot', travel_mode: 'walk', items: planItems.slice(0, 2) });
  await runTool(spec('show_card'), turn, { type: 'list', title: 'Places', travel_mode: 'drive', items: planItems.slice(0, 2) });
  assert.equal(turn.cards[0]!.travel_mode, 'walk');
  assert.equal(turn.cards[0]!.items.some((item) => item.stop_parking !== undefined), false);
  assert.equal(turn.cards[1]!.travel_mode, undefined);
  assert.equal(turn.cards[1]!.items.some((item) => item.stop_parking !== undefined), false);
  assert.equal(turn.trace.some((entry) => entry.tool === 'plan_parking'), false);
});

test('after a plan the agent may ask up to three questions about it; otherwise one per turn', async () => {
  const deps: ToolDependencies = { features: fakeReader([]), grounding: null };
  const plain = registry(deps);
  await runTool(plain.spec('ask_user'), plain.turn, { question: 'Which gardens?', options: ['Fitzroy', 'Carlton'] });
  const second = await runTool(plain.spec('ask_user'), plain.turn, { question: 'And when?', options: ['Now', 'Later'] });
  assert.equal((second as { error: { code: string } }).error.code, 'invalid_arguments');
  assert.equal(plain.turn.questions.length, 1);
  assert.equal(plain.turn.asked?.planCardId, undefined);

  const planned = registry(deps);
  planned.turn.rememberFeatures(STOPS);
  await runTool(planned.spec('show_card'), planned.turn, { type: 'plan', title: 'Evening', items: planItems.slice(0, 2) });
  const asks = [['When will you leave?', ['Now', 'In an hour', '7 pm']], ['How long do you have?', ['1 hour', '2 to 3 hours']],
    ['How will you get there?', ['Walk', 'Public transport', 'Drive']], ['Anything else?', ['No', 'Yes']]] as const;
  const results = [];
  for (const [question, options] of asks) results.push(await runTool(planned.spec('ask_user'), planned.turn, { question, options }));
  assert.deepEqual(planned.turn.questions.map((question) => [question.id, question.planCardId]),
    [['q_t_test_1', 'c_t_test_1'], ['q_t_test_2', 'c_t_test_1'], ['q_t_test_3', 'c_t_test_1']]);
  assert.equal((results[3] as { error: { code: string } }).error.code, 'invalid_arguments');
  const sent = planned.sink.sent.flatMap((event) => event.event === 'question' ? [event.question.text] : []);
  assert.deepEqual(sent, ['When will you leave?', 'How long do you have?', 'How will you get there?']);
});

test('before a plan the agent asks up to three questions for it, and the answers ask for the plan at once', async () => {
  const deps: ToolDependencies = { features: fakeReader([]), grounding: null };
  const { turn, spec } = registry(deps);
  const asks = [['When will you leave?', ['Now', 'In an hour']], ['How long do you have?', ['1 hour', '2 to 3 hours']],
    ['How will you get around?', ['Walk', 'Drive']], ['Anything else?', ['No', 'Yes']]] as const;
  const results = [];
  for (const [question, options] of asks) results.push(await runTool(spec('ask_user'), turn, { question, options, for_plan: true }));
  assert.deepEqual(turn.questions.map((question) => [question.id, question.planCardId, question.forPlan]),
    [['q_t_test_1', undefined, true], ['q_t_test_2', undefined, true], ['q_t_test_3', undefined, true]]);
  assert.equal((results[3] as { error: { code: string } }).error.code, 'invalid_arguments');

  const pending = (question: Question) => instructionFor(question).split('Pending question')[1] ?? '';
  assert.match(pending(turn.questions[0]!), /make the plan now \(Answers before a plan\)/);
  assert.match(pending({ ...turn.questions[0]!, planCardId: 'c_t_0_1' }), /revise that plan once for all the answers/);
  assert.doesNotMatch(pending({ id: 'q_1', text: 'Which gardens?', options: ['Fitzroy', 'Carlton'], allowFreeText: true }), /plan now|revise that plan/);
});

test('a plan turn may only ask: its questions come together, without a card, and the history says they are for a plan', async () => {
  const llm = new ScriptedLlm([
    () => calls([['ask_user', { question: 'How long do you have?', options: ['1 hour', '2 to 3 hours'], for_plan: true }],
      ['ask_user', { question: 'How will you get around?', options: ['Walk', 'Public transport', 'Drive'], for_plan: true }]]),
    () => streamedText('never sent', usage(1, 1)),
  ]);
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 8, tools: { features: fakeReader(STOPS), grounding: null }, clock });
  const stored = await runner.run(turnContext('Plan something fun for tonight'));
  assert.equal(stored.stop, 'asked');
  assert.equal(llm.seen.length, 1, 'asking ends the turn');
  assert.deepEqual(stored.cards, []);
  assert.deepEqual(stored.questions.map((question) => [question.text, question.forPlan, question.planCardId]),
    [['How long do you have?', true, undefined], ['How will you get around?', true, undefined]]);
  const history = historyContents([stored]);
  assert.match(history[1]?.parts?.[0]?.text ?? '', /asked: "How will you get around\?" options \["Walk","Public transport","Drive"\] for a plan/);
});

test('while a turn changes a plan, its questions are about that plan and the plan card it shows revises it', async () => {
  const deps: ToolDependencies = { features: fakeReader([]), grounding: null };
  const base: Card = { id: 'c_t_0_1', type: 'plan', title: 'Your evening', items: [planItems[1]!] };
  const changing = registry(deps);
  changing.turn.rememberCard(base);
  changing.turn.basePlan = base;
  await runTool(changing.spec('ask_user'), changing.turn, { question: 'Later by how much?', options: ['An hour', 'Two hours'] });
  await runTool(changing.spec('ask_user'), changing.turn, { question: 'Still on foot?', options: ['Yes', 'No'] });
  assert.deepEqual(changing.turn.questions.map((question) => [question.planCardId, question.forPlan]), [['c_t_0_1', true], ['c_t_0_1', true]]);

  const revising = registry(deps);
  revising.turn.rememberCard(base);
  revising.turn.basePlan = base;
  await runTool(revising.spec('show_card'), revising.turn, { type: 'plan', title: 'Later evening', items: base.items });
  await runTool(revising.spec('show_card'), revising.turn, { type: 'list', title: 'Also nearby', items: base.items });
  assert.deepEqual(revising.turn.cards.map((card) => [card.type, card.revises]), [['plan', 'c_t_0_1'], ['list', undefined]]);

  const fresh = registry(deps);
  fresh.turn.rememberCard(base);
  await runTool(fresh.spec('show_card'), fresh.turn, { type: 'plan', title: 'New evening', items: base.items });
  assert.equal(fresh.turn.cards[0]!.revises, undefined, 'a new plan revises nothing');
});

/** One model response that calls several tools, as Gemini does for parallel calls. */
function calls(list: [string, Record<string, unknown>][]): LlmResponse[] {
  return [{ content: { role: 'model', parts: list.map(([name, args]) => ({ functionCall: { name, args } })) }, partial: false, usageMetadata: {} },
    { partial: false, usageMetadata: usage(500, 40) }];
}

test('a plan turn shows the plan, then asks its questions together and stops; the stored turn keeps them all', async () => {
  const llm = new ScriptedLlm([
    () => functionCall('search_features', { query: 'evening', area: { center: { lat: -37.8102, lng: 144.9628 }, radius_m: 800 }, layers: ['event'] }, usage(300, 30)),
    () => functionCall('show_card', { type: 'plan', title: 'Your evening', items: planItems.slice(0, 2) }, usage(400, 60),
      'Assuming you leave now and walk.'),
    () => calls([['ask_user', { question: 'When will you leave?', options: ['Now', 'In an hour'] }],
      ['ask_user', { question: 'How will you get there?', options: ['Walk', 'Public transport', 'Drive'] }]]),
    () => streamedText('never sent', usage(1, 1)),
  ]);
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 8, tools: { features: fakeReader(STOPS), grounding: null }, clock });
  const stored = await runner.run(turnContext('Plan something fun for tonight'));
  assert.equal(stored.stop, 'asked');
  assert.equal(llm.seen.length, 3, 'asking ends the turn');
  assert.deepEqual(stored.questions.map((question) => [question.text, question.planCardId]),
    [['When will you leave?', stored.cards[0]!.id], ['How will you get there?', stored.cards[0]!.id]]);
  assert.equal(stored.question?.id, stored.questions[0]!.id);
  const history = historyContents([stored]);
  assert.match(history[1]?.parts?.[0]?.text ?? '', /asked: "How will you get there\?" options \["Walk","Public transport","Drive"\] about c_t_test_1/);
});

test('answers about a plan reach the model with their questions and the whole plan, without the old parking reading', async () => {
  const parking: StopParking = { checked_at: '2026-10-10T18:00:00+11:00', radius_m: 400, vacant: 2, occupied: 1, no_data: 0, bays: [],
    fee: null, time_limit: null, hours: null, payment: null, policy_scope: 'unknown', policy_url: null };
  const plan: Card = { id: 'c_t_0_1', type: 'plan', title: 'Your evening', travel_mode: 'walk',
    items: [{ ...planItems[1]!, stop_parking: parking }] };
  const questions = [
    { id: 'q_t_0_1', text: 'When will you leave?', options: ['Now', 'In an hour'], allowFreeText: true, planCardId: plan.id },
    { id: 'q_t_0_2', text: 'How will you get there?', options: ['Walk', 'Drive'], allowFreeText: true, planCardId: plan.id },
  ];
  const earlier: StoredTurn = { id: 't_0', seq: 1, createdAt: '2026-10-10T07:30:00.000Z', input: { kind: 'text', text: 'Plan my evening' },
    attachments: [], text: '', cards: [plan], uiActions: [], question: questions[0]!, questions, stop: 'asked', trace: [],
    usage: { calls: 1, input: 1, cachedInput: 0, output: 1, thoughts: 0, toolUseInput: 0, total: 2, complete: true, perCall: [] } };
  const llm = new ScriptedLlm([() => streamedText('Driving it is.', usage(80, 5))]);
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 8, tools: { features: fakeReader([]), grounding: null }, clock });
  const input = { kind: 'answers' as const, answers: [{ questionId: 'q_t_0_2', value: 'Drive' }, { questionId: 'q_t_0_1', value: 'In an hour' }] };
  await runner.run({ ...turnContext('', { input, history: [earlier], pendingQuestion: questions[0]! }), planCard: plan });
  const parts = llm.seen[0]!.contents.at(-1)!.parts!;
  assert.match(parts[1]?.text ?? '', /^Current plan/);
  assert.match(parts[1]?.text ?? '', /"travel_mode":"walk"/);
  assert.doesNotMatch(parts[1]?.text ?? '', /stop_parking/);
  assert.equal(parts[2]?.text, 'Answers to your questions:\n- "How will you get there?": Drive\n- "When will you leave?": In an hour');
});

test('refreshing a stop reads the sensors again and keeps the area rules it already had', async () => {
  const ground = grounding();
  const deps: ToolDependencies = { features: fakeReader(BAYS.slice(0, 2)), grounding: ground, structured: structuredModel([RULES]), cache: createMemoryCache(clock) };
  const later = () => new Date('2026-10-10T08:15:00Z');
  const previous: StopParking = { checked_at: '2026-10-10T18:40:00+11:00', radius_m: 400, vacant: 3, occupied: 1, no_data: 0, bays: [],
    fee: '$7.10 an hour', time_limit: 'Mostly 1P to 2P', hours: null, payment: null, policy_scope: 'area', policy_url: RULES_URL };
  const point = { lat: -37.8102, lng: 144.9628 };
  const kept = await refreshStopParking(deps, { uid: 'u', point, name: 'Gallery late opening', previous, signal: new AbortController().signal, clock: later });
  assert.equal(kept.checked_at, '2026-10-10T19:15:00+11:00');
  assert.equal(kept.vacant, 1);
  assert.equal(kept.radius_m, 800, 'few free bays: it looked further');
  assert.deepEqual(kept.bays.map((bay) => bay.feature_id), ['parking:kerbside:a']);
  assert.equal(kept.fee, '$7.10 an hour');
  assert.equal(ground.calls, 0, 'the rules were kept, so no web search');

  const fresh = await refreshStopParking(deps, { uid: 'u', point, name: 'Gallery late opening', signal: new AbortController().signal, clock: later });
  assert.equal(ground.calls, 1, 'a stop without rules looks them up');
  assert.equal(fresh.policy_url, RULES_URL);
});
