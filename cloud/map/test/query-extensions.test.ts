import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery, parseUnlocatedQuery } from '../src/contracts/map-contract.js';
import { prepareViewQuery } from '../src/query/view-queries.js';
import { prepareUnlocatedQuery } from '../src/query/unlocated-queries.js';
import { preparePublicRecordQuery } from '../src/query/public-record-queries.js';
import { createViewQueryRunner, MapQueryError } from '../src/query/query-runner.js';
import type { BigQueryViewAdapter } from '../src/query/bigquery-adapter.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const request = parseViewportQuery({ requestId: 'scope', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 14,
  layers: ['planning'], mode: 'current', window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' } });
const { bbox: _bbox, zoom: _zoom, ...context } = request;

test('viewport SQL only reads supplied admitted sources and current live records, with no caller SQL path', () => {
  const query = prepareViewQuery({ queryId: 'planning', request, config, pageSize: 10, publicSourceIds: ['public.planning'] });
  assert.match(query.query, /g.source_id IN UNNEST\(JSON_VALUE_ARRAY\(@publicSourceIdsJson\)\)/);
  assert.deepEqual(JSON.parse(String(query.params.publicSourceIdsJson)), ['public.planning']);
  assert.match(query.query, /g.record_status IN \('active', 'planned'\)/);
  assert.doesNotMatch(query.query, /public\.planning|raw|staging/);
});

test('unlocated fixed read requires exact trusted area scope and never spatially counts null geometry', () => {
  const list = parseUnlocatedQuery({ ...context, scope: { areaRefs: ['com:municipal'] } });
  const query = prepareUnlocatedQuery({ queryId: 'planning', request: list, config, pageSize: 10,
    approvedScope: { sourceIds: ['public.planning'], areaRefs: ['com:municipal'], sourceJurisdiction: null } });
  assert.match(query.query, /g.geometry IS NULL/); assert.match(query.query, /UNNEST\(g.area_refs\)/);
  assert.doesNotMatch(query.query, /ST_INTERSECTSBOX|@west|@north/);
  assert.throws(() => prepareUnlocatedQuery({ queryId: 'planning', request: list, config, pageSize: 10,
    approvedScope: { sourceIds: ['public.planning'], areaRefs: ['invented'], sourceJurisdiction: null } }));
});

test('pedestrian drawable/unlocated SQL are complementary for full observation-effective location eligibility', () => {
  const pedestrian = parseViewportQuery({ ...request, layers: ['pedestrian'] });
  const drawable = prepareViewQuery({ queryId: 'pedestrian', request: pedestrian, config, pageSize: 10 });
  assert.match(drawable.query, /p.location_valid_from <= p.observed_at/);
  assert.match(drawable.query, /p.location_valid_to >=/); assert.match(drawable.query, /INTERVAL 1 HOUR/);
  const list = parseUnlocatedQuery({ ...context, layers: ['pedestrian'], scope: { sourceJurisdiction: 'city-of-melbourne' } });
  const unlocated = prepareUnlocatedQuery({ queryId: 'pedestrian', request: list, config, pageSize: 10,
    approvedScope: { sourceIds: ['public.pedestrian'], areaRefs: [], sourceJurisdiction: 'city-of-melbourne' } });
  assert.match(unlocated.query, /p.location_valid_from > p.observed_at/); assert.match(unlocated.query, /p.location_valid_to </);
  assert.throws(() => prepareUnlocatedQuery({ queryId: 'pedestrian', request: parseUnlocatedQuery({ ...list, scope: { areaRefs: ['com:municipal'] } }), config, pageSize: 10,
    approvedScope: { sourceIds: ['public.pedestrian'], areaRefs: ['com:municipal'], sourceJurisdiction: null } }));
});

test('public record proofs retain native identity/version/source or observation identity and exclude withdrawal', () => {
  const keys = [{ id: 'public:item', versionId: 'version1', sourceId: 'public.planning' }];
  const geo = preparePublicRecordQuery({ queryId: 'planning', request, config, pageSize: 1000, recordKeys: keys });
  assert.match(geo.query, /JSON_VALUE\(k, '\$.versionId'\) = g.version_id/);
  assert.match(geo.query, /JSON_VALUE\(k, '\$.sourceId'\) = g.source_id/);
  assert.doesNotMatch(geo.query, /public:item|public\.planning/);
  const historical = preparePublicRecordQuery({ queryId: 'planning', request: { ...request, mode: 'historical' }, config, pageSize: 1000, recordKeys: keys });
  assert.match(historical.query, /v_geo_records_history/); assert.match(historical.query, /g.record_status != 'withdrawn'/);
  const boundary = preparePublicRecordQuery({ queryId: 'boundary', request, config, pageSize: 1000, recordKeys: keys });
  assert.match(boundary.query, /v_boundaries/); assert.match(boundary.query, /b.version_id/);
  const pedestrian = preparePublicRecordQuery({ queryId: 'pedestrian', request, config, pageSize: 1000,
    recordKeys: [{ ...keys[0]!, sensorId: 'sensor1', observedAt: '2026-10-01T00:00:00Z' }] });
  assert.match(pedestrian.query, /p.sensor_id/); assert.match(pedestrian.query, /p.observed_at = SAFE_CAST/);
});

test('unlocated/public-record internal families reject unbound scope/keys before query execution', async () => {
  let calls = 0;
  const adapter: BigQueryViewAdapter = { async dryRun() { calls += 1; return { bytesProcessed: 1n }; },
    async startQuery() { throw new Error('must not execute'); } };
  const runner = createViewQueryRunner({ config, adapter });
  for (const input of [{ family: 'unlocated', queryId: 'planning', request: { ...context, scope: { areaRefs: ['com:municipal'] } } },
    { family: 'publicRecords', queryId: 'planning', request },
    { queryId: 'planning', request, recordKeys: [{ id: 'a', versionId: 'v', sourceId: 's' }] }]) {
    await assert.rejects(runner.run(input), (e: unknown) => e instanceof MapQueryError && e.code === 'invalidRequest');
  }
  assert.equal(calls, 0);
});

test('boundary and pedestrian reads fail closed without a trusted supplemental current record-rights verifier', async () => {
  const { createMapService } = await import('../src/map-service.js');
  const geoStarts: string[] = [];
  const coverage = ['boundary', 'pedestrian'].map((topic) => ({ source_id: `public.${topic}`, topic,
    scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'], coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current', latest_published_batch_id: 'batch1',
    latest_published_at: '2026-10-01T01:00:00Z', latest_published_window_from: '2026-09-01T00:00:00Z',
    latest_published_window_to: '2026-11-01T00:00:00Z', latest_published_output_count: 1, coverage_evidence_state: 'verified' }));
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      if (!query.query.includes('v_source_coverage')) geoStarts.push(query.query);
      return { async readPage() { return { rows: query.query.includes('v_source_coverage')
        ? coverage.map((row) => ({ record: JSON.stringify(row) })) : [], complete: true, hasMore: false }; }, async cancel() {} };
    } };
  const service = createMapService({ config, adapter, publicSources: coverage.map((source) => ({ sourceId: source.source_id,
    url: 'https://example.org/public', attribution: 'Official published source', versionRef: null })) });
  const reply = await service.queryViewport({ ...request, layers: ['boundary', 'pedestrian'], boundaryFilter: { level: 'LGA', vintage: '2021' } });
  assert.deepEqual(reply.layers.map((layer) => layer.state), ['unavailable', 'unavailable']);
  assert.equal(geoStarts.length, 0);
});
