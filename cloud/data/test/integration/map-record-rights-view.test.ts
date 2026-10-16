import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012' && process.env.MELENS_GUARD_TEST_CONFIRM === project;
const first = '2026-10-01T00:00:00Z';
const second = '2026-10-02T00:00:00Z';
const third = '2026-10-03T00:00:00Z';
const point = JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] });
const polygon = JSON.stringify({ type: 'Polygon', coordinates: [
  [[144.95, -37.82], [144.97, -37.82], [144.97, -37.80], [144.95, -37.82]],
] });

type RecordRow = {
  source_id: string; source_record_id: string; version_id: string; batch_id: string;
  source_updated_at: string | null; source_version_ordinal: number | null;
  fetched_at: string; rights_status: string; record_status: string;
};

async function productionBody(file: string, name: string): Promise<string> {
  let root = process.cwd();
  while (!existsSync(join(root, 'cloud/data/sql', file))) {
    const parent = dirname(root);
    if (parent === root) throw new Error('Run map rights acceptance from the Melens repository');
    root = parent;
  }
  const sql = await readFile(join(root, 'cloud/data/sql', file), 'utf8');
  const body = sql.split(`CREATE OR REPLACE VIEW \`melens_query.${name}\` AS`)[1]?.split(';')[0]?.trim();
  assert.ok(body);
  assert.ok(body.startsWith('WITH '));
  const replaced = body.replaceAll('`melens_ingest.sync_batches`', 'fixture_batches')
    .replaceAll('`melens_ingest.data_sources`', 'fixture_sources')
    .replaceAll('`melens_ingest.source_records`', 'fixture_records')
    .replaceAll('`melens_ingest.boundaries`', 'fixture_boundaries')
    .replaceAll('`melens_ingest.pedestrian_observations`', 'fixture_observations')
    .replaceAll('`melens_ingest.sensor_locations`', 'fixture_locations');
  assert.doesNotMatch(replaced, /melens_ingest|CREATE|INSERT|UPDATE|DELETE/);
  return replaced;
}

test('production boundary and pedestrian views deny latest-record/source withdrawal without reviving old facts', {
  skip: !enabled, timeout: 120_000,
}, async () => {
  assert.ok(project);
  const records: RecordRow[] = [];
  const sources: { source_id: string; access_status: string; updated_at: string }[] = [];
  const boundaries: { source_id: string; source_record_id: string; batch_id: string;
    version_id: string; boundary_id: string; code: string }[] = [];
  const observations: { source_id: string; source_record_id: string; batch_id: string;
    version_id: string; sensor_id: string }[] = [];
  const locations: { source_id: string; source_record_id: string; batch_id: string;
    version_id: string; sensor_id: string; source_updated_at: string;
    valid_from?: string; valid_to?: string; geometry_geojson?: string; device_status?: string }[] = [];
  const addSource = (source_id: string) => sources.push({ source_id, access_status: 'active', updated_at: first });
  const addRecord = (source_id: string, key: string, version: string,
    extra: Partial<RecordRow> = {}): RecordRow => {
    const row = { source_id, source_record_id: key, version_id: version, batch_id: `${source_id}:${version}`,
      source_updated_at: version === 'v1' ? first : second, source_version_ordinal: null,
      fetched_at: version === 'v1' ? first : second, rights_status: 'verified_open', record_status: 'active', ...extra };
    records.push(row);
    return row;
  };
  for (const code of ['boundary-public', 'boundary-rights', 'boundary-withdrawn', 'boundary-cancelled',
    'boundary-source', 'boundary-unknown-order', 'boundary-same-clock', 'boundary-same-version', 'boundary-unpublished']) {
    const source = `fixture.${code}`;
    addSource(source);
    const old = addRecord(source, `${source}:record`, 'v1', code === 'boundary-unknown-order' ? { source_updated_at: null } : {});
    boundaries.push({ ...old, boundary_id: `com_clue_block:${code}:2025`, code });
    if (code === 'boundary-source') sources.push({ source_id: source, access_status: 'disabled', updated_at: third });
    else if (code !== 'boundary-public') {
      addRecord(source, old.source_record_id, code === 'boundary-same-version' ? 'v1' : 'v2', {
        rights_status: code === 'boundary-withdrawn' || code === 'boundary-cancelled' ? 'verified_open' : 'review_required',
        record_status: code === 'boundary-withdrawn' ? 'withdrawn' : code === 'boundary-cancelled' ? 'cancelled' : 'active',
        ...(code === 'boundary-unknown-order' ? { source_updated_at: null } : {}),
        ...(code === 'boundary-same-clock' || code === 'boundary-same-version' ? { source_updated_at: first } : {}),
      });
    } else {
      const latest = addRecord(source, old.source_record_id, 'v2');
      boundaries.push({ ...latest, boundary_id: `com_clue_block:${code}:2025`, code });
    }
  }
  for (const sensor_id of ['counts-public', 'counts-rights', 'counts-withdrawn', 'counts-source', 'counts-same-clock',
    'location-rights', 'location-withdrawn', 'location-source', 'location-same-clock',
    'hour-conflict', 'hour-inactive', 'hour-decommission', 'hour-only-late', 'hour-move',
    'hour-ending-exactly', 'hour-nonoverlap']) {
    const source = `fixture.${sensor_id}.counts`;
    const locationSource = `fixture.${sensor_id}.locations`;
    addSource(source); addSource(locationSource);
    const count = addRecord(source, `${source}:record`, 'v1');
    const location = addRecord(locationSource, `${locationSource}:record`, 'v1');
    observations.push({ ...count, sensor_id });
    if (sensor_id !== 'hour-only-late') locations.push({ ...location, sensor_id, source_updated_at: first,
      ...(sensor_id === 'hour-move' ? { valid_to: '2026-10-02T00:30:00Z' } : {}),
      ...(sensor_id === 'hour-ending-exactly' ? { valid_to: '2026-10-02T01:00:00Z' } : {}),
    });
    if (sensor_id === 'counts-public') {
      const latest = addRecord(source, count.source_record_id, 'v2');
      observations.push({ ...latest, sensor_id });
    } else if (sensor_id.startsWith('hour-')) {
      if (sensor_id !== 'hour-ending-exactly') {
        const later = addRecord(locationSource, location.source_record_id, 'v2');
        locations.push({ ...later, sensor_id, source_updated_at: second,
          valid_from: sensor_id === 'hour-nonoverlap' ? '2026-10-02T01:00:00Z' : '2026-10-02T00:30:00Z',
          geometry_geojson: sensor_id === 'hour-inactive' || sensor_id === 'hour-decommission'
            ? point : JSON.stringify({ type: 'Point', coordinates: [144.97, -37.81] }),
          ...(sensor_id === 'hour-inactive' ? { device_status: 'I' } : {}),
          ...(sensor_id === 'hour-decommission' ? { device_status: 'decommissioned' } : {}),
        });
      }
    } else if (sensor_id.endsWith('-source')) {
      sources.push({ source_id: sensor_id.startsWith('counts') ? source : locationSource,
        access_status: 'disabled', updated_at: third });
    } else {
      const target = sensor_id.startsWith('counts') ? count : location;
      addRecord(target.source_id, target.source_record_id, 'v2', {
        rights_status: sensor_id.endsWith('withdrawn') ? 'verified_open' : 'review_required',
        record_status: sensor_id.endsWith('withdrawn') ? 'withdrawn' : 'active',
        ...(sensor_id.endsWith('same-clock') ? { source_updated_at: first } : {}),
      });
    }
  }
  const [boundaryBody, pedestrianBody] = await Promise.all([
    productionBody('006_area_views.sql', 'v_boundaries'),
    productionBody('004_street_views.sql', 'v_pedestrian_observations'),
  ]);
  const query = `WITH fixture_records AS (
    SELECT JSON_VALUE(row, '$.batch_id') batch_id, JSON_VALUE(row, '$.source_id') source_id,
      JSON_VALUE(row, '$.source_record_id') source_record_id, JSON_VALUE(row, '$.version_id') version_id,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) source_updated_at,
      CAST(JSON_VALUE(row, '$.source_version_ordinal') AS INT64) source_version_ordinal,
      TIMESTAMP(JSON_VALUE(row, '$.fetched_at')) fetched_at,
      JSON_VALUE(row, '$.rights_status') rights_status, JSON_VALUE(row, '$.record_status') record_status
    FROM UNNEST(JSON_QUERY_ARRAY(@records)) row
  ), fixture_batches AS (
    SELECT DISTINCT batch_id, source_id,
      IF(STARTS_WITH(batch_id, 'fixture.boundary-unpublished:') AND ENDS_WITH(batch_id, ':v2'), 'failed', 'published') state,
      fetched_at published_at, fetched_at state_updated_at, fetched_at started_at FROM fixture_records
  ), fixture_sources AS (
    SELECT JSON_VALUE(row, '$.source_id') source_id, JSON_VALUE(row, '$.access_status') access_status,
      TIMESTAMP(JSON_VALUE(row, '$.updated_at')) updated_at, 'verified_open' license_status,
      IF(CONTAINS_SUBSTR(JSON_VALUE(row, '$.source_id'), '.hour-'), 'sensor_hour', 'sensor_minute') record_granularity,
      CAST(NULL AS INT64) cadence_seconds,
      CAST(NULL AS INT64) check_interval_seconds, TIMESTAMP(@third) last_success_at
    FROM UNNEST(JSON_QUERY_ARRAY(@sources)) row
  ), fixture_boundaries AS (
    SELECT JSON_VALUE(row, '$.batch_id') batch_id, JSON_VALUE(row, '$.source_id') source_id,
      JSON_VALUE(row, '$.source_record_id') source_record_id, JSON_VALUE(row, '$.version_id') version_id,
      JSON_VALUE(row, '$.boundary_id') boundary_id, JSON_VALUE(row, '$.code') code,
      'com_clue_block' scheme, '2025' vintage, 'Fixture' name, @polygon geometry_geojson,
      CAST(NULL AS TIMESTAMP) valid_from, CAST(NULL AS TIMESTAMP) valid_to,
      IF(JSON_VALUE(row, '$.version_id') = 'v1', TIMESTAMP(@first), TIMESTAMP(@second)) fetched_at
    FROM UNNEST(JSON_QUERY_ARRAY(@boundaries)) row
  ), fixture_observations AS (
    SELECT JSON_VALUE(row, '$.batch_id') batch_id, JSON_VALUE(row, '$.source_id') source_id,
      JSON_VALUE(row, '$.source_record_id') source_record_id, JSON_VALUE(row, '$.version_id') version_id,
      JSON_VALUE(row, '$.sensor_id') sensor_id, TIMESTAMP(@second) observed_at,
      TIMESTAMP(@third) fetched_at, 7 total_count, CAST(NULL AS INT64) direction_a_count,
      CAST(NULL AS INT64) direction_b_count FROM UNNEST(JSON_QUERY_ARRAY(@observations)) row
  ), fixture_locations AS (
    SELECT JSON_VALUE(row, '$.batch_id') batch_id, JSON_VALUE(row, '$.source_id') source_id,
      JSON_VALUE(row, '$.source_record_id') source_record_id, JSON_VALUE(row, '$.version_id') version_id,
      JSON_VALUE(row, '$.sensor_id') sensor_id,
      TIMESTAMP(COALESCE(JSON_VALUE(row, '$.valid_from'), @first)) valid_from,
      TIMESTAMP(JSON_VALUE(row, '$.valid_to')) valid_to,
      TIMESTAMP(JSON_VALUE(row, '$.source_updated_at')) source_updated_at,
      CAST(NULL AS INT64) source_version_ordinal, TIMESTAMP(@first) fetched_at,
      COALESCE(JSON_VALUE(row, '$.geometry_geojson'), @point) geometry_geojson,
      COALESCE(JSON_VALUE(row, '$.device_status'), 'A') device_status
    FROM UNNEST(JSON_QUERY_ARRAY(@locations)) row
  ), boundary_result AS (${boundaryBody}), pedestrian_result AS (${pedestrianBody})
  SELECT 'boundary' layer, code test_case, version_id, rights_evidence,
    CAST(NULL AS STRING) location_status, CAST(NULL AS STRING) location_version_id,
    geometry_geojson FROM boundary_result
  UNION ALL
  SELECT 'pedestrian', sensor_id, version_id, rights_evidence, location_status,
    location_version_id, geometry_geojson FROM pedestrian_result ORDER BY layer, test_case`;
  let rows: unknown;
  try {
    [rows] = await new BigQuery({ projectId: project }).query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '1000000', useQueryCache: false,
      params: { records: JSON.stringify(records), sources: JSON.stringify(sources), boundaries: JSON.stringify(boundaries),
        observations: JSON.stringify(observations), locations: JSON.stringify(locations), first, second, third, point, polygon } });
  } catch (error) {
    // Cloud errors can contain credential/request configuration. Return only the error code.
    const parsed = z.object({ code: z.union([z.string(), z.number()]).optional() }).safeParse(error);
    throw new Error(`Map rights fixture query failed (${parsed.success ? parsed.data.code ?? 'unknown' : 'unknown'})`);
  }
  const parsed = z.array(z.object({ layer: z.string(), test_case: z.string(), version_id: z.string(),
    rights_evidence: z.literal('latest_published_record_v1'), location_status: z.string().nullable(),
    location_version_id: z.string().nullable(), geometry_geojson: z.string().nullable() })).parse(rows);
  assert.deepEqual(parsed.filter(row => row.layer === 'boundary').map(row => [row.test_case, row.version_id]), [
    ['boundary-public', 'v2'], ['boundary-unpublished', 'v1'],
  ]);
  const pedestrians = parsed.filter(row => row.layer === 'pedestrian');
  assert.deepEqual(pedestrians.map(row => [row.test_case, row.location_status]), [
    ['counts-public', 'located'], ['hour-conflict', 'ambiguous'], ['hour-decommission', 'ambiguous'],
    ['hour-ending-exactly', 'located'], ['hour-inactive', 'ambiguous'], ['hour-move', 'unlocated'],
    ['hour-nonoverlap', 'located'], ['hour-only-late', 'unlocated'],
    ['location-rights', 'unlocated'], ['location-same-clock', 'unlocated'],
    ['location-source', 'unlocated'], ['location-withdrawn', 'unlocated'],
  ]);
  assert.equal(pedestrians[0]?.version_id, 'v2');
  assert.equal(pedestrians[0]?.location_version_id, 'v1');
  assert.equal(pedestrians[0]?.geometry_geojson, point);
  assert.ok(pedestrians.filter(row => row.test_case.startsWith('location-'))
    .every(row => row.geometry_geojson === null && row.location_version_id === null));
  assert.ok(pedestrians.filter(row => row.location_status !== 'located').every(row => row.geometry_geojson === null));
});
