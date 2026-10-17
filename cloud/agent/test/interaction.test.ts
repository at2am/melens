import assert from 'node:assert/strict';
import test from 'node:test';

import type { LlmRequest } from '@google/adk';
import type { Content } from '@google/genai';

import { COMPACTION_LIMITS, compactOldToolResults } from '../src/agent/compaction.js';
import { CONTEXT_CACHE_LIMITS, createContextCache, useContextCache, type CachedPrefix } from '../src/agent/context-cache.js';
import { createMapAgentRunner } from '../src/agent/map-agent.js';
import { contextBlock, historyContents } from '../src/agent/prompts.js';
import { RetryingLlm, isTransientModelError } from '../src/agent/retrying-llm.js';
import type { StoredTurn } from '../src/protocol/schemas.js';
import { CONTEXT, ScriptedLlm, fakeReader, functionCall, streamedText, turnContext, usage } from './support.js';

const request = (): LlmRequest => ({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], toolsDict: {}, liveConnectConfig: {} } as unknown as LlmRequest);

async function drain(llm: RetryingLlm): Promise<string[]> {
  const texts: string[] = [];
  for await (const response of llm.generateContentAsync(request(), true)) texts.push(response.content?.parts?.[0]?.text ?? '');
  return texts;
}

test('a model call that fails with a passing 429 or 503 before it streamed anything is made again', async () => {
  const unavailable = Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'), { status: 503 });
  const inner = new ScriptedLlm([() => { throw unavailable; }, () => streamedText('Hello', usage(1, 1))]);
  const logged: Record<string, unknown>[] = [];
  const texts = await drain(new RetryingLlm(inner, { delaysMs: [0, 0], log: (line) => logged.push(line) }));
  assert.equal(inner.seen.length, 2);
  assert.deepEqual(texts, ['Hel', 'lo', 'Hello']);
  assert.equal(logged[0]?.event, 'modelCallRetried');
});

test('a model call is not made again for a lasting error, after its retries, or once it streamed', async () => {
  const badRequest = Object.assign(new Error('INVALID_ARGUMENT'), { status: 400 });
  const once = new ScriptedLlm([() => { throw badRequest; }]);
  await assert.rejects(drain(new RetryingLlm(once, { delaysMs: [0, 0] })), /INVALID_ARGUMENT/);
  assert.equal(once.seen.length, 1);

  const quota = () => { throw Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }); };
  const always = new ScriptedLlm([quota, quota, quota]);
  await assert.rejects(drain(new RetryingLlm(always, { delaysMs: [0, 0] })), /RESOURCE_EXHAUSTED/);
  assert.equal(always.seen.length, 3, 'one call and two retries');

  assert.equal(isTransientModelError(new Error('fetch failed')), true);
  assert.equal(isTransientModelError(new Error('Could not load the default credentials')), false);

  class StreamsThenDrops extends ScriptedLlm {
    override async *generateContentAsync() {
      this.seen.push({ contents: [], tools: undefined, stream: true });
      yield { content: { role: 'model' as const, parts: [{ text: 'Hel' }] }, partial: true };
      throw Object.assign(new Error('socket hang up'), { status: 503 });
    }
  }
  const streamed = new StreamsThenDrops([]);
  await assert.rejects(drain(new RetryingLlm(streamed, { delaysMs: [0, 0] })), /socket hang up/);
  assert.equal(streamed.seen.length, 1, 'the user saw part of the call, so it is not repeated');
});

const PREFIX: CachedPrefix = { systemInstruction: 'You are Melens.', tools: [{ functionDeclarations: [{ name: 'search_features' }] }] };

test('the instruction and tools are cached once, reused, renewed before they expire, and sent in full while creation backs off', async () => {
  let now = 0;
  let created = 0;
  let fail = false;
  const cache = createContextCache(async () => {
    created += 1;
    if (fail) throw new Error('minimum token count');
    return { name: `cachedContents/${created}`, expiresAt: now + CONTEXT_CACHE_LIMITS.ttlSeconds * 1_000 };
  }, { clock: () => now });
  const [first, second] = await Promise.all([cache.nameFor(PREFIX), cache.nameFor(PREFIX)]);
  assert.deepEqual([first, second, created], ['cachedContents/1', 'cachedContents/1', 1], 'concurrent turns share one creation');
  now = CONTEXT_CACHE_LIMITS.ttlSeconds * 1_000 - CONTEXT_CACHE_LIMITS.renewBeforeMs + 1;
  assert.equal(await cache.nameFor(PREFIX), 'cachedContents/2', 'a cache about to expire is replaced');
  assert.equal(await cache.nameFor({ ...PREFIX, systemInstruction: 'Another instruction' }), 'cachedContents/3', 'another prefix has its own cache');
  cache.invalidate();
  fail = true;
  assert.equal(await cache.nameFor(PREFIX), null);
  const failures = created;
  assert.equal(await cache.nameFor(PREFIX), null);
  assert.equal(created, failures, 'no new attempt while backing off');
  fail = false;
  now += CONTEXT_CACHE_LIMITS.backoffMs;
  assert.match(await cache.nameFor(PREFIX) ?? '', /^cachedContents\//);
});

test('a call that uses the cache names it and sends no instruction, tools or tool config; a call without tools keeps its prefix', async () => {
  const cache = createContextCache(async () => ({ name: 'cachedContents/1', expiresAt: Number.MAX_SAFE_INTEGER }));
  const withTools = { ...request(), config: { systemInstruction: 'You are Melens.', tools: PREFIX.tools, toolConfig: { functionCallingConfig: {} } } } as LlmRequest;
  assert.equal(await useContextCache(cache, withTools), true);
  assert.deepEqual(withTools.config, { cachedContent: 'cachedContents/1' });
  const withoutTools = { ...request(), config: { systemInstruction: 'You are Melens.' } } as LlmRequest;
  assert.equal(await useContextCache(cache, withoutTools), false);
  assert.deepEqual(withoutTools.config, { systemInstruction: 'You are Melens.' });
});

test('every model call of a turn reaches Gemini through the cached prefix but the last one without tools', async () => {
  const llm = new ScriptedLlm([
    () => functionCall('search_features', { layers: ['event'] }, usage(10, 1)),
    () => streamedText('Done.', usage(10, 1)),
  ]);
  const cache = createContextCache(async () => ({ name: 'cachedContents/chat', expiresAt: Number.MAX_SAFE_INTEGER }));
  const runner = createMapAgentRunner({ model: llm, maxModelCalls: 2, contextCache: cache, tools: { features: fakeReader([]), grounding: null },
    clock: () => new Date('2026-10-10T07:40:00Z') });
  await runner.run(turnContext('Anything on tonight?'));
  assert.deepEqual(llm.seen.map((seen) => [seen.cachedContent, seen.tools === undefined, seen.systemInstruction === undefined]),
    [['cachedContents/chat', true, true], [undefined, true, false]], 'the last call has no tools, so it sends its instruction itself');
});

function toolTurn(name: string, rows: number): Content[] {
  return [
    { role: 'model', parts: [{ functionCall: { name, args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name, response: { items: Array.from({ length: rows }, (_, index) => ({ id: `event:${index}`,
      summary: 'x'.repeat(600) })) } } }] },
  ];
}

test('large tool results the model already read are shortened for later calls; the newest stay whole and the originals are untouched', () => {
  const older = toolTurn('search_features', 40);
  const newest = toolTurn('get_feature', 40);
  const small = toolTurn('get_anomaly', 2);
  const contents = [{ role: 'user', parts: [{ text: 'hi' }] }, ...older, ...small, ...newest];
  const original = older[1]!;
  assert.equal(compactOldToolResults(contents), 1);
  assert.equal(older[1], original, 'the session content is not changed');
  const shortened = contents[2]!.parts![0]!.functionResponse!.response as { items: unknown[] };
  assert.equal(shortened.items.length, COMPACTION_LIMITS.keepItems + 1);
  assert.match(String(shortened.items.at(-1)), /35 more not shown again/);
  assert.equal((shortened.items[0] as { id: string; summary: string }).id, 'event:0');
  assert.ok((shortened.items[0] as { summary: string }).summary.length <= COMPACTION_LIMITS.maxString + 1);
  assert.equal(contents[4], small[1], 'a small result stays whole');
  assert.equal(contents[6], newest[1], 'the newest results stay whole');
});

test('the map context tells the model which of its map actions did not apply, and the history marks a failed answer', () => {
  const block = contextBlock({ ...CONTEXT, actionReports: [{ action: 'highlight_features', outcome: 'partial', skipped: ['event:9'] },
    { action: 'show_layers', outcome: 'ignored', skipped: [] }] });
  assert.match(block, /your last highlight_features was applied in part by the map \(could not use: event:9\)/);
  assert.match(block, /your last show_layers was not applied by the map$/m);
  const failed: StoredTurn = { id: 't_0', seq: 1, createdAt: '2026-10-10T07:30:00.000Z', input: { kind: 'text', text: 'plan my evening' }, attachments: [],
    text: 'Looking', cards: [], uiActions: [], question: null, questions: [], stop: 'end', failure: { message: 'The agent could not finish this turn', retryable: true },
    trace: [], usage: { calls: 1, input: 1, cachedInput: 0, output: 1, thoughts: 0, toolUseInput: 0, total: 2, complete: false, perCall: [] } };
  assert.match(historyContents([failed])[1]?.parts?.[0]?.text ?? '', /Looking\n\[this answer failed before it finished/);
});
