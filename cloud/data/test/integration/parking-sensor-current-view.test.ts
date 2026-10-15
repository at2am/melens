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

const VIEW_HEADER = 'CREATE OR REPLACE VIEW `melens_query.v_parking_sensor_current` AS';
async function sensorViewSql(): Promise<string> {
  const sql = await readFile(new URL('../../../sql/003_parking_views.sql', import.meta.url), 'utf8');
  const selected = sql.split(VIEW_HEADER)[1]?.split(/;\s*\n/)[0]?.trim();
  assert.ok(selected, 'The sensor view must be defined in 003_parking_views.sql');
  return selected;
}

// Not a cloud test: it always runs. It stops the view being pointed back at the append-only
// history, which made a map read scan 165 MB (limit 100 MB) and grow with every retained snapshot.
test('the sensor view reads only the latest-snapshot table, never the append-only history', async () => {
  const view = await sensorViewSql();
  const tables = [...view.matchAll(/`melens_ingest\.([a-z_]+)`/g)].map(match => match[1]).sort();
  assert.deepEqual([...new Set(tables)], ['data_sources', 'parking_sensor_current', 'sync_batches']);
  for (const history of ['parking_sensor_memberships', 'source_records', 'geo_records', 'geo_record_sources',
    'parking_observations']) {
    assert.ok(!view.includes(history), `${history} is append-only history and must not be in the map read path`);
  }
});

test('the sensor view keeps its public contract and never grants legal permission', async () => {
  const view = await sensorViewSql();
  for (const column of ['sensor_id', 'occupied', 'reported_status', 'zone_number', 'status_changed_at',
    'source_updated_at', 'latitude', 'longitude', 'geometry_geojson', 'source_freshness',
    'occupancy_freshness', 'availability_note', 'may_park_now']) {
    assert.match(view, new RegExp(`\\b${column}\\b`), `${column} is part of the view contract`);
  }
  assert.match(view, /'unknown' AS may_park_now/, 'No crosswalk to rules is admitted, so permission stays unknown');
  assert.match(view, /sensor_not_reporting/, 'A sensor that stopped reporting must be labelled, not shown as vacant');
});

function sensor(id: string, batch = 'new', options: {
  occupied?: boolean | null; observedAt?: string | null; updatedAt?: string;
  rights?: string; status?: string; geometry?: string | null;
} = {}) {
  const geometry = options.geometry === undefined ? point : options.geometry;
  return { sensor_id: id, batch_id: batch, source_id: source,
    source_record_id: `${source}:${id}`, version_id: 'v1', fetched_at: recent,
    observed_at: options.observedAt === undefined ? old : options.observedAt,
    source_updated_at: options.updatedAt ?? recent,
    occupied: options.occupied === undefined ? false : options.occupied,
    status_description: 'Unoccupied', zone_number: 7, marker_id: null, bay_id: null,
    latitude: geometry === null ? null : -37.81, longitude: geometry === null ? null : 144.96,
    geometry_geojson: geometry, rights_status: options.rights ?? 'verified_open',
    record_status: options.status ?? 'active',
    original_url: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/',
  };
}

const freshness = z.enum(['current', 'late', 'stale', 'unknown']);
const rowsSchema = z.array(z.object({ sensor_id: z.string(), batch_id: z.string(), occupied: z.boolean().nullable(),
  status_changed_at: z.unknown(), source_freshness: freshness, occupancy_freshness: freshness,
  is_public_holiday: z.boolean().nullable(), geometry_geojson: z.string().nullable(), latitude: z.number().nullable(),
  availability_note: z.string(), may_park_now: z.literal('unknown') }));

test('production sensor SQL separates live, silent and withdrawn sensors and honours the operating limits', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const body = (await sensorViewSql())
    .replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
    .replaceAll('`melens_ingest.data_sources`', 'fixture_sources')
    .replaceAll('`melens_ingest.parking_sensor_current`', 'fixture_snapshot')
    .replaceAll('CURRENT_TIMESTAMP()', 'TIMESTAMP(@now)')
    .replaceAll("CURRENT_DATE('Australia/Melbourne')", "DATE(TIMESTAMP(@now), 'Australia/Melbourne')");
  const rows = [
    sensor('live', 'new', { occupied: true }),
    // Silent for 90 days: it keeps its last status but must read stale, not vacant.
    sensor('offline', 'new', { updatedAt: old, occupied: false }),
    sensor('future', 'new', { updatedAt: '2026-10-01T02:01:00Z' }),
    sensor('unlocated', 'new', { geometry: null, observedAt: null, occupied: null }),
    sensor('withdrawn', 'new', { rights: 'review_required' }),
    sensor('inactive', 'new', { status: 'withdrawn' }),
    sensor('orphan', 'failed'),
  ];
  const batches = [
    { batch_id: 'new', source_id: source, started_at: recent, state: 'published',
      published_at: recent, state_updated_at: recent },
    { batch_id: 'failed', source_id: source, started_at: now, state: 'failed',
      published_at: null, state_updated_at: now },
  ];
  const query = `WITH fixture_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.state') AS state, TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.started_at')) AS started_at FROM UNNEST(JSON_QUERY_ARRAY(@batches)) row
  ), fixture_sources AS (
    SELECT @source AS source_id, 120 AS cadence_seconds, 120 AS check_interval_seconds,
      TIMESTAMP(@lastSuccess) AS last_success_at, 'verified_open' AS license_status,
      @access AS access_status, TIMESTAMP(@recent) AS updated_at
  ), fixture_snapshot AS (
    SELECT JSON_VALUE(row, '$.sensor_id') AS sensor_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.batch_id') AS batch_id, 1 AS schema_version,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id, JSON_VALUE(row, '$.version_id') AS version_id,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      SAFE.TIMESTAMP(JSON_VALUE(row, '$.observed_at')) AS observed_at,
      SAFE_CAST(JSON_VALUE(row, '$.occupied') AS BOOL) AS occupied,
      JSON_VALUE(row, '$.status_description') AS status_description,
      SAFE_CAST(JSON_VALUE(row, '$.zone_number') AS INT64) AS zone_number,
      JSON_VALUE(row, '$.marker_id') AS marker_id, JSON_VALUE(row, '$.bay_id') AS bay_id,
      SAFE_CAST(JSON_VALUE(row, '$.latitude') AS FLOAT64) AS latitude,
      SAFE_CAST(JSON_VALUE(row, '$.longitude') AS FLOAT64) AS longitude,
      JSON_VALUE(row, '$.geometry_geojson') AS geometry_geojson, JSON_VALUE(row, '$.original_url') AS original_url,
      JSON_VALUE(row, '$.record_status') AS record_status, JSON_VALUE(row, '$.rights_status') AS rights_status
    FROM UNNEST(JSON_QUERY_ARRAY(@rows)) row
  ), result AS (${body})
  SELECT sensor_id, batch_id, occupied, status_changed_at, source_freshness, occupancy_freshness,
    is_public_holiday, geometry_geojson, latitude, availability_note, may_park_now FROM result`;
  const client = new BigQuery({ projectId: project });
  async function run(clock: string, options: { states?: typeof batches; access?: string; lastSuccess?: string } = {}) {
    const shift = (value: string) => new Date(Date.parse(value) + Date.parse(clock) - Date.parse(now)).toISOString();
    const shiftedRows = rows.map(row => ({ ...row, fetched_at: shift(row.fetched_at),
      observed_at: row.observed_at === null ? null : shift(row.observed_at),
      source_updated_at: shift(row.source_updated_at) }));
    const shiftedBatches = (options.states ?? batches).map(batch => ({ ...batch, started_at: shift(batch.started_at),
      state_updated_at: shift(batch.state_updated_at),
      published_at: batch.published_at === null ? null : shift(batch.published_at) }));
    let result: unknown;
    try {
      [result] = await client.query({ query, location: 'australia-southeast2',
        maximumBytesBilled: '100000000', useQueryCache: false,
        params: { source, now: clock, recent: shift(recent), access: options.access ?? 'active',
          lastSuccess: options.lastSuccess ?? shift(recent), rows: JSON.stringify(shiftedRows),
          batches: JSON.stringify(shiftedBatches) } });
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Parking SQL query failed');
    }
    return rowsSchema.parse(result);
  }
  const bySensor = (list: z.infer<typeof rowsSchema>, id: string) => list.find(row => row.sensor_id === id);

  const current = await run(now);
  assert.deepEqual(current.map(row => row.sensor_id).sort(), ['future', 'live', 'offline', 'unlocated'],
    'Withdrawn rights, inactive records and an unpublished batch never reach the map');
  const live = bySensor(current, 'live');
  assert.ok(live);
  assert.equal(live.occupied, true);
  assert.equal(live.source_freshness, 'current');
  assert.equal(live.occupancy_freshness, 'current');
  assert.equal(live.is_public_holiday, false);
  assert.equal(live.availability_note, 'vacancy_does_not_prove_access_or_legal_permission');
  const silent = bySensor(current, 'offline');
  assert.ok(silent);
  assert.equal(silent.source_freshness, 'stale', 'A sensor that stopped reporting reads stale');
  assert.equal(silent.occupancy_freshness, 'stale');
  assert.equal(silent.availability_note, 'sensor_not_reporting');
  assert.equal(bySensor(current, 'future')?.source_freshness, 'unknown');
  const unlocated = bySensor(current, 'unlocated');
  assert.ok(unlocated);
  assert.equal(unlocated.geometry_geojson, null, 'No location is invented for a sensor without one');
  assert.equal(unlocated.latitude, null);
  assert.equal(unlocated.occupancy_freshness, 'unknown', 'No status time means no occupancy claim');

  const ordinary = await run('2026-09-30T15:00:00Z');
  // 01 October is a known ordinary Melbourne day even while UTC remains 30 September.
  assert.ok(ordinary.length > 0 && ordinary.every(row => row.is_public_holiday === false));
  const holiday = await run('2026-11-02T15:00:00Z');
  assert.ok(holiday.length > 0 && holiday.every(row => row.is_public_holiday === true
    && row.occupancy_freshness === 'unknown' && row.availability_note === 'sensor_not_operational_public_holiday'));
  const nextYear = await run('2027-01-02T02:00:00Z');
  assert.ok(nextYear.length > 0 && nextYear.every(row => row.is_public_holiday === null
    && row.occupancy_freshness === 'unknown' && row.availability_note === 'sensor_holiday_status_unknown'));

  assert.deepEqual(await run(now, { access: 'candidate' }), [], 'A source that is not public shows nothing');
  const staleSource = await run(now, { lastSuccess: old });
  assert.ok(staleSource.length > 0 && staleSource.every(row => row.source_freshness !== 'current'),
    'A collection that stopped succeeding cannot leave the map claiming fresh data');
  const unpublished = await run(now, { states: batches.map(batch => ({ ...batch,
    state: batch.batch_id === 'new' ? 'running' : batch.state, published_at: batch.batch_id === 'new' ? null : batch.published_at })) });
  assert.deepEqual(unpublished, [], 'A snapshot whose batch is not published is never shown');
});
