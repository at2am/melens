import assert from 'node:assert/strict';
import test from 'node:test';

import { compareMapItems, type Bbox, type LayerResult, type MapItem } from '@melens/shared/contracts/map-contract';
import { adaptParkingRow } from '@melens/shared/query/parking';
import { aggregateLayer } from '../src/services/aggregation.js';

const BOUNDS: Bbox = [144.95, -37.82, 144.97, -37.80];
const source = { sourceId: 'melbourne.parking.sensors', url: 'https://data.melbourne.vic.gov.au/',
  attribution: 'City of Melbourne', versionRef: null };

// Sensors along one street, about 6 m apart, as bays are.
function sensor(index: number, options: { occupied?: boolean; freshness?: string } = {}) {
  return adaptParkingRow({ source_id: source.sourceId, batch_id: 'batch-1', sensor_id: `kerbside:${1000 + index}`, version_id: 'v1',
    occupied: options.occupied ?? false, zone_number: 7, status_changed_at: '2026-10-15T08:50:00Z',
    source_updated_at: '2026-10-15T09:00:00Z', fetched_at: '2026-10-15T09:00:05Z',
    occupancy_freshness: options.freshness ?? 'current', availability_note: 'vacancy_does_not_prove_access_or_legal_permission',
    may_park_now: 'unknown', latitude: -37.81, longitude: 144.96 + index * 0.00007,
    original_url: source.url }, { source });
}

function layer(items: MapItem[]): LayerResult {
  return { layerId: 'parking', state: 'available', freshness: 'current', completeness: 'complete',
    sourceIds: [source.sourceId], coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] },
    observedWindow: null, updatedAt: '2026-10-15T09:00:05Z', items: [...items].sort(compareMapItems),
    unresolvedCount: null, nextCursor: null, totalMatching: items.length };
}

const street = [sensor(0), sensor(1), sensor(2, { occupied: true }), sensor(3, { freshness: 'stale' }), sensor(4)];

test('away from the street, sensors cluster and the cluster counts only current vacant readings', () => {
  const result = aggregateLayer(layer(street), { zoom: 13, bounds: BOUNDS });
  assert.equal(result.items.length, 1, 'One street of bays is one cluster at district zoom');
  const cluster = result.items[0];
  assert.ok(cluster && cluster.kind === 'aggregate');
  assert.equal(cluster.details.metric.id, 'vacantSensorCount');
  assert.equal(cluster.details.metric.value, 3, 'Occupied and not-reporting sensors are not vacant');
  assert.equal(cluster.details.memberIds.length, 5);
  assert.match(cluster.details.metric.definition, /does not mean parking there is legal/);
});

test('close up, every sensor is drawn on its own so a driver can see each bay', () => {
  const result = aggregateLayer(layer(street), { zoom: 18, bounds: BOUNDS });
  assert.equal(result.band, 'closeUp');
  assert.equal(result.items.length, 5);
  assert.ok(result.items.every((item) => item.kind === 'parking'));
  assert.equal(result.groups.size, 0);
  const silent = result.items.find((item) => item.kind === 'parking' && item.details.noDataReason === 'notReporting');
  assert.ok(silent, 'The not-reporting sensor is still drawn, as noData');
});
