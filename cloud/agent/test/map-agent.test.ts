import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapAgentRunner } from '../src/agent/map-agent.js';
import type { AgentEvent } from '../src/protocol/schemas.js';
import { CONTEXT, ScriptedLlm, eventItem, fakeReader, functionCall, streamedText, turnContext, usage } from './support.js';

const ITEMS = [
  eventItem('event:1', 'Mahler 5', 144.9683, -37.8211, '2026-10-10T08:30:00Z', '2026-10-10T10:30:00Z'),
  eventItem('event:2', 'Jazz on the lane', 144.9660, -37.8150, '2026-10-10T09:00:00Z', '2026-10-10T12:00:00Z'),
];

function kinds(events: readonly AgentEvent[]): string[] { return events.map((event) => event.event); }

function runner(llm: ScriptedLlm, options: { maxModelCalls?: number; items?: typeof ITEMS } = {}) {
  const reader = fakeReader(options.items ?? ITEMS);
  return { reader, runner: createMapAgentRunner({ model: llm, maxModelCalls: options.maxModelCalls ?? 16, tools: { features: reader, grounding: null },
    clock: () => new Date('2026-10-10T07:40:00Z') }) };
}

test('a plain answer streams text deltas once and reports one usage event per model call', async () => {
  const llm = new ScriptedLlm([() => streamedText('Hello there.', usage(120, 8, 30))]);
  const turn = turnContext('hi');
  const stored = await runner(llm).runner.run(turn);
  assert.deepEqual(kinds(turn.sink.sent), ['text', 'text', 'usage', 'done']);
  assert.equal(stored.text, 'Hello there.');
  const usageEvent = turn.sink.sent[2];
  assert.equal(usageEvent?.event, 'usage');
  if (usageEvent?.event === 'usage') {
    assert.deepEqual({ ...usageEvent.call, durationMs: 0 }, { index: 1, agent: 'map_agent', model: 'gemini-test', input: 120, cachedInput: 0, output: 8, thoughts: 30, toolUseInput: 0, total: 158, durationMs: 0 });
    assert.equal(usageEvent.turn.total, 158);
  }
  const done = turn.sink.sent.at(-1);
  assert.equal(done?.event, 'done');
  if (done?.event === 'done') assert.deepEqual(done.usage, { calls: 1, input: 120, cachedInput: 0, output: 8, thoughts: 30, toolUseInput: 0, total: 158, complete: true });
  assert.deepEqual(stored.usage.perCall.map((call) => call.index), [1]);
  assert.equal(llm.seen[0]?.stream, true);
  assert.match(llm.seen[0]?.contents.at(-1)?.parts?.[0]?.text ?? '', /Map context/);
  assert.equal(llm.seen[0]?.contents.at(-1)?.parts?.[1]?.text, 'hi');
});

test('a tool call sends its status, the result reaches the next model call, and usage sums over calls', async () => {
  const llm = new ScriptedLlm([
    () => functionCall('search_features', { area: { center: { lat: -37.8136, lng: 144.9631 }, radius_m: 1500 }, layers: ['event'] }, usage(200, 20)),
    (request) => {
      const response = request.contents.at(-1)?.parts?.[0]?.functionResponse?.response as { total: number; items: { id: string }[] };
      return streamedText(`Found ${response.total} events; first ${response.items[0]?.id}.`, usage(400, 12));
    },
  ]);
  const turn = turnContext('what is on tonight?');
  const { runner: run, reader } = runner(llm);
  const stored = await run.run(turn);
  // The tool call's usage arrives on the trailing response, after the tool ran; it is still one model call.
  assert.deepEqual(kinds(turn.sink.sent), ['status', 'usage', 'text', 'text', 'usage', 'done']);
  assert.equal(stored.text, 'Found 2 events; first event:2.', 'sorted by distance from the centre');
  assert.deepEqual(reader.queries, [{ layers: ['event'] }]);
  assert.deepEqual(stored.trace.map((entry) => [entry.tool, entry.rows, entry.error]), [['search_features', 2, null]]);
  assert.equal(stored.usage.calls, 2);
  assert.equal(stored.usage.total, 632);
  assert.deepEqual(stored.usage.perCall.map((call) => [call.index, call.total]), [[1, 220], [2, 412]]);
  const turnCounts = turn.sink.sent.flatMap((event) => event.event === 'usage' ? [event.turn.calls] : []);
  assert.deepEqual(turnCounts, [1, 2]);
});

test('a model call that never reports usage is counted once, as zeros', async () => {
  const llm = new ScriptedLlm([() => [{ content: { role: 'model', parts: [{ text: 'No usage came back.' }] }, partial: false }]]);
  const turn = turnContext('hi');
  const stored = await runner(llm).runner.run(turn);
  assert.deepEqual(kinds(turn.sink.sent), ['text', 'usage', 'done']);
  assert.deepEqual(stored.usage, { calls: 1, input: 0, cachedInput: 0, output: 0, thoughts: 0, toolUseInput: 0, total: 0, complete: true,
    perCall: [{ index: 1, agent: 'map_agent', model: 'gemini-test', input: 0, cachedInput: 0, output: 0, thoughts: 0, toolUseInput: 0, total: 0, durationMs: 0 }] });
});

test('show_card rejects sources no tool returned, then accepts a searched feature and emits the card', async () => {
  const llm = new ScriptedLlm([
    () => functionCall('show_card', { type: 'list', title: 'Tonight', items: [{ title: 'Made up', source: { feature_id: 'event:999' } }] }, usage(100, 10)),
    (request) => {
      const response = request.contents.at(-1)?.parts?.[0]?.functionResponse?.response as { error: { code: string; details: { items: number[] } } };
      assert.equal(response.error.code, 'unverified_sources');
      assert.deepEqual(response.error.details.items, [0]);
      return functionCall('search_features', { area: { bbox: { north: -37.80, south: -37.83, east: 144.98, west: 144.95 } } }, usage(150, 10));
    },
    () => functionCall('show_card', { type: 'list', title: 'Tonight', items: [
      { title: 'Mahler 5', source: { feature_id: 'event:1' }, location: { lat: -37.8211, lng: 144.9683 } },
      { title: 'Ticketmaster page', source: { url: 'https://example.org/events/event:2' } }] }, usage(300, 15)),
    () => streamedText('Two options tonight.', usage(350, 5)),
  ]);
  const turn = turnContext('what is on tonight?');
  const stored = await runner(llm).runner.run(turn);
  assert.deepEqual(kinds(turn.sink.sent), ['usage', 'status', 'usage', 'card', 'usage', 'text', 'text', 'usage', 'done']);
  assert.equal(stored.cards.length, 1);
  assert.equal(stored.cards[0]?.id, 'c_t_test_1');
  assert.deepEqual(stored.trace.map((entry) => entry.error), ['unverified_sources', null, null]);
});

test('ask_user sends the question and ends the turn without another model call', async () => {
  const llm = new ScriptedLlm([
    () => functionCall('ask_user', { question: 'Which gardens?', options: ['Fitzroy Gardens', 'Carlton Gardens'] }, usage(90, 12)),
  ]);
  const turn = turnContext('take me to the gardens');
  const stored = await runner(llm).runner.run(turn);
  assert.deepEqual(kinds(turn.sink.sent), ['question', 'usage', 'done']);
  assert.equal(stored.stop, 'asked');
  assert.equal(stored.question?.text, 'Which gardens?');
  assert.equal(llm.seen.length, 1);
  const done = turn.sink.sent.at(-1);
  if (done?.event === 'done') assert.equal(done.stop, 'asked');
});

test('the call budget removes the tools for the last call and the turn ends with stop budget', async () => {
  const focus = () => functionCall('focus_map', { target: { point: { lat: -37.81, lng: 144.96 } } }, usage(50, 5));
  const llm = new ScriptedLlm([
    focus,
    (request) => { assert.ok(request.config?.tools?.length, 'tools present on the second-to-last call'); return focus(); },
    (request) => { assert.equal(request.config?.tools, undefined, 'no tools on the last call'); return streamedText('Out of moves.', usage(60, 4)); },
  ]);
  const turn = turnContext('keep going');
  const stored = await runner(llm, { maxModelCalls: 3 }).runner.run(turn);
  assert.equal(stored.stop, 'budget');
  // Each tool call streams two complete responses; the budget counts requests, so all three happen.
  assert.equal(stored.usage.calls, 3);
  assert.equal(llm.seen.length, 3);
  assert.equal(stored.uiActions.length, 2);
  assert.match(llm.seen[1]?.contents.at(-1)?.parts?.[0]?.text ?? '', /last chance/);
  assert.match(llm.seen[2]?.contents.at(-1)?.parts?.[0]?.text ?? '', /no tools/);
});

test('two invalid calls in a row disable the tools for the rest of the turn', async () => {
  const bad = () => functionCall('search_features', { area: { radius_m: 99_999 } }, usage(40, 6));
  const llm = new ScriptedLlm([
    bad,
    (request) => {
      const response = request.contents.at(-1)?.parts?.[0]?.functionResponse?.response as { error: { code: string } };
      assert.equal(response.error.code, 'invalid_arguments');
      return bad();
    },
    (request) => { assert.equal(request.config?.tools, undefined); return streamedText('I could not search.', usage(45, 4)); },
  ]);
  const turn = turnContext('search badly');
  const stored = await runner(llm).runner.run(turn);
  assert.equal(stored.stop, 'end');
  assert.deepEqual(stored.trace.map((entry) => entry.error), ['invalid_arguments', 'invalid_arguments']);
});

test('identical read-only calls are answered from the memo without a second query', async () => {
  const search = () => functionCall('search_features', { area: { center: { lat: -37.8136, lng: 144.9631 }, radius_m: 1500 } }, usage(100, 10));
  const llm = new ScriptedLlm([search, search, () => streamedText('Done.', usage(120, 3))]);
  const turn = turnContext('again');
  const { runner: run, reader } = runner(llm);
  const stored = await run.run(turn);
  assert.equal(reader.queries.length, 1);
  assert.deepEqual(stored.trace.map((entry) => entry.status), ['Searching the map', 'memo']);
  assert.equal(kinds(turn.sink.sent).filter((kind) => kind === 'status').length, 1);
});

test('the pending question and stored history reach the model', async () => {
  const llm = new ScriptedLlm([() => streamedText('Fitzroy it is.', usage(80, 5))]);
  const pending = { id: 'q_1', text: 'Which gardens?', options: ['Fitzroy Gardens', 'Carlton Gardens'], allowFreeText: true };
  const history = [{ id: 't_0', seq: 1, createdAt: '2026-10-10T07:30:00.000Z', input: { kind: 'text' as const, text: 'take me to the gardens' }, text: '',
    cards: [], uiActions: [], question: pending, stop: 'asked' as const, trace: [],
    usage: { calls: 1, input: 1, cachedInput: 0, output: 1, thoughts: 0, toolUseInput: 0, total: 2, complete: true, perCall: [] } }];
  const turn = { ...turnContext('Fitzroy', { pendingQuestion: pending, history }), request: { input: { kind: 'answer' as const, questionId: 'q_1', value: 'Fitzroy Gardens' }, context: CONTEXT } };
  await runner(llm).runner.run(turn);
  const contents = llm.seen[0]!.contents;
  assert.equal(contents.length, 3, 'history user + model, then the new message');
  assert.match(contents[1]?.parts?.[0]?.text ?? '', /asked: "Which gardens\?"/);
  assert.match(contents[2]?.parts?.[1]?.text ?? '', /Answer to question q_1: Fitzroy Gardens/);
});

test('a failed model call ends the turn with an error event rather than a silent done', async () => {
  const llm = new ScriptedLlm([() => { throw new Error('Could not load the default credentials'); }]);
  const turn = turnContext('hi');
  await assert.rejects(runner(llm).runner.run(turn), { name: 'ModelCallError' });
  assert.deepEqual(kinds(turn.sink.sent), ['error']);
  const error = turn.sink.sent[0];
  assert.equal(error?.event, 'error');
  if (error?.event === 'error') { assert.equal(error.retryable, true); assert.equal(error.usage.complete, false); }
});
