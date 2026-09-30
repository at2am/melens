import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ParkingBay, ParkingObservation, ParkingRule } from '../../src/core/types.js';
import { evaluateParkingBay } from '../../src/normalization/parking.js';

const provenance = { batch_id: 'batch', source_id: 'melbourne.parking.test',
  schema_version: 1, fetched_at: '2026-09-28T00:09:00Z' };
const bay: ParkingBay = { ...provenance, bay_id: 'bay:1', version_id: 'v1',
  marker_id: 'kerbside:1', geometry_geojson: null, public_access: true,
  valid_from: null, valid_to: null, source_record_id: 'bay-source:1',
  source_updated_at: null, source_version_ordinal: null };
const observation: ParkingObservation = { ...provenance, sensor_id: 'sensor:1',
  bay_id: 'sensor-bay:1', marker_id: 'kerbside:1', version_id: 'v1',
  observed_at: '2026-09-28T00:05:00Z', occupied: false,
  source_record_id: 'sensor-source:1' };
const rule: ParkingRule = { ...provenance, rule_id: 'rule:1',
  version_id: 'v1', bay_id: 'rule-bay:1', days_of_week: [1],
  start_minute_of_day: 9 * 60, end_minute_of_day: 18 * 60,
  holiday_applicability: 'does_not_apply', vehicle_class: 'all',
  restriction_type: 'parking_allowed', max_stay_minutes: 60,
  exemption: null, valid_from: '2026-09-01T00:00:00Z', valid_to: null,
  source_record_id: 'rule-source:1', source_updated_at: null,
  source_version_ordinal: null };

const input = { bay, allBays: [bay], observations: [observation], rules: [rule],
  ruleCrosswalk: { bayId: bay.bay_id, sensorBayId: observation.bay_id!, ruleBayId: rule.bay_id,
    evidenceUrl: 'https://example.org/official-crosswalk', verified: true as const },
  now: new Date('2026-09-28T00:10:00Z'), melbournePublicHoliday: false,
  vehicleClass: 'car', cadenceSeconds: 300,
  lastSuccessfulCheckAt: '2026-09-28T00:09:00Z' };

test('a current empty bay needs unique IDs, an official rule crosswalk and holiday evidence', () => {
  assert.equal(evaluateParkingBay(input).mayParkNow, 'yes');
  assert.equal(evaluateParkingBay({ ...input, ruleCrosswalk: null }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input, melbournePublicHoliday: null }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input,
    allBays: [bay, { ...bay, bay_id: 'bay:2' }] }).mayParkNow, 'unknown');
});

test('occupancy and permission remain separate; stale occupancy cannot prove availability', () => {
  const occupied = evaluateParkingBay({ ...input,
    observations: [{ ...observation, occupied: true }] });
  assert.equal(occupied.occupied, true);
  assert.equal(occupied.mayParkNow, 'no');
  const stale = evaluateParkingBay({ ...input, now: new Date('2026-09-28T00:30:00Z') });
  assert.equal(stale.occupied, false);
  assert.equal(stale.occupancyFreshness, 'stale');
  assert.equal(stale.mayParkNow, 'unknown');
});

test('conflicting legal rules never become an allow conclusion', () => {
  const conflict = evaluateParkingBay({ ...input,
    rules: [rule, { ...rule, rule_id: 'rule:2', restriction_type: 'no_parking' }] });
  assert.equal(conflict.mayParkNow, 'unknown');
  assert.ok(conflict.reasons.includes('rule_ambiguous'));
});

test('missing real-world marker or sensor bay key cannot be promoted to available', () => {
  const noMarker = { ...bay, marker_id: null };
  const unmatched = evaluateParkingBay({ ...input, bay: noMarker, allBays: [noMarker] });
  assert.equal(unmatched.occupied, null);
  assert.equal(unmatched.mayParkNow, 'unknown');
  assert.ok(unmatched.reasons.includes('bay_marker_not_unique'));
  const noSensorBayId = evaluateParkingBay({ ...input,
    observations: [{ ...observation, bay_id: null }] });
  assert.equal(noSensorBayId.mayParkNow, 'unknown');
  assert.ok(noSensorBayId.reasons.includes('rule_crosswalk_unverified'));
});

test('expired bay location and mismatched rule mapping cannot prove permission', () => {
  assert.equal(evaluateParkingBay({ ...input, bay: { ...bay,
    valid_to: '2026-09-27T00:00:00Z' } }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input, ruleCrosswalk: { ...input.ruleCrosswalk,
    sensorBayId: 'different' } }).mayParkNow, 'unknown');
});

test('undated historical restriction cannot establish permission today', () => {
  const result = evaluateParkingBay({ ...input, rules: [{ ...rule, valid_from: null }] });
  assert.equal(result.mayParkNow, 'unknown');
  assert.ok(result.reasons.includes('no_current_rule'));
});
