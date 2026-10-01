import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ParkingBay, ParkingObservation, ParkingRule } from '../../src/core/types.js';
import { evaluateParkingBay, type VerifiedRuleCrosswalk } from '../../src/normalization/parking.js';

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

const crosswalk: VerifiedRuleCrosswalk = { bayId: bay.bay_id, sensorBayId: 'sensor-bay:1',
  ruleBayId: rule.bay_id, evidenceUrl: 'https://example.org/official-crosswalk', verified: true };
const input = { bay, allBays: [bay], observations: [observation], rules: [rule],
  ruleCrosswalk: crosswalk,
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

test('EffectiveOnPH means the weekday restriction also applies on public holidays', () => {
  const publicHolidayRule = { ...rule, holiday_applicability: 'applies' };
  assert.equal(evaluateParkingBay({ ...input, rules: [publicHolidayRule],
    melbournePublicHoliday: false }).mayParkNow, 'yes');
  assert.equal(evaluateParkingBay({ ...input, rules: [publicHolidayRule],
    melbournePublicHoliday: true }).mayParkNow, 'yes');
  const excluded = evaluateParkingBay({ ...input, melbournePublicHoliday: true });
  assert.equal(excluded.mayParkNow, 'unknown');
  assert.ok(excluded.reasons.includes('no_current_rule'));
});

test('unknown holiday state or an unrecognized holiday policy cannot prove permission', () => {
  for (const holidayPolicy of ['all_days', 'applies', 'does_not_apply']) {
    assert.equal(evaluateParkingBay({ ...input, melbournePublicHoliday: null,
      rules: [{ ...rule, holiday_applicability: holidayPolicy }] }).mayParkNow, 'unknown');
  }
  for (const holidayPolicy of [null, '', 'not verified']) {
    for (const holiday of [false, true]) {
      assert.equal(evaluateParkingBay({ ...input, melbournePublicHoliday: holiday,
        rules: [{ ...rule, holiday_applicability: holidayPolicy }] }).mayParkNow, 'unknown');
    }
  }
});

test('malformed or reversed rule dates do not become current through NaN comparisons', () => {
  const dates: Array<Partial<ParkingRule>> = [
    { valid_from: 'invalid' }, { valid_to: 'invalid' },
    { valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-08-01T00:00:00Z' },
    { valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-09-01T00:00:00Z' },
  ];
  for (const datesOverride of dates) {
    const decision = evaluateParkingBay({ ...input, rules: [{ ...rule, ...datesOverride }] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_ambiguous'));
  }
});

test('a competing rule with unknown dates or schedule cannot be silently discarded', () => {
  const uncertainties: Array<Partial<ParkingRule>> = [
    { valid_from: null }, { valid_from: 'invalid' }, { valid_to: 'invalid' },
    { start_minute_of_day: null }, { end_minute_of_day: null },
    { start_minute_of_day: Number.NaN }, { end_minute_of_day: 1500 },
    { days_of_week: [] }, { days_of_week: [8] },
    { holiday_applicability: null }, { restriction_type: 'unknown' },
  ];
  for (const uncertainty of uncertainties) {
    const decision = evaluateParkingBay({ ...input,
      rules: [rule, { ...rule, rule_id: 'uncertain-rule', ...uncertainty }] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_ambiguous'));
  }
});

test('an overnight or equal-time sign requires publisher semantics before allowing parking', () => {
  for (const hours of [{ start: 22 * 60, end: 6 * 60 }, { start: 0, end: 0 }]) {
    const decision = evaluateParkingBay({ ...input, rules: [rule, { ...rule,
      rule_id: 'overnight', restriction_type: 'no_stopping',
      start_minute_of_day: hours.start, end_minute_of_day: hours.end }] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_ambiguous'));
  }
});

test('known inactive restrictions do not invalidate a distinct current permission', () => {
  const expired = { ...rule, rule_id: 'expired', restriction_type: 'no_stopping',
    valid_to: '2026-09-27T00:00:00Z' };
  const future = { ...rule, rule_id: 'future', restriction_type: 'no_stopping',
    valid_from: '2026-09-29T00:00:00Z' };
  const later = { ...rule, rule_id: 'later', start_minute_of_day: 12 * 60 };
  assert.equal(evaluateParkingBay({ ...input, rules: [rule, expired, future, later] }).mayParkNow, 'yes');
});

test('malformed bay validity and a historical private-access version cannot prove a current decision', () => {
  for (const fields of [{ valid_from: 'invalid' }, { valid_to: 'invalid' },
    { valid_to: '2026-09-27T00:00:00Z', public_access: false }]) {
    const invalidBay = { ...bay, ...fields };
    const decision = evaluateParkingBay({ ...input, bay: invalidBay, allBays: [invalidBay] });
    assert.equal(decision.mayParkNow, 'unknown');
  }
});

test('the unique marker must identify the requested bay version', () => {
  assert.equal(evaluateParkingBay({ ...input,
    allBays: [{ ...bay, bay_id: 'another-bay' }] }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input,
    allBays: [{ ...bay, version_id: 'another-version' }] }).mayParkNow, 'unknown');
  const blankBay = { ...bay, marker_id: ' ' };
  assert.equal(evaluateParkingBay({ ...input, bay: blankBay, allBays: [blankBay],
    observations: [{ ...observation, marker_id: ' ' }] }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input, observations: [{ ...observation, bay_id: '' }],
    ruleCrosswalk: { ...crosswalk, sensorBayId: '' } }).mayParkNow, 'unknown');
});

test('the latest observation is selected by instant across equivalent UTC offsets', () => {
  const older = { ...observation, observed_at: '2026-09-28T10:05:00+10:00', occupied: true };
  const newer = { ...observation, observed_at: '2026-09-28T00:09:00Z', occupied: false };
  const decision = evaluateParkingBay({ ...input, observations: [older, newer] });
  assert.equal(decision.occupied, false);
  assert.equal(decision.occupancyObservedAt, newer.observed_at);
  assert.equal(decision.mayParkNow, 'yes');
});

test('equal instants with conflicting occupancy remain unknown even with different offset strings', () => {
  const decision = evaluateParkingBay({ ...input, observations: [observation,
    { ...observation, observed_at: '2026-09-28T10:05:00+10:00', occupied: true }] });
  assert.equal(decision.occupied, null);
  assert.equal(decision.occupancyFreshness, 'unknown');
  assert.equal(decision.mayParkNow, 'unknown');
});

test('a sensor moved to another marker cannot keep its older bay available', () => {
  const moved = { ...observation, observed_at: '2026-09-28T00:09:00Z', marker_id: 'marker:2' };
  const decision = evaluateParkingBay({ ...input, observations: [observation, moved] });
  assert.equal(decision.occupied, null);
  assert.equal(decision.mayParkNow, 'unknown');
  assert.ok(decision.reasons.includes('occupancy_missing'));
});

test('multiple current sensor identities mapped to one marker are ambiguous without a tie timestamp', () => {
  const replacement = { ...observation, sensor_id: 'sensor:2', observed_at: '2026-09-28T00:09:00Z' };
  const decision = evaluateParkingBay({ ...input, observations: [observation, replacement] });
  assert.equal(decision.occupied, null);
  assert.equal(decision.occupancyFreshness, 'unknown');
  assert.equal(decision.mayParkNow, 'unknown');
  assert.ok(decision.reasons.includes('occupancy_conflict'));
});

test('unknown sensor chronology or empty device identity cannot prove a free bay', () => {
  for (const observations of [[{ ...observation, sensor_id: '' }],
    [observation, { ...observation, observed_at: 'invalid' },
      { ...observation, observed_at: '2026-09-28T00:09:00Z' }]]) {
    const decision = evaluateParkingBay({ ...input, observations });
    assert.equal(decision.occupancyFreshness, 'unknown');
    assert.equal(decision.mayParkNow, 'unknown');
  }
});

test('non-finite cadence and source checks older than the observation cannot establish current data', () => {
  for (const override of [{ cadenceSeconds: Number.POSITIVE_INFINITY },
    { cadenceSeconds: Number.NaN }, { lastSuccessfulCheckAt: '2026-09-28T00:04:00Z' },
    { lastSuccessfulCheckAt: 'invalid' }]) {
    const decision = evaluateParkingBay({ ...input, ...override });
    assert.equal(decision.occupancyFreshness, 'stale');
    assert.equal(decision.mayParkNow, 'unknown');
  }
});

test('an unknown vehicle category cannot obtain permission from an all-vehicles rule', () => {
  assert.equal(evaluateParkingBay({ ...input, vehicleClass: ' ' }).mayParkNow, 'unknown');
  assert.equal(evaluateParkingBay({ ...input, rules: [{ ...rule, vehicle_class: null }] }).mayParkNow,
    'unknown');
});

test('City of Melbourne sensor readings cannot be current when holiday operation is unverified', () => {
  const cityObservation = { ...observation, source_id: 'melbourne.parking.sensors' };
  const holidayRule = { ...rule, holiday_applicability: 'applies' };
  for (const holiday of [true, null]) {
    const decision = evaluateParkingBay({ ...input, observations: [cityObservation],
      rules: [holidayRule], melbournePublicHoliday: holiday });
    assert.equal(decision.occupied, false);
    assert.equal(decision.occupancyFreshness, 'unknown');
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes(holiday === true
      ? 'sensor_not_operational_public_holiday' : 'sensor_holiday_status_unknown'));
  }
  assert.equal(evaluateParkingBay({ ...input, observations: [cityObservation],
    rules: [holidayRule], melbournePublicHoliday: false }).mayParkNow, 'yes');
});

test('invalid calendar and non-UTC validity cannot allow parking alone or beside a current rule', () => {
  const uncertainDates = ['2026-02-30T00:00:00Z', '2026-09-01',
    '2026-09-01T00:00:00', '2026-09-01T10:00:00+10:00'];
  for (const date of uncertainDates) {
    for (const override of [{ valid_from: date }, { valid_to: date }]) {
      const uncertainRule = { ...rule, rule_id: 'uncertain-calendar', ...override };
      for (const rules of [[uncertainRule], [rule, uncertainRule]]) {
        const decision = evaluateParkingBay({ ...input, rules });
        assert.equal(decision.mayParkNow, 'unknown');
        assert.ok(decision.reasons.includes('rule_ambiguous'));
      }
      const uncertainBay = { ...bay, ...override };
      assert.equal(evaluateParkingBay({ ...input, bay: uncertainBay,
        allBays: [uncertainBay] }).mayParkNow, 'unknown');
    }
  }
});

test('observation and successful check timestamps require valid calendars and explicit time zones', () => {
  const uncertainObservationTimes = ['2026-02-30T00:05:00Z', '2026-09-28',
    '2026-09-28T00:05:00'];
  for (const observedAt of uncertainObservationTimes) {
    const decision = evaluateParkingBay({ ...input,
      observations: [{ ...observation, observed_at: observedAt }] });
    assert.equal(decision.occupancyFreshness, 'unknown');
    assert.equal(decision.mayParkNow, 'unknown');
  }
  for (const checkedAt of [...uncertainObservationTimes, '2026-09-28T10:09:00+10:00']) {
    const decision = evaluateParkingBay({ ...input, lastSuccessfulCheckAt: checkedAt });
    assert.equal(decision.occupancyFreshness, 'stale');
    assert.equal(decision.mayParkNow, 'unknown');
  }
});
