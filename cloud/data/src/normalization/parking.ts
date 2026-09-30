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

function applicable(rule: ParkingRule, now: Date, day: number, minute: number): boolean {
  // A fetched copy of an undated historical sign is not evidence that the
  // restriction still governs parking today.
  if (rule.valid_from === null || Date.parse(rule.valid_from) > now.getTime()) return false;
  if (rule.valid_to !== null && Date.parse(rule.valid_to) <= now.getTime()) return false;
  return rule.days_of_week.includes(day)
    && rule.start_minute_of_day !== null && rule.end_minute_of_day !== null
    && rule.start_minute_of_day <= minute && minute < rule.end_minute_of_day;
}

function ruleConclusion(rule: ParkingRule, vehicleClass: string,
  holiday: boolean | null): 'allow' | 'prohibit' | 'unknown' {
  if (rule.vehicle_class !== 'all' && rule.vehicle_class !== 'any'
    && rule.vehicle_class !== vehicleClass) return 'unknown';
  if (rule.exemption !== null) return 'unknown';
  if (holiday === null && rule.holiday_applicability !== 'all_days') return 'unknown';
  if (holiday === true && rule.holiday_applicability === 'does_not_apply') return 'unknown';
  if (holiday === false && rule.holiday_applicability === 'applies') return 'unknown';
  if (['no_parking', 'no_stopping', 'prohibited'].includes(rule.restriction_type)) return 'prohibit';
  if (['allowed', 'parking_allowed'].includes(rule.restriction_type)) return 'allow';
  return 'unknown';
}

/** A shared kerbside ID supports an occupancy observation, never a legal rule by itself. */
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
  const sharedMarkerIsUnique = bay.marker_id !== null && bay.marker_id.length > 0
    && markerMatches.length === 1;
  const matching = sharedMarkerIsUnique
    ? input.observations.filter(item => item.marker_id === bay.marker_id)
    : [];
  matching.sort((left, right) => right.observed_at.localeCompare(left.observed_at));
  const latest = matching[0] ?? null;
  const tied = latest !== null && matching.some(item => item !== latest
    && item.observed_at === latest.observed_at
    && (item.occupied !== latest.occupied || item.sensor_id !== latest.sensor_id
      || item.bay_id !== latest.bay_id));
  const occupied = tied ? null : latest?.occupied ?? null;
  const age = latest === null ? Number.POSITIVE_INFINITY
    : now.getTime() - Date.parse(latest.observed_at);
  const checkAge = input.lastSuccessfulCheckAt === null ? Number.POSITIVE_INFINITY
    : now.getTime() - Date.parse(input.lastSuccessfulCheckAt);
  const fresh = latest !== null && !tied && input.cadenceSeconds !== null
    && input.cadenceSeconds > 0 && age >= 0 && checkAge >= 0
    && age <= 2 * input.cadenceSeconds * 1000
    && checkAge <= 2 * input.cadenceSeconds * 1000;
  const occupancyFreshness = latest === null || tied ? 'unknown' : fresh ? 'current' : 'stale';
  if (!sharedMarkerIsUnique) reasons.push('bay_marker_not_unique');
  if (latest === null) reasons.push('occupancy_missing');
  if (tied) reasons.push('occupancy_conflict');
  if (latest !== null && !fresh) reasons.push('occupancy_stale');
  const bayActive = (bay.valid_from === null || Date.parse(bay.valid_from) <= now.getTime())
    && (bay.valid_to === null || Date.parse(bay.valid_to) > now.getTime());
  if (!bayActive) reasons.push('bay_version_expired');

  const clock = localClock(now);
  const crosswalk = input.ruleCrosswalk?.verified === true
    && input.ruleCrosswalk.bayId === bay.bay_id
    && latest?.bay_id !== null && latest?.bay_id !== undefined
    && input.ruleCrosswalk.sensorBayId === latest.bay_id
    && /^https:\/\//.test(input.ruleCrosswalk.evidenceUrl)
    ? input.ruleCrosswalk : null;
  const applicableRules = crosswalk === null ? [] : input.rules.filter(rule =>
    rule.bay_id === crosswalk.ruleBayId && applicable(rule, now, clock.day, clock.minute));
  const conclusions = applicableRules.map(rule => ruleConclusion(rule, input.vehicleClass,
    input.melbournePublicHoliday));
  if (!crosswalk) reasons.push('rule_crosswalk_unverified');
  else if (applicableRules.length === 0) reasons.push('no_current_rule');
  else if (conclusions.length !== 1 || conclusions[0] === 'unknown') reasons.push('rule_ambiguous');

  let mayParkNow: ParkingDecision['mayParkNow'] = 'unknown';
  if (bay.public_access === false) {
    mayParkNow = 'no';
    reasons.push('not_public_access');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique && occupied === true) {
    mayParkNow = 'no';
    reasons.push('occupied');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique
    && crosswalk !== null && conclusions.length === 1 && conclusions[0] === 'prohibit') {
    mayParkNow = 'no';
    reasons.push('rule_prohibits');
  } else if (bay.public_access === true && bayActive && fresh && sharedMarkerIsUnique
    && occupied === false && crosswalk !== null && conclusions.length === 1
    && conclusions[0] === 'allow') {
    mayParkNow = 'yes';
    reasons.push('verified_allow');
  }
  if (bay.public_access === null) reasons.push('public_access_unknown');
  return { bayId: bay.bay_id, occupied, occupancyObservedAt: latest?.observed_at ?? null,
    occupancyFreshness, mayParkNow, appliedRuleIds: applicableRules.map(rule => rule.rule_id),
    reasons };
}
