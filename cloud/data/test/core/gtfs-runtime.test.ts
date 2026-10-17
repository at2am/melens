import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';

import { normalizeGtfsSnapshot, parseGtfsSnapshot,
  SOURCE_ID as STATIC_SOURCE_ID } from '../../src/connectors/tv_gtfs_static/index.js';
import { normalizeAlertFeeds, SOURCE_ID as REALTIME_SOURCE_ID,
  type ParsedAlertFeed } from '../../src/connectors/tv_gtfs_realtime/index.js';
import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { loadPublishedStaticGtfsVersions, withPublishedGtfsLocations } from '../../src/core/gtfs-runtime.js';

const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  secretNames: [], maxBytesBilled: '100000000' };
const timestamp = '2026-09-28T00:05:00.000Z';
const fetchedAt = '2026-09-28T00:06:00.000Z';

function realtime(feedVersion: string | null = 'PTV_GTFS_20260928_v1',
  selector: { routeId: string | null; stopId: string | null; agencyId?: string; routeType?: number | null;
    directionId?: number | null } =
  { routeId: '2-FLI', stopId: '19499' }): ConnectorSuccess {
  const metro: ParsedAlertFeed = { feedVersion, feedTimestamp: timestamp, gtfsRealtimeVersion: '2.0',
    alerts: [{ id: 'M-17', activePeriods: [], communicationPeriods: [], impactPeriods: [],
      cause: null, effect: 1, header: 'Disruption', description: null, url: null,
      selectors: [{ agencyId: null, routeType: 2, ...selector,
        directionId: null, tripId: null, tripRouteId: null, tripStartDate: null, tripStartTime: null }] }] };
  const normalized = normalizeAlertFeeds([
    { mode: 'metro_train', resourceUrl: 'https://example.test/metro', parsed: metro, fetchedAt },
    { mode: 'yarra_tram', resourceUrl: 'https://example.test/tram', parsed: { ...metro, alerts: [] }, fetchedAt },
  ], parseConnectorInput({ sourceId: REALTIME_SOURCE_ID, window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null, runId: 'realtime-test' }));
  return { ...normalized, kind: 'success', sourceId: REALTIME_SOURCE_ID, runId: 'realtime-test',
    fetchedAt, sourceLatestUpdateAt: normalized.latestUpdate, checkpointAfter: null,
    completeness: { complete: true, method: 'feed_snapshot', expected_records: 1, fetched_records: 1,
      expected_pages: 2, fetched_pages: 2, evidence: 'Both synthetic mode feeds parsed' },
    inputCount: 1, outputCount: normalized.sourceRecords.length, rejectedCount: 0,
    boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [], parkingRules: [],
    sensorLocations: [], pedestrianObservations: [], retainableRawRecords: null };
}

async function references(publisherMode: 'metro_train' | 'yarra_tram' | null = null,
  official?: { routeShapes: { route_id: string; lines: [number, number][][] }[] }) {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/tv_gtfs_static.json', import.meta.url), 'utf8'));
  const snapshot = parseGtfsSnapshot({ ...fixture,
    // The official feed types metro trains as extended GTFS 400 (urban railway).
    ...(official ? { feed_info: [], route_shapes: official.routeShapes,
      routes: fixture.routes.map((route: { route_type: number }) =>
        route.route_type === 2 ? { ...route, route_type: 400 } : route) } : {}) });
  const normalized = normalizeGtfsSnapshot(snapshot, parseConnectorInput({ sourceId: STATIC_SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null, runId: 'published-static' }), fetchedAt,
    // The official reader: no feed_info, a version derived from the archive's HTTP validator.
    official ? { feedVersion: 'archive-sha256:fixture', sourceUpdatedAt: fetchedAt, tripStopMembershipComplete: false }
      : undefined);
  const shapes = normalized.geoRecords.filter(geo => geo.geo_record_id.includes(':route:')).map(geo => {
    const record = normalized.sourceRecords.find(item => item.source_record_id === geo.geo_record_id);
    assert.ok(record);
    return { kind: 'route_shape' as const, source: record, summary: geo.summary ?? '', geometry_geojson: geo.geometry_geojson ?? '' };
  });
  return [...normalized.geoRecords.filter(geo => geo.geo_record_id.includes(':stop:')).map(geo => {
    const record = normalized.sourceRecords.find(item => item.source_record_id === geo.geo_record_id);
    assert.ok(record);
    const summary = JSON.parse(geo.summary ?? '{}');
    if (publisherMode !== null) {
      // Explicit synthetic per-mode evidence; the current official reader never supplies this.
      summary.publisher_mode = publisherMode;
      summary.publisher_feed_info = { feed_version: normalized.feedVersion,
        feed_start_date: snapshot.feed_info[0]?.feed_start_date ?? null,
        feed_end_date: snapshot.feed_info[0]?.feed_end_date ?? null };
    }
    const routeIds = new Set(normalized.geoRecordSources.filter(item =>
      item.geo_record_id === geo.geo_record_id && item.evidence_role === 'serving_route')
      .map(item => item.source_record_id));
    return { kind: 'stop' as const, source: { ...record, rights_status: 'verified_open' }, summary: JSON.stringify(summary),
      geometry_geojson: geo.geometry_geojson, centroid_lat: geo.centroid_lat, centroid_lon: geo.centroid_lon,
      route_records: normalized.sourceRecords.filter(item => routeIds.has(item.source_record_id))
        .map(item => ({ ...item, rights_status: 'verified_open' })) };
  }), ...shapes];
}

test('runtime loads published static references and keeps official mode/version uncertainty unlocated', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  const rows = await references();
  t.mock.method(bq, 'query', async (options: { query: string; maximumBytesBilled: string }) => {
    assert.equal(options.maximumBytesBilled, '100000000');
    assert.match(options.query, /b\.state = 'published'/);
    assert.match(options.query, /s\.access_status = 'active'/);
    assert.match(options.query, /r\.version_id = l\.source_version_id/);
    return [rows.map(reference => ({ reference: JSON.stringify(reference) }))];
  });
  const original = realtime();
  const actual = await withPublishedGtfsLocations(original, config, bq);
  assert.equal(actual.geoRecords[0]?.geometry_geojson, null);
  assert.equal(JSON.parse(actual.geoRecords[0]?.summary ?? '{}').gtfs_mapping_status, 'version_unverified');
  assert.deepEqual(JSON.parse(actual.geoRecords[0]?.summary ?? '{}').static_evidence, []);
  assert.deepEqual(actual.sourceRecords, original.sourceRecords);
  const again = await withPublishedGtfsLocations(original, config, bq);
  assert.deepEqual(again.geoRecords, actual.geoRecords);
  assert.deepEqual(again.geoRecordSources, actual.geoRecordSources);
});

test('explicit published per-mode references preserve exact source versions in a located alert', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  let rows = await references('metro_train');
  t.mock.method(bq, 'query', async () => [rows.map(reference => ({ reference: JSON.stringify(reference) }))]);
  const actual = await withPublishedGtfsLocations(realtime(), config, bq);
  const point = actual.geoRecords[0];
  assert.ok(point);
  assert.equal(point.location_confidence, 'official_join');
  assert.equal(point.centroid_lat, -37.8183);
  assert.equal(point.centroid_lon, 144.9671);
  assert.equal(JSON.parse(point.summary ?? '{}').gtfs_mapping_status, 'located');
  const expectedStop = rows.find(row => row.source.source_record_id.endsWith(':stop:19499'));
  assert.ok(expectedStop);
  const stopEvidence = JSON.parse(point.summary ?? '{}').static_evidence
    .find((item: { role: string }) => item.role === 'gtfs_static_stop_location');
  assert.equal(stopEvidence?.source_record_id, expectedStop.source.source_record_id);
  assert.equal(stopEvidence?.version_id, expectedStop.source.version_id);
  assert.equal(actual.geoRecordSources.every(link => link.version_id === point.version_id), true);
  // A batch links only its own source's records; the static facts stay in the summary.
  assert.equal(actual.geoRecordSources.every(link => link.source_record_id.startsWith(REALTIME_SOURCE_ID)), true);

  rows = await references('yarra_tram');
  const wrongMode = await withPublishedGtfsLocations(realtime(), config, bq);
  assert.equal(wrongMode.geoRecords[0]?.geometry_geojson, null);
  assert.equal(JSON.parse(wrongMode.geoRecords[0]?.summary ?? '{}').gtfs_mapping_status, 'version_unverified');
});

test('the official archive schedule places stop alerts at the stop and route alerts along the route', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  const line: [number, number][] = [[144.9671, -37.8183], [144.9625, -37.8102], [144.9568, -37.7995]];
  const rows = await references(null, { routeShapes: [{ route_id: '2-FLI', lines: [line] }] });
  assert.equal(rows.filter(row => row.kind === 'route_shape').length, 1);
  t.mock.method(bq, 'query', async (options: { query: string }) => {
    assert.match(options.query, /QUALIFY ROW_NUMBER\(\) OVER \(ORDER BY b\.published_at DESC, b\.batch_id DESC\) = 1/);
    assert.match(options.query, /CONCAT\(@sourceId, ':route:'\)/);
    return [rows.map(reference => ({ reference: JSON.stringify(reference) }))];
  });
  // Transport Victoria's alerts carry no feed version that a schedule could be checked against.
  const atStop = await withPublishedGtfsLocations(realtime(null,
    { routeId: '2-FLI', stopId: '19499', agencyId: '1', routeType: null }), config, bq);
  const point = atStop.geoRecords[0];
  assert.equal(JSON.parse(point?.summary ?? '{}').gtfs_mapping_status, 'located');
  assert.equal(JSON.parse(point?.summary ?? '{}').static_feed_version, 'archive-sha256:fixture');
  assert.equal(point?.centroid_lat, -37.8183);
  assert.equal(point?.location_confidence, 'official_join');

  // As the live feed sends them: agency "1", no route type, the route id and a direction.
  const onRoute = await withPublishedGtfsLocations(realtime(null,
    { routeId: '2-FLI', stopId: null, agencyId: '1', routeType: null, directionId: 1 }), config, bq);
  const drawn = onRoute.geoRecords[0];
  assert.ok(drawn);
  assert.equal(JSON.parse(drawn.summary ?? '{}').gtfs_mapping_status, 'route_only');
  assert.deepEqual(JSON.parse(drawn.summary ?? '{}').service_names, ['Craigieburn (Flinders Street - Craigieburn)']);
  assert.deepEqual(JSON.parse(drawn.geometry_geojson ?? 'null'), { type: 'MultiLineString', coordinates: [line] });
  assert.equal(drawn.centroid_lat, null);
  assert.equal(drawn.location_role, 'event_site');
  assert.equal(drawn.location_confidence, 'official_join');
  const routeEvidence = JSON.parse(drawn.summary ?? '{}').static_evidence
    .find((item: { role: string }) => item.role === 'gtfs_static_route_id');
  assert.equal(routeEvidence?.source_record_id, `${STATIC_SOURCE_ID}:route:2-FLI`);
  assert.equal(onRoute.geoRecordSources.every(link => link.source_record_id.startsWith(REALTIME_SOURCE_ID)), true);
  assert.equal(onRoute.geoRecordSources.every(link => link.version_id === drawn.version_id), true);

  // A route with no shape in the schedule stays unlocated rather than guessed.
  const noShape = await withPublishedGtfsLocations(realtime(null,
    { routeId: '2-LIL', stopId: null, agencyId: '1', routeType: null }), config, bq);
  assert.equal(noShape.geoRecords[0]?.geometry_geojson, null);
  assert.equal(JSON.parse(noShape.geoRecords[0]?.summary ?? '{}').gtfs_mapping_status, 'route_only');
});

test('empty complete snapshots do not require static queries but still require two upstream timestamps', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  const query = t.mock.method(bq, 'query', async () => { throw new Error('Unexpected reference query'); });
  const empty = { ...realtime(), geoRecords: [], geoRecordSources: [] };
  const actual = await withPublishedGtfsLocations(empty, config, bq);
  assert.deepEqual(actual.geoRecords, []);
  assert.equal(query.mock.callCount(), 0);
  await assert.rejects(withPublishedGtfsLocations({ ...empty,
    sourceRecords: empty.sourceRecords.map(row => ({ ...row, source_updated_at: null })) }, config, bq));
  await assert.rejects(withPublishedGtfsLocations({ ...empty,
    completeness: { ...empty.completeness, fetched_pages: 1 } }, config, bq), /both complete/);
  const other = { ...empty, sourceId: 'other.source' };
  assert.equal(await withPublishedGtfsLocations(other, config, bq), other);
});

test('runtime rejects a snapshot parent whose timestamp disagrees with its identity', async () => {
  const bq = new BigQuery({ projectId: config.projectId });
  const original = realtime();
  const empty = { ...original, geoRecords: [], geoRecordSources: [],
    sourceRecords: original.sourceRecords.map(row => row.source_record_id.includes(':feed:metro_train:')
      ? { ...row, source_updated_at: '2026-09-28T00:04:00.000Z' } : row) };
  await assert.rejects(withPublishedGtfsLocations(empty, config, bq), /parent timestamp/);
});

test('runtime rejects alert membership in a different mode snapshot', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  const query = t.mock.method(bq, 'query', async () => [ [] ]);
  const original = realtime();
  const tram = original.sourceRecords.find(row => row.source_record_id.includes(':feed:yarra_tram:'));
  assert.ok(tram);
  const wrongMode = { ...original, geoRecordSources: original.geoRecordSources.map(link =>
    link.evidence_role === 'parent_feed_snapshot' ? { ...link,
      source_record_id: tram.source_record_id, source_version_id: tram.version_id } : link) };
  await assert.rejects(withPublishedGtfsLocations(wrongMode, config, bq), /snapshot membership/);
  assert.equal(query.mock.callCount(), 0);
});

test('malformed, excessive or missing-provenance static references fail before publication', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  await assert.rejects(loadPublishedStaticGtfsVersions({ ...config, maxBytesBilled: null }, bq), /billed-byte ceiling/);
  const valid = (await references('metro_train'))[0];
  assert.ok(valid);
  let rows: unknown[] = [{ reference: '{}' }];
  t.mock.method(bq, 'query', async () => [rows]);
  await assert.rejects(loadPublishedStaticGtfsVersions(config, bq));
  rows = Array.from({ length: 50_001 }, () => ({ reference: '{}' }));
  await assert.rejects(loadPublishedStaticGtfsVersions(config, bq));
  rows = [{ reference: JSON.stringify({ ...valid, route_records: [] }) }];
  await assert.rejects(loadPublishedStaticGtfsVersions(config, bq), /route references are incomplete/);
});

test('cloud reference errors discard SDK request and response properties', async t => {
  const bq = new BigQuery({ projectId: config.projectId });
  const original = Object.assign(new Error('Query failed'), { response: { request: { headers: {} } } });
  t.mock.method(bq, 'query', async () => { throw original; });
  await assert.rejects(loadPublishedStaticGtfsVersions(config, bq), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Query failed');
    assert.notEqual(error, original);
    assert.equal('response' in error, false);
    assert.equal('request' in error, false);
    assert.equal('cause' in error, false);
    return true;
  });
});
