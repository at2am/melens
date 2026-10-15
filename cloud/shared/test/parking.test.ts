import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import { MapAdapterError, type PublicSourceReference } from '../src/query/adapter-common.js';
import { adaptLayerRows, adaptContext, ADAPTED_LAYERS, UNLOCATED_LAYERS } from '../src/query/layer-adapters.js';
import { adaptParkingRow, adaptParkingRows, parkingDrawState } from '../src/query/parking.js';
import type { ViewRow } from '../src/query/query-runner.js';
import { sourceBelongsToLayer, type PublicSourceCoverage } from '../src/query/source-coverage.js';
import { preparePublicRecordQuery } from '../src/query/public-record-queries.js';
import { prepareViewQuery } from '../src/query/view-queries.js';

const sensors: PublicSourceReference = { sourceId: 'melbourne.parking.sensors',
  url: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-parking-bay-sensors/',
  attribution: 'City of Melbourne', versionRef: null };
const resolveSource = (sourceId: string) => sourceId === sensors.sourceId ? sensors : null;
const VACANT_NOTE = 'vacancy_does_not_prove_access_or_legal_permission';

function row(overrides: ViewRow = {}): ViewRow {
  return { source_id: sensors.sourceId, batch_id: 'batch-1', sensor_id: 'kerbside:9344',
    source_record_id: 'melbourne.parking.sensors:kerbside:9344', version_id: 'v1',
    occupied: false, reported_status: 'Unoccupied', zone_number: 7,
    status_changed_at: '2026-10-15T08:50:00Z', source_updated_at: '2026-10-15T09:00:00Z',
    fetched_at: '2026-10-15T09:00:05Z', source_freshness: 'current', occupancy_freshness: 'current',
    latitude: -37.81, longitude: 144.96, availability_note: VACANT_NOTE, may_park_now: 'unknown',
    original_url: sensors.url, ...overrides };
}

test('a current vacant sensor is drawn vacant at its own point, with its own report time', () => {
  const item = adaptParkingRow(row(), { source: sensors });
  assert.equal(item.kind, 'parking');
  assert.equal(item.layerId, 'parking');
  assert.equal(item.id, 'parking:kerbside:9344');
  assert.equal(item.title, 'Parking sensor 9344');
  assert.deepEqual(item.geometry, { type: 'Point', coordinates: [144.96, -37.81] });
  assert.equal(item.location.role, 'sensor');
  assert.equal(item.details.state, 'vacant');
  assert.equal(item.details.noDataReason, null);
  assert.equal(item.details.reading, 'current');
  assert.equal(item.details.lastReportedAt, '2026-10-15T09:00:00Z');
  assert.equal(item.details.statusChangedAt, '2026-10-15T08:50:00Z');
  assert.equal(item.time.reportedAt, '2026-10-15T09:00:00Z');
  assert.equal(item.details.zoneNumber, 7);
  assert.equal(item.sources[0]?.attribution, 'City of Melbourne');
});

test('the item never claims legal parking, and warns that construction can leave a blocked bay vacant', () => {
  const item = adaptParkingRow(row(), { source: sensors });
  assert.equal(item.details.legalParking, 'unknown');
  assert.equal(item.details.mayBeObstructed, true);
  // A view that ever relays a permission claim is refused, not forwarded.
  assert.throws(() => adaptParkingRow(row({ may_park_now: 'yes' }), { source: sensors }),
    (error: unknown) => error instanceof MapAdapterError);
});

test('an occupied current sensor is occupied; a late reading is still drawn', () => {
  assert.equal(adaptParkingRow(row({ occupied: true }), { source: sensors }).details.state, 'occupied');
  const late = adaptParkingRow(row({ occupancy_freshness: 'late' }), { source: sensors });
  assert.equal(late.details.state, 'vacant');
  assert.equal(late.details.reading, 'late');
});

test('a sensor that stopped reporting is noData, never vacant, even though it still holds a status', () => {
  const silent = adaptParkingRow(row({ occupied: false, occupancy_freshness: 'stale',
    source_freshness: 'stale', source_updated_at: '2025-06-26T02:44:34Z', availability_note: 'sensor_not_reporting' }),
  { source: sensors });
  assert.equal(silent.details.state, 'noData');
  assert.equal(silent.details.noDataReason, 'notReporting');
  assert.equal(silent.details.reading, 'stale');
  assert.equal(silent.details.lastReportedAt, '2025-06-26T02:44:34Z', 'The sensor\'s own old report time is kept');
  const unknown = adaptParkingRow(row({ occupancy_freshness: 'unknown' }), { source: sensors });
  assert.equal(unknown.details.state, 'noData');
});

test('draw state names a holiday or a missing status before "not reporting"', () => {
  const base = { occupied: false, statusChangedAt: '2026-10-15T08:50:00Z', freshness: 'current' as const, note: VACANT_NOTE };
  assert.deepEqual(parkingDrawState(base), { state: 'vacant', reason: null });
  assert.deepEqual(parkingDrawState({ ...base, note: 'sensor_not_operational_public_holiday', freshness: 'unknown' }),
    { state: 'noData', reason: 'publicHoliday' });
  assert.deepEqual(parkingDrawState({ ...base, note: 'sensor_holiday_status_unknown', freshness: 'unknown' }),
    { state: 'noData', reason: 'holidayUnknown' });
  assert.deepEqual(parkingDrawState({ ...base, occupied: null, freshness: 'unknown' }), { state: 'noData', reason: 'noStatus' });
  assert.deepEqual(parkingDrawState({ ...base, statusChangedAt: null, freshness: 'unknown' }), { state: 'noData', reason: 'noStatus' });
  assert.deepEqual(parkingDrawState({ ...base, freshness: 'stale' }), { state: 'noData', reason: 'notReporting' });
});

test('a sensor without a status time or occupancy makes no occupancy claim', () => {
  const item = adaptParkingRow(row({ occupied: null, status_changed_at: null, occupancy_freshness: 'unknown' }),
    { source: sensors });
  assert.equal(item.details.state, 'noData');
  assert.equal(item.details.noDataReason, 'noStatus');
  assert.equal(item.details.statusChangedAt, null);
});

test('each published snapshot is a new version of the same sensor so clients never keep an old reading', () => {
  const first = adaptParkingRow(row({ batch_id: 'batch-1' }), { source: sensors });
  const second = adaptParkingRow(row({ batch_id: 'batch-2' }), { source: sensors });
  assert.equal(first.id, second.id);
  assert.notEqual(first.versionId, second.versionId);
  assert.equal(adaptParkingRow(row({ batch_id: 'batch-1' }), { source: sensors }).versionId, first.versionId);
  // The version is the publication, not the read time: current -> late keeps it, so the public-record recheck holds.
  assert.equal(adaptParkingRow(row({ occupancy_freshness: 'late' }), { source: sensors }).versionId, first.versionId);
  assert.notEqual(adaptParkingRow(row({ version_id: 'v2' }), { source: sensors }).versionId, first.versionId);
});

test('the public-record recheck reads only the latest-snapshot view, by source and sensor', () => {
  const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
  const request = parseViewportQuery({ requestId: 'p', bbox: [144.95, -37.82, 144.97, -37.80], zoom: 17, layers: ['parking'],
    mode: 'current', window: { from: '2026-10-15T08:00:00Z', to: '2026-10-15T09:00:00Z' } });
  const query = preparePublicRecordQuery({ queryId: 'parking', request, config, pageSize: 1000,
    recordKeys: [{ id: 'parking:kerbside:9344', versionId: 'parking-v2:x', sourceId: sensors.sourceId, sensorId: 'kerbside:9344' }] });
  assert.match(query.query, /v_parking_sensor_current/);
  assert.match(query.query, /JSON_VALUE\(k, '\$\.sensorId'\) = s\.sensor_id/);
  assert.match(query.query, /JSON_VALUE\(k, '\$\.sourceId'\) = s\.source_id/);
  assert.doesNotMatch(query.query, /parking_sensor_memberships|source_records|geo_records/);
  assert.doesNotMatch(query.query, /kerbside:9344/, 'Keys travel as a parameter');
});

test('malformed or unpublished rows fail the layer instead of being relayed', () => {
  assert.throws(() => adaptParkingRow(row({ latitude: null }), { source: sensors }), MapAdapterError);
  assert.throws(() => adaptParkingRow(row({ latitude: 95 }), { source: sensors }), MapAdapterError);
  assert.throws(() => adaptParkingRow(row({ occupancy_freshness: 'fresh' }), { source: sensors }), MapAdapterError);
  assert.throws(() => adaptParkingRows([row()], { resolveSource: () => null }),
    (error: unknown) => error instanceof MapAdapterError && error.code === 'notPublic');
  assert.throws(() => adaptParkingRows([row({ source_id: 'other.source' })], { resolveSource }), MapAdapterError);
});

test('rows come back ordered, and there is no historical parking read', () => {
  const batch = adaptParkingRows([row({ sensor_id: 'kerbside:2' }), row({ sensor_id: 'kerbside:1' })],
    { resolveSource, mode: 'current' });
  assert.deepEqual(batch.items.map((item) => item.id), ['parking:kerbside:1', 'parking:kerbside:2']);
  assert.equal(batch.unlocatedItems.length, 0);
  assert.throws(() => adaptParkingRows([row()], { resolveSource, mode: 'historical' }), MapAdapterError);
});

test('parking is an adapted layer, has no unlocated read, and its source is only the live sensor feed', () => {
  assert.ok(ADAPTED_LAYERS.has('parking'));
  assert.ok(!UNLOCATED_LAYERS.has('parking'), 'A sensor without coordinates is never listed or drawn');
  const request = parseViewportQuery({ requestId: 'p', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 17, layers: ['parking'],
    mode: 'current', window: { from: '2026-10-15T08:00:00Z', to: '2026-10-15T09:00:00Z' } });
  const items = adaptLayerRows('parking', [row()], adaptContext(request, resolveSource, '2026-10-15T09:00:00Z'));
  assert.equal(items.items.length, 1);
  const source = (sourceId: string): PublicSourceCoverage => ({ sourceId, topic: 'parking', scope: 'city_of_melbourne',
    coverageAreaRefs: [], coverageFrom: null, coverageTo: null, licenseStatus: 'verified_open', accessStatus: 'active',
    admitted: true, healthState: 'current', publishedBatchId: 'b', publishedAt: '2026-10-15T09:00:00Z',
    publishedWindow: null, publishedOutputCount: 1, evidenceState: 'unknown' });
  assert.equal(sourceBelongsToLayer(source('melbourne.parking.sensors'), 'parking'), true);
  for (const reference of ['melbourne.parking.bays', 'melbourne.parking.restrictions']) {
    assert.equal(sourceBelongsToLayer(source(reference), 'parking'), false,
      `${reference} is a static reference, not a live reading`);
  }
});

test('the viewport query reads only the latest-snapshot view, inside the box, for admitted sources', () => {
  const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
  const request = parseViewportQuery({ requestId: 'p', bbox: [144.95, -37.82, 144.97, -37.80], zoom: 17, layers: ['parking'],
    mode: 'current', window: { from: '2026-10-15T08:00:00Z', to: '2026-10-15T09:00:00Z' } });
  const query = prepareViewQuery({ queryId: 'parking', request, config, pageSize: 500,
    publicSourceIds: ['melbourne.parking.sensors'] });
  assert.match(query.query, /v_parking_sensor_current/);
  assert.match(query.query, /s\.latitude BETWEEN @south AND @north AND s\.longitude BETWEEN @west AND @east/);
  assert.match(query.query, /s\.source_id IN UNNEST\(JSON_VALUE_ARRAY\(@publicSourceIdsJson\)\)/);
  assert.match(query.query, /LIMIT @resultLimit/);
  assert.doesNotMatch(query.query, /parking_sensor_memberships|source_records|geo_records|parking_observations/,
    'The map must never read the append-only history');
  assert.doesNotMatch(query.query, /melbourne\.parking\.sensors/, 'Source ids travel as parameters, not SQL text');
  assert.deepEqual([query.params.west, query.params.south, query.params.east, query.params.north],
    [144.95, -37.82, 144.97, -37.80]);
  assert.equal(query.params.resultLimit, 501, 'One lookahead row tells the runner the page is partial');
  assert.equal(query.maximumBytesBilled, String(config.dynamicScanBytes), 'A current read uses the small dynamic ceiling');
});
