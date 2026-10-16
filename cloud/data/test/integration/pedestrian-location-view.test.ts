import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;

test('production pedestrian SQL preserves closure gaps and rejects inactive, ambiguous and unreferenced locations', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/004_street_views.sql', import.meta.url), 'utf8');
  const body = sql.split('CREATE OR REPLACE VIEW `melens_query.v_pedestrian_observations` AS')[1]
    ?.split(';')[0]?.trim();
  assert.ok(body);
  assert.ok(body.startsWith('WITH '));
  const view = body.slice(5)
    .replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
    .replaceAll('`melens_ingest.data_sources`', 'fixture_sources')
    .replaceAll('`melens_ingest.pedestrian_observations`', 'fixture_observations')
    .replaceAll('`melens_ingest.sensor_locations`', 'fixture_locations')
    .replaceAll('`melens_ingest.source_records`', 'fixture_records');
  const locationSource = 'melbourne.pedestrian.locations';
  const countSource = 'melbourne.pedestrian.minute';
  const instant = (minute: number) => `2026-09-28T00:${String(minute).padStart(2, '0')}:00Z`;
  const point = (longitude: number) => JSON.stringify({ type: 'Point', coordinates: [longitude, -37.81] });
  const locations = [
    { sensor_id: '1', version_id: 'zz-open', geometry_geojson: point(144.96), device_status: 'A',
      valid_from: instant(0), valid_to: null, source_updated_at: instant(0), fetched_at: instant(0) },
    { sensor_id: '1', version_id: 'aa-closed', geometry_geojson: point(144.96), device_status: 'A',
      valid_from: instant(0), valid_to: instant(10), source_updated_at: instant(20), fetched_at: instant(20) },
    { sensor_id: '1', version_id: 'new-place', geometry_geojson: point(144.97), device_status: 'A',
      valid_from: instant(20), valid_to: null, source_updated_at: instant(20), fetched_at: instant(20) },
    { sensor_id: '2', version_id: 'no-coordinate', geometry_geojson: null, device_status: 'A',
      valid_from: instant(0), valid_to: null, source_updated_at: instant(0), fetched_at: instant(0) },
    { sensor_id: '3', version_id: 'inactive', geometry_geojson: point(144.96), device_status: 'I',
      valid_from: instant(0), valid_to: null, source_updated_at: instant(0), fetched_at: instant(0) },
    { sensor_id: '4', version_id: 'overlap-1', geometry_geojson: point(144.96), device_status: 'A',
      valid_from: instant(0), valid_to: null, source_updated_at: instant(0), fetched_at: instant(0) },
    { sensor_id: '4', version_id: 'overlap-2', geometry_geojson: point(144.97), device_status: 'A',
      valid_from: instant(10), valid_to: null, source_updated_at: instant(10), fetched_at: instant(10) },
    { sensor_id: '5', version_id: 'unreferenced', geometry_geojson: point(144.96), device_status: 'A',
      valid_from: instant(0), valid_to: null, source_updated_at: instant(0), fetched_at: instant(0) },
  ].map(row => ({ ...row, batch_id: 'locations', source_id: locationSource,
    source_record_id: `${locationSource}:${row.sensor_id}` }));
  const observations = [['1', 5], ['1', 15], ['1', 25], ['2', 25], ['3', 25], ['4', 25], ['5', 25]]
    .map(([sensor, minute]) => {
      const sensor_id = z.string().parse(sensor);
      const observed_at = instant(z.number().parse(minute));
      return { batch_id: 'counts', source_id: countSource, sensor_id, observed_at,
        version_id: `${sensor_id}:${observed_at}`, source_record_id: `${sensor_id}:${observed_at}` };
    });
  const records = [
    ...locations.filter(row => row.sensor_id !== '5'),
    ...observations.map(row => ({ ...row, source_updated_at: row.observed_at })),
  ];
  const query = `WITH fixture_batches AS (
    SELECT batch_id, source_id, 'published' AS state, TIMESTAMP('2026-09-28T01:00:00Z') AS published_at,
      TIMESTAMP('2026-09-28T01:00:00Z') AS state_updated_at, TIMESTAMP('2026-09-28T00:00:00Z') AS started_at
    FROM UNNEST([STRUCT('locations' AS batch_id, @locationSource AS source_id),
      STRUCT('counts' AS batch_id, @countSource AS source_id)])
  ), fixture_sources AS (
    SELECT source_id, 'verified_open' AS license_status, 'active' AS access_status,
      'sensor_minute' AS record_granularity, CAST(NULL AS INT64) AS cadence_seconds,
      CAST(NULL AS INT64) AS check_interval_seconds,
      TIMESTAMP('2026-09-28T01:00:00Z') AS last_success_at,
      TIMESTAMP('2026-09-28T01:00:00Z') AS updated_at FROM UNNEST([@locationSource, @countSource]) source_id
  ), fixture_observations AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.sensor_id') AS sensor_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      TIMESTAMP(JSON_VALUE(row, '$.observed_at')) AS observed_at,
      TIMESTAMP('2026-09-28T01:00:00Z') AS fetched_at,
      7 AS total_count, CAST(NULL AS INT64) AS direction_a_count, CAST(NULL AS INT64) AS direction_b_count
    FROM UNNEST(JSON_QUERY_ARRAY(@observations)) row
  ), fixture_locations AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.sensor_id') AS sensor_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.geometry_geojson') AS geometry_geojson, JSON_VALUE(row, '$.device_status') AS device_status,
      TIMESTAMP(JSON_VALUE(row, '$.valid_from')) AS valid_from, TIMESTAMP(JSON_VALUE(row, '$.valid_to')) AS valid_to,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at, CAST(NULL AS INT64) AS source_version_ordinal
    FROM UNNEST(JSON_QUERY_ARRAY(@locations)) row
  ), fixture_records AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      CAST(NULL AS INT64) AS source_version_ordinal,
      TIMESTAMP('2026-09-28T01:00:00Z') AS fetched_at,
      'verified_open' AS rights_status, 'active' AS record_status
    FROM UNNEST(JSON_QUERY_ARRAY(@records)) row
  ), result AS (${view.replace(/^/, 'WITH ')} )
  SELECT sensor_id, FORMAT_TIMESTAMP('%M', observed_at) AS minute, location_status,
    geometry_geojson, total_count FROM result ORDER BY sensor_id, observed_at`;
  let rows: unknown;
  try {
    [rows] = await new BigQuery({ projectId: project }).query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '100000000', useQueryCache: false, params: {
        locationSource, countSource, locations: JSON.stringify(locations),
        observations: JSON.stringify(observations), records: JSON.stringify(records),
      } });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Cloud query failed');
  }
  const parsed = z.array(z.object({ sensor_id: z.string(), minute: z.string(), location_status: z.string(),
    geometry_geojson: z.string().nullable(), total_count: z.number() })).parse(rows);
  assert.deepEqual(parsed.map(row => [row.sensor_id, row.minute, row.location_status]), [
    ['1', '05', 'located'], ['1', '15', 'unlocated'], ['1', '25', 'located'],
    ['2', '25', 'unlocated'], ['3', '25', 'inactive'], ['4', '25', 'ambiguous'], ['5', '25', 'unlocated'],
  ]);
  assert.equal(parsed[0]?.geometry_geojson, point(144.96));
  assert.equal(parsed[2]?.geometry_geojson, point(144.97));
  assert.equal(parsed.filter(row => row.location_status !== 'located').every(row => row.geometry_geojson === null), true);
  assert.equal(parsed.every(row => row.total_count === 7), true);
});
