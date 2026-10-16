import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import { mapItemSchema, parseViewportQuery } from '../src/contracts/map-contract.js';
import type { PublicSourceReference } from '../src/query/adapter-common.js';
import type { PreparedViewQuery } from '../src/query/bigquery-adapter.js';
import { NEWS_AREA_MEMBERS, createNewsAreaLoader, prepareNewsAreaBoundariesLoad, prepareNewsAreaRowsLoad }
  from '../src/query/news-areas.js';
import type { ViewQueryResult } from '../src/query/query-runner.js';
import type { PublicSourceCoverage, SourceCoverageSnapshot } from '../src/query/source-coverage.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const gdelt: PublicSourceReference = { sourceId: 'gdelt.news', url: 'https://www.gdeltproject.org/',
  attribution: 'GDELT metadata', versionRef: null };
const asgs: PublicSourceReference = { sourceId: 'abs.asgs', url: 'https://www.abs.gov.au/',
  attribution: 'Australian Bureau of Statistics', versionRef: null };
const resolveSource = (id: string) => id === gdelt.sourceId ? gdelt : id === asgs.sourceId ? asgs : null;
const request = parseViewportQuery({ requestId: 'news-areas', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 12,
  layers: ['news'], mode: 'current', window: { from: '2026-10-15T23:45:00Z', to: '2026-10-16T00:00:00Z' } });
const layerCoverage = { state: 'unknown' as const, areaRefs: [], window: null, evidenceSourceIds: [] };

function square(west: number, south: number, size: number) {
  return JSON.stringify({ type: 'Polygon', coordinates: [[[west, south], [west + size, south], [west + size, south + size],
    [west, south + size], [west, south]]] });
}
const boundaries = [
  { boundary_id: 'ASGS_LGA:24600:2025', version_id: 'b1', name: 'Melbourne', source_id: 'abs.asgs',
    geometry_geojson: square(144.9, -37.85, 0.1) },
  { boundary_id: 'ASGS_SA2:206071143:2026', version_id: 'b2', name: 'Richmond', source_id: 'abs.asgs',
    geometry_geojson: square(144.99, -37.83, 0.02) },
  // Simplified into a collection the contract cannot draw: skipped, not a failed load.
  { boundary_id: 'ASGS_LGA:21010:2025', version_id: 'b4', name: 'Bad shape', source_id: 'abs.asgs',
    geometry_geojson: JSON.stringify({ type: 'GeometryCollection', geometries: [] }) },
  // Named by an article, but outside the requested viewport.
  { boundary_id: 'ASGS_LGA:22750:2025', version_id: 'b3', name: 'Greater Geelong', source_id: 'abs.asgs',
    geometry_geojson: square(144.3, -38.2, 0.1) },
];
function article(id: string, processedAt: string, refs: string[], extra: Record<string, unknown> = {}) {
  return { geo_record_id: id, version_id: `${id}-v1`, source_id: 'gdelt.news', topic: 'news', assertion_kind: 'report',
    is_prediction: false, title: `Headline ${id}`, summary: null, original_url: `https://example.org/${id}`,
    geometry_geojson: null, location_role: 'mentioned_place', location_confidence: 'unverified', area_refs: refs,
    observed_at: null, published_at: null, valid_from: null, valid_to: null, fetched_at: '2026-10-16T00:00:00Z',
    source_updated_at: processedAt, record_status: 'active', ...extra };
}
function coverageSource(sourceId: string, topic: string, batch: string): PublicSourceCoverage {
  return { sourceId, topic, scope: 'victoria', coverageAreaRefs: [], coverageFrom: null, coverageTo: null,
    licenseStatus: 'verified_open', accessStatus: 'active', admitted: true, healthState: 'current',
    publishedBatchId: batch, publishedAt: '2026-10-15T23:30:00Z', publishedWindow: null, publishedOutputCount: 1,
    evidenceState: 'unknown' };
}
const coverage: SourceCoverageSnapshot = { completeness: 'complete', sources: [coverageSource('gdelt.news', 'news', 'n1')] };
const complete = (rows: readonly Record<string, unknown>[]): ViewQueryResult =>
  ({ kind: 'complete', rows: rows as never, totalMatching: rows.length, resultBytes: 2 });

function harness(rows: Record<string, unknown>[], state: Record<string, unknown>[] = [{ source_id: 'gdelt.news', batch_id: 'n1' }]) {
  const queries: PreparedViewQuery[] = [];
  const now = Date.parse('2026-10-16T00:00:00Z');
  const runner = { async runPrepared(query: PreparedViewQuery): Promise<ViewQueryResult> {
    queries.push(query);
    if (query.query.includes('v_boundaries')) return complete(boundaries);
    if (query.query.includes('v_geo_records_current_state')) return complete(state);
    return complete(rows);
  } };
  const { load, warm } = createNewsAreaLoader({ config, runner, clock: () => new Date(now) });
  const read = (overrides: Partial<Parameters<typeof load>[1]> = {}, query = request) => load(query, {
    coverage, layerCoverage, publicSourceIds: ['gdelt.news'], resolveSource, rowLimit: 500, ...overrides });
  return { read, warm, queries };
}
const published = (batch: string): SourceCoverageSnapshot =>
  ({ completeness: 'complete', sources: [coverageSource('gdelt.news', 'news', batch)] });

test('news area loads keep only the summary text, take mentions only and simplify the outlines they draw', () => {
  const rows = prepareNewsAreaRowsLoad(config, 100).query;
  assert.match(rows, /STRUCT\(JSON_VALUE\(g\.summary, '\$\.summary_text'\) AS summary_text\)\) END AS summary,/);
  assert.doesNotMatch(rows, /g\.title, g\.summary, g\.original_url/);
  assert.match(rows, /g\.geometry IS NULL AND ARRAY_LENGTH\(g\.area_refs\) > 0/);
  assert.match(rows, /ORDER BY COALESCE\(g\.published_at, g\.observed_at, g\.source_updated_at\) DESC/);
  assert.match(prepareNewsAreaBoundariesLoad(config, 100).query, /ST_DUMP\(ST_SIMPLIFY\(b\.geometry, 100\), 2\)/);
});

test('each named area in view becomes one polygon aggregate with its story count and latest stories', async () => {
  const rows = [
    ...Array.from({ length: 7 }, (_, index) => article(`news:m${index}`, `2026-10-15T23:0${index}:00Z`, ['ASGS_LGA:24600:2025'])),
    article('news:both', '2026-10-15T23:50:00Z', ['ASGS_LGA:24600:2025', 'ASGS_SA2:206071143:2026']),
    // An older syndicated copy of the same story from another outlet: counted and listed once.
    article('news:copy', '2026-10-15T23:40:00Z', ['ASGS_LGA:24600:2025'], { title: 'HEADLINE news:both!' }),
    article('news:geelong', '2026-10-15T23:00:00Z', ['ASGS_LGA:22750:2025', 'ASGS_LGA:21010:2025']),
    // Older than the current week, and from after the window end.
    article('news:old', '2026-10-01T00:00:00Z', ['ASGS_SA2:206071143:2026']),
    article('news:future', '2026-10-16T00:30:00Z', ['ASGS_SA2:206071143:2026']),
  ].sort((left, right) => left.source_updated_at < right.source_updated_at ? 1 : -1);
  const groups = await harness(rows).read();
  assert.deepEqual(groups.map((group) => group.aggregate.id),
    ['aggregate.news.area.ASGS_LGA:24600:2025', 'aggregate.news.area.ASGS_SA2:206071143:2026']);
  const [city, richmond] = groups;
  assert.ok(city !== undefined && richmond !== undefined);
  assert.equal(city.aggregate.kind, 'aggregate');
  if (city.aggregate.kind !== 'aggregate') return;
  assert.equal(city.aggregate.geometry?.type, 'Polygon');
  assert.deepEqual(city.aggregate.location, { precision: 'area', role: 'areaAssociation',
    evidence: 'Official boundary of an area these articles name. A named place is not where the reported event happened.' });
  assert.equal(city.aggregate.details.representation, 'areaMentions');
  assert.equal(city.aggregate.details.metric.value, 8);
  assert.deepEqual(city.aggregate.details.resultRange, { scope: 'areaAssociation', returnedCount: NEWS_AREA_MEMBERS, totalMatching: 8 });
  // The newest five, listed in contract id order.
  assert.deepEqual(city.members.map((member) => member.id), ['news:both', 'news:m3', 'news:m4', 'news:m5', 'news:m6']);
  assert.deepEqual(city.aggregate.details.memberIds, city.members.map((member) => member.id));
  assert.ok(city.members.every((member) => member.geometry === null && member.time.reportedAt === null));
  assert.deepEqual(city.aggregate.sources, [{ ...asgs, versionRef: 'b1' }, gdelt]);
  assert.equal(city.aggregate.title, 'Melbourne council area: 8 news stories');
  assert.equal(richmond.aggregate.title, 'Richmond: 1 news story');
  assert.deepEqual(richmond.members.map((member) => member.id), ['news:both']);
  assert.ok(mapItemSchema.safeParse(city.aggregate).success);
});

test('dense views list fewer articles per area so every member fits the row limit', async () => {
  const rows = [article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025', 'ASGS_SA2:206071143:2026']),
    article('news:b', '2026-10-15T22:00:00Z', ['ASGS_LGA:24600:2025', 'ASGS_SA2:206071143:2026'])];
  const { read } = harness(rows);
  assert.deepEqual((await read({ rowLimit: 2 })).map((group) => group.members.length), [1, 1]);
  assert.deepEqual(await read({ rowLimit: 1 }), []);
});

test('no areas without an admitted source, in historical mode, or from a copy behind the registry', async () => {
  const rows = [article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025'])];
  assert.deepEqual(await harness(rows).read({ publicSourceIds: [] }), []);
  assert.deepEqual(await harness(rows).read({}, { ...request, mode: 'historical' }), []);
  assert.deepEqual(await harness(rows, [{ source_id: 'gdelt.news', batch_id: 'n0' }]).read(), []);
  // A boundary whose source is not public cannot be drawn.
  assert.deepEqual(await harness(rows).read({ resolveSource: (id) => id === gdelt.sourceId ? gdelt : null }), []);
});

test('one load serves requests until the news source publishes again', async () => {
  const { read, queries } = harness([article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025'])]);
  await read();
  await read();
  assert.equal(queries.length, 3);
});

test('a copy behind the registry is not reloaded on every request', async () => {
  const { read, queries } = harness([article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025'])],
    [{ source_id: 'gdelt.news', batch_id: 'n0' }]);
  assert.deepEqual(await read(), []);
  assert.deepEqual(await read(), []);
  assert.equal(queries.length, 3);
});

test('warming loads the copy before the first news request, which then reads it at once', async () => {
  const { read, warm, queries } = harness([article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025'])]);
  warm(coverage);
  warm(coverage);
  assert.equal(queries.length, 3, 'one load however often it is warmed');
  assert.equal((await read()).length, 1);
  assert.equal(queries.length, 3);
});

test('a new publication reloads the articles but keeps the outlines until an article names a new area', async () => {
  const rows = [article('news:a', '2026-10-15T23:00:00Z', ['ASGS_LGA:24600:2025'])];
  const state = [{ source_id: 'gdelt.news', batch_id: 'n1' }];
  const { read, queries } = harness(rows, state);
  await read();
  const boundaryReads = () => queries.filter((query) => query.query.includes('v_boundaries')).length;
  assert.equal(boundaryReads(), 1);

  state[0]!.batch_id = 'n2';
  rows.push(article('news:b', '2026-10-15T23:30:00Z', ['ASGS_LGA:24600:2025']));
  assert.equal((await read({ coverage: published('n2') }))[0]?.aggregate.details.metric.value, 2);
  assert.equal(boundaryReads(), 1, 'the same areas reuse their outlines');

  state[0]!.batch_id = 'n3';
  rows.push(article('news:c', '2026-10-15T23:40:00Z', ['ASGS_SA2:206071143:2026']));
  assert.equal((await read({ coverage: published('n3') })).length, 2);
  assert.equal(boundaryReads(), 2, 'a newly named area reads the outlines again');
});
