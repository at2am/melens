import assert from 'node:assert/strict';
import test from 'node:test';
import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import { preparePublicRecordQuery, type PublicRecordKeys } from '../src/query/public-record-queries.js';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const request = parseViewportQuery({ requestId: 'public-record-key-fixture', bbox: [144.9, -37.9, 145.1, -37.7],
  zoom: 14, layers: ['planning', 'boundary', 'pedestrian'], mode: 'current',
  window: { from: '2026-10-15T00:00:00Z', to: '2026-10-15T01:00:00Z' },
  boundaryFilter: { level: 'LGA', vintage: '2021' } });

const geoKeys: PublicRecordKeys = [
  { id: 'wanted', versionId: 'v1', sourceId: 'public.geo' },
  { id: 'wanted', versionId: 'v1', sourceId: 'public.geo' },
  { id: 'cancelled', versionId: 'v1', sourceId: 'public.geo' },
  { id: 'withdrawn', versionId: 'v1', sourceId: 'public.geo' },
  { id: 'revoked', versionId: 'v1', sourceId: 'public.geo' },
];
const boundaryKeys: PublicRecordKeys = [
  { id: 'wanted', versionId: 'v1', sourceId: 'public.boundary' },
  { id: 'wanted', versionId: 'v1', sourceId: 'public.boundary' },
  { id: 'revoked', versionId: 'v1', sourceId: 'public.boundary' },
];
const pedestrianKey = { id: 'pedestrian:one', versionId: 'content:v1', sourceId: 'public.pedestrian', sensorId: 'sensor:one' };
const pedestrianKeys: PublicRecordKeys = [
  { ...pedestrianKey, observedAt: '2026-10-15T00:00:00Z' },
  { ...pedestrianKey, observedAt: '2026-10-15T00:00:00.000000Z' },
  { ...pedestrianKey, observedAt: '2026-10-15T00:00:00+00:00' },
  { ...pedestrianKey, sensorId: 'sensor:absent', observedAt: 'not-a-timestamp' },
];

test('public-record key joins retain fixed views, limits and complete tuple matching', () => {
  for (const queryId of ['planning', 'disruption', 'event', 'news', 'boundary', 'pedestrian'] as const) {
    const keys = queryId === 'pedestrian' ? pedestrianKeys : queryId === 'boundary' ? boundaryKeys : geoKeys;
    const query = preparePublicRecordQuery({ queryId, request, config, pageSize: 1_000, recordKeys: keys });
    assert.doesNotMatch(query.query, /EXISTS|melens_ingest/);
    assert.match(query.query, /JOIN \(\s*SELECT DISTINCT/);
    assert.match(query.query, /requested\.source_id = [gbp]\.source_id/);
    assert.match(query.query, /LIMIT @resultLimit/);
    assert.equal(query.params.resultLimit, 1_001);
    assert.equal(query.params.publicRecordKeysJson, JSON.stringify(keys));
    assert.equal(query.maximumBytesBilled, String(queryId === 'boundary' ? config.historicalScanBytes : config.dynamicScanBytes));
  }
});

test('GoogleSQL public-record joins reject wrong tuples, preserve lifecycle and deduplicate equivalent UTC keys', {
  skip: !enabled, timeout: 60_000,
}, async () => {
  assert.ok(project);
  const fixtureQuery = (queryId: 'planning' | 'boundary' | 'pedestrian', mode: 'current' | 'historical',
    keys: PublicRecordKeys, view: string, fixture: string, parameter: string) => preparePublicRecordQuery({
    queryId, request: { ...request, mode }, config, pageSize: 1_000, recordKeys: keys,
  }).query.replaceAll(`\`melens-testing.melens_query.${view}\``, fixture)
    .replaceAll('@publicRecordKeysJson', `@${parameter}`);
  const current = fixtureQuery('planning', 'current', geoKeys, 'v_geo_records_current', 'fixture_geo', 'geoKeys');
  const historical = fixtureQuery('planning', 'historical', geoKeys, 'v_geo_records_history', 'fixture_geo', 'geoKeys');
  const boundary = fixtureQuery('boundary', 'current', boundaryKeys, 'v_boundaries', 'fixture_boundary', 'boundaryKeys');
  const pedestrian = fixtureQuery('pedestrian', 'current', pedestrianKeys, 'v_pedestrian_observations', 'fixture_pedestrian', 'pedestrianKeys');
  const query = `WITH fixture_geo AS (
    SELECT r.*, 'planning' topic, 'report' assertion_kind, FALSE is_prediction,
      'Fixture' title, CAST(NULL AS STRING) summary, CAST(NULL AS STRING) original_url,
      CAST(NULL AS STRING) geometry_geojson, 'unknown' location_role, 'unverified' location_confidence,
      ARRAY<STRING>[] area_refs, CAST(NULL AS TIMESTAMP) observed_at,
      CAST(NULL AS TIMESTAMP) published_at, CAST(NULL AS TIMESTAMP) valid_from,
      CAST(NULL AS TIMESTAMP) valid_to, TIMESTAMP('2026-10-15T00:00:00Z') fetched_at,
      'current' freshness_state
    FROM UNNEST([
      STRUCT('wanted' AS geo_record_id, 'v1' AS version_id, 'public.geo' AS source_id, 'active' AS record_status),
      STRUCT('wanted', 'v2', 'public.geo', 'active'), STRUCT('wanted', 'v1', 'other.geo', 'active'),
      STRUCT('unrequested', 'v1', 'public.geo', 'active'), STRUCT('cancelled', 'v1', 'public.geo', 'cancelled'),
      STRUCT('withdrawn', 'v1', 'public.geo', 'withdrawn')]) r
  ), fixture_boundary AS (
    SELECT r.*, 'ASGS_LGA' scheme, '24600' code, 'Fixture' name, '2021' vintage,
      CAST(NULL AS STRING) geometry_geojson, CAST(NULL AS TIMESTAMP) valid_from,
      CAST(NULL AS TIMESTAMP) valid_to, 'source:boundary' source_record_id,
      'fixture-batch' batch_id, TIMESTAMP('2026-10-15T00:00:00Z') fetched_at,
      'latest_published_record_v1' rights_evidence
    FROM UNNEST([
      STRUCT('wanted' AS boundary_id, 'v1' AS version_id, 'public.boundary' AS source_id),
      STRUCT('wanted', 'v2', 'public.boundary'), STRUCT('wanted', 'v1', 'other.boundary'),
      STRUCT('unrequested', 'v1', 'public.boundary')]) r
  ), fixture_pedestrian AS (
    SELECT r.*, 'fixture-batch' batch_id, 'source:observation' source_record_id, 'native-v1' version_id,
      CAST(NULL AS INT64) direction_a_count, CAST(NULL AS INT64) direction_b_count, 7 total_count,
      'sensor_minute' record_granularity, TIMESTAMP('2026-10-15T00:00:00Z') fetched_at,
      TIMESTAMP('2026-10-15T00:00:00Z') source_last_success_at,
      CAST(NULL AS STRING) location_source_id, CAST(NULL AS STRING) location_source_record_id,
      CAST(NULL AS STRING) location_version_id, 'latest_published_record_v1' rights_evidence,
      CAST(NULL AS TIMESTAMP) location_valid_from, CAST(NULL AS TIMESTAMP) location_valid_to,
      CAST(NULL AS STRING) geometry_geojson, 'unlocated' location_status, 'current' source_freshness_state
    FROM UNNEST([
      STRUCT('public.pedestrian' AS source_id, 'sensor:one' AS sensor_id, TIMESTAMP('2026-10-15T00:00:00Z') AS observed_at),
      STRUCT('other.pedestrian', 'sensor:one', TIMESTAMP('2026-10-15T00:00:00Z')),
      STRUCT('public.pedestrian', 'sensor:other', TIMESTAMP('2026-10-15T00:00:00Z')),
      STRUCT('public.pedestrian', 'sensor:one', TIMESTAMP('2026-10-15T00:01:00Z'))]) r
  )
  SELECT 'geoCurrent' family, record FROM (${current})
  UNION ALL SELECT 'geoHistory', record FROM (${historical})
  UNION ALL SELECT 'boundary', record FROM (${boundary})
  UNION ALL SELECT 'pedestrian', record FROM (${pedestrian}) ORDER BY family, record`;
  assert.doesNotMatch(query, /melens_query|melens_ingest/);
  let rows: unknown;
  try {
    [rows] = await new BigQuery({ projectId: project }).query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '1000000', jobTimeoutMs: 20_000, useQueryCache: false,
      params: { geoKeys: JSON.stringify(geoKeys), boundaryKeys: JSON.stringify(boundaryKeys),
        pedestrianKeys: JSON.stringify(pedestrianKeys), resultLimit: 1_001 } });
  } catch (error) {
    const parsed = z.object({ code: z.union([z.string(), z.number()]).optional() }).safeParse(error);
    throw new Error(`Public-record fixture query failed (${parsed.success ? parsed.data.code ?? 'unknown' : 'unknown'})`);
  }
  const parsed = z.array(z.object({ family: z.string(), record: z.string() })).parse(rows);
  const identifiers = parsed.map(({ family, record }) => {
    const row = z.object({ geo_record_id: z.string().optional(), boundary_id: z.string().optional(),
      sensor_id: z.string().optional(), source_id: z.string(), version_id: z.string() }).parse(JSON.parse(record));
    return [family, row.geo_record_id ?? row.boundary_id ?? row.sensor_id, row.source_id, row.version_id];
  });
  assert.deepEqual(identifiers, [
    ['boundary', 'wanted', 'public.boundary', 'v1'],
    ['geoCurrent', 'wanted', 'public.geo', 'v1'],
    ['geoHistory', 'cancelled', 'public.geo', 'v1'],
    ['geoHistory', 'wanted', 'public.geo', 'v1'],
    ['pedestrian', 'sensor:one', 'public.pedestrian', 'native-v1'],
  ]);
});
