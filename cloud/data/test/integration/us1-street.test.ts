import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type {
  DataSource,
  ParkingBay,
  ParkingObservation,
  ParkingRule,
  PedestrianObservation,
  SensorLocation,
} from '../../src/core/types.js';
import {
  evaluateParkingBay,
  type ParkingDecision,
  type VerifiedRuleCrosswalk,
} from '../../src/normalization/parking.js';
import {
  joinPedestrianObservations,
} from '../../src/normalization/pedestrian.js';
import {
  normalizeRoadSnapshot,
  parseRoadPage,
  UnplannedRoadConnector,
} from '../../src/connectors/tv_road_unplanned/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { ParkingBaysConnector } from '../../src/connectors/com_parking_bays/index.js';
import { ParkingSensorsConnector } from '../../src/connectors/com_parking_sensors/index.js';
import { ParkingRestrictionsConnector } from '../../src/connectors/com_parking_restrictions/index.js';
import { PedestrianLocationsConnector } from '../../src/connectors/com_pedestrian_locations/index.js';
import type { DataConfig } from '../../src/core/config.js';
import { HttpClient, HttpFailure, type HttpResponse } from '../../src/core/http.js';
import { OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { withPublishedPedestrianLocationHistory } from '../../src/core/pedestrian-location-history.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import {
  computeCoverageStatus,
  computeSourceHealth,
} from '../../src/core/health.js';

/**
 * ============================================================================
 * Task T039: User Story 1 — Trusted Parking and Street State Integration Tests
 * ============================================================================
 *
 * Requirements & Completion Boundary:
 * 1. Comprehensive integration test suite for User Story 1 (US1) and
 *    quality-rules.md#6-抽样与运行准入.
 * The 30 + 10 parking scenarios below are synthetic contract tests. They are
 * not the real-source sample required for SC-005 production acceptance. The
 * current three City of Melbourne exports do not provide a verified three-way
 * crosswalk or current rule validity evidence, so T035 remains open.
 * A 24-hour cloud observation window is still needed for SC-002 operational
 * acceptance. Local examples cannot establish its denominator or visibility.
 *
 * 2. Parking bay evaluation using cloud/data/src/normalization/parking.ts:
 *    - Complete parking bay matching (marker_id to sensor, bay_id to rule,
 *      sensorBayId crosswalk).
 *    - Missing rules / conflict / expiration handling (mayParkNow: 'unknown').
 *    - Insufficient holiday evidence handling (unknown when holiday status is
 *      null, including an all_days rule).
 *    - Conflicting rules never become an allow conclusion.
 *    - Stale occupancy observations (>2x cadence budget) marked as 'stale' and
 *      cannot prove current availability.
 *    - Occupancy and legal permission remain separate.
 *    - SC-005 benchmark: 30 complete parking bay samples (weekdays + weekends,
 *      occupied vs vacant, allowed vs prohibited) + 10 anomaly samples where
 *      0 samples are described as allowing immediate legal parking.
 * 3. Pedestrian sensor relocation, missing minutes, and inactive devices using
 *    cloud/data/src/normalization/pedestrian.ts:
 *    - Minute vs hourly counts joined with versioned sensor locations.
 *    - Sensor relocations before and after move; gaps flagged as unlocated.
 *    - Absence of zero-filling: missing minute counts strictly preserved as
 *      null without backfilling rows.
 *    - Inactive / decommissioned / ambiguous device states.
 * 4. Road disruption clearance & source interruption (SC-002, SC-005 observables):
 *    - Cleared road disruptions no longer active current events.
 *    - Source interruption / latency does not report as 'zero disruptions' or
 *      'realtime'.
 *    - Real-source SC-002 and SC-005 gates are documented separately.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// Shared Test Constants & Helpers
// ----------------------------------------------------------------------------

const PROVENANCE = {
  batch_id: 'batch:us1:test',
  source_id: 'melbourne.test.source',
  schema_version: 1,
  fetched_at: '2026-09-28T00:08:00Z',
};

async function loadFixtureJson(relativePath: string): Promise<unknown> {
  try {
    const raw = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    return JSON.parse(raw);
  } catch {
    const fallback = new URL(`../../test/fixtures/${relativePath.replace(/^.*fixtures\//, '')}`, import.meta.url);
    const raw = await readFile(fallback, 'utf8');
    return JSON.parse(raw);
  }
}

// ============================================================================
// PART 1: Parking Bay Evaluation & SC-005 Benchmark (30 Complete + 10 Anomaly)
// ============================================================================

test('Synthetic SC-005 contract: 30 complete parking bay samples cover weekdays and weekends', () => {
  /**
   * SC-005 requirement:
   * "30 个完整车位样本必须具备新鲜占用、可关联车位与覆盖测试时刻/车辆类别的有效规则，包含工作日与周末"
   * "验证 30 个资料完整的车位全部能区分占用状态与停车规则"
   */

  interface SampleSchedule {
    isoUtc: string;
    dayOfWeek: number; // 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat, 7: Sun
    minuteOfDay: number;
    isWeekend: boolean;
  }

  const schedules: SampleSchedule[] = [
    // --- 18 Weekday schedules (Days 1 to 5) ---
    // Monday (Day 1)
    { isoUtc: '2026-09-28T00:30:00Z', dayOfWeek: 1, minuteOfDay: 630, isWeekend: false },
    { isoUtc: '2026-09-28T04:30:00Z', dayOfWeek: 1, minuteOfDay: 870, isWeekend: false },
    { isoUtc: '2026-09-28T09:00:00Z', dayOfWeek: 1, minuteOfDay: 1140, isWeekend: false },
    { isoUtc: '2026-09-28T01:15:00Z', dayOfWeek: 1, minuteOfDay: 675, isWeekend: false },
    // Tuesday (Day 2)
    { isoUtc: '2026-09-29T00:30:00Z', dayOfWeek: 2, minuteOfDay: 630, isWeekend: false },
    { isoUtc: '2026-09-29T04:30:00Z', dayOfWeek: 2, minuteOfDay: 870, isWeekend: false },
    { isoUtc: '2026-09-29T09:00:00Z', dayOfWeek: 2, minuteOfDay: 1140, isWeekend: false },
    { isoUtc: '2026-09-29T02:00:00Z', dayOfWeek: 2, minuteOfDay: 720, isWeekend: false },
    // Wednesday (Day 3)
    { isoUtc: '2026-09-30T00:30:00Z', dayOfWeek: 3, minuteOfDay: 630, isWeekend: false },
    { isoUtc: '2026-09-30T04:30:00Z', dayOfWeek: 3, minuteOfDay: 870, isWeekend: false },
    { isoUtc: '2026-09-30T08:30:00Z', dayOfWeek: 3, minuteOfDay: 1110, isWeekend: false },
    { isoUtc: '2026-09-30T01:45:00Z', dayOfWeek: 3, minuteOfDay: 705, isWeekend: false },
    // Thursday (Day 4)
    { isoUtc: '2026-10-01T00:30:00Z', dayOfWeek: 4, minuteOfDay: 630, isWeekend: false },
    { isoUtc: '2026-10-01T05:00:00Z', dayOfWeek: 4, minuteOfDay: 900, isWeekend: false },
    { isoUtc: '2026-10-01T08:00:00Z', dayOfWeek: 4, minuteOfDay: 1080, isWeekend: false },
    // Friday (Day 5)
    { isoUtc: '2026-10-02T00:30:00Z', dayOfWeek: 5, minuteOfDay: 630, isWeekend: false },
    { isoUtc: '2026-10-02T04:30:00Z', dayOfWeek: 5, minuteOfDay: 870, isWeekend: false },
    { isoUtc: '2026-10-02T09:30:00Z', dayOfWeek: 5, minuteOfDay: 1170, isWeekend: false },

    // --- 12 Weekend schedules (Days 6 & 7) ---
    // Saturday (Day 6)
    { isoUtc: '2026-10-03T00:30:00Z', dayOfWeek: 6, minuteOfDay: 630, isWeekend: true },
    { isoUtc: '2026-10-03T02:00:00Z', dayOfWeek: 6, minuteOfDay: 720, isWeekend: true },
    { isoUtc: '2026-10-03T04:30:00Z', dayOfWeek: 6, minuteOfDay: 870, isWeekend: true },
    { isoUtc: '2026-10-03T06:30:00Z', dayOfWeek: 6, minuteOfDay: 990, isWeekend: true },
    { isoUtc: '2026-10-03T08:30:00Z', dayOfWeek: 6, minuteOfDay: 1110, isWeekend: true },
    { isoUtc: '2026-10-03T09:30:00Z', dayOfWeek: 6, minuteOfDay: 1170, isWeekend: true },
    // Sunday (Day 7)
    { isoUtc: '2026-09-27T00:30:00Z', dayOfWeek: 7, minuteOfDay: 630, isWeekend: true },
    { isoUtc: '2026-09-27T02:00:00Z', dayOfWeek: 7, minuteOfDay: 720, isWeekend: true },
    { isoUtc: '2026-09-27T04:30:00Z', dayOfWeek: 7, minuteOfDay: 870, isWeekend: true },
    { isoUtc: '2026-09-27T06:00:00Z', dayOfWeek: 7, minuteOfDay: 960, isWeekend: true },
    { isoUtc: '2026-09-27T08:00:00Z', dayOfWeek: 7, minuteOfDay: 1080, isWeekend: true },
    { isoUtc: '2026-09-27T09:30:00Z', dayOfWeek: 7, minuteOfDay: 1170, isWeekend: true },
  ];

  assert.equal(schedules.length, 30, 'Must have exactly 30 benchmark schedules');
  const weekdayCount = schedules.filter(s => !s.isWeekend).length;
  const weekendCount = schedules.filter(s => s.isWeekend).length;
  assert.equal(weekdayCount, 18, 'Expected 18 weekday samples');
  assert.equal(weekendCount, 12, 'Expected 12 weekend samples');

  const allBays: ParkingBay[] = [];
  const testInputs: Array<{
    sampleIndex: number;
    isWeekend: boolean;
    bay: ParkingBay;
    observation: ParkingObservation;
    rule: ParkingRule;
    ruleCrosswalk: VerifiedRuleCrosswalk;
    now: Date;
    expectedOccupied: boolean;
    expectedMayParkNow: 'yes' | 'no';
    expectedReason: string;
  }> = [];

  for (const [i, sched] of schedules.entries()) {
    const bayId = `bay:complete:${i + 1}`;
    const markerId = `marker:complete:${i + 1}`;
    const sensorBayId = `sensor-bay:${i + 1}`;
    const ruleBayId = `rule-bay:${i + 1}`;
    const ruleId = `rule:complete:${i + 1}`;
    const sensorId = `sensor:complete:${i + 1}`;

    const bay: ParkingBay = {
      ...PROVENANCE,
      bay_id: bayId,
      version_id: `v-bay-${i + 1}`,
      marker_id: markerId,
      geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
      public_access: true,
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: `bay-src:${i + 1}`,
      source_updated_at: null,
      source_version_ordinal: null,
    };
    allBays.push(bay);

    const now = new Date(sched.isoUtc);
    const observedAt = new Date(now.getTime() - 120 * 1000).toISOString();

    let occupied: boolean;
    let restrictionType: 'parking_allowed' | 'no_parking';
    let expectedMayParkNow: 'yes' | 'no';
    let expectedReason: string;

    if (i < 12 || (i >= 18 && i < 24)) {
      // Vacant + Allowed -> YES
      occupied = false;
      restrictionType = 'parking_allowed';
      expectedMayParkNow = 'yes';
      expectedReason = 'verified_allow';
    } else if ((i >= 12 && i < 16) || (i >= 24 && i < 28)) {
      // Occupied + Allowed -> NO (Physical occupancy blocks legal permission)
      occupied = true;
      restrictionType = 'parking_allowed';
      expectedMayParkNow = 'no';
      expectedReason = 'occupied';
    } else {
      // Vacant + Prohibited -> NO (Legal rule prohibits even though physically vacant)
      occupied = false;
      restrictionType = 'no_parking';
      expectedMayParkNow = 'no';
      expectedReason = 'rule_prohibits';
    }

    const observation: ParkingObservation = {
      ...PROVENANCE,
      sensor_id: sensorId,
      bay_id: sensorBayId,
      marker_id: markerId,
      version_id: `v-obs-${i + 1}`,
      observed_at: observedAt,
      occupied,
      source_record_id: `sensor-src:${i + 1}`,
    };

    const rule: ParkingRule = {
      ...PROVENANCE,
      rule_id: ruleId,
      version_id: `v-rule-${i + 1}`,
      bay_id: ruleBayId,
      days_of_week: [sched.dayOfWeek],
      start_minute_of_day: sched.minuteOfDay - 60,
      end_minute_of_day: sched.minuteOfDay + 60,
      holiday_applicability: 'all_days',
      vehicle_class: 'all',
      restriction_type: restrictionType,
      max_stay_minutes: 60,
      exemption: null,
      valid_from: '2026-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: `rule-src:${i + 1}`,
      source_updated_at: null,
      source_version_ordinal: null,
    };

    const ruleCrosswalk: VerifiedRuleCrosswalk = {
      bayId,
      sensorBayId,
      ruleBayId,
      evidenceUrl: `https://example.test/fixtures/parking-crosswalk/${bayId}`,
      verified: true,
    };

    testInputs.push({
      sampleIndex: i + 1,
      isWeekend: sched.isWeekend,
      bay,
      observation,
      rule,
      ruleCrosswalk,
      now,
      expectedOccupied: occupied,
      expectedMayParkNow,
      expectedReason,
    });
  }

  // Execute evaluation on all 30 complete samples
  const results: ParkingDecision[] = [];
  for (const input of testInputs) {
    const decision = evaluateParkingBay({
      bay: input.bay,
      allBays,
      observations: [input.observation],
      rules: [input.rule],
      ruleCrosswalk: input.ruleCrosswalk,
      now: input.now,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(input.now.getTime() - 60000).toISOString(),
    });

    results.push(decision);

    assert.equal(decision.bayId, input.bay.bay_id);
    assert.equal(decision.occupied, input.expectedOccupied, `Sample ${input.sampleIndex} occupied mismatch`);
    assert.equal(decision.occupancyFreshness, 'current', `Sample ${input.sampleIndex} freshness must be current`);
    assert.equal(decision.mayParkNow, input.expectedMayParkNow, `Sample ${input.sampleIndex} mayParkNow mismatch`);
    assert.equal(decision.appliedRuleIds.length, 1, `Sample ${input.sampleIndex} must apply exactly 1 rule`);
    assert.equal(decision.appliedRuleIds[0], input.rule.rule_id);
    assert.ok(decision.reasons.includes(input.expectedReason),
      `Sample ${input.sampleIndex} expected reason '${input.expectedReason}', got: ${decision.reasons.join(', ')}`);
  }

  assert.equal(results.length, 30);
  const yesDecisions = results.filter(r => r.mayParkNow === 'yes');
  const noDecisions = results.filter(r => r.mayParkNow === 'no');
  const unknownDecisions = results.filter(r => r.mayParkNow === 'unknown');

  assert.equal(yesDecisions.length, 18, 'Expected 18 unambiguous allow decisions');
  assert.equal(noDecisions.length, 12, 'Expected 12 prohibited / occupied decisions');
  assert.equal(unknownDecisions.length, 0, 'No complete sample should be ambiguous');

  // Verify that physical occupancy and legal permission are strictly decoupled:
  for (const r of results.filter(res => res.occupied === true)) {
    assert.equal(r.mayParkNow, 'no');
    assert.ok(r.reasons.includes('occupied'));
  }
  for (const r of results.filter(res => res.occupied === false && res.reasons.includes('rule_prohibits'))) {
    assert.equal(r.mayParkNow, 'no');
    assert.equal(r.occupied, false);
  }
});

test('Synthetic SC-005 contract: 10 anomaly samples never claim immediate legal parking', () => {
  /**
   * SC-005 requirement:
   * "10 个异常样本至少覆盖关联缺失、规则冲突、规则过期、占用过期及节假日状态无法核实"
   * "10 个缺失、冲突或过期样本中，0 个被描述为可立即合法停车"
   */

  const baseNow = new Date('2026-09-28T00:30:00Z'); // Monday 10:30 AEST, minute: 630
  const baseBay: ParkingBay = {
    ...PROVENANCE,
    bay_id: 'bay:anomaly:base',
    version_id: 'v-bay-base',
    marker_id: 'marker:anomaly:base',
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    public_access: true,
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'bay-src:base',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const baseObservation: ParkingObservation = {
    ...PROVENANCE,
    sensor_id: 'sensor:anomaly:base',
    bay_id: 'sensor-bay:anomaly:base',
    marker_id: 'marker:anomaly:base',
    version_id: 'v-obs-base',
    observed_at: new Date(baseNow.getTime() - 120 * 1000).toISOString(),
    occupied: false,
    source_record_id: 'sensor-src:base',
  };

  const baseRule: ParkingRule = {
    ...PROVENANCE,
    rule_id: 'rule:anomaly:base',
    version_id: 'v-rule-base',
    bay_id: 'rule-bay:anomaly:base',
    days_of_week: [1],
    start_minute_of_day: 9 * 60,
    end_minute_of_day: 18 * 60,
    holiday_applicability: 'all_days',
    vehicle_class: 'all',
    restriction_type: 'parking_allowed',
    max_stay_minutes: 60,
    exemption: null,
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'rule-src:base',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const baseCrosswalk: VerifiedRuleCrosswalk = {
    bayId: baseBay.bay_id,
    sensorBayId: 'sensor-bay:anomaly:base',
    ruleBayId: baseRule.bay_id,
    evidenceUrl: 'https://example.test/fixtures/parking-crosswalk/anomaly-base',
    verified: true,
  };

  interface AnomalySample {
    name: string;
    description: string;
    expectedMayParkNow: 'unknown' | 'no';
    expectedReason: string;
    decision: ParkingDecision;
  }

  const anomalyResults: AnomalySample[] = [];

  // Anomaly 1: Missing rule crosswalk (bay cannot be linked to regulations)
  {
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [baseRule],
      ruleCrosswalk: null,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_1_MISSING_CROSSWALK',
      description: 'Sensor vacant but crosswalk to parking rule is missing',
      expectedMayParkNow: 'unknown',
      expectedReason: 'rule_crosswalk_unverified',
      decision,
    });
  }

  // Anomaly 2: Crosswalk unverified (non-HTTPS evidence URL)
  {
    const unverifiedCrosswalk = {
      ...baseCrosswalk,
      evidenceUrl: 'http://insecure-http.example.org/crosswalk', // Not HTTPS
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [baseRule],
      ruleCrosswalk: unverifiedCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_2_UNVERIFIED_CROSSWALK_EVIDENCE',
      description: 'Crosswalk evidence URL is insecure HTTP rather than HTTPS',
      expectedMayParkNow: 'unknown',
      expectedReason: 'rule_crosswalk_unverified',
      decision,
    });
  }

  // Anomaly 3: Non-unique marker ID across bays (marker ambiguity)
  {
    const dupBay1 = { ...baseBay, bay_id: 'bay:dup:1', marker_id: 'marker:shared' };
    const dupBay2 = { ...baseBay, bay_id: 'bay:dup:2', marker_id: 'marker:shared' };
    const dupObs = { ...baseObservation, marker_id: 'marker:shared' };
    const decision = evaluateParkingBay({
      bay: dupBay1,
      allBays: [dupBay1, dupBay2],
      observations: [dupObs],
      rules: [baseRule],
      ruleCrosswalk: { ...baseCrosswalk, bayId: dupBay1.bay_id },
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_3_NON_UNIQUE_MARKER',
      description: 'Multiple bays share the same marker_id without unique resolution',
      expectedMayParkNow: 'unknown',
      expectedReason: 'bay_marker_not_unique',
      decision,
    });
  }

  // Anomaly 4: Conflicting occupancy observations at identical timestamp
  {
    const tiedObs1 = { ...baseObservation, occupied: false, observed_at: '2026-09-28T00:25:00Z' };
    const tiedObs2 = { ...baseObservation, sensor_id: 'sensor:anomaly:alt', occupied: true, observed_at: '2026-09-28T00:25:00Z' };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [tiedObs1, tiedObs2],
      rules: [baseRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_4_OCCUPANCY_CONFLICT',
      description: 'Tied observations at identical timestamp report conflicting occupancy',
      expectedMayParkNow: 'unknown',
      expectedReason: 'occupancy_conflict',
      decision,
    });
  }

  // Anomaly 5: Missing applicable rule for the current time slot
  {
    const eveningOnlyRule: ParkingRule = {
      ...baseRule,
      start_minute_of_day: 18 * 60,
      end_minute_of_day: 20 * 60,
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [eveningOnlyRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_5_NO_CURRENT_RULE',
      description: 'No parking regulation covers the current hour of day',
      expectedMayParkNow: 'unknown',
      expectedReason: 'no_current_rule',
      decision,
    });
  }

  // Anomaly 6: Conflicting legal rules for current time (allow vs prohibit overlap)
  {
    const allowRule: ParkingRule = {
      ...baseRule,
      rule_id: 'rule:conflict:allow',
      restriction_type: 'parking_allowed',
    };
    const prohibitRule: ParkingRule = {
      ...baseRule,
      rule_id: 'rule:conflict:prohibit',
      restriction_type: 'no_parking',
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [allowRule, prohibitRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_6_RULE_CONFLICT',
      description: 'Two conflicting rules apply simultaneously (allow vs no_parking)',
      expectedMayParkNow: 'unknown',
      expectedReason: 'rule_ambiguous',
      decision,
    });
  }

  // Anomaly 7: Rule expired in the past (valid_to <= now)
  {
    const expiredRule: ParkingRule = {
      ...baseRule,
      valid_to: '2026-09-01T00:00:00Z',
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [expiredRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_7_RULE_EXPIRED',
      description: 'Parking rule valid_to has passed; rule is expired',
      expectedMayParkNow: 'unknown',
      expectedReason: 'no_current_rule',
      decision,
    });
  }

  // Anomaly 8: Rule future / not yet effective (valid_from > now)
  {
    const futureRule: ParkingRule = {
      ...baseRule,
      valid_from: '2026-10-15T00:00:00Z',
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [futureRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_8_RULE_FUTURE_EFFECTIVE',
      description: 'Parking rule valid_from is in the future',
      expectedMayParkNow: 'unknown',
      expectedReason: 'no_current_rule',
      decision,
    });
  }

  // Anomaly 9: Stale occupancy observation (> 2x cadence budget)
  {
    const staleObs: ParkingObservation = {
      ...baseObservation,
      observed_at: new Date(baseNow.getTime() - 30 * 60 * 1000).toISOString(),
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [staleObs],
      rules: [baseRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: false,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_9_OCCUPANCY_STALE',
      description: 'Observation age is 30 minutes, exceeding 2x cadence budget',
      expectedMayParkNow: 'unknown',
      expectedReason: 'occupancy_stale',
      decision,
    });
  }

  // Anomaly 10: Insufficient holiday evidence (holiday status is null for non-all_days rule)
  {
    const holidayConditionalRule: ParkingRule = {
      ...baseRule,
      holiday_applicability: 'does_not_apply',
    };
    const decision = evaluateParkingBay({
      bay: baseBay,
      allBays: [baseBay],
      observations: [baseObservation],
      rules: [holidayConditionalRule],
      ruleCrosswalk: baseCrosswalk,
      now: baseNow,
      melbournePublicHoliday: null,
      vehicleClass: 'car',
      cadenceSeconds: 300,
      lastSuccessfulCheckAt: new Date(baseNow.getTime() - 60000).toISOString(),
    });
    anomalyResults.push({
      name: 'ANOMALY_10_HOLIDAY_EVIDENCE_UNKNOWN',
      description: 'Rule holiday applicability is does_not_apply but holiday evidence is null',
      expectedMayParkNow: 'unknown',
      expectedReason: 'rule_ambiguous',
      decision,
    });
  }

  assert.equal(anomalyResults.length, 10, 'Must have exactly 10 anomaly samples');

  for (const sample of anomalyResults) {
    assert.equal(sample.decision.mayParkNow, sample.expectedMayParkNow,
      `Anomaly ${sample.name} mayParkNow mismatch: expected ${sample.expectedMayParkNow}`);
    assert.ok(sample.decision.reasons.includes(sample.expectedReason),
      `Anomaly ${sample.name} missing reason ${sample.expectedReason}. Got: ${sample.decision.reasons.join(', ')}`);

    // Synthetic anomaly cases must never describe immediate legal parking.
    assert.notEqual(sample.decision.mayParkNow, 'yes',
      `CRITICAL FAILURE: Anomaly sample ${sample.name} allowed immediate parking!`);
  }

  const zeroAllowed = anomalyResults.filter(s => s.decision.mayParkNow === 'yes').length;
  assert.equal(zeroAllowed, 0, 'Synthetic contract: Exactly 0 out of 10 anomaly samples can result in yes');
});

test('Current City of Melbourne API-shaped parking fixtures cannot establish a legal parking permission', async () => {
  const fixtureSchema = z.object({ total_count: z.number().int().nonnegative(), results: z.array(z.unknown()) });
  const [bays, sensors, restrictions] = await Promise.all([
    loadFixtureJson('../fixtures/com_parking_bays.json').then(value => fixtureSchema.parse(value)),
    loadFixtureJson('../fixtures/com_parking_sensors.json').then(value => fixtureSchema.parse(value)),
    loadFixtureJson('../fixtures/com_parking_restrictions.json').then(value => fixtureSchema.parse(value)),
  ]);
  const fetchedAt = '2026-09-28T13:10:00Z';

  class FixtureBayHttpClient extends HttpClient {
    override async getJson(request: Parameters<HttpClient['getJson']>[0]): Promise<HttpResponse<unknown>> {
      const body = String(request.url).includes('/records?limit=0')
        ? { total_count: bays.total_count } : bays.results;
      return {
        body, status: 200, fetchedAt,
        etag: null, lastModified: null, contentType: 'application/json',
      };
    }
  }

  class FixtureOdsClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      const fixture = query.datasetId === 'on-street-parking-bay-sensors'
        ? sensors : restrictions;
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt,
        lastModified: query.datasetId === 'on-street-parking-bay-sensors'
          ? '2026-09-28T18:45:00Z' : '2022-11-13T10:30:19Z',
      };
    }
  }

  const bayResult = await new ParkingBaysConnector(new FixtureBayHttpClient()).collect(
    parseConnectorInput({ sourceId: 'melbourne.parking.bays',
      window: { kind: 'snapshot', revision: 'fixture' }, checkpoint: null, runId: 'us1-bays' }),
  );
  const sensorResult = await new ParkingSensorsConnector(new FixtureOdsClient()).collect(
    parseConnectorInput({ sourceId: 'melbourne.parking.sensors',
      window: { kind: 'snapshot', revision: 'fixture' }, checkpoint: null, runId: 'us1-sensors' }),
  );
  const ruleResult = await new ParkingRestrictionsConnector(new FixtureOdsClient()).collect(
    parseConnectorInput({ sourceId: 'melbourne.parking.restrictions',
      window: { kind: 'snapshot', revision: 'fixture' }, checkpoint: null, runId: 'us1-rules' }),
  );

  assert.equal(bayResult.kind, 'success');
  assert.equal(sensorResult.kind, 'success');
  assert.equal(ruleResult.kind, 'success');
  if (bayResult.kind !== 'success' || sensorResult.kind !== 'success'
    || ruleResult.kind !== 'success') return;

  assert.ok(bayResult.parkingBays.length > 0);
  assert.ok(sensorResult.parkingObservations.length > 0);
  assert.ok(ruleResult.parkingRules.length > 0);
  assert.ok(bayResult.parkingBays.every(bay => bay.marker_id === null));
  assert.ok(sensorResult.parkingObservations.some(observation => observation.marker_id === null));
  assert.ok(ruleResult.parkingRules.every(rule => rule.valid_from === null));

  const decisions = bayResult.parkingBays.map(bay => evaluateParkingBay({
    bay,
    allBays: bayResult.parkingBays,
    observations: sensorResult.parkingObservations,
    rules: ruleResult.parkingRules,
    ruleCrosswalk: null,
    now: new Date(fetchedAt),
    melbournePublicHoliday: null,
    vehicleClass: 'car',
    cadenceSeconds: 300,
    lastSuccessfulCheckAt: fetchedAt,
  }));
  assert.ok(decisions.every(decision => decision.mayParkNow === 'unknown'));
  assert.ok(decisions.every(decision => decision.reasons.includes('rule_crosswalk_unverified')));
  assert.ok(decisions.every(decision => decision.occupied === null));
});

test('Parking edge cases: vehicle class, exemptions, missing keys, expired bays, undated rules', () => {
  const now = new Date('2026-09-28T00:30:00Z');
  const bay: ParkingBay = {
    ...PROVENANCE,
    bay_id: 'bay:edge:1',
    version_id: 'v1',
    marker_id: 'marker:edge:1',
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    public_access: true,
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'bay-src:edge',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const observation: ParkingObservation = {
    ...PROVENANCE,
    sensor_id: 'sensor:edge:1',
    bay_id: 'sensor-bay:edge:1',
    marker_id: 'marker:edge:1',
    version_id: 'v1',
    observed_at: new Date(now.getTime() - 60000).toISOString(),
    occupied: false,
    source_record_id: 'obs-src:edge',
  };

  const rule: ParkingRule = {
    ...PROVENANCE,
    rule_id: 'rule:edge:1',
    version_id: 'v1',
    bay_id: 'rule-bay:edge:1',
    days_of_week: [1],
    start_minute_of_day: 9 * 60,
    end_minute_of_day: 18 * 60,
    holiday_applicability: 'all_days',
    vehicle_class: 'all',
    restriction_type: 'parking_allowed',
    max_stay_minutes: 60,
    exemption: null,
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'rule-src:edge',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const ruleCrosswalk: VerifiedRuleCrosswalk = {
    bayId: bay.bay_id,
    sensorBayId: 'sensor-bay:edge:1',
    ruleBayId: rule.bay_id,
    evidenceUrl: 'https://example.test/fixtures/parking-crosswalk/edge',
    verified: true,
  };

  const baseInput = {
    bay,
    allBays: [bay],
    observations: [observation],
    rules: [rule],
    ruleCrosswalk,
    now,
    melbournePublicHoliday: false,
    vehicleClass: 'car',
    cadenceSeconds: 300,
    lastSuccessfulCheckAt: new Date(now.getTime() - 60000).toISOString(),
  };

  // 1. Vehicle class mismatch (motorcycle rule evaluated for car)
  {
    const motoRule: ParkingRule = { ...rule, vehicle_class: 'motorcycle' };
    const decision = evaluateParkingBay({ ...baseInput, rules: [motoRule] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_ambiguous'));
  }

  // 2. Rule with permit exemption requires separate evaluation
  {
    const exemptionRule: ParkingRule = { ...rule, exemption: 'Disability Permit Only' };
    const decision = evaluateParkingBay({ ...baseInput, rules: [exemptionRule] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_ambiguous'));
  }

  // 3. Private access bay (public_access: false)
  {
    const privateBay: ParkingBay = { ...bay, public_access: false };
    const decision = evaluateParkingBay({ ...baseInput, bay: privateBay, allBays: [privateBay] });
    assert.equal(decision.mayParkNow, 'no');
    assert.ok(decision.reasons.includes('not_public_access'));
  }

  // 4. Public access unknown (public_access: null)
  {
    const unknownBay: ParkingBay = { ...bay, public_access: null };
    const decision = evaluateParkingBay({ ...baseInput, bay: unknownBay, allBays: [unknownBay] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('public_access_unknown'));
  }

  // 5. Stale check timestamp (> 2x cadence budget) makes freshness stale
  {
    const staleCheck = evaluateParkingBay({
      ...baseInput,
      lastSuccessfulCheckAt: new Date(now.getTime() - 700 * 1000).toISOString(),
    });
    assert.equal(staleCheck.occupancyFreshness, 'stale');
    assert.equal(staleCheck.mayParkNow, 'unknown');
    assert.ok(staleCheck.reasons.includes('occupancy_stale'));
  }

  // 6. Holiday applies rule correctly evaluates when holiday is known
  {
    const phRule: ParkingRule = { ...rule, holiday_applicability: 'applies' };
    const onHoliday = evaluateParkingBay({ ...baseInput, rules: [phRule], melbournePublicHoliday: true });
    assert.equal(onHoliday.mayParkNow, 'yes');

    const notOnHoliday = evaluateParkingBay({ ...baseInput, rules: [phRule], melbournePublicHoliday: false });
    assert.equal(notOnHoliday.mayParkNow, 'yes');
  }

  // 7. Missing bay marker (marker_id: null)
  {
    const noMarkerBay = { ...bay, marker_id: null };
    const decision = evaluateParkingBay({ ...baseInput, bay: noMarkerBay, allBays: [noMarkerBay] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('bay_marker_not_unique'));
  }

  // 8. Missing observation bay_id cannot satisfy verified crosswalk
  {
    const noBayObs = { ...observation, bay_id: null };
    const decision = evaluateParkingBay({ ...baseInput, observations: [noBayObs] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_crosswalk_unverified'));
  }

  // 9. Mismatched sensorBayId in crosswalk
  {
    const mismatchedCrosswalk = { ...ruleCrosswalk, sensorBayId: 'unmatched-sensor-bay' };
    const decision = evaluateParkingBay({ ...baseInput, ruleCrosswalk: mismatchedCrosswalk });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('rule_crosswalk_unverified'));
  }

  // 10. Expired bay polygon version (valid_to <= now)
  {
    const expiredBay = { ...bay, valid_to: '2026-09-20T00:00:00Z' };
    const decision = evaluateParkingBay({ ...baseInput, bay: expiredBay, allBays: [expiredBay] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('bay_version_expired'));
  }

  // 11. Undated historical rule (valid_from: null) cannot establish permission today
  {
    const undatedRule = { ...rule, valid_from: null };
    const decision = evaluateParkingBay({ ...baseInput, rules: [undatedRule] });
    assert.equal(decision.mayParkNow, 'unknown');
    assert.ok(decision.reasons.includes('no_current_rule'));
  }

  const uncertainRules: Array<{ name: string; patch: Partial<ParkingRule> }> = [
    { name: 'invalid validity start', patch: { valid_from: 'not-a-time' } },
    { name: 'invalid validity end', patch: { valid_to: 'not-a-time' } },
    { name: 'reversed validity', patch: { valid_from: '2026-09-01T00:00:00Z', valid_to: '2026-01-01T00:00:00Z' } },
    { name: 'undated rule', patch: { valid_from: null } },
    { name: 'missing start clock', patch: { start_minute_of_day: null } },
    { name: 'missing end clock', patch: { end_minute_of_day: null } },
    { name: 'missing weekday', patch: { days_of_week: [] } },
    { name: 'unknown holiday policy', patch: { holiday_applicability: 'unknown' } },
    { name: 'unknown restriction', patch: { restriction_type: 'untranslated_sign' } },
    { name: 'unknown vehicle class', patch: { vehicle_class: 'unclassified' } },
    { name: 'permit exemption', patch: { exemption: 'Permit holders excepted' } },
    { name: 'overnight schedule without day ownership', patch: { start_minute_of_day: 1380, end_minute_of_day: 60 } },
    { name: 'equal clock endpoints', patch: { start_minute_of_day: 630, end_minute_of_day: 630 } },
  ];
  for (const { name, patch } of uncertainRules) {
    const uncertain = { ...rule, ...patch, rule_id: `uncertain:${name}` };
    const onlyUncertain = evaluateParkingBay({ ...baseInput, rules: [uncertain] });
    assert.equal(onlyUncertain.mayParkNow, 'unknown', name);
    const alongsideAllow = evaluateParkingBay({ ...baseInput, rules: [rule, uncertain] });
    assert.equal(alongsideAllow.mayParkNow, 'unknown', `${name} cannot be ignored beside an allow rule`);
    assert.equal(alongsideAllow.occupied, false, `${name} must retain occupancy evidence`);
  }

  for (const irrelevantRule of [
    { ...rule, rule_id: 'expired', valid_to: '2026-09-01T00:00:00Z' },
    { ...rule, rule_id: 'future', valid_from: '2026-10-01T00:00:00Z' },
    { ...rule, rule_id: 'tuesday', days_of_week: [2] },
    { ...rule, rule_id: 'evening', start_minute_of_day: 1200, end_minute_of_day: 1320 },
    { ...rule, rule_id: 'different-bay', bay_id: 'another-rule-bay' },
  ]) {
    const decision = evaluateParkingBay({ ...baseInput, rules: [rule, irrelevantRule] });
    assert.equal(decision.mayParkNow, 'yes', `${irrelevantRule.rule_id} is proven irrelevant to this decision`);
    assert.deepEqual(decision.appliedRuleIds, [rule.rule_id]);
  }

  const unknownHoliday = evaluateParkingBay({ ...baseInput, melbournePublicHoliday: null });
  assert.equal(unknownHoliday.occupied, false);
  assert.equal(unknownHoliday.mayParkNow, 'unknown', 'all_days does not supply missing authoritative holiday evidence');

  const citySensor = { ...observation, source_id: 'melbourne.parking.sensors' };
  for (const holiday of [true, null]) {
    const decision = evaluateParkingBay({ ...baseInput, observations: [citySensor],
      melbournePublicHoliday: holiday, cadenceSeconds: 120 });
    assert.equal(decision.occupied, false, 'Source operating limits retain the reported reading');
    assert.equal(decision.occupancyFreshness, 'unknown', 'City parking sensors do not prove current occupancy during holidays');
    assert.equal(decision.mayParkNow, 'unknown');
  }
  const cityOrdinaryDay = evaluateParkingBay({ ...baseInput, observations: [citySensor], cadenceSeconds: 120 });
  assert.equal(cityOrdinaryDay.occupancyFreshness, 'current');
  assert.equal(cityOrdinaryDay.mayParkNow, 'yes', 'The synthetic complete association works within source operating limits');

  for (const elapsedSeconds of [600, 601]) {
    const freshUntil = evaluateParkingBay({ ...baseInput, observations: [{ ...observation,
      observed_at: new Date(now.getTime() - elapsedSeconds * 1000).toISOString(),
    }] });
    assert.equal(freshUntil.mayParkNow, elapsedSeconds === 600 ? 'yes' : 'unknown');
  }

  const movedSensor = evaluateParkingBay({ ...baseInput, observations: [observation,
    { ...observation, marker_id: 'different-marker',
      observed_at: new Date(now.getTime() - 30_000).toISOString(), version_id: 'after-move' },
  ] });
  assert.equal(movedSensor.occupied, null, 'A newer observation at another marker supersedes this device old bay reading');
  assert.equal(movedSensor.mayParkNow, 'unknown');
});

// ============================================================================
// PART 2: Pedestrian Sensor Relocation, Minute vs Hourly & Missing Minutes
// ============================================================================

test('Pedestrian: minute vs hourly counts joined with versioned sensor locations retain true granularity', () => {
  const locV1: SensorLocation = {
    ...PROVENANCE,
    sensor_id: 'ped-sensor:1',
    version_id: 'loc-v1',
    geometry_geojson: '{"type":"Point","coordinates":[144.965,-37.812]}',
    device_status: 'A',
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: '2026-09-28T00:00:00Z',
    source_record_id: 'loc-src:1',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const locV2: SensorLocation = {
    ...locV1,
    version_id: 'loc-v2',
    geometry_geojson: '{"type":"Point","coordinates":[144.970,-37.815]}',
    valid_from: '2026-09-28T00:00:00Z',
    valid_to: null,
    source_record_id: 'loc-src:2',
  };

  const obsMinute: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'ped-sensor:1',
    observed_at: '2026-09-28T00:15:00Z',
    version_id: 'obs-min:1',
    direction_a_count: 14,
    direction_b_count: 22,
    total_count: 36,
    source_record_id: 'min-src:1',
  };

  const obsHourly: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'ped-sensor:1',
    observed_at: '2026-09-27T10:00:00Z',
    version_id: 'obs-hr:1',
    direction_a_count: 450,
    direction_b_count: 620,
    total_count: 1070,
    source_record_id: 'hr-src:1',
  };

  // Join minute observations
  const joinedMinute = joinPedestrianObservations({
    observations: [obsMinute],
    locations: [locV1, locV2],
    granularity: 'minute',
  });
  assert.equal(joinedMinute.length, 1);
  assert.equal(joinedMinute[0]?.granularity, 'minute');
  assert.equal(joinedMinute[0]?.locationStatus, 'located');
  assert.equal(joinedMinute[0]?.location?.version_id, 'loc-v2');
  assert.equal(joinedMinute[0]?.observation.total_count, 36);

  // Join hourly observations
  const joinedHourly = joinPedestrianObservations({
    observations: [obsHourly],
    locations: [locV1, locV2],
    granularity: 'hour',
  });
  assert.equal(joinedHourly.length, 1);
  assert.equal(joinedHourly[0]?.granularity, 'hour');
  assert.equal(joinedHourly[0]?.locationStatus, 'located');
  assert.equal(joinedHourly[0]?.location?.version_id, 'loc-v1');
  assert.equal(joinedHourly[0]?.observation.total_count, 1070);
});

test('Pedestrian: sensor relocation before and after move; gaps flagged as unlocated', () => {
  const locOld: SensorLocation = {
    ...PROVENANCE,
    sensor_id: 'relocated-sensor',
    version_id: 'loc-pre-move',
    geometry_geojson: '{"type":"Point","coordinates":[144.95,-37.81]}',
    device_status: 'A',
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: '2026-06-01T00:00:00Z',
    source_record_id: 'loc-old',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  // Gap during June 2026 while sensor was physically uninstalled and moved
  const locNew: SensorLocation = {
    ...locOld,
    version_id: 'loc-post-move',
    geometry_geojson: '{"type":"Point","coordinates":[144.98,-37.83]}',
    valid_from: '2026-07-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'loc-new',
  };

  const obsPreMove: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'relocated-sensor',
    observed_at: '2026-05-15T12:00:00Z',
    version_id: 'obs-pre',
    direction_a_count: 5,
    direction_b_count: 8,
    total_count: 13,
    source_record_id: 'obs-src-pre',
  };

  const obsDuringGap: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'relocated-sensor',
    observed_at: '2026-06-15T12:00:00Z',
    version_id: 'obs-gap',
    direction_a_count: 0,
    direction_b_count: 0,
    total_count: 0,
    source_record_id: 'obs-src-gap',
  };

  const obsPostMove: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'relocated-sensor',
    observed_at: '2026-07-15T12:00:00Z',
    version_id: 'obs-post',
    direction_a_count: 20,
    direction_b_count: 35,
    total_count: 55,
    source_record_id: 'obs-src-post',
  };

  const joined = joinPedestrianObservations({
    observations: [obsPreMove, obsDuringGap, obsPostMove],
    locations: [locOld, locNew],
    granularity: 'minute',
  });

  assert.equal(joined.length, 3);

  // 1. Before move -> located to locOld
  assert.equal(joined[0]?.locationStatus, 'located');
  assert.equal(joined[0]?.location?.version_id, 'loc-pre-move');
  assert.equal(joined[0]?.location?.geometry_geojson, locOld.geometry_geojson);

  // 2. During gap -> strictly UNLOCATED, location is null
  assert.equal(joined[1]?.locationStatus, 'unlocated');
  assert.equal(joined[1]?.location, null);

  // 3. After move -> located to locNew
  assert.equal(joined[2]?.locationStatus, 'located');
  assert.equal(joined[2]?.location?.version_id, 'loc-post-move');
  assert.equal(joined[2]?.location?.geometry_geojson, locNew.geometry_geojson);
});

test('Pedestrian: absence of zero-filling strictly preserves missing counts and never synthesizes rows', () => {
  const loc: SensorLocation = {
    ...PROVENANCE,
    sensor_id: 'sensor:null-test',
    version_id: 'loc-1',
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    device_status: 'A',
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'loc-src',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  // Observations with missing counts (upstream sensor fault or null reading)
  const obsNullCounts: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'sensor:null-test',
    observed_at: '2026-09-28T00:00:00Z',
    version_id: 'obs-null-1',
    direction_a_count: null,
    direction_b_count: null,
    total_count: null,
    source_record_id: 'obs-null-src-1',
  };

  // Observation with genuine zero count
  const obsZeroCounts: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'sensor:null-test',
    observed_at: '2026-09-28T00:01:00Z',
    version_id: 'obs-zero-1',
    direction_a_count: 0,
    direction_b_count: 0,
    total_count: 0,
    source_record_id: 'obs-zero-src-1',
  };

  // Observation 5 minutes later (minutes 02, 03, 04 omitted by upstream)
  const obsAfterGap: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'sensor:null-test',
    observed_at: '2026-09-28T00:05:00Z',
    version_id: 'obs-after-gap',
    direction_a_count: 12,
    direction_b_count: 15,
    total_count: 27,
    source_record_id: 'obs-gap-src-1',
  };

  const joined = joinPedestrianObservations({
    observations: [obsNullCounts, obsZeroCounts, obsAfterGap],
    locations: [loc],
    granularity: 'minute',
  });

  // Invariant 1: Exactly 3 records returned (strictly NO backfilled rows for missing minutes 02, 03, 04)
  assert.equal(joined.length, 3);

  // Invariant 2: Null counts strictly preserved as null (never fabricated as 0)
  assert.strictEqual(joined[0]?.observation.direction_a_count, null);
  assert.strictEqual(joined[0]?.observation.direction_b_count, null);
  assert.strictEqual(joined[0]?.observation.total_count, null);

  // Invariant 3: Genuine 0 counts preserved as 0
  assert.strictEqual(joined[1]?.observation.direction_a_count, 0);
  assert.strictEqual(joined[1]?.observation.direction_b_count, 0);
  assert.strictEqual(joined[1]?.observation.total_count, 0);

  // Invariant 4: True positive counts preserved
  assert.strictEqual(joined[2]?.observation.direction_a_count, 12);
  assert.strictEqual(joined[2]?.observation.direction_b_count, 15);
  assert.strictEqual(joined[2]?.observation.total_count, 27);
});

test('Pedestrian: inactive devices, decommissioned sensors, and ambiguous locations', () => {
  const baseLoc: SensorLocation = {
    ...PROVENANCE,
    sensor_id: 'ped-dev-status',
    version_id: 'loc-status-base',
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    device_status: 'A',
    valid_from: '2026-09-01T00:00:00Z',
    valid_to: null,
    source_record_id: 'loc-status-src',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  const obs: PedestrianObservation = {
    ...PROVENANCE,
    sensor_id: 'ped-dev-status',
    observed_at: '2026-09-28T00:10:00Z',
    version_id: 'obs-status',
    direction_a_count: 10,
    direction_b_count: 10,
    total_count: 20,
    source_record_id: 'obs-status-src',
  };

  // 1. Inactive status ('I', 'Inactive', 'R', 'Removed') -> locationStatus: 'inactive', location: null
  for (const status of ['I', 'inactive', 'R', 'Removed']) {
    const res = joinPedestrianObservations({
      observations: [obs],
      locations: [{ ...baseLoc, device_status: status }],
      granularity: 'minute',
    });
    assert.equal(res[0]?.locationStatus, 'inactive', `Expected inactive for status ${status}`);
    assert.equal(res[0]?.location, null);
  }

  // 2. Decommissioned status -> locationStatus: 'unlocated', location: null
  {
    const res = joinPedestrianObservations({
      observations: [obs],
      locations: [{ ...baseLoc, device_status: 'decommissioned' }],
      granularity: 'minute',
    });
    assert.equal(res[0]?.locationStatus, 'unlocated');
    assert.equal(res[0]?.location, null);
  }

  // 3. Conflicting location versions for the same window -> locationStatus: 'ambiguous', location: null
  {
    const conflictingLoc = {
      ...baseLoc,
      version_id: 'loc-conflict-coords',
      geometry_geojson: '{"type":"Point","coordinates":[145.10,-37.95]}',
    };
    const res = joinPedestrianObservations({
      observations: [obs],
      locations: [baseLoc, conflictingLoc],
      granularity: 'minute',
    });
    assert.equal(res[0]?.locationStatus, 'ambiguous');
    assert.equal(res[0]?.location, null);
  }
});

// ============================================================================
// PART 3: Road Disruption Clearance & Source Interruption (SC-002, SC-005)
// ============================================================================

test('Pedestrian: published history survives cold runs, source disappearance, and reappearance without invented counts or move dates', async t => {
  const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
    bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
    secretNames: [], maxBytesBilled: '100000000' };
  const bigquery = new BigQuery({ projectId: config.projectId });
  const publishedIntervals = new Map<string, SensorLocation>();
  t.mock.method(bigquery, 'query', async () => [Array.from(publishedIntervals.values(),
    location => ({ location: JSON.stringify(location) }))]);
  const input = parseConnectorInput({ sourceId: 'melbourne.pedestrian.locations',
    window: { kind: 'snapshot', revision: 'synthetic-current' }, checkpoint: null, runId: 'first-location' });
  const location = { location_id: 999, sensor_description: 'Synthetic move fixture',
    installation_date: '2010-01-01', latitude: -37.81, longitude: 144.96, status: 'A' };

  async function collect(records: unknown[], fetchedAt: string, runId: string) {
    class SnapshotClient extends OpenDataSoftClient {
      override async fetchRecords(): Promise<OdsRecords> {
        return { records, fetchedAt, lastModified: null, pageCount: 1, totalCount: records.length };
      }
    }
    const restored = await withPublishedPedestrianLocationHistory({ ...input, runId }, config, bigquery);
    const result = await new PedestrianLocationsConnector({ client: new SnapshotClient() }).collect(restored);
    assert.equal(result.kind, 'success');
    if (result.kind !== 'success') throw new Error('Synthetic location collection failed');
    for (const interval of result.sensorLocations) {
      const fact = result.sourceRecords.find(record => record.source_record_id === interval.source_record_id
        && record.version_id === interval.version_id && record.batch_id === interval.batch_id);
      assert.ok(fact, 'An interval requires a same-batch source fact for publication');
      parseSourceRecord(fact);
      publishedIntervals.set(`${interval.sensor_id}:${interval.valid_from}`, interval);
    }
    return result;
  }

  await collect([location], '2026-09-28T00:00:00.000Z', 'initial');
  await collect([location], '2026-09-28T00:10:00.000Z', 'confirmed');
  const moved = await collect([{ ...location, longitude: 144.97 }], '2026-09-28T00:30:00.000Z', 'moved');
  const previous = moved.sensorLocations.find(row => row.valid_to !== null);
  const current = moved.sensorLocations.find(row => row.valid_to === null);
  assert.equal(previous?.valid_to, '2026-09-28T00:10:00.000Z');
  assert.equal(current?.valid_from, '2026-09-28T00:30:00.000Z');
  assert.notEqual(current?.valid_from, '2010-01-01T00:00:00.000Z', 'Installation date is not location evidence');

  const disappeared = await collect([], '2026-09-28T00:40:00.000Z', 'disappeared');
  assert.equal(disappeared.geoRecords.length, 0);
  assert.equal(disappeared.sensorLocations[0]?.valid_to, '2026-09-28T00:30:00.000Z');
  assert.equal(disappeared.sensorLocations[0]?.device_status, 'A', 'Missing membership is not a reported removal status');
  await collect([{ ...location, longitude: 144.98 }], '2026-09-28T01:00:00.000Z', 'reappeared');

  const timestamps = ['2026-09-27T23:59:00Z', '2026-09-28T00:05:00Z',
    '2026-09-28T00:20:00Z', '2026-09-28T00:45:00Z', '2026-09-28T01:05:00Z'];
  const observations: PedestrianObservation[] = timestamps.map((observedAt, index) => ({
    ...PROVENANCE, source_id: 'melbourne.pedestrian.minute', sensor_id: '999', observed_at: observedAt,
    version_id: `count:${index}`, source_record_id: `minute:${index}`, direction_a_count: null,
    direction_b_count: null, total_count: index === 2 ? null : index === 3 ? 0 : 3,
  }));
  const joined = joinPedestrianObservations({ observations,
    locations: Array.from(publishedIntervals.values()), granularity: 'minute' });
  assert.deepEqual(joined.map(row => row.locationStatus),
    ['unlocated', 'located', 'unlocated', 'unlocated', 'located']);
  assert.deepEqual(joined.map(row => row.observation.total_count), [3, 3, null, 0, 3]);
  assert.equal(joined.length, timestamps.length, 'Missing minutes remain absent across source gaps');
  assert.equal(joined[1]?.location?.geometry_geojson, JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }));
  assert.equal(joined[4]?.location?.geometry_geojson, JSON.stringify({ type: 'Point', coordinates: [144.98, -37.81] }));
});

test('Road disruption normalization retains clearance facts and exact parent, impact, and snapshot evidence', async () => {
  const parsed = parseRoadPage(await loadFixtureJson('../fixtures/tv_road_unplanned.json'));
  const input = parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'us1-road-test-run',
  });

  const normalized = normalizeRoadSnapshot(parsed.data.features, input, '2026-09-28T00:06:00Z');
  assert.equal(normalized.geoRecords.length, parsed.data.features.length);

  const activeRecord = normalized.geoRecords.find(r => r.record_status === 'active');
  const resolvedRecord = normalized.geoRecords.find(r => r.record_status === 'resolved');

  assert.ok(activeRecord, 'Must have active road disruption');
  assert.ok(resolvedRecord, 'Must have resolved road disruption');

  assert.equal(activeRecord?.valid_to, null, 'Active incident must have null valid_to');
  assert.equal(resolvedRecord?.valid_to, null, 'Resolved status does not prove the provider closure timestamp');

  const parents = new Set<string>();
  const snapshots = new Set<string>();
  for (const record of normalized.geoRecords) {
    const links = normalized.geoRecordSources.filter(link => link.geo_record_id === record.geo_record_id
      && link.version_id === record.version_id);
    assert.deepEqual(new Set(links.map(link => link.evidence_role)),
      new Set(['parent_incident', 'child_impact', 'road_snapshot_membership']));
    for (const link of links) {
      const fact = normalized.sourceRecords.find(source => source.batch_id === record.batch_id
        && source.source_record_id === link.source_record_id && source.version_id === link.source_version_id);
      assert.ok(fact, 'Every accepted road record has exact source evidence');
      parseSourceRecord(fact);
      if (link.evidence_role === 'parent_incident') parents.add(link.source_record_id);
      if (link.evidence_role === 'road_snapshot_membership') snapshots.add(link.source_record_id);
    }
  }
  assert.equal(parents.size, 1, 'Independent child clearance does not create another parent incident');
  assert.equal(snapshots.size, 1, 'The children belong to one complete source snapshot');
});

test('Road complete empty snapshots report membership, while outages expose no publishable disappearance or inferred clearance', async t => {
  const parsed = parseRoadPage(await loadFixtureJson('../fixtures/tv_road_unplanned.json'));
  const empty = parseRoadPage({ meta: { total_records: 0, total_pages: 0, page: 1, count: 0 },
    data: { type: 'FeatureCollection', features: [] } });
  const input = parseConnectorInput({ sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'snapshot', revision: 'fixture' }, checkpoint: null, runId: 'road-populated' });
  const client = new HttpClient();
  let body = parsed;
  let fetchedAt = '2026-09-28T00:06:00.000Z';
  const request = t.mock.method(client, 'getJson', async (): Promise<HttpResponse<unknown>> => ({
    body, fetchedAt, status: 200, etag: null, lastModified: null, contentType: 'application/json',
  }));
  const connector = new UnplannedRoadConnector(client, () => 'synthetic-key', 0);
  const populated = await connector.collect(input);
  assert.equal(populated.kind, 'success');
  if (populated.kind !== 'success') throw new Error('Synthetic road snapshot failed');
  body = empty;
  fetchedAt = '2026-09-28T00:07:00.000Z';
  const clearedMembership = await connector.collect({ ...input, runId: 'road-empty' });
  assert.equal(clearedMembership.kind, 'success');
  if (clearedMembership.kind !== 'success') throw new Error('Synthetic empty snapshot failed');
  assert.equal(clearedMembership.completeness.complete, true);
  assert.equal(clearedMembership.geoRecords.length, 0);
  assert.equal(clearedMembership.sourceRecords.length, 1, 'An empty complete snapshot persists its own source fact');
  assert.equal(clearedMembership.sourceRecords[0]?.first_accessible_at, fetchedAt);
  assert.equal(clearedMembership.sourceRecords[0]?.valid_to, null,
    'Absence from a snapshot does not invent incident clearance time');
  assert.notEqual(clearedMembership.sourceRevision, populated.sourceRevision);

  request.mock.mockImplementation(async () => { throw new HttpFailure('upstream_unavailable', 503, 1); });
  const interrupted = await connector.collect({ ...input, runId: 'road-outage' });
  assert.equal(interrupted.kind, 'failure');
  if (interrupted.kind !== 'failure') throw new Error('Outage was accepted');
  assert.equal(interrupted.completeness.complete, false);
  assert.equal('geoRecords' in interrupted, false);
  assert.equal('sourceRecords' in interrupted, false,
    'A failed fetch cannot replace the prior published snapshot with zero incidents');
});

test('Source Health & Empty Results: interruption and latency do not report as zero disruptions or realtime', () => {
  const roadSource: DataSource = {
    source_id: 'victoria.transport.road_unplanned',
    legacy_ids: [],
    provider: 'Transport Victoria',
    dataset_title: 'Unplanned Road Disruptions',
    landing_url: 'https://opendata.transport.vic.gov.au',
    topic: 'road_disruption',
    scope: 'victoria',
    coverage_area_refs: ['ASGS_STE:2:2026'],
    coverage_from: '2026-01-01T00:00:00Z',
    coverage_to: null,
    cadence_seconds: 60,
    check_interval_seconds: 60,
    admission_evidence: {
      dataset_url: null,
      native_record_key: null,
      completeness_rule: null,
      quota_requests_per_day: null,
      secret_names: [],
      allowed_fields: null,
      raw_retention_days: null,
      staging_retention_days: null,
      license_evidence_url: null,
      reviewed_at: null,
      missing_requirements: [],
      declared_license_status: 'verified_open',
    },
    connector_owner: 'integrator',
    license_status: 'verified_open',
    access_status: 'active',
    last_checked_at: '2026-09-28T01:00:00Z',
    last_success_at: '2026-09-28T01:00:00Z',
    last_source_update_at: '2026-09-28T01:00:00Z',
    record_granularity: 'incident_impact',
  };

  // Scenario 1: Source is HEALTHY and CURRENT with 0 disruptions in database
  // Result: coverage_status is 'no_matching_records' (explicitly certified clean)
  {
    const health = computeSourceHealth({
      source: roadSource,
      now: '2026-09-28T01:01:00Z', // 60s after success, within 120s budget
      lastCheckedAt: '2026-09-28T01:01:00Z',
      lastSuccessAt: '2026-09-28T01:01:00Z',
      latestCheckSucceeded: true,
      latestUpstreamUpdateAt: '2026-09-28T01:01:00Z',
      consecutiveFailures: 0,
      knownGapCount: 0,
    });
    assert.equal(health.state, 'current');

    const coverage = computeCoverageStatus({
      coveringSources: [health],
      matchingRecords: 0,
      completeWindow: true,
    });
    assert.equal(coverage, 'no_matching_records', 'Healthy source with 0 records reports no_matching_records');
  }

  // Scenario 2: Source check FAILED / INTERRUPTED with 0 disruptions in database
  // Result: coverage_status must be 'unknown', STRICTLY NOT 'no_matching_records'!
  // An interrupted source CANNOT report as "zero disruptions"!
  {
    const failedHealth = computeSourceHealth({
      source: roadSource,
      now: '2026-09-28T01:01:00Z',
      lastCheckedAt: '2026-09-28T01:01:00Z',
      lastSuccessAt: '2026-09-28T01:00:00Z',
      latestCheckSucceeded: false,
      latestUpstreamUpdateAt: null,
      consecutiveFailures: 1,
      knownGapCount: 0,
    });
    assert.equal(failedHealth.state, 'unknown');

    const coverage = computeCoverageStatus({
      coveringSources: [failedHealth],
      matchingRecords: 0,
      completeWindow: true,
    });
    assert.equal(coverage, 'unknown', 'Failed source cannot report no_matching_records');
    assert.notEqual(coverage, 'no_matching_records');
  }

  // Scenario 3: Source is LATE (age exceeds 1x budget but <= 2x budget)
  // Result: health is 'late', coverage is 'unknown' (never falsely labeled 'current' or 'realtime')
  {
    const lateHealth = computeSourceHealth({
      source: roadSource,
      now: '2026-09-28T01:02:30Z', // 150s after success (> 120s budget, <= 240s)
      lastCheckedAt: '2026-09-28T01:00:00Z',
      lastSuccessAt: '2026-09-28T01:00:00Z',
      latestCheckSucceeded: true,
      latestUpstreamUpdateAt: null,
      consecutiveFailures: 0,
      knownGapCount: 0,
    });
    assert.equal(lateHealth.state, 'late');
    assert.notEqual(lateHealth.state, 'current');

    const coverage = computeCoverageStatus({
      coveringSources: [lateHealth],
      matchingRecords: 0,
      completeWindow: true,
    });
    assert.equal(coverage, 'unknown');
  }

  // Scenario 4: Source is STALE (> 2x budget = 240s)
  // Result: health is 'stale', coverage is 'source_unavailable'
  {
    const staleHealth = computeSourceHealth({
      source: roadSource,
      now: '2026-09-28T01:05:00Z', // 300s after success (> 240s)
      lastCheckedAt: '2026-09-28T01:00:00Z',
      lastSuccessAt: '2026-09-28T01:00:00Z',
      latestCheckSucceeded: true,
      latestUpstreamUpdateAt: null,
      consecutiveFailures: 0,
      knownGapCount: 0,
    });
    assert.equal(staleHealth.state, 'stale');

    const coverage = computeCoverageStatus({
      coveringSources: [staleHealth],
      matchingRecords: 0,
      completeWindow: true,
    });
    assert.equal(coverage, 'source_unavailable', 'Stale source reports source_unavailable');
    assert.notEqual(coverage, 'no_matching_records');
  }

  // Scenario 5: Location not covered by any source
  {
    const coverage = computeCoverageStatus({
      coveringSources: [],
      matchingRecords: 0,
      completeWindow: true,
    });
    assert.equal(coverage, 'not_covered');
  }

  const baseline = {
    source: roadSource, now: '2026-09-28T01:01:00Z', lastCheckedAt: '2026-09-28T01:01:00Z',
    lastSuccessAt: '2026-09-28T01:01:00Z', latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-27T01:00:00Z', consecutiveFailures: 0, knownGapCount: 0,
  };
  const unchanged = computeSourceHealth(baseline);
  assert.equal(unchanged.state, 'current', 'A successful no-change response is not a new event, but still confirms source health');
  assert.equal(unchanged.latestUpstreamUpdateAt, '2026-09-27T01:00:00Z');

  for (const uncertain of [
    computeSourceHealth({ ...baseline, latestCheckSucceeded: false, consecutiveFailures: 1 }),
    computeSourceHealth({ ...baseline, knownGapCount: 1 }),
    computeSourceHealth({ ...baseline, source: { ...roadSource, access_status: 'candidate' } }),
  ]) {
    assert.equal(uncertain.state, 'unknown');
    for (const matchingRecords of [0, 1]) {
      assert.equal(computeCoverageStatus({ coveringSources: [unchanged, uncertain],
        matchingRecords, completeWindow: true }), 'unknown',
      'A healthy source cannot hide a second source outage, gap, or missing admission');
    }
  }
});
