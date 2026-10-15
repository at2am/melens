import assert from 'node:assert/strict';
import test from 'node:test';

import { parseViewportQuery } from '@melens/shared/contracts/map-contract';
import { adaptParkingRow } from '@melens/shared/query/parking';
import type { ViewQueryResult, ViewRow } from '@melens/shared/query/query-runner';
import type { SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';
import { createPublicRecordChecker } from '../src/services/public-records.js';
import { assertSnapshotPublic } from '../src/services/viewport.js';

const source = { sourceId: 'melbourne.parking.sensors', url: 'https://data.melbourne.vic.gov.au/',
  attribution: 'City of Melbourne', versionRef: null };
const request = parseViewportQuery({ requestId: 'parking-recheck', bbox: [144.958, -37.816, 144.966, -37.8105], zoom: 18,
  layers: ['parking'], mode: 'current', window: { from: '2026-10-15T09:30:00Z', to: '2026-10-15T10:30:00Z' } });
const snapshot = { request, createdAt: '2026-10-15T10:30:00.000Z' } as never;
const coverage = { sources: [], completeness: 'complete' } as SourceCoverageSnapshot;

function row(overrides: ViewRow = {}): ViewRow {
  return { source_id: source.sourceId, batch_id: 'batch-1', sensor_id: 'kerbside:9344', version_id: 'v1',
    occupied: false, zone_number: 7, status_changed_at: '2026-10-15T10:20:00Z', source_updated_at: '2026-10-15T10:28:00Z',
    fetched_at: '2026-10-15T10:28:20Z', occupancy_freshness: 'current',
    availability_note: 'vacancy_does_not_prove_access_or_legal_permission', may_park_now: 'unknown',
    latitude: -37.81, longitude: 144.96, original_url: source.url, ...overrides };
}

function checker(rows: readonly ViewRow[]) {
  const calls: unknown[] = [];
  const check = createPublicRecordChecker({
    runQuery: async (input) => { calls.push(input); return { kind: 'complete', rows: [...rows] } as unknown as ViewQueryResult; },
    resolveSource: () => (sourceId) => sourceId === source.sourceId ? source : null,
    external: undefined,
  });
  return { check, calls };
}

const stored = adaptParkingRow(row(), { source });

test('a reading that moved from current to late is still the same published record', async () => {
  const later = adaptParkingRow(row({ occupancy_freshness: 'late' }), { source });
  assert.equal(later.versionId, stored.versionId, 'Read-time freshness is not part of the version');
  assert.notEqual(JSON.stringify(later), JSON.stringify(stored));
  const { check, calls } = checker([row({ occupancy_freshness: 'late' })]);
  assert.equal(await check([stored], snapshot, coverage, {}), true);
  const call = calls[0] as { family: string; queryId: string; recordKeys: { sensorId?: string }[] };
  assert.equal(call.family, 'publicRecords');
  assert.equal(call.queryId, 'parking');
  assert.equal(call.recordKeys[0]?.sensorId, 'kerbside:9344');
});

// The snapshot is replaced every 2 minutes. Requiring the same batch made about 1 in 7 viewport requests fail
// with notAvailable when a swap landed between the first read and this recheck (measured 2026-10-15).
test('a newer publication of a still-public sensor is not a withdrawal', async () => {
  assert.equal(await checker([row({ batch_id: 'batch-2' })]).check([stored], snapshot, coverage, {}), true,
    'A routine 2-minute publication must not fail the request');
  assert.equal(await checker([row({ version_id: 'v2', occupied: true })]).check([stored], snapshot, coverage, {}), true);
});

test('a sensor the public view no longer returns is withdrawn', async () => {
  assert.equal(await checker([]).check([stored], snapshot, coverage, {}), false, 'A sensor gone from the view is withdrawn');
  assert.equal(await checker([row({ sensor_id: 'kerbside:1' })]).check([stored], snapshot, coverage, {}), false,
    'Another sensor does not prove this one');
  assert.equal(await checker([row({ source_id: 'other.source' })]).check([stored], snapshot, coverage, {}), false,
    'A row from an unpublished source fails closed');
  assert.equal(await checker([row({ may_park_now: 'yes' })]).check([stored], snapshot, coverage, {}), false,
    'A row claiming permission fails closed');
});

function published(sourceId: string, batchId: string, publishedAt = '2026-10-15T10:30:00Z') {
  return { sourceId, topic: 'parking', scope: 'city_of_melbourne', coverageAreaRefs: [], coverageFrom: null,
    coverageTo: null, licenseStatus: 'verified_open' as const, accessStatus: 'active' as const, admitted: true,
    healthState: 'current' as const, publishedBatchId: batchId, publishedAt, publishedWindow: null,
    publishedOutputCount: 6324, evidenceState: 'unknown' as const };
}

function storedSnapshot(sourceId: string) {
  return { id: 's', family: 'viewport', identity: 'i', request, selectedLayers: ['parking'], createdAt: 0, expiresAt: 0,
    sourceWatermarks: [{ sourceId, batchId: 'batch-1', publishedAt: '2026-10-15T10:28:00Z' }],
    layers: [{ items: [stored] }], listItems: [], listCompleteness: 'complete', listTotal: null, listScope: null,
    groups: [] } as never;
}

function access(sources: ReturnType<typeof published>[], recordsPublic: boolean) {
  return { store: undefined as never, readCoverage: async () => ({ sources, completeness: 'complete' as const }),
    checkPublicRecords: async () => recordsPublic };
}

test('a routine parking publication between reads does not fail the request or a later detail read', async () => {
  await assertSnapshotPublic(storedSnapshot(source.sourceId), access([published(source.sourceId, 'batch-2')], true));
});

test('parking still fails closed when the source is withdrawn or a record is no longer public', async () => {
  await assert.rejects(assertSnapshotPublic(storedSnapshot(source.sourceId), access([], true)));
  await assert.rejects(assertSnapshotPublic(storedSnapshot(source.sourceId),
    access([published(source.sourceId, 'batch-2')], false)));
});

test('other sources keep the strict same-batch rule', async () => {
  const other = 'melbourne.development_monitor';
  await assert.rejects(assertSnapshotPublic(storedSnapshot(other), access([published(other, 'batch-2')], true)));
  await assertSnapshotPublic(storedSnapshot(other),
    access([published(other, 'batch-1', '2026-10-15T10:28:00Z')], true));
});
