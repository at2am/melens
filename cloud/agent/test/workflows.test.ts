import assert from 'node:assert/strict';
import test from 'node:test';
import type { z } from 'zod';
import type { MapItem } from '@melens/shared/contracts/map-contract';

import { createMapAgentRunner } from '../src/agent/map-agent.js';
import type { GroundingModel } from '../src/agent/grounding.js';
import type { StructuredModel } from '../src/agent/structured.js';
import { createMemoryCache } from '../src/cache.js';
import type { RoutesClient } from '../src/routes/routes-client.js';
import { RouteNotFoundError } from '../src/routes/routes-client.js';
import { toolSpecs, type ToolDependencies } from '../src/tools/catalog.js';
import { TurnRegistry, buildTool, runTool } from '../src/tools/define.js';
import { collectingSink } from '../src/protocol/sse.js';
import { CONTEXT, ScriptedLlm, anomalyItem, eventItem, fakeReader, functionCall, streamedText, turnContext, usage } from './support.js';

const EVENTS = [
  eventItem('event:1', 'Mahler 5', 144.9683, -37.8211, '2026-10-10T08:30:00Z', '2026-10-10T10:30:00Z'),
  eventItem('event:2', 'Jazz on the lane', 144.9660, -37.8150, '2026-10-10T09:00:00Z', '2026-10-10T12:00:00Z'),
];
const clock = () => new Date('2026-10-10T07:40:00Z');

function registry(deps: ToolDependencies, input: { kind: 'text'; text: string } | { kind: 'area'; lat: number; lng: number } = { kind: 'text', text: 'x' }) {
  const sink = collectingSink('t_test');
  const turn = new TurnRegistry({ turnId: 't_test', uid: 'u', request: { input, context: CONTEXT }, sink, signal: new AbortController().signal, clock });
  const spec = (name: string) => toolSpecs(deps).find((candidate) => candidate.name === name)!;
  return { turn, sink, spec };
}

/** A structured model that answers from a script and records its prompts. */
function structuredModel(answers: unknown[]): StructuredModel & { readonly prompts: string[] } {
  const prompts: string[] = [];
  return { prompts, async generate<S extends z.ZodType>(request: { prompt: string; schema: S }) {
    prompts.push(request.prompt);
    const answer = answers.shift();
    if (answer === undefined) throw new Error('Unscripted structured call');
    return { value: request.schema.parse(answer) as z.output<S>, usage: usage(300, 60, 10), model: 'gemini-test' };
  } };
}

const grounding = (sources: { title: string; url: string }[] = [{ title: 'Visit Melbourne', url: 'https://example.org/visit' }]): GroundingModel & { calls: number } => {
  const model = { calls: 0, async ground() { model.calls += 1; return { answer: 'A lively arts precinct.', sources, places: [], searchEntryPoint: null, usage: usage(50, 20), model: 'gemini-test' }; } };
  return model;
};

test('draw_route sends the polyline to the app, returns only the numbers to the model, and maps a missing route to route_not_found', async () => {
  const computed: { waypoints: unknown; mode: string }[] = [];
  const routes: RoutesClient = { async compute({ waypoints, mode }) {
    computed.push({ waypoints, mode });
    if (waypoints.length === 3) throw new RouteNotFoundError();
    return { distance_m: 3400, duration_min: 46, legs: [{ from: 0, to: 1, duration_min: 46, distance_m: 3400 }], polyline: '_p~iF~ps|U_ulLnnqC' };
  } };
  const deps: ToolDependencies = { features: fakeReader(EVENTS), grounding: null, routes };
  const { turn, sink, spec } = registry(deps);
  turn.rememberFeatures([EVENTS[0]!]);
  const ok = await runTool(spec('draw_route'), turn, { waypoints: [{ lat: -37.8136, lng: 144.9631 }, { feature_id: 'event:1' }], mode: 'walk' });
  assert.deepEqual(ok, { distance_m: 3400, duration_min: 46, legs: [{ from: 0, to: 1, duration_min: 46 }], drawn: true });
  const action = sink.sent.find((event) => event.event === 'ui_action');
  assert.equal(action?.event === 'ui_action' && action.action, 'draw_route');
  assert.deepEqual(action?.event === 'ui_action' && action.args, { polyline: '_p~iF~ps|U_ulLnnqC', mode: 'walk', distance_m: 3400, duration_min: 46,
    waypoints: [{ lat: -37.8136, lng: 144.9631 }, { lat: -37.8211, lng: 144.9683, label: 'Mahler 5' }] });
  assert.equal(turn.uiActions.length, 1);
  const undrawn = await runTool(spec('draw_route'), turn, { waypoints: [{ lat: -37.81, lng: 144.96 }, { lat: -37.82, lng: 144.97 }], mode: 'walk', draw: false });
  assert.equal((undrawn as { drawn: boolean }).drawn, false);
  assert.equal(turn.uiActions.length, 1, 'draw false sends nothing to the map');
  const missing = await runTool(spec('draw_route'), turn, { waypoints: [{ lat: -37.81, lng: 144.96 }, { lat: -37.815, lng: 144.965 }, { lat: -37.82, lng: 144.97 }], mode: 'walk' });
  assert.equal((missing as { error: { code: string } }).error.code, 'route_not_found');
  const transit = await runTool(spec('draw_route'), turn, { waypoints: [{ lat: -37.81, lng: 144.96 }, { lat: -37.815, lng: 144.965 }, { lat: -37.82, lng: 144.97 }], mode: 'transit' });
  assert.equal((transit as { error: { code: string } }).error.code, 'invalid_arguments', 'transit takes exactly two waypoints');
  const unknown = await runTool(spec('draw_route'), turn, { waypoints: [{ lat: -37.81, lng: 144.96 }, { feature_id: 'event:nope' }], mode: 'walk' });
  assert.equal((unknown as { error: { code: string } }).error.code, 'not_found');
});

test('get_feature, focus_map and highlight_features resolve a feature the user can see even if this turn never searched for it', async () => {
  const anomaly = anomalyItem('anomaly:41-h18', 'Flinders La-Swanston St (West)', 144.9654, -37.8166);
  const deps: ToolDependencies = { features: fakeReader([anomaly]), grounding: null };
  const { turn, sink, spec } = registry(deps);
  const got = await runTool(spec('get_feature'), turn, { id: 'anomaly:41-h18' }) as { item: { id: string } };
  assert.equal(got.item.id, 'anomaly:41-h18');
  const fresh = registry(deps);
  const focus = await runTool(fresh.spec('focus_map'), fresh.turn, { target: { feature_id: 'anomaly:41-h18' } });
  assert.deepEqual(focus, { ok: true });
  const highlighted = await runTool(fresh.spec('highlight_features'), fresh.turn, { ids: ['anomaly:41-h18', 'anomaly:gone'] });
  assert.deepEqual(highlighted, { ok: true, missing: ['anomaly:gone'] });
  assert.deepEqual(fresh.turn.uiActions.at(-1)?.args, { ids: ['anomaly:41-h18'], clear_previous: true, missing: ['anomaly:gone'],
    titles: { 'anomaly:41-h18': 'Flinders La-Swanston St (West)' } });
  const numbers = await runTool(spec('get_anomaly'), turn, { feature_id: 'anomaly:41-h18' }) as { observed: number; baseline: number; change_pct: number; direction: string };
  assert.deepEqual([numbers.observed, numbers.baseline, numbers.change_pct, numbers.direction], [4210, 1830, 130, 'higher']);
  const notOne = await runTool(spec('get_anomaly'), registry(deps).turn, { feature_id: 'event:never' }) as { error: { code: string } };
  assert.equal(notOne.error.code, 'not_found');
  const none = await runTool(spec('get_feature'), turn, { id: 'event:never' }) as { error: { code: string } };
  assert.equal(none.error.code, 'not_found');
  assert.ok(sink.sent.length > 0);
});

test('area_brief builds a card from layer features and search sources, drops items without a source, and serves the second request from the cache', async () => {
  const structured = structuredModel([
    { character: 'A lively arts precinct on the Yarra.', places: [{ ref: 'W3', name: 'Arts precinct', reason: 'Galleries and venues close together.' }, { ref: 'F99', name: 'Invented bar', reason: 'Made up.' }],
      activities: [{ ref: 'F2', name: 'Mahler 5', reason: 'Tonight at Hamer Hall.' }, { ref: 'W3', name: 'Not an event', reason: 'No time, so it cannot be an activity.' }] },
  ]);
  const ground = grounding();
  const deps: ToolDependencies = { features: fakeReader(EVENTS), grounding: ground, structured, cache: createMemoryCache(clock) };
  const first = registry(deps);
  const result = await runTool(first.spec('area_brief'), first.turn, { point: { lat: -37.8136, lng: 144.9631 }, radius_m: 1500 }) as { card_id: string; summary: string };
  assert.match(result.card_id, /^c_t_test_1$/);
  const card = first.turn.cards[0]!;
  assert.equal(card.type, 'area_brief');
  assert.equal(card.intro, 'A lively arts precinct on the Yarra.');
  assert.equal(card.items.length, 2, 'the invented reference and the untimed activity are dropped');
  assert.deepEqual(card.items.map((item) => item.title), ['Arts precinct', 'Mahler 5']);
  assert.deepEqual(card.items[0]?.source, { url: 'https://example.org/visit', title: 'Visit Melbourne' });
  assert.deepEqual(card.items[1]?.source, { feature_id: 'event:1' });
  assert.ok(card.items[1]?.time?.from);
  assert.match(card.items[1]?.getting_there ?? '', /min walk/);
  assert.match(result.summary, /Mahler 5 \(event:1\)/);
  assert.equal(first.turn.usage.calls, 2, 'the grounded answer and the one generation are both reported');
  // The same area and day for another user: no model calls at all, a card of its own.
  const second = registry(deps);
  const again = await runTool(second.spec('area_brief'), second.turn, { point: { lat: -37.8137, lng: 144.9632 }, radius_m: 1500 }) as { card_id: string };
  assert.equal(again.card_id, 'c_t_test_1');
  assert.equal(second.turn.usage.calls, 0);
  assert.equal(structured.prompts.length, 1);
  assert.equal(ground.calls, 1);
  assert.ok(second.turn.featureIds.has('event:1'), 'cached sources are registered for this turn');
});

test('area_brief with nothing around returns a summary and no card', async () => {
  const deps: ToolDependencies = { features: fakeReader([]), grounding: null, structured: structuredModel([]) };
  const { turn, spec } = registry(deps);
  const result = await runTool(spec('area_brief'), turn, { point: { lat: -37.8136, lng: 144.9631 } }) as { card_id: string | null };
  assert.equal(result.card_id, null);
  assert.equal(turn.cards.length, 0);
});

test('analyse_anomaly writes possible causes with confidence and sources, and an anomaly with no explanation says so without inventing one', async () => {
  const anomaly = anomalyItem('anomaly:41-h18', 'Flinders La-Swanston St (West)', 144.9654, -37.8166);
  const structured = structuredModel([{ headline: 'Foot traffic is 130% higher than usual near Flinders Lane.',
    causes: [{ ref: 'F2', cause: 'Mahler 5 at Hamer Hall', confidence: 'medium', reason: 'A large concert started nearby that evening.' },
      { ref: 'X7', cause: 'Unsourced rumour', confidence: 'high', reason: 'x' }, { ref: 'F99', cause: 'Invented', confidence: 'low', reason: 'x' }] }]);
  const deps: ToolDependencies = { features: fakeReader([anomaly, ...EVENTS]), grounding: grounding([]), structured, cache: createMemoryCache(clock) };
  const { turn, spec } = registry(deps);
  const result = await runTool(spec('analyse_anomaly'), turn, { feature_id: 'anomaly:41-h18' }) as { card_id: string; summary: string };
  const card = turn.cards[0]!;
  assert.equal(card.type, 'anomaly_analysis');
  assert.match(card.intro ?? '', /130% higher/);
  assert.equal(card.items[0]?.title, 'Mahler 5 at Hamer Hall');
  assert.match(card.items[0]?.summary ?? '', /^Confidence medium\./);
  assert.deepEqual(card.items[0]?.source, { feature_id: 'event:1' });
  assert.ok(!card.items.some((item) => item.title === 'Invented' || item.title === 'Unsourced rumour'));
  assert.match(result.summary, /Possible causes/);
  assert.match(structured.prompts[0] ?? '', /4210 people counted against a usual 1830/);

  const quiet: ToolDependencies = { features: fakeReader([anomaly]), grounding: grounding([]), structured: structuredModel([]), cache: createMemoryCache(clock) };
  const none = registry(quiet);
  await runTool(none.spec('analyse_anomaly'), none.turn, { feature_id: 'anomaly:41-h18' });
  assert.equal(none.turn.cards[0]?.items[0]?.title, 'No clear cause found');
  assert.deepEqual(none.turn.cards[0]?.items[0]?.source, { feature_id: 'anomaly:41-h18' });
  assert.equal(none.turn.usage.calls, 1, 'only the grounded search ran: nothing to explain it with, so no generation');

  // When the web search could not answer, the card says the analysis is incomplete and is not shared through the cache.
  const blind: ToolDependencies = { features: fakeReader([anomaly]), grounding: null, structured: structuredModel([]), cache: createMemoryCache(clock) };
  const incomplete = registry(blind);
  await runTool(incomplete.spec('analyse_anomaly'), incomplete.turn, { feature_id: 'anomaly:41-h18' });
  assert.equal(incomplete.turn.cards[0]?.items[0]?.title, 'Analysis incomplete');
  const again = registry(blind);
  await runTool(again.spec('analyse_anomaly'), again.turn, { feature_id: 'anomaly:41-h18' });
  assert.equal(again.turn.cards.length, 1, 'recomputed, not served from the cache');

  const notAnomaly = registry({ features: fakeReader(EVENTS), grounding: null, structured: structuredModel([]) });
  const wrong = await runTool(notAnomaly.spec('analyse_anomaly'), notAnomaly.turn, { feature_id: 'event:1' }) as { error: { code: string } };
  assert.equal(wrong.error.code, 'not_an_anomaly');
});

test('a map tap and the Analyse button run their workflow without a chat model call; no card falls back to the loop', async () => {
  const anomaly = anomalyItem('anomaly:41-h18', 'Flinders La-Swanston St (West)', 144.9654, -37.8166);
  const structured = structuredModel([{ headline: 'Higher than usual.', causes: [{ ref: 'F1', cause: 'Mahler 5', confidence: 'medium', reason: 'Concert nearby.' }] }]);
  const llm = new ScriptedLlm([]);
  const run = createMapAgentRunner({ model: llm, maxModelCalls: 16, clock, tools: { features: fakeReader([anomaly, ...EVENTS]), grounding: null, structured } });
  const turn = turnContext('', { input: { kind: 'analyse', featureId: 'anomaly:41-h18' } });
  const stored = await run.run(turn);
  assert.equal(llm.seen.length, 0, 'the chat model is never called');
  assert.deepEqual(turn.sink.sent.map((event) => event.event), ['status', 'usage', 'card', 'status', 'done']);
  assert.equal(stored.cards[0]?.type, 'anomaly_analysis');
  assert.equal(stored.stop, 'end');
  assert.equal(stored.usage.calls, 1);
  assert.equal(stored.trace[0]?.tool, 'analyse_anomaly');

  const fallbackLlm = new ScriptedLlm([() => streamedText('Nothing is recorded here.', usage(100, 10))]);
  const fallback = createMapAgentRunner({ model: fallbackLlm, maxModelCalls: 16, clock, tools: { features: fakeReader([]), grounding: null, structured: structuredModel([]) } });
  const areaTurn = turnContext('', { input: { kind: 'area', lat: -37.8136, lng: 144.9631 } });
  const areaStored = await fallback.run(areaTurn);
  assert.equal(fallbackLlm.seen.length, 1, 'with no card from the workflow the loop answers');
  assert.equal(areaStored.text, 'Nothing is recorded here.');
  assert.match(fallbackLlm.seen[0]?.contents.at(-1)?.parts?.[1]?.text ?? '', /selected the point/);
});

test('grounded answers are shared through the cache by tool, question, place cell and date', async () => {
  const ground = grounding();
  const deps: ToolDependencies = { features: fakeReader([]), grounding: ground, cache: createMemoryCache(clock) };
  for (let i = 0; i < 2; i += 1) {
    const { turn, spec } = registry(deps);
    const result = await runTool(spec('search_grounding'), turn, { question: '  What time does the FREE tram zone end? ' }) as { sources: { url: string }[] };
    assert.equal(result.sources[0]?.url, 'https://example.org/visit');
    assert.ok(turn.urls.has('https://example.org/visit'), 'a cached answer still registers its sources for show_card');
  }
  assert.equal(ground.calls, 1);
  void buildTool;
});

function parkingItem(id: string, lng: number, lat: number, details: Record<string, unknown> = {}): MapItem {
  return { id: `parking:kerbside:${id}`, versionId: `v-${id}`, layerId: 'parking', kind: 'parking', title: `Parking sensor ${id}`,
    geometry: { type: 'Point', coordinates: [lng, lat] }, location: { precision: 'point', role: 'sensor', evidence: null },
    assertionKind: 'observation', lifecycle: 'active',
    time: { observedAt: null, reportedAt: null, validFrom: null, validTo: null, periodLabel: null, fetchedAt: null, sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId: 'melbourne.parking.sensors', url: null, attribution: 'City of Melbourne', versionRef: null }],
    details: { sensorId: `kerbside:${id}`, state: 'vacant', noDataReason: null, reading: 'current', lastReportedAt: '2026-10-10T07:38:00.000Z',
      statusChangedAt: '2026-10-10T07:30:00.000Z', zoneNumber: 7012, legalParking: 'unknown', mayBeObstructed: true, ...details } } as MapItem;
}

// Melbourne Central is the destination; bays sit about 60 m, 150 m, 250 m and 600 m away.
const DESTINATION = { lat: -37.8102, lng: 144.9628 };
const BAYS = [
  parkingItem('near-occupied', 144.9628, -37.8098, { state: 'occupied' }),
  parkingItem('near-stale', 144.9630, -37.8100, { state: 'noData', noDataReason: 'notReporting', reading: 'stale' }),
  parkingItem('a', 144.9628, -37.80966),
  parkingItem('late', 144.9628, -37.8089, { reading: 'late' }),
  parkingItem('b', 144.9628, -37.8080),
  parkingItem('far', 144.9628, -37.8048),
];

test('find_parking moves the map to the nearest vacant bay, highlights the candidates and shows each bay with its distance and the area rules', async () => {
  const structured = structuredModel([{ ref: 'W1', fee: '$7.10 an hour', time_limit: 'Mostly 1P to 2P', hours: 'Mon to Sat, 7:30 am to 6:30 pm',
    payment: 'PayStay app or meter' }]);
  const ground = grounding([{ title: 'City of Melbourne parking fees', url: 'https://www.melbourne.vic.gov.au/parking-fees' }]);
  const deps: ToolDependencies = { features: fakeReader(BAYS), grounding: ground, structured, cache: createMemoryCache(clock) };
  const { turn, sink, spec } = registry(deps);
  const result = await runTool(spec('find_parking'), turn, { destination: DESTINATION, destination_name: 'Melbourne Central' }) as
    { card_id: string; focused_on: string; bays: { id: string }[] };
  assert.equal(result.focused_on, 'parking:kerbside:a');
  // Three bays read vacant within 400 m, so it does not widen; the late reading ranks after a current bay 100 m further.
  assert.deepEqual(result.bays.map((bay) => bay.id), ['parking:kerbside:a', 'parking:kerbside:b', 'parking:kerbside:late']);
  const actions = sink.sent.flatMap((event) => event.event === 'ui_action' ? [event] : []);
  assert.deepEqual(actions.map((action) => action.action), ['show_layers', 'focus_map', 'highlight_features']);
  assert.deepEqual(actions[0]?.args, { layers: ['parking'], mode: 'add' });
  assert.deepEqual(actions[1]?.args, { target: { point: { lat: -37.80966, lng: 144.9628 }, feature_id: 'parking:kerbside:a' }, zoom: 18 });
  assert.deepEqual((actions[2]?.args as { ids: string[] }).ids, result.bays.map((bay) => bay.id));
  // The map moves before the card arrives, so the user sees the bay while the rules are still being looked up.
  assert.ok(sink.sent.findIndex((event) => event.event === 'ui_action') < sink.sent.findIndex((event) => event.event === 'card'));
  const card = turn.cards[0]!;
  assert.equal(card.title, 'Parking near Melbourne Central');
  assert.match(card.intro ?? '', /not that parking there is allowed now/);
  assert.equal(card.items.length, 4, 'three bays and the rules source');
  const best = card.items[0]!;
  assert.equal(best.parking?.recommended, true);
  assert.equal(best.parking?.state, 'vacant');
  assert.equal(best.parking?.distance_m, 60);
  assert.equal(best.parking?.walk_min, 1);
  assert.equal(best.parking?.destination, 'Melbourne Central');
  assert.equal(best.parking?.zone, 7012);
  assert.equal(best.parking?.reported_at, '2026-10-10T18:38:00+11:00');
  assert.equal(best.parking?.fee, '$7.10 an hour');
  assert.equal(best.parking?.time_limit, 'Mostly 1P to 2P');
  assert.equal(best.parking?.policy_scope, 'area');
  assert.equal(best.parking?.policy_url, 'https://www.melbourne.vic.gov.au/parking-fees');
  assert.equal(best.cost, '$7.10 an hour', 'older apps still show the fee');
  assert.equal(best.getting_there, '60 m, about 1 min walk to Melbourne Central');
  assert.equal(card.items.slice(1, 3).every((item) => item.parking?.recommended === false), true);
  assert.deepEqual(card.items[3]?.source, { url: 'https://www.melbourne.vic.gov.au/parking-fees', title: 'City of Melbourne parking fees' });
  assert.match(card.items[3]?.summary ?? '', /the sign at each bay decides/);
  assert.match(structured.prompts[0] ?? '', /Melbourne Central/);
});

test('find_parking widens the search when few bays are free, and without rules says they are unknown instead of guessing', async () => {
  const deps: ToolDependencies = { features: fakeReader(BAYS.filter((bay) => bay.id !== 'parking:kerbside:b')), grounding: null };
  const reader = deps.features as ReturnType<typeof fakeReader>;
  const { turn, spec } = registry(deps);
  const result = await runTool(spec('find_parking'), turn, { destination: DESTINATION }) as { bays: { id: string }[]; area_rules: unknown };
  assert.equal(reader.queries.length, 2, 'two vacant bays within 400 m, so it looked within 800 m');
  assert.deepEqual(result.bays.map((bay) => bay.id), ['parking:kerbside:a', 'parking:kerbside:late', 'parking:kerbside:far']);
  assert.equal(result.area_rules, null);
  const item = turn.cards[0]!.items[0]!;
  assert.equal(item.parking?.policy_scope, 'unknown');
  assert.equal(item.parking?.fee, null);
  assert.equal(item.cost, undefined);
  assert.match(item.summary ?? '', /not known; check the sign at the bay/);
  assert.equal(turn.cards[0]!.items.length, 3, 'no rules item without a source');
});

test('find_parking with no vacant bay shows the parking layer at the destination and makes no card', async () => {
  const deps: ToolDependencies = { features: fakeReader([BAYS[0]!, BAYS[1]!]), grounding: null };
  const { turn, sink, spec } = registry(deps);
  const result = await runTool(spec('find_parking'), turn, {}) as { card_id: null; summary: string };
  assert.equal(result.card_id, null);
  assert.match(result.summary, /No sensor reads vacant within 800 m/);
  const actions = sink.sent.flatMap((event) => event.event === 'ui_action' ? [event] : []);
  assert.deepEqual(actions.map((action) => action.action), ['show_layers', 'focus_map']);
  // No destination given: the user's location from the map context.
  assert.deepEqual(actions[1]?.args, { target: { point: CONTEXT.userLocation }, zoom: 17 });
  assert.equal(turn.cards.length, 0);
});
