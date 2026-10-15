/**
 * Runs the seed evaluation set (the example queries of the use cases) through the real agent: Gemini through Vertex AI,
 * the published BigQuery views and the Routes API, with in-memory sessions and no HTTP. It checks the tool trace of each
 * precise request and prints a Markdown report for the deck (agent-design.md, Evaluation).
 *
 *   cd cloud && npm run build --workspace agent
 *   cd agent && node scripts/eval.mts [--only <number>] [--out report.md]
 *
 * Needs Application Default Credentials for the project, like `npm run dev`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gemini } from '@google/adk';
import { sourceReferenceSchema } from '@melens/shared/contracts/map-contract';

import { createMapAgentRunner } from '../dist/src/agent/map-agent.js';
import { createVertexGrounding } from '../dist/src/agent/grounding.js';
import { createVertexStructuredModel } from '../dist/src/agent/structured.js';
import { createMemoryCache } from '../dist/src/cache.js';
import { loadAgentConfig } from '../dist/src/config.js';
import { createSharedFeatureReader } from '../dist/src/features/reader.js';
import type { StoredTurn } from '../dist/src/protocol/schemas.js';
import { collectingSink } from '../dist/src/protocol/sse.js';
import { createRoutesClient } from '../dist/src/routes/routes-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const env = { AGENT_PROJECT_ID: 'melens-510012', AGENT_VERTEX_LOCATION: 'global', MAP_DYNAMIC_SCAN_BYTES: '1000000000',
  AGENT_PUBLIC_SOURCES_FILE: resolve(here, '../../map/infra/dev-public-sources.json'), ...process.env };
const config = loadAgentConfig(env);
const publicSources = JSON.parse(await readFile(config.publicSourcesFile!, 'utf8')).map((source: unknown) => sourceReferenceSchema.parse(source));

const CITY = { lat: -37.8136, lng: 144.9631 };
const VIEWPORT = { north: -37.805, south: -37.822, east: 144.98, west: 144.946 };
const context = (layers: string[] = ['event', 'disruption', 'news']) => ({ viewport: VIEWPORT, zoom: 15, userLocation: CITY, layers,
  localTime: '2026-10-16T18:40:00+11:00' });

interface Case {
  readonly id: number;
  readonly use: string;
  readonly input: { kind: 'text'; text: string } | { kind: 'area'; lat: number; lng: number } | { kind: 'analyse'; featureId: string };
  /** Tools the trace must contain. */
  readonly expect: readonly string[];
  /** Tools the trace must not contain. */
  readonly forbid?: readonly string[];
  readonly expectCard?: boolean;
  readonly expectQuestion?: boolean;
  /** The turn must be answered in plain text: no tool call, no card, no question. */
  readonly noTools?: boolean;
  readonly layers?: string[];
  /** Earlier messages in the same session, run live first; the checks apply to the last turn only. */
  readonly before?: readonly string[];
}

const CASES: readonly Case[] = [
  { id: 1, use: 'UC-02', input: { kind: 'area', lat: CITY.lat, lng: CITY.lng }, expect: ['area_brief'], expectCard: true },
  { id: 2, use: 'UC-02', input: { kind: 'text', text: "What's interesting around here?" }, expect: ['area_brief'], expectCard: true },
  { id: 3, use: 'UC-02', input: { kind: 'text', text: 'Anything happening around here this weekend?' }, expect: ['search_features'] },
  { id: 4, use: 'UC-03', input: { kind: 'text', text: 'What can I do after 7 PM tonight? I enjoy arts and culture and need somewhere accessible on foot or by public transport.' }, expect: ['search_features'], expectCard: true },
  { id: 5, use: 'UC-03', input: { kind: 'text', text: 'Plan a free, 45-minute walk near me, with a few interesting stops along the way.' }, expect: ['draw_route'], forbid: ['ask_user'], expectCard: true },
  { id: 6, use: 'UC-13', input: { kind: 'text', text: 'Take me to Fitzroy Gardens.' }, expect: ['focus_map', 'draw_route'], forbid: ['ask_user'] },
  { id: 7, use: 'UC-13', input: { kind: 'text', text: 'Take me to the gardens.' }, expect: ['ask_user'], expectQuestion: true },
  { id: 8, use: 'UC-13', input: { kind: 'text', text: 'Only show live music tonight.' }, expect: ['show_layers'] },
  { id: 9, use: 'UC-13', input: { kind: 'text', text: 'Is the State Library worth visiting?' }, expect: [] },
  { id: 10, use: 'UC-13', input: { kind: 'text', text: 'What time does the free tram zone end?' }, expect: ['search_grounding'] },
  { id: 11, use: 'UC-08', input: { kind: 'text', text: "What's the history of Flinders Street Station?" }, expect: ['search_grounding'], expectCard: true },
  { id: 13, use: 'UC-04', input: { kind: 'analyse', featureId: 'anomaly:replay-161-2025092702' }, expect: ['analyse_anomaly'], expectCard: true },
  { id: 14, use: 'UC-13', input: { kind: 'text', text: 'hi' }, expect: [], noTools: true },
  { id: 15, use: 'UC-13', input: { kind: 'text', text: 'Thanks, that was helpful!' }, expect: [], noTools: true },
  { id: 16, use: 'UC-13', input: { kind: 'text', text: 'What can you do?' }, expect: [], noTools: true },
  { id: 17, use: 'UC-13', input: { kind: 'text', text: 'Tell me a joke about trams.' }, expect: [], noTools: true },
  { id: 18, use: 'UC-13', input: { kind: 'text', text: 'What is the capital of Victoria?' }, expect: [], noTools: true },
  // Multi-turn: thanks after a tool-heavy answer must stay plain text; thanks with a new request must still search.
  { id: 19, use: 'UC-13', before: ['What can I do after 7 PM tonight?'], input: { kind: 'text', text: 'Thanks!' }, expect: [], noTools: true },
  { id: 20, use: 'UC-13', before: ['Take me to Fitzroy Gardens.'], input: { kind: 'text', text: 'Great, thanks a lot.' }, expect: [], noTools: true },
  { id: 21, use: 'UC-13', before: ["What's the history of Flinders Street Station?"], input: { kind: 'text', text: 'Cool, thank you, that was interesting.' }, expect: [], noTools: true },
  { id: 22, use: 'UC-13', before: ['What can I do after 7 PM tonight?'], input: { kind: 'text', text: 'Thanks! Anything on tomorrow night too?' }, expect: ['search_features'] },
  { id: 12, use: 'UC-04', input: { kind: 'text', text: 'Why is it so busy here right now?' }, expect: ['nearby_context'], layers: ['event', 'disruption', 'news', 'pedestrian', 'anomaly'] },
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null;
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

const runner = createMapAgentRunner({
  model: new Gemini({ model: config.model, vertexai: true, project: config.projectId, location: config.vertexLocation }),
  maxModelCalls: config.maxModelCalls,
  tools: {
    features: createSharedFeatureReader({ config: config.query, publicSources }),
    grounding: createVertexGrounding({ projectId: config.projectId, location: config.vertexLocation, model: config.model }),
    groundingTimeoutMs: config.groundingTimeoutMs,
    structured: createVertexStructuredModel({ projectId: config.projectId, location: config.vertexLocation, model: config.model }),
    routes: createRoutesClient({ quotaProject: config.projectId }),
    cache: createMemoryCache(),
  },
});

const rows: string[] = [];
let failures = 0;
let ran = 0;
for (const testCase of CASES) {
  if (only !== null && testCase.id !== only) continue;
  ran += 1;
  const turnId = `t_eval_${testCase.id}`;
  const sink = collectingSink(turnId);
  const startedAt = Date.now();
  let verdict: string[] = [];
  let tools: string[] = [];
  let usageTotal = 0;
  let calls = 0;
  let cards = 0;
  let text = '';
  const runTurn = (id: string, seq: number, input: Case['input'], history: StoredTurn[], pendingQuestion: StoredTurn['question']) =>
    runner.run({ uid: 'eval', turnId: id, seq, startedAt: new Date(), signal: AbortSignal.timeout(280_000), sink: id === turnId ? sink : collectingSink(id),
      session: { id: `s_eval_${testCase.id}`, uid: 'eval', title: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        turnCount: history.length, pendingQuestion, activeTurn: null, expiresAt: new Date(Date.now() + 864e5).toISOString() },
      request: { input, context: context(testCase.layers) } as never, images: [], history, historyImages: new Map() });
  try {
    const history: StoredTurn[] = [];
    for (const [index, earlier] of (testCase.before ?? []).entries()) {
      history.push(await runTurn(`${turnId}_${index}`, index + 1, { kind: 'text', text: earlier }, history.slice(), null));
    }
    const stored = await runTurn(turnId, history.length + 1, testCase.input, history, history.at(-1)?.question ?? null);
    if (history.length > 0) console.log(`#${testCase.id} earlier: ${history.map((turn) => turn.trace.map((entry) => entry.tool).join(' → ') || 'none').join(' | ')}`);
    tools = stored.trace.map((entry) => entry.tool);
    usageTotal = stored.usage.total;
    calls = stored.usage.calls;
    cards = stored.cards.length;
    text = stored.text;
    if (args.includes('--show')) for (const card of stored.cards) console.log(JSON.stringify(card, null, 1));
    for (const tool of testCase.expect) if (!tools.includes(tool)) verdict.push(`missing ${tool}`);
    for (const tool of testCase.forbid ?? []) if (tools.includes(tool)) verdict.push(`unexpected ${tool}`);
    if (testCase.noTools === true && (tools.length > 0 || cards > 0 || stored.question !== null)) verdict.push(`expected plain text, got ${tools.join(',') || 'a card'}`);
    if (testCase.noTools === true && text.trim() === '') verdict.push('no answer text');
    if (testCase.expectCard === true && cards === 0) verdict.push('no card');
    if (testCase.expectQuestion === true && stored.question === null) verdict.push('no question');
    const failed = stored.trace.filter((entry) => entry.error !== null && entry.error !== 'upstream_unavailable').map((entry) => `${entry.tool}:${entry.error}`);
    if (failed.length > 0) verdict.push(`tool errors ${failed.join(',')}`);
    const sum = stored.usage.perCall.reduce((acc, call) => acc + call.total, 0);
    if (sum !== stored.usage.total) verdict.push('usage totals differ');
  } catch (error) {
    verdict = [`error ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`];
  }
  if (verdict.length > 0) failures += 1;
  const last = testCase.input.kind === 'text' ? testCase.input.text : testCase.input.kind === 'analyse' ? `Analyse ${testCase.input.featureId}` : `map tap at ${testCase.input.lat}, ${testCase.input.lng}`;
  const input = [...(testCase.before ?? []).map((earlier) => `${earlier} ⟶`), last].join(' ');
  rows.push(`| ${testCase.id} | ${testCase.use} | ${input.replace(/\|/g, '/')} | ${tools.join(' → ') || 'none'} | ${cards} | ${calls} / ${usageTotal} | ${Math.round((Date.now() - startedAt) / 1000)} s | ${verdict.length === 0 ? 'pass' : `**FAIL** ${verdict.join('; ')}`} |`);
  console.log(`#${testCase.id} ${verdict.length === 0 ? 'pass' : `FAIL ${verdict.join('; ')}`} | ${tools.join(' → ')} | cards ${cards} | ${text.slice(0, 100).replace(/\n/g, ' ')}`);
}

const report = ['| # | Use case | Query | Tool trace | Cards | Model calls / tokens | Time | Result |', '| --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
console.log(`\n${report}\n\n${ran - failures}/${ran} passed`);
if (outPath !== null) await writeFile(outPath, `${report}\n`);
process.exitCode = failures === 0 ? 0 : 1;
