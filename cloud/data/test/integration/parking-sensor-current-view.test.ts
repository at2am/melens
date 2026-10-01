import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const source = 'melbourne.parking.sensors';
const now = '2026-10-01T02:00:00Z';
const recent = '2026-10-01T01:59:30Z';
const old = '2026-09-30T01:00:00Z';
const point = JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] });

function sensor(id: string, batch = 'new', options: {
  occupied?: boolean; observedAt?: string; updatedAt?: string;
  rights?: string; version?: string; geometry?: string;
} = {}) {
  return { sensor_id: id, batch_id: batch, source_id: source,
    source_record_id: `${id}:${options.version ?? 'v1'}`, version_id: options.version ?? 'v1',
    fetched_at: recent, observed_at: options.observedAt ?? old,
    source_updated_at: options.updatedAt ?? recent, occupied: options.occupied ?? false,
    rights_status: options.rights ?? 'verified_open', record_status: 'active',
    marker_id: null, bay_id: null, geometry_geojson: options.geometry ?? point,
    original_url: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/',
  };
}

const rowsSchema = z.array(z.object({ sensor_id: z.string(), occupied: z.boolean().nullable(),
  status_changed_at: z.unknown(), source_freshness: z.enum(['current', 'late', 'stale', 'unknown']),
  occupancy_freshness: z.enum(['current', 'late', 'stale', 'unknown']),
  is_public_holiday: z.boolean().nullable(), geometry_geojson: z.string().nullable(),
  availability_note: z.string(), may_park_now: z.literal('unknown'), business_batch_id: z.string() }));

test('independent production parking sensor SQL preserves snapshot membership, sensor refresh time and operating limits', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/003_parking_views.sql', import.meta.url), 'utf8');
  const selected = sql.split('CREATE OR REPLACE VIEW `melens_query.v_parking_sensor_current` AS')[1]
    ?.split(';')[0]?.trim();
  assert.ok(selected);
  const body = selected.replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
    .replaceAll('`melens_ingest.data_sources`', 'fixture_sources')
    .replaceAll('`melens_ingest.source_records`', 'fixture_records')
    .replaceAll('`melens_ingest.parking_observations`', 'fixture_observations')
    .replaceAll('`melens_ingest.parking_sensor_memberships`', 'fixture_memberships')
    .replaceAll('`melens_ingest.geo_records`', 'fixture_geography')
    .replaceAll('CURRENT_TIMESTAMP()', 'TIMESTAMP(@now)')
    .replaceAll("CURRENT_DATE('Australia/Melbourne')", "DATE(TIMESTAMP(@now), 'Australia/Melbourne')");
  const rows = [sensor('stable', 'old'), sensor('gone', 'old'), sensor('moved', 'old'),
    sensor('moved', 'new', { geometry: JSON.stringify({ type: 'Point', coordinates: [144.97, -37.82] }) }),
    sensor('withdrawn', 'old'), sensor('withdrawn', 'new', { rights: 'review_required' }),
    sensor('future', 'new', { updatedAt: '2026-10-01T02:01:00Z' }),
    sensor('stale', 'new', { updatedAt: old }), sensor('conflict', 'new', { version: 'a' }),
    sensor('conflict', 'new', { occupied: true, version: 'b' }), sensor('orphan')];
  const batches = [{ batch_id: 'old', source_id: source, started_at: old, state: 'published',
    published_at: old, state_updated_at: old },
  { batch_id: 'new', source_id: source, started_at: recent, state: 'published',
    published_at: recent, state_updated_at: recent },
  { batch_id: 'failed', source_id: source, started_at: now, state: 'failed',
    published_at: null, state_updated_at: now }];
  const query = `WITH fixture_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.state') AS state, TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.started_at')) AS started_at FROM UNNEST(JSON_QUERY_ARRAY(@batches)) row
  ), fixture_sources AS (
    SELECT @source AS source_id, 120 AS cadence_seconds, 120 AS check_interval_seconds,
      TIMESTAMP(@recent) AS last_success_at, 'verified_open' AS license_status,
      'active' AS access_status, TIMESTAMP(@recent) AS updated_at
  ), fixture_observations AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.sensor_id') AS sensor_id, JSON_VALUE(row, '$.marker_id') AS marker_id,
      JSON_VALUE(row, '$.bay_id') AS bay_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      CAST(JSON_VALUE(row, '$.occupied') AS BOOL) AS occupied,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at,
      TIMESTAMP(JSON_VALUE(row, '$.observed_at')) AS observed_at FROM UNNEST(JSON_QUERY_ARRAY(@rows)) row
  ), fixture_records AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.version_id') AS version_id, JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.record_status') AS record_status, JSON_VALUE(row, '$.rights_status') AS rights_status,
      JSON_VALUE(row, '$.original_url') AS original_url,
      TIMESTAMP(JSON_VALUE(row, '$.observed_at')) AS observed_at,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at
    FROM UNNEST(JSON_QUERY_ARRAY(@rows)) row WHERE JSON_VALUE(row, '$.sensor_id') != 'orphan'
    UNION ALL
    SELECT 'new', @source, 'snapshot-v1', 'snapshot-new', 'active', 'verified_open',
      'https://data.melbourne.vic.gov.au/', CAST(NULL AS TIMESTAMP), TIMESTAMP(@recent), TIMESTAMP(@recent)
  ), fixture_memberships AS (
    SELECT 'new' AS batch_id, @source AS source_id, JSON_VALUE(row, '$.sensor_id') AS sensor_id,
      JSON_VALUE(row, '$.source_record_id') AS business_source_record_id,
      'fixture-business-state-hash' AS business_state_hash,
      JSON_VALUE(row, '$.version_id') AS business_version_id,
      JSON_VALUE(row, '$.batch_id') AS business_batch_id,
      'snapshot-new' AS snapshot_source_record_id, 'snapshot-v1' AS snapshot_version_id,
      CONCAT('member-', JSON_VALUE(row, '$.sensor_id'), '-', JSON_VALUE(row, '$.version_id')) AS version_id,
      TIMESTAMP(@recent) AS fetched_at,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at
    FROM UNNEST(JSON_QUERY_ARRAY(@rows)) row
    WHERE JSON_VALUE(row, '$.batch_id') = 'new' OR JSON_VALUE(row, '$.sensor_id') = 'stable'
  ), fixture_geography AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.version_id') AS version_id, JSON_VALUE(row, '$.source_record_id') AS geo_record_id,
      JSON_VALUE(row, '$.geometry_geojson') AS geometry_geojson, -37.81 AS centroid_lat, 144.96 AS centroid_lon,
      CAST(NULL AS STRING) AS summary,
      'sensor_site' AS location_role, 'source_coordinate' AS location_confidence,
      'active' AS record_status, 'verified_open' AS rights_status, TRUE AS public_query_allowed
    FROM UNNEST(JSON_QUERY_ARRAY(@rows)) row
  ), result AS (${body})
  SELECT sensor_id, occupied, status_changed_at, source_freshness, occupancy_freshness,
    is_public_holiday, geometry_geojson, availability_note, may_park_now, business_batch_id FROM result`;
  const client = new BigQuery({ projectId: project });
  async function run(clock: string, states = batches) {
    const shift = (value: string) => new Date(Date.parse(value) + Date.parse(clock) - Date.parse(now)).toISOString();
    const shiftedRows = rows.map(row => ({ ...row, fetched_at: shift(row.fetched_at),
      observed_at: shift(row.observed_at), source_updated_at: shift(row.source_updated_at) }));
    const shiftedBatches = states.map(batch => ({ ...batch, started_at: shift(batch.started_at),
      state_updated_at: shift(batch.state_updated_at),
      published_at: batch.published_at === null ? null : shift(batch.published_at) }));
    let result: unknown;
    try {
      [result] = await client.query({ query, location: 'australia-southeast2',
        maximumBytesBilled: '100000000', useQueryCache: false,
        params: { source, now: clock, recent: shift(recent), rows: JSON.stringify(shiftedRows),
          batches: JSON.stringify(shiftedBatches) } });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Parking SQL query failed');
    }
    return rowsSchema.parse(result);
  }
  const current = await run(now);
  const stable = current.find(row => row.sensor_id === 'stable');
  assert.ok(stable);
  assert.equal(stable.occupied, false);
  assert.equal(stable.source_freshness, 'current');
  assert.equal(stable.occupancy_freshness, 'current');
  assert.equal(stable.is_public_holiday, false);
  assert.equal(stable.business_batch_id, 'old', 'A fresh snapshot can reference a prior published business batch');
  assert.equal(current.some(row => ['gone', 'withdrawn', 'orphan'].includes(row.sensor_id)), false);
  assert.equal(current.find(row => row.sensor_id === 'moved')?.geometry_geojson, rows[3]?.geometry_geojson);
  assert.equal(current.find(row => row.sensor_id === 'conflict')?.occupied, null);
  assert.equal(current.find(row => row.sensor_id === 'conflict')?.geometry_geojson, null);
  assert.equal(current.find(row => row.sensor_id === 'future')?.source_freshness, 'unknown');
  assert.equal(current.find(row => row.sensor_id === 'stale')?.source_freshness, 'stale');
  const ordinary = await run('2026-09-30T15:00:00Z');
  // 01 October is a known ordinary Melbourne day even while UTC remains 30 September.
  assert.ok(ordinary.length > 0 && ordinary.every(row => row.is_public_holiday === false));
  const holiday = await run('2026-11-02T15:00:00Z');
  assert.ok(holiday.length > 0 && holiday.every(row => row.is_public_holiday === true
    && row.occupancy_freshness === 'unknown'
    && row.availability_note === (row.sensor_id === 'conflict'
      ? 'conflicting_sensor_records' : 'sensor_not_operational_public_holiday')));
  const nextYear = await run('2027-01-02T02:00:00Z');
  assert.ok(nextYear.length > 0 && nextYear.every(row => row.is_public_holiday === null
    && row.occupancy_freshness === 'unknown'));
  const empty = await run(now, [...batches, { batch_id: 'empty', source_id: source,
    started_at: now, state: 'published', published_at: now, state_updated_at: now }]);
  assert.deepEqual(empty, []);
});
