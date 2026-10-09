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
