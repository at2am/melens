import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const now = '2026-10-01T02:00:00Z';
const recent = '2026-10-01T01:59:30Z';
const earlier = '2026-10-01T01:59:00Z';
const future = '2026-10-01T02:01:00Z';
const point = JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] });

function bay(input: {
  id: string; marker: string | null; version?: string; source?: string;
  batch?: string; publicAccess?: boolean | null; validFrom?: string | null;
  validTo?: string | null; updatedAt?: string | null;
}) {
  const version = input.version ?? 'bay-v1';
  return { bay_id: input.id, marker_id: input.marker, version_id: version,
    source_record_id: `${input.id}:${version}`, source_id: input.source ?? 'bays',
    batch_id: input.batch ?? 'bays-published', fetched_at: recent,
    source_updated_at: input.updatedAt ?? recent, source_version_ordinal: null,
    geometry_geojson: point, public_access: input.publicAccess === undefined ? true : input.publicAccess,
    valid_from: input.validFrom ?? null, valid_to: input.validTo ?? null };
}

function observation(input: {
  id: string; marker: string | null; occupied?: boolean | null;
  observedAt?: string; updatedAt?: string; version?: string; source?: string;
  batch?: string;
}) {
  const version = input.version ?? 'observation-v1';
  return { sensor_id: input.id, bay_id: `sensor-bay:${input.id}`, marker_id: input.marker,
    occupied: input.occupied === undefined ? false : input.occupied, version_id: version,
    source_record_id: `${input.id}:${version}`, source_id: input.source ?? 'sensors',
    batch_id: input.batch ?? 'sensors-published', observed_at: input.observedAt ?? recent,
    source_updated_at: input.updatedAt ?? recent, fetched_at: recent,
    source_version_ordinal: null };
}

test('production parking SQL enforces published provenance, current unique mappings and conservative eligibility', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const sql = await readFile(new URL('../../../sql/003_parking_views.sql', import.meta.url), 'utf8');
  function body(name: string): string {
    const result = sql.split(`CREATE OR REPLACE VIEW \`melens_query.${name}\` AS`)[1]?.split(';')[0]?.trim();
    assert.ok(result);
    return result.replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
      .replaceAll('`melens_ingest.data_sources`', 'fixture_sources')
      .replaceAll('`melens_ingest.source_records`', 'fixture_records')
      .replaceAll('`melens_ingest.parking_bays`', 'fixture_bays')
      .replaceAll('`melens_ingest.parking_observations`', 'fixture_observations')
      .replaceAll('`melens_query.v_parking_current`', 'result_current')
      .replaceAll('CURRENT_TIMESTAMP()', 'TIMESTAMP(@now)');
  }
  const bays = [
    bay({ id: 'free', marker: 'free' }), bay({ id: 'occupied', marker: 'occupied' }),
    bay({ id: 'missing-marker', marker: null }),
    bay({ id: 'duplicate-bay-a', marker: 'duplicate-bay' }),
    bay({ id: 'duplicate-bay-b', marker: 'duplicate-bay' }),
    bay({ id: 'duplicate-sensor', marker: 'duplicate-sensor' }),
    bay({ id: 'orphan-bay', marker: 'orphan' }), bay({ id: 'review-bay', marker: 'review' }),
    bay({ id: 'review-bay-version', marker: 'review-bay-version', version: 'old', updatedAt: earlier }),
    bay({ id: 'review-bay-version', marker: 'review-bay-version', version: 'restricted', updatedAt: recent }),
    bay({ id: 'failed-bay', marker: 'failed', batch: 'failed' }),
    bay({ id: 'expired', marker: 'expired', validTo: earlier }),
    bay({ id: 'future-version', marker: 'future-version', validFrom: earlier, version: 'zz-old' }),
    bay({ id: 'future-version', marker: 'future-new-marker', validFrom: future, version: 'aa-future' }),
    bay({ id: 'stale', marker: 'stale' }), bay({ id: 'future-observation', marker: 'future-observation' }),
    bay({ id: 'future-check', marker: 'future-check' }), bay({ id: 'zero-cadence', marker: 'zero-cadence' }),
    bay({ id: 'ambiguous-observation', marker: 'ambiguous-observation' }),
    bay({ id: 'corrected-observation', marker: 'corrected-observation' }),
    bay({ id: 'sensor-source-a', marker: 'sensor-source-a' }),
    bay({ id: 'sensor-source-b', marker: 'sensor-source-b' }),
    bay({ id: 'same-bay-id', marker: 'bay-source-a' }),
    bay({ id: 'same-bay-id', marker: 'bay-source-b', source: 'other-bays', batch: 'other-bays-published' }),
    bay({ id: 'private', marker: null, publicAccess: false }),
    bay({ id: 'orphan-observation', marker: 'orphan-observation' }),
    bay({ id: 'review-observation', marker: 'review-observation' }),
    bay({ id: 'withdrawn-observation', marker: 'withdrawn-observation' }),
    bay({ id: 'closed', marker: 'closed', validFrom: earlier, version: 'zz-open', updatedAt: earlier }),
    bay({ id: 'closed', marker: 'closed', validFrom: earlier, validTo: recent,
      version: 'aa-closed', updatedAt: recent }),
    bay({ id: 'overlap', marker: 'overlap', validFrom: earlier, version: 'first' }),
    bay({ id: 'overlap', marker: 'overlap', validFrom: recent, version: 'second' }),
  ];
  const observations = [
    ...['free', 'occupied', 'duplicate-bay', 'future-version', 'future-observation',
      'future-check', 'zero-cadence', 'bay-source-a', 'bay-source-b', 'orphan-observation',
      'review-observation', 'overlap'].map(id => observation({ id, marker: id,
      occupied: id !== 'free', observedAt: id === 'future-observation' ? future : recent,
      source: id === 'future-check' ? 'future-sensors' : id === 'zero-cadence' ? 'zero-sensors' : 'sensors',
      batch: id === 'future-check' ? 'future-sensors-published'
        : id === 'zero-cadence' ? 'zero-sensors-published' : 'sensors-published' })),
    observation({ id: 'duplicate-sensor-a', marker: 'duplicate-sensor', occupied: true }),
    observation({ id: 'duplicate-sensor-b', marker: 'duplicate-sensor', occupied: false }),
    observation({ id: 'stale', marker: 'stale', occupied: true, observedAt: '2026-10-01T01:50:00Z' }),
    observation({ id: 'ambiguous-observation', marker: 'ambiguous-observation', occupied: true, version: 'true' }),
    observation({ id: 'ambiguous-observation', marker: 'ambiguous-observation', occupied: false, version: 'false' }),
    observation({ id: 'corrected-observation', marker: 'corrected-observation', occupied: false,
      version: 'zz-old', updatedAt: earlier }),
    observation({ id: 'corrected-observation', marker: 'corrected-observation', occupied: true,
      version: 'aa-corrected', updatedAt: recent }),
    observation({ id: 'same-sensor-id', marker: 'sensor-source-a', occupied: true }),
    observation({ id: 'same-sensor-id', marker: 'sensor-source-b', occupied: true,
      source: 'other-sensors', batch: 'other-sensors-published' }),
    observation({ id: 'review-observation', marker: 'review-observation', occupied: true,
      version: 'old-verified', updatedAt: earlier }),
    observation({ id: 'missing-marker', marker: null, occupied: true }),
    observation({ id: 'withdrawn-observation', marker: 'withdrawn-observation', occupied: true,
      version: 'old', observedAt: earlier }),
    observation({ id: 'withdrawn-observation', marker: 'withdrawn-observation', occupied: true,
      version: 'withdrawn' }),
  ];
  const records = [...bays, ...observations]
    .filter(row => !(row.source_id === 'bays' && row.source_record_id.startsWith('orphan-bay:'))
      && !(row.source_id === 'sensors' && row.source_record_id.startsWith('orphan-observation:')))
    .map(row => ({ ...row,
      rights_status: row.source_updated_at === recent
        && (row.source_record_id.startsWith('review-bay:')
          || row.source_record_id.startsWith('review-bay-version:')
          || (row.source_id === 'sensors' && row.source_record_id.startsWith('review-observation:')))
        ? 'review_required' : 'verified_open',
      record_status: row.version_id === 'withdrawn' ? 'withdrawn' : 'active' }));
  const sources = ['bays', 'other-bays', 'sensors', 'other-sensors', 'future-sensors', 'zero-sensors']
    .map(source_id => ({ source_id, cadence_seconds: source_id === 'zero-sensors' ? 0 : 60,
      check_interval_seconds: null, last_success_at: source_id === 'future-sensors' ? future : recent,
      license_status: 'verified_open', access_status: 'active', updated_at: recent }));
  const batches = sources.map(source => ({ batch_id: `${source.source_id}-published`, source_id: source.source_id,
    state: 'published', published_at: recent, state_updated_at: recent, started_at: earlier }));
  batches.push({ batch_id: 'failed', source_id: 'bays', state: 'failed',
    published_at: recent, state_updated_at: recent, started_at: earlier });

  const query = `WITH fixture_batches AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.state') AS state, TIMESTAMP(JSON_VALUE(row, '$.published_at')) AS published_at,
      TIMESTAMP(JSON_VALUE(row, '$.state_updated_at')) AS state_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.started_at')) AS started_at FROM UNNEST(JSON_QUERY_ARRAY(@batches)) row
  ), fixture_sources AS (
    SELECT JSON_VALUE(row, '$.source_id') AS source_id, JSON_VALUE(row, '$.license_status') AS license_status,
      JSON_VALUE(row, '$.access_status') AS access_status,
      CAST(JSON_VALUE(row, '$.cadence_seconds') AS INT64) AS cadence_seconds,
      CAST(JSON_VALUE(row, '$.check_interval_seconds') AS INT64) AS check_interval_seconds,
      TIMESTAMP(JSON_VALUE(row, '$.last_success_at')) AS last_success_at,
      TIMESTAMP(JSON_VALUE(row, '$.updated_at')) AS updated_at FROM UNNEST(JSON_QUERY_ARRAY(@sources)) row
  ), fixture_bays AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.bay_id') AS bay_id, JSON_VALUE(row, '$.marker_id') AS marker_id,
      JSON_VALUE(row, '$.version_id') AS version_id, JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.geometry_geojson') AS geometry_geojson,
      CAST(JSON_VALUE(row, '$.public_access') AS BOOL) AS public_access,
      TIMESTAMP(JSON_VALUE(row, '$.valid_from')) AS valid_from, TIMESTAMP(JSON_VALUE(row, '$.valid_to')) AS valid_to,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at,
      CAST(JSON_VALUE(row, '$.source_version_ordinal') AS INT64) AS source_version_ordinal
    FROM UNNEST(JSON_QUERY_ARRAY(@bays)) row
  ), fixture_observations AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.sensor_id') AS sensor_id, JSON_VALUE(row, '$.bay_id') AS bay_id,
      JSON_VALUE(row, '$.marker_id') AS marker_id, JSON_VALUE(row, '$.version_id') AS version_id,
      JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      CAST(JSON_VALUE(row, '$.occupied') AS BOOL) AS occupied,
      TIMESTAMP(JSON_VALUE(row, '$.observed_at')) AS observed_at,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) AS fetched_at
    FROM UNNEST(JSON_QUERY_ARRAY(@observations)) row
  ), fixture_records AS (
    SELECT JSON_VALUE(row, '$.batch_id') AS batch_id, JSON_VALUE(row, '$.source_id') AS source_id,
      JSON_VALUE(row, '$.version_id') AS version_id, JSON_VALUE(row, '$.source_record_id') AS source_record_id,
      JSON_VALUE(row, '$.record_status') AS record_status, JSON_VALUE(row, '$.rights_status') AS rights_status,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) AS source_updated_at,
      CAST(JSON_VALUE(row, '$.source_version_ordinal') AS INT64) AS source_version_ordinal
    FROM UNNEST(JSON_QUERY_ARRAY(@records)) row
  ), result_current AS (${body('v_parking_current')}),
  result_unmatched AS (${body('v_parking_unmatched_observations')})
  SELECT 'current' AS kind, bay_id AS id, bay_source_id AS source_id, occupied, may_park_now,
    occupancy_join_evidence AS evidence, occupancy_freshness AS freshness, geometry_geojson,
    occupancy_version_id AS version_id FROM result_current
  UNION ALL
  SELECT 'unmatched' AS kind, sensor_id AS id, source_id, occupied, may_park_now,
    observation_status AS evidence, CAST(NULL AS STRING) AS freshness,
    CAST(NULL AS STRING) AS geometry_geojson, version_id FROM result_unmatched`;
  let rows: unknown;
  try {
    [rows] = await new BigQuery({ projectId: project }).query({ query,
      location: 'australia-southeast2', maximumBytesBilled: '100000000', useQueryCache: false,
      params: { now, batches: JSON.stringify(batches), sources: JSON.stringify(sources),
        bays: JSON.stringify(bays), observations: JSON.stringify(observations), records: JSON.stringify(records) } });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Cloud query failed');
  }
  const parsed = z.array(z.object({ kind: z.enum(['current', 'unmatched']), id: z.string(),
    source_id: z.string(), occupied: z.boolean().nullable(), may_park_now: z.enum(['yes', 'no', 'unknown']),
    evidence: z.string(), freshness: z.string().nullable(), geometry_geojson: z.string().nullable(),
    version_id: z.string().nullable() })).parse(rows);
  const current = parsed.filter(row => row.kind === 'current');
  function find(id: string, source = 'bays') {
    const result = current.find(row => row.id === id && row.source_id === source);
    assert.ok(result, `${source}:${id} must remain available`);
    return result;
  }
  assert.equal(current.some(row => ['orphan-bay', 'review-bay', 'review-bay-version', 'failed-bay', 'expired', 'closed'].includes(row.id)), false);
  assert.equal(current.some(row => row.may_park_now === 'yes'), false);
  assert.equal(find('free').occupied, false);
  assert.equal(find('free').may_park_now, 'unknown');
  assert.equal(find('occupied').may_park_now, 'no');
  assert.equal(find('occupied').evidence, 'shared_marker_id');
  assert.equal(find('private').may_park_now, 'no');
  for (const id of ['missing-marker', 'duplicate-bay-a', 'duplicate-bay-b', 'duplicate-sensor',
    'ambiguous-observation', 'orphan-observation', 'review-observation', 'withdrawn-observation', 'overlap']) {
    assert.equal(find(id).occupied, null, `${id} cannot inherit occupancy`);
    assert.equal(find(id).evidence, 'unverified');
    assert.equal(find(id).may_park_now, 'unknown');
  }
  assert.equal(find('overlap').geometry_geojson, null);
  assert.equal(find('future-version').occupied, true);
  assert.equal(find('future-version').version_id, 'observation-v1');
  assert.equal(find('corrected-observation').occupied, true);
  assert.equal(find('corrected-observation').version_id, 'aa-corrected');
  assert.equal(find('stale').freshness, 'stale');
  for (const id of ['future-observation', 'future-check', 'zero-cadence']) {
    assert.equal(find(id).freshness, 'unknown');
    assert.equal(find(id).may_park_now, 'unknown');
  }
  for (const id of ['sensor-source-a', 'sensor-source-b']) assert.equal(find(id).may_park_now, 'no');
  assert.equal(find('same-bay-id').may_park_now, 'no');
  assert.equal(find('same-bay-id', 'other-bays').may_park_now, 'no');
  const unmatched = parsed.filter(row => row.kind === 'unmatched');
  assert.ok(unmatched.some(row => row.id === 'missing-marker' && row.may_park_now === 'unknown'));
  assert.ok(unmatched.some(row => row.id === 'ambiguous-observation' && row.evidence === 'ambiguous'
    && row.occupied === null));
  assert.equal(unmatched.some(row => ['orphan-observation', 'review-observation', 'withdrawn-observation'].includes(row.id)), false);
  assert.equal(unmatched.some(row => row.id === 'same-sensor-id'), false);
});
