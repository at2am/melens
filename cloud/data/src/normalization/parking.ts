import { z } from 'zod';

import type { ParkingBay, ParkingObservation, ParkingRule } from '../core/types.js';

export interface VerifiedRuleCrosswalk {
  bayId: string;
  sensorBayId: string;
  ruleBayId: string;
  evidenceUrl: string;
  verified: true;
}

export interface ParkingDecision {
  bayId: string;
  occupied: boolean | null;
  occupancyObservedAt: string | null;
  occupancyFreshness: 'current' | 'stale' | 'unknown';
  mayParkNow: 'yes' | 'no' | 'unknown';
  appliedRuleIds: readonly string[];
  reasons: readonly string[];
}

function localClock(now: Date): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', weekday: 'short', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday ?? '') + 1;
  if (day === 0 || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error('Australia/Melbourne local clock could not be resolved');
  }
  return { day, minute: hour * 60 + minute };
}

type Applicability = 'current' | 'inactive' | 'unknown';

const utcTimestamp = z.iso.datetime({ offset: false });
const absoluteTimestamp = z.iso.datetime({ offset: true });

function timestampMs(value: string, allowOffset = false): number {
  const parsed = (allowOffset ? absoluteTimestamp : utcTimestamp).safeParse(value);
  return parsed.success ? Date.parse(parsed.data) : Number.NaN;
}

function intervalState(from: string | null, to: string | null, now: number,
  requireStart: boolean): Applicability {
  const start = from === null ? null : timestampMs(from);
  const end = to === null ? null : timestampMs(to);
  if ((start !== null && !Number.isFinite(start))
    || (end !== null && !Number.isFinite(end))
    || (start !== null && end !== null && end <= start)) return 'unknown';
  if ((start !== null && start > now) || (end !== null && end <= now)) return 'inactive';
  return requireStart && start === null ? 'unknown' : 'current';
}

function ruleApplicability(rule: ParkingRule, now: number, day: number, minute: number,
  holiday: boolean | null): Applicability {
  if (rule.days_of_week.length === 0 || rule.days_of_week.some(value =>
    !Number.isInteger(value) || value < 1 || value > 7)) return 'unknown';
  const start = rule.start_minute_of_day;
  const end = rule.end_minute_of_day;
  if (start === null || end === null || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || start >= 1440 || end < 0 || end > 1440) return 'unknown';
  // The publisher does not define which date owns an overnight or equal-time
  // sign. Do not discard it as inactive and allow a competing rule instead.
  if (end <= start) return 'unknown';
  if (!rule.days_of_week.includes(day) || minute < start || minute >= end) return 'inactive';
  if (!['all_days', 'applies', 'does_not_apply'].includes(rule.holiday_applicability ?? '')
    || holiday === null) return 'unknown';
  if (holiday && rule.holiday_applicability === 'does_not_apply') return 'inactive';
  return intervalState(rule.valid_from, rule.valid_to, now, true);
}

function ruleConclusion(rule: ParkingRule, vehicleClass: string): 'allow' | 'prohibit' | 'unknown' {
  if (vehicleClass.trim().length === 0 || rule.vehicle_class === null) return 'unknown';
  if (rule.vehicle_class !== 'all' && rule.vehicle_class !== 'any'
    && rule.vehicle_class !== vehicleClass) return 'unknown';
  if (rule.exemption !== null) return 'unknown';
  if (['no_parking', 'no_stopping', 'prohibited'].includes(rule.restriction_type)) return 'prohibit';
  if (['allowed', 'parking_allowed'].includes(rule.restriction_type)) return 'allow';
  return 'unknown';
}

function latestSensorObservations(observations: readonly ParkingObservation[]): ParkingObservation[] {
  const bySensor = new Map<string, ParkingObservation[]>();
  for (const observation of observations) {
    const prior = bySensor.get(observation.sensor_id);
    const latest = prior?.[0];
    if (latest === undefined) {
      bySensor.set(observation.sensor_id, [observation]);
    } else if (!Number.isFinite(timestampMs(observation.observed_at, true))
      || prior?.some(item => !Number.isFinite(timestampMs(item.observed_at, true)))) {
      prior?.push(observation);
    } else if (timestampMs(observation.observed_at, true) > timestampMs(latest.observed_at, true)) {
      bySensor.set(observation.sensor_id, [observation]);
    } else if (timestampMs(observation.observed_at, true) === timestampMs(latest.observed_at, true)) {
      prior?.push(observation);
    }
  }
  return [...bySensor.values()].flat();
}

/** Only publisher-provided markers and a reviewed crosswalk establish a three-table join. */
export function evaluateParkingBay(input: {
  bay: ParkingBay;
  allBays: readonly ParkingBay[];
  observations: readonly ParkingObservation[];
  rules: readonly ParkingRule[];
  ruleCrosswalk: VerifiedRuleCrosswalk | null;
  now: Date;
  melbournePublicHoliday: boolean | null;
  vehicleClass: string;
  cadenceSeconds: number | null;
  lastSuccessfulCheckAt: string | null;
}): ParkingDecision {
  const { bay, now } = input;
  const reasons: string[] = [];
  const markerMatches = bay.marker_id === null ? []
    : input.allBays.filter(candidate => candidate.marker_id === bay.marker_id);
  const sharedMarkerIsUnique = bay.marker_id !== null && bay.marker_id.trim().length > 0
    && markerMatches.length === 1 && markerMatches[0]?.bay_id === bay.bay_id
    && markerMatches[0]?.version_id === bay.version_id;
  const latestBySensor = latestSensorObservations(input.observations);
  const matching = sharedMarkerIsUnique
    ? latestBySensor.filter(item => item.marker_id === bay.marker_id)
    : [];
  matching.sort((left, right) => timestampMs(right.observed_at, true) - timestampMs(left.observed_at, true));
  const latest = matching[0] ?? null;
  const tied = matching.some(item => item.sensor_id.trim().length === 0
      || !Number.isFinite(timestampMs(item.observed_at, true)))
    || new Set(matching.map(item => item.sensor_id)).size > 1
    || (latest !== null && matching.some(item => item !== latest
      && timestampMs(item.observed_at, true) === timestampMs(latest.observed_at, true)
      && (item.occupied !== latest.occupied || item.bay_id !== latest.bay_id)))
    || (latest !== null && latestBySensor.some(item =>
      item.sensor_id === latest.sensor_id && item.marker_id !== latest.marker_id));
  const occupied = tied ? null : latest?.occupied ?? null;
  const age = latest === null ? Number.POSITIVE_INFINITY
    : now.getTime() - timestampMs(latest.observed_at, true);
  const checkAge = input.lastSuccessfulCheckAt === null ? Number.POSITIVE_INFINITY
    : now.getTime() - timestampMs(input.lastSuccessfulCheckAt);
  // The City's published metadata says these sensors do not operate on public
  // holidays. A recent timestamp alone cannot establish operational readings.
  const sensorOperationalUnknown = latest?.source_id === 'melbourne.parking.sensors'
    && input.melbournePublicHoliday !== false;
  const fresh = latest !== null && !tied && !sensorOperationalUnknown && input.cadenceSeconds !== null
    && Number.isFinite(input.cadenceSeconds) && input.cadenceSeconds > 0
    && Number.isFinite(age) && Number.isFinite(checkAge) && age >= checkAge && checkAge >= 0
    && age <= 2 * input.cadenceSeconds * 1000
    && checkAge <= 2 * input.cadenceSeconds * 1000;
  const occupancyFreshness = latest === null || tied || sensorOperationalUnknown
    ? 'unknown' : fresh ? 'current' : 'stale';
  if (!sharedMarkerIsUnique) reasons.push('bay_marker_not_unique');
  if (latest === null) reasons.push('occupancy_missing');
  if (tied) reasons.push('occupancy_conflict');
  if (sensorOperationalUnknown) reasons.push(input.melbournePublicHoliday === true
    ? 'sensor_not_operational_public_holiday' : 'sensor_holiday_status_unknown');
  if (latest !== null && !fresh && !sensorOperationalUnknown) reasons.push('occupancy_stale');
  const bayActive = intervalState(bay.valid_from, bay.valid_to, now.getTime(), false) === 'current';
  if (!bayActive) reasons.push('bay_version_expired');

  const clock = localClock(now);
  const crosswalk = input.ruleCrosswalk?.verified === true
    && bay.bay_id.trim().length > 0
    && input.ruleCrosswalk.bayId === bay.bay_id
    && latest?.bay_id !== null && latest?.bay_id !== undefined
    && input.ruleCrosswalk.sensorBayId === latest.bay_id
    && input.ruleCrosswalk.sensorBayId.trim().length > 0
    && input.ruleCrosswalk.ruleBayId.trim().length > 0
    && /^https:\/\//.test(input.ruleCrosswalk.evidenceUrl)
    ? input.ruleCrosswalk : null;
  const consideredRules = crosswalk === null ? [] : input.rules
    .filter(rule => rule.bay_id === crosswalk.ruleBayId)
    .map(rule => ({ rule, applicability: ruleApplicability(rule, now.getTime(), clock.day,
      clock.minute, input.melbournePublicHoliday) }))
    .filter(item => item.applicability !== 'inactive');
  const applicableRules = consideredRules.filter(item => item.applicability === 'current')
    .map(item => item.rule);
  const hasUnknownRule = consideredRules.some(item => item.applicability === 'unknown');
  const conclusions = applicableRules.map(rule => ruleConclusion(rule, input.vehicleClass));
  if (!crosswalk) reasons.push('rule_crosswalk_unverified');
  else {
    if (applicableRules.length === 0) reasons.push('no_current_rule');
    if (hasUnknownRule || conclusions.length > 1 || conclusions[0] === 'unknown') {
      reasons.push('rule_ambiguous');
    }
  }

  let mayParkNow: ParkingDecision['mayParkNow'] = 'unknown';
  if (bay.public_access === false && bayActive) {
    mayParkNow = 'no';
    reasons.push('not_public_access');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique && occupied === true) {
    mayParkNow = 'no';
    reasons.push('occupied');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique
    && crosswalk !== null && !hasUnknownRule && conclusions.length === 1 && conclusions[0] === 'prohibit') {
    mayParkNow = 'no';
    reasons.push('rule_prohibits');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique
    && occupied === false && crosswalk !== null && !hasUnknownRule && conclusions.length === 1
    && conclusions[0] === 'allow') {
    mayParkNow = 'yes';
    reasons.push('verified_allow');
  }
  if (bay.public_access === null) reasons.push('public_access_unknown');
  return { bayId: bay.bay_id, occupied, occupancyObservedAt: latest?.observed_at ?? null,
    occupancyFreshness, mayParkNow, appliedRuleIds: applicableRules.map(rule => rule.rule_id),
    reasons };
}
