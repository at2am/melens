import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadMapConfig } from '@melens/shared/config';
import { parseMapItem, type ViewportResponse, type MapItemPage } from '@melens/shared/contracts/map-contract';
import { COVERAGE_CACHE_TTL_MS, createMapService } from '../src/map-service.js';
import { createMapHttpServer } from '../src/server.js';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import { aggregateLayer } from '../src/services/aggregation.js';
import { MapServiceError } from '../src/services/viewport.js';

const time = '2026-10-01T01:00:00Z';
const sourceId = 'test.planning';
const source = { sourceId, url: 'https://example.org/planning', attribution: 'Public planning source', versionRef: null };
const base = { requestId: 'http-1', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 14,
  layers: ['planning'], mode: 'historical', window: { from: '2026-10-01T00:00:00Z', to: time }, pageSize: 1 };
const scope = { areaRefs: ['com:municipal'] };
function registry(id = sourceId, topic = 'planning') {
  return { source_id: id, topic, scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: '2026-11-01T00:00:00Z',
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch-1', latest_published_at: time,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 3, coverage_evidence_state: 'verified' };
}
function row(id: string, located = true, topic = 'planning', idSource = sourceId) {
  return { geo_record_id: id, version_id: 'version-1', source_id: idSource, topic,
    assertion_kind: 'plan', is_prediction: false, title: id, summary: 'Published summary', original_url: null,
    geometry_geojson: located ? JSON.stringify({ type: 'Point', coordinates: [144.98, -37.81] }) : null,
    location_role: located ? 'event_site' : 'unknown', location_confidence: located ? 'source_coordinate' : 'unverified',
    area_refs: ['com:municipal'], observed_at: null, published_at: null,
    valid_from: '2026-10-01T00:00:00Z', valid_to: null, fetched_at: time,
    freshness_state: 'current', record_status: 'planned' };
}
function fixture(options: { rows?: ReturnType<typeof row>[]; partial?: boolean; aggregate?: boolean; maxBytes?: number;
  coverageStaleMs?: number; extraSources?: ReturnType<typeof registry>[] } = {}) {
  let clockValue = Date.parse(time);
  const metadata = [registry(), ...(options.extraSources ?? [])];
  const rows = options.rows ?? [row('planning:first/a'), row('planning:second'), row('planning:third')];
  const unlocated = [row('planning:missing-1', false), row('planning:missing-2', false)];
  const queries: PreparedViewQuery[] = [];
  const withdrawnIds = new Set<string>();
  const adapter: BigQueryViewAdapter = {
    async dryRun(query) { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const selected = query.query.includes('v_source_coverage') ? metadata
        : query.query.includes('g.geometry IS NULL') ? unlocated
        : rows.filter((r) => r.topic === query.params.topic && !withdrawnIds.has(r.geo_record_id));
      return { async readPage({ maxRows }) {
        return { rows: selected.slice(0, Math.min(Number(query.params.resultLimit), maxRows)).map((r) => ({ record: JSON.stringify(r) })),
          complete: true, hasMore: options.partial === true && !query.query.includes('v_source_coverage') };
      }, async cancel() {} };
    },
  };
  const clock = () => new Date(clockValue);
  const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', ...(options.maxBytes === undefined ? {} : {
    MAP_MAX_RESPONSE_BYTES: String(options.maxBytes), MAP_RESPONSE_ENVELOPE_RESERVE_BYTES: '512' }) });
  const service = createMapService({ config, adapter,
    publicSources: [source, ...(options.extraSources ?? []).map((entry) => ({ ...source, sourceId: entry.source_id }))], clock,
    ...(options.coverageStaleMs === undefined ? {} : { coverageStaleMs: options.coverageStaleMs }),
    aggregateLayer: options.aggregate === true ? aggregateLayer : (layer) => ({ items: layer.items, groups: new Map() }) });
  return { service, metadata, rows, unlocated, queries, withdrawnIds, advance(ms: number) { clockValue += ms; } };
}
async function withServer(run: (url: string, f: ReturnType<typeof fixture>) => Promise<void>,
  options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  const server = createMapHttpServer({ service: f.service, allowedOrigins: ['https://map.example.org'] });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try { await run(url, f); }
  finally { await new Promise<void>((resolve) => server.close(() => resolve())); server.closeAllConnections(); }
}
async function viewport(url: string, request = base) {
  const response = await fetch(`${url}/v1/map/viewport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  return { status: response.status, body: await response.json() as ViewportResponse };
}
const unavailable = (code: string) => (e: unknown) => e instanceof MapServiceError && e.code === code;
/** Lets background reloads (registry, layer cache) finish. */
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const readUrl = (url: string, id: string, snapshotId: string) => `${url}/v1/map/items/${encodeURIComponent(id)}?requestId=detail&snapshotId=${encodeURIComponent(snapshotId)}`;

test('all frozen HTTP routes produce validated live envelopes; details preserve snapshot historical context', async () => {
  await withServer(async (url, f) => {
    const catalog = await fetch(`${url}/v1/map/layers`);
    assert.equal(catalog.status, 200); assert.equal((await catalog.json() as { layers: unknown[] }).layers.length, 10);
    const initial = await viewport(url); assert.equal(initial.status, 200);
    const layer = initial.body.layers[0]!; assert.equal(layer.items.length, 1); assert.ok(layer.nextCursor);
    assert.equal(initial.body.dataMode, 'live'); assert.equal(initial.body.mode, 'historical');
    const detail = await fetch(readUrl(url, layer.items[0]!.id, initial.body.snapshotId));
    assert.equal(detail.status, 200); const detailBody = await detail.json() as { mode: string; item: unknown };
    assert.equal(detailBody.mode, 'historical'); parseMapItem(detailBody.item);
    const list = await fetch(`${url}/v1/map/unlocated?query=${encodeURIComponent(JSON.stringify({ ...base, bbox: undefined, zoom: undefined, scope }))}`);
    assert.equal(list.status, 200); const listBody = await list.json() as MapItemPage;
    assert.equal(listBody.scope.kind, 'unlocated'); assert.equal(listBody.items[0]!.geometry, null);
    assert.ok(f.queries.some((q) => q.query.includes('g.geometry IS NULL') && q.query.includes('UNNEST(g.area_refs)')));
  });
});

test('a continuation recomputes its page from the request alone and stores nothing', async () => {
  const f = fixture(); const first = await f.service.queryViewport(base);
  const historyReads = () => f.queries.filter((q) => q.query.includes('v_geo_records_history')).length;
  assert.equal(historyReads(), 1);
  const second = await f.service.queryViewport({ ...base, requestId: 'http-2', cursor: first.layers[0]!.nextCursor, snapshotId: first.snapshotId });
  assert.equal(second.layers[0]!.items[0]!.title, 'planning:second'); assert.equal(second.snapshotId, first.snapshotId);
  assert.equal(second.layers[0]!.totalMatching, 3); assert.equal(second.layers[0]!.completeness, 'partial');
  assert.equal(historyReads(), 2);
  // Another instance, with no shared memory, continues the same token.
  const other = fixture();
  const third = await other.service.queryViewport({ ...base, requestId: 'http-3', cursor: second.layers[0]!.nextCursor, snapshotId: first.snapshotId });
  assert.equal(third.layers[0]!.items[0]!.title, 'planning:third');
  assert.equal(third.layers[0]!.completeness, 'complete'); assert.equal(third.layers[0]!.nextCursor, null);
});

test('upstream partial buffer stays null total through every stored page and has no unsafe last continuation', async () => {
  const f = fixture({ partial: true }); let reply = await f.service.queryViewport(base);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(reply.layers[0]!.totalMatching, null); assert.equal(reply.layers[0]!.completeness, 'partial');
    if (reply.layers[0]!.nextCursor === null) break;
    reply = await f.service.queryViewport({ ...base, cursor: reply.layers[0]!.nextCursor, snapshotId: reply.snapshotId });
  }
  assert.equal(reply.layers[0]!.nextCursor, null);
});

test('all context fields, layer and family bind cursor; unknown tokens differ from expiry', async () => {
  const f = fixture(); const first = await f.service.queryViewport(base);
  const continuation = { ...base, cursor: first.layers[0]!.nextCursor, snapshotId: first.snapshotId };
  for (const change of [{ zoom: 15 }, { pageSize: 2 }, { layers: ['event'] }, { areaFilter: {
    indicatorId: 'unused', periodId: 'q1', periodStart: '2026-01-01', periodEnd: '2026-02-01', propertyType: null, boundaryVintage: '2021' } }]) {
    await assert.rejects(f.service.queryViewport({ ...continuation, ...change }), (e: unknown) => e instanceof MapServiceError && e.code === 'cursorMismatch');
  }
  // A token that cannot be recomputed (an old stored-snapshot id) asks the client to reissue its request.
  await assert.rejects(f.service.queryViewport({ ...continuation, snapshotId: 'unknown' }), unavailable('snapshotExpired'));
  const other = await f.service.queryViewport({ ...base, requestId: 'other', zoom: 15 });
  await assert.rejects(f.service.queryViewport({ ...continuation, zoom: 15, snapshotId: other.snapshotId }), unavailable('cursorMismatch'));
  await assert.rejects(f.service.queryUnlocated({ ...base, bbox: undefined, zoom: undefined, scope,
    cursor: continuation.cursor, snapshotId: first.snapshotId }), (e: unknown) => e instanceof MapServiceError && e.code === 'invalidRequest');
  const { bbox: _bbox, zoom: _zoom, ...listContext } = continuation;
  await assert.rejects(f.service.queryUnlocated({ ...listContext, scope }), (e: unknown) => e instanceof MapServiceError && e.code === 'cursorMismatch');
  // Tokens do not expire: ten minutes later the continuation is still answered.
  f.advance(10 * 60_000);
  assert.equal((await f.service.queryViewport(continuation)).layers[0]!.items[0]!.title, 'planning:second');
});

test('detail and member reads follow the current registry: a paused source leaves, a new batch does not', async () => {
  // Without the stale window a registry change applies as soon as the cache window has passed.
  const f = fixture({ aggregate: true, coverageStaleMs: 0 }); const first = await f.service.queryViewport({ ...base, zoom: 8 });
  const aggregate = first.layers[0]!.items[0]!; assert.equal(aggregate.kind, 'aggregate');
  const context = { requestId: 'members', snapshotId: first.snapshotId, pageSize: 1 };
  const members = await f.service.getMembers(aggregate.id, context);
  assert.equal(members.items[0]!.id, f.rows[0]!.geo_record_id); assert.equal(members.mode, 'historical'); assert.ok(members.nextCursor);
  await assert.rejects(f.service.getMembers('different-aggregate', { ...context, cursor: members.nextCursor }), unavailable('cursorMismatch'));
  await assert.rejects(f.service.getMembers(aggregate.id, { ...context, pageSize: 2, cursor: members.nextCursor }), unavailable('cursorMismatch'));
  f.metadata[0]!.latest_published_batch_id = 'batch-2';
  f.advance(COVERAGE_CACHE_TTL_MS);
  assert.equal((await f.service.getItem(aggregate.id, { requestId: 'detail', snapshotId: first.snapshotId })).item.id, aggregate.id);
  f.metadata[0]!.access_status = 'paused';
  f.advance(COVERAGE_CACHE_TTL_MS);
  await assert.rejects(f.service.getItem(aggregate.id, { requestId: 'detail', snapshotId: first.snapshotId }), unavailable('notFound'));
  await assert.rejects(f.service.getMembers(aggregate.id, { ...context, cursor: members.nextCursor }), unavailable('snapshotExpired'));
});

test('requests inside the cache window share one source registry read', async () => {
  const f = fixture();
  const registryReads = () => f.queries.filter((query) => query.query.includes('v_source_coverage')).length;
  await f.service.getCatalog(); await f.service.queryViewport(base); await f.service.queryViewport({ ...base, requestId: 'again' });
  assert.equal(registryReads(), 1);
  // An expired read is still served while one background read replaces it.
  f.advance(COVERAGE_CACHE_TTL_MS); await f.service.queryViewport({ ...base, requestId: 'later' });
  await settle();
  assert.equal(registryReads(), 2);
});

test('unlocated approves actual associations or exact jurisdiction and binds its own stored pages', async () => {
  const f = fixture(); const { bbox: _bbox, zoom: _zoom, ...context } = base;
  const initial = await f.service.queryUnlocated({ ...context, scope }); assert.equal(initial.totalMatching, 2);
  const next = await f.service.queryUnlocated({ ...context, scope, snapshotId: initial.snapshotId, cursor: initial.nextCursor });
  assert.equal(next.items[0]!.id, 'planning:missing-2'); assert.equal(next.nextCursor, null);
  await assert.rejects(f.service.queryUnlocated({ ...context, scope: { areaRefs: ['invented'] } }), (e: unknown) => e instanceof MapServiceError && e.code === 'notAvailable');
  const jurisdiction = await f.service.queryUnlocated({ ...context, scope: { sourceJurisdiction: 'city-of-melbourne' } });
  assert.equal(jurisdiction.scope.kind, 'unlocated');
  await assert.rejects(f.service.queryUnlocated({ ...context, scope: { sourceJurisdiction: 'arbitrary-source' } }), (e: unknown) => e instanceof MapServiceError && e.code === 'notAvailable');
});

test('empty viewport cannot become noMatching without verified bbox resolver and unresolved proof', async () => {
  const f = fixture({ rows: [] }); const response = await f.service.queryViewport(base);
  assert.equal(response.layers[0]!.state, 'unknown'); assert.equal(response.layers[0]!.coverage.state, 'unknown');
  assert.equal(response.layers[0]!.unresolvedCount, null); assert.equal(response.layers[0]!.totalMatching, null);
});

test('HTTP rejects duplicate/extra GET parameters, wrong encodings and unknown origins with safe errors', async () => {
  await withServer(async (url) => {
    for (const [path, options] of [
      ['/v1/map/layers?mode=current', {}],
      ['/v1/map/items/a?requestId=a&requestId=b&snapshotId=unknown', {}],
      ['/v1/map/items/a?requestId=a&snapshotId=unknown&mode=current', {}],
      ['/v1/map/unlocated?requestId=a', {}],
      ['/v1/map/layers', { headers: { Origin: 'https://untrusted.example.org' } }],
      ['/v1/map/viewport', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }],
    ] as const) {
      const response = await fetch(`${url}${path}`, options); assert.equal(response.status, 400);
      const error = await response.json() as { error: { code: string; messageKey: string } };
      assert.equal(error.error.code, 'invalidRequest'); assert.equal(error.error.messageKey, 'map.error.invalidRequest');
    }
    const response = await fetch(`${url}/v1/map/layers`, { headers: { Origin: 'https://map.example.org' } });
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://map.example.org');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    const preflight = await fetch(`${url}/v1/map/viewport`, { method: 'OPTIONS', headers: {
      Origin: 'https://map.example.org', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(preflight.status, 204);
  });
});

test('HTTP exposes bounded safe errors for malformed/oversized JSON and never leaks backend diagnostics', async () => {
  await withServer(async (url) => {
    for (const text of ['{invalid', JSON.stringify({ ...base, secret: 'x'.repeat(256 * 1024) }), JSON.stringify({ ...base, dataMode: 'sample' })]) {
      const response = await fetch(`${url}/v1/map/viewport`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
      assert.equal(response.status, 400); assert.ok(Buffer.byteLength(await response.text()) < 300);
    }
  });
});

test('a withdrawn record leaves the next detail, page and member read; its aggregate keeps its id', async () => {
  const f = fixture(); const initial = await f.service.queryViewport(base);
  f.withdrawnIds.add('planning:first/a');
  await assert.rejects(f.service.getItem('planning:first/a', { requestId: 'detail', snapshotId: initial.snapshotId }), unavailable('notFound'));
  const next = await f.service.queryViewport({ ...base, cursor: initial.layers[0]!.nextCursor, snapshotId: initial.snapshotId });
  assert.equal(next.layers[0]!.items[0]!.title, 'planning:third');
  const grouped = fixture({ aggregate: true }); const reply = await grouped.service.queryViewport({ ...base, zoom: 8, pageSize: 1000 });
  const aggregate = reply.layers[0]!.items[0]!;
  assert.ok(aggregate.kind === 'aggregate'); assert.equal(aggregate.details.memberIds.length, 3);
  assert.match(aggregate.id, /^aggregate\.planning\.overview\.\d+\.\d+\.[\w-]{32}$/);
  grouped.withdrawnIds.add('planning:second');
  const members = await grouped.service.getMembers(aggregate.id, { requestId: 'members', snapshotId: reply.snapshotId });
  assert.deepEqual(members.items.map((item) => item.id), ['planning:first/a', 'planning:third']);
  const detail = await grouped.service.getItem(aggregate.id, { requestId: 'aggregate-detail', snapshotId: reply.snapshotId });
  assert.ok(detail.item.kind === 'aggregate'); assert.equal(detail.item.details.memberIds.length, 2);
  assert.notEqual(detail.item.versionId, aggregate.versionId);
});

test('aggregate member HTTP route returns only stored actual original identities and inherited historical mode', async () => {
  await withServer(async (url, f) => {
    const initial = await viewport(url, { ...base, zoom: 8 });
    const aggregate = initial.body.layers[0]!.items[0]!;
    const path = `${url}/v1/map/aggregates/${encodeURIComponent(aggregate.id)}/members`;
    const response = await fetch(`${path}?requestId=member&snapshotId=${initial.body.snapshotId}&pageSize=1`);
    assert.equal(response.status, 200); const members = await response.json() as MapItemPage;
    assert.equal(members.mode, 'historical'); assert.equal(members.items[0]!.id, f.rows[0]!.geo_record_id); assert.ok(members.nextCursor);
    const next = await fetch(`${path}?requestId=member2&snapshotId=${initial.body.snapshotId}&pageSize=1&cursor=${members.nextCursor}`);
    assert.equal(next.status, 200); assert.equal((await next.json() as MapItemPage).items[0]!.id, f.rows[1]!.geo_record_id);
  }, { aggregate: true });
});

test('HTTP concurrent request and total deadline bounds return429/504 without service internals', async () => {
  const f = fixture(); let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const service = { ...f.service, async getCatalog() { await blocked; throw new Error('secret SQL raw.private job-id'); } };
  const server = createMapHttpServer({ service, allowedOrigins: [], maxConcurrentRequests: 1, requestTimeoutMs: 50 });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = fetch(`${url}/v1/map/layers`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await fetch(`${url}/v1/map/layers`); assert.equal(second.status, 429);
    const timeout = await first; assert.equal(timeout.status, 504);
    assert.doesNotMatch(await timeout.text(), /secret|SQL|raw.private|job-id/);
  } finally { release!(); await new Promise<void>((resolve) => server.close(() => resolve())); server.closeAllConnections(); }
});

test('response byte limit keeps item buffers truthful and never emits more than configured bytes', async () => {
  const f = fixture({ maxBytes: 5_000 });
  f.rows[0]!.summary = 'x'.repeat(4_000);
  const response = await f.service.queryViewport({ ...base, pageSize: 1_000 });
  assert.ok(Buffer.byteLength(JSON.stringify(response), 'utf8') <= 5_000);
  assert.equal(response.layers[0]!.totalMatching, null); assert.equal(response.layers[0]!.completeness, 'partial');
});


test('chunked oversized bodies and oversized request headers return bounded schema errors', async () => {
  await withServer(async (url) => {
    const chunked = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest(`${url}/v1/map/viewport`, { method: 'POST', headers: {
        'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, (response) => {
        let contents = ''; response.on('data', (chunk) => { contents += String(chunk); });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: contents }));
      });
      request.on('error', reject); request.write('x'.repeat(128 * 1024)); request.write('x'.repeat(129 * 1024)); request.end();
    });
    assert.equal(chunked.status, 400); assert.equal(JSON.parse(chunked.body).error.code, 'invalidRequest');
    const headers = await fetch(`${url}/v1/map/layers`, { headers: { 'X-Overflow': 'x'.repeat(17 * 1024) } });
    assert.equal(headers.status, 400); assert.equal((await headers.json() as { error: { code: string } }).error.code, 'invalidRequest');
  });
});

test('runner row bound across a single viewport never turns omitted lookahead into a continuation or total', async () => {
  const f = fixture({ rows: Array.from({ length: 1_001 }, (_, i) => row(`planning:item-${String(i).padStart(4, '0')}`)) });
  const result = await f.service.queryViewport({ ...base, pageSize: 1_000 });
  assert.equal(result.layers[0]!.items.length, 1_000);
  assert.equal(result.layers[0]!.completeness, 'partial'); assert.equal(result.layers[0]!.totalMatching, null);
  assert.equal(result.layers[0]!.nextCursor, null);
});

test('the health probe reports warming until the instance is ready, so Cloud Run holds traffic off it', async () => {
  let ready = false;
  const server = createMapHttpServer({ service: fixture().service, allowedOrigins: [], isReady: () => ready });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/healthz`;
  try {
    const warming = await fetch(url);
    assert.equal(warming.status, 503); assert.equal((await warming.json() as { status: string }).status, 'warming');
    ready = true;
    const live = await fetch(url);
    assert.equal(live.status, 200); assert.equal((await live.json() as { status: string }).status, 'ok');
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); server.closeAllConnections(); }
});
