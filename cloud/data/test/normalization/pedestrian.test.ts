import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { PedestrianObservation, SensorLocation } from '../../src/core/types.js';
import { joinPedestrianObservations } from '../../src/normalization/pedestrian.js';

const provenanceMinute = {
  batch_id: 'batch-minute-1',
  source_id: 'melbourne.pedestrian.minute',
  schema_version: 1,
  fetched_at: '2026-09-28T01:00:00Z',
};

const provenanceHourly = {
  batch_id: 'batch-hourly-1',
  source_id: 'melbourne.pedestrian.hourly',
  schema_version: 1,
  fetched_at: '2026-09-28T01:00:00Z',
};

const provenanceLocation = {
  batch_id: 'batch-loc-1',
  source_id: 'melbourne.pedestrian.locations',
  schema_version: 1,
  fetched_at: '2026-09-28T01:00:00Z',
};

const observationMinute: PedestrianObservation = {
  ...provenanceMinute,
  sensor_id: '10',
  observed_at: '2026-09-28T00:30:00Z',
  version_id: 'v1',
  direction_a_count: null,
  direction_b_count: 3,
  total_count: null,
  source_record_id: 'minute:10:0030',
};

const observationHourly: PedestrianObservation = {
  ...provenanceHourly,
  sensor_id: '10',
  observed_at: '2026-09-28T00:00:00Z',
  version_id: 'vh1',
  direction_a_count: 45,
  direction_b_count: 65,
  total_count: 110,
  source_record_id: 'hourly:10:00',
};

const earlierLocation: SensorLocation = {
  ...provenanceLocation,
  sensor_id: '10',
  version_id: 'loc-old',
  geometry_geojson: '{"type":"Point","coordinates":[144.9,-37.8]}',
  device_status: 'A',
  valid_from: '2026-09-27T00:00:00Z',
  valid_to: '2026-09-28T00:45:00Z',
  source_record_id: 'loc:old',
  source_updated_at: null,
  source_version_ordinal: null,
};

const movedLocation: SensorLocation = {
  ...earlierLocation,
  version_id: 'loc-new',
  geometry_geojson: '{"type":"Point","coordinates":[145.0,-37.8]}',
  valid_from: '2026-09-28T00:45:00Z',
  valid_to: null,
  source_record_id: 'loc:new',
};

test('minute counts join the location effective at that minute without filling missing counts', () => {
  const after = { ...observationMinute, observed_at: '2026-09-28T00:50:00Z' };
  const joined = joinPedestrianObservations({
    observations: [observationMinute, after],
    locations: [earlierLocation, movedLocation],
    granularity: 'minute',
  });
  assert.equal(joined.length, 2);
  assert.equal(joined[0]?.granularity, 'minute');
  assert.equal(joined[1]?.granularity, 'minute');
  assert.equal(joined[0]?.locationStatus, 'located');
  assert.equal(joined[1]?.locationStatus, 'located');
  assert.equal(joined[0]?.location?.version_id, 'loc-old');
  assert.equal(joined[1]?.location?.version_id, 'loc-new');
  assert.equal(joined[0]?.observation.direction_a_count, null);
  assert.equal(joined[0]?.observation.direction_b_count, 3);
  assert.equal(joined[0]?.observation.total_count, null);
});

test('hourly counts join the location effective at that hour and preserve hour granularity', () => {
  const joined = joinPedestrianObservations({
    observations: [observationHourly],
    locations: [earlierLocation],
    granularity: 'hour',
  });
  assert.equal(joined.length, 1);
  assert.equal(joined[0]?.granularity, 'hour');
  assert.equal(joined[0]?.locationStatus, 'located');
  assert.equal(joined[0]?.location?.version_id, 'loc-old');
  assert.equal(joined[0]?.observation.observed_at, '2026-09-28T00:00:00Z');
  assert.equal(joined[0]?.observation.direction_a_count, 45);
  assert.equal(joined[0]?.observation.direction_b_count, 65);
  assert.equal(joined[0]?.observation.total_count, 110);
});

test('sensor relocation correctly associates observations before and after move, and flags gaps as unlocated', () => {
  const obsBefore = { ...observationMinute, observed_at: '2026-09-27T12:00:00Z' };
  const obsAfter = { ...observationMinute, observed_at: '2026-09-29T12:00:00Z' };
  const obsInGap = { ...observationMinute, observed_at: '2026-09-28T00:46:00Z' };

  // Setup relocation with a temporary gap between old and new location
  const locV1: SensorLocation = {
    ...earlierLocation,
    valid_from: '2026-09-27T00:00:00Z',
    valid_to: '2026-09-28T00:45:00Z',
  };
  const locV2: SensorLocation = {
    ...movedLocation,
    valid_from: '2026-09-28T01:00:00Z',
    valid_to: null,
  };

  const joined = joinPedestrianObservations({
    observations: [obsBefore, obsInGap, obsAfter],
    locations: [locV1, locV2],
    granularity: 'minute',
  });

  assert.equal(joined[0]?.locationStatus, 'located');
  assert.equal(joined[0]?.location?.version_id, locV1.version_id);

  assert.equal(joined[1]?.locationStatus, 'unlocated');
  assert.equal(joined[1]?.location, null);

  assert.equal(joined[2]?.locationStatus, 'located');
  assert.equal(joined[2]?.location?.version_id, locV2.version_id);
});

test('missing locations result in unlocated status with null location', () => {
  const unlocatedEmpty = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [],
    granularity: 'hour',
  });
  assert.equal(unlocatedEmpty[0]?.granularity, 'hour');
  assert.equal(unlocatedEmpty[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedEmpty[0]?.location, null);

  const unknownSensorObs = { ...observationMinute, sensor_id: '99999' };
  const unlocatedUnknown = joinPedestrianObservations({
    observations: [unknownSensorObs],
    locations: [earlierLocation],
    granularity: 'minute',
  });
  assert.equal(unlocatedUnknown[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedUnknown[0]?.location, null);

  // Observation outside valid window (before valid_from)
  const obsTooEarly = { ...observationMinute, observed_at: '2026-09-20T00:00:00Z' };
  const unlocatedEarly = joinPedestrianObservations({
    observations: [obsTooEarly],
    locations: [earlierLocation],
    granularity: 'minute',
  });
  assert.equal(unlocatedEarly[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedEarly[0]?.location, null);

  // Observation outside valid window (after valid_to when valid_to is not null)
  const obsTooLate = { ...observationMinute, observed_at: '2026-09-30T00:00:00Z' };
  const unlocatedLate = joinPedestrianObservations({
    observations: [obsTooLate],
    locations: [earlierLocation],
    granularity: 'minute',
  });
  assert.equal(unlocatedLate[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedLate[0]?.location, null);

  // Sensor location record exists but coordinates are null
  const nullCoordsLoc: SensorLocation = {
    ...earlierLocation,
    geometry_geojson: null,
  };
  const unlocatedNullCoords = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [nullCoordsLoc],
    granularity: 'minute',
  });
  assert.equal(unlocatedNullCoords[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedNullCoords[0]?.location, null);

  // Sensor location marked decommissioned
  const decommissionedLoc: SensorLocation = {
    ...earlierLocation,
    device_status: 'decommissioned',
  };
  const unlocatedDecom = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [decommissionedLoc],
    granularity: 'minute',
  });
  assert.equal(unlocatedDecom[0]?.locationStatus, 'unlocated');
  assert.equal(unlocatedDecom[0]?.location, null);
});

test('conflicting location versions for the same window result in ambiguous status with null location', () => {
  // Two versions with different geometry
  const conflicting = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [earlierLocation, { ...earlierLocation, geometry_geojson: movedLocation.geometry_geojson }],
    granularity: 'minute',
  });
  assert.equal(conflicting[0]?.locationStatus, 'ambiguous');
  assert.equal(conflicting[0]?.location, null);

  // Three versions with different geometries
  const thirdLocation: SensorLocation = {
    ...earlierLocation,
    version_id: 'loc-third',
    geometry_geojson: '{"type":"Point","coordinates":[145.2,-37.9]}',
  };
  const conflictingThree = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [earlierLocation, { ...earlierLocation, geometry_geojson: movedLocation.geometry_geojson }, thirdLocation],
    granularity: 'minute',
  });
  assert.equal(conflictingThree[0]?.locationStatus, 'ambiguous');
  assert.equal(conflictingThree[0]?.location, null);

  // Conflicting active vs inactive status
  const conflictingStatus = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [earlierLocation, { ...earlierLocation, device_status: 'I' }],
    granularity: 'minute',
  });
  assert.equal(conflictingStatus[0]?.locationStatus, 'ambiguous');
  assert.equal(conflictingStatus[0]?.location, null);

  // Non-conflicting duplicate versions (same coordinates, both active) deduplicate cleanly
  const duplicateActive = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [
      earlierLocation,
      { ...earlierLocation, version_id: 'loc-dup', device_status: 'Active' },
    ],
    granularity: 'minute',
  });
  assert.equal(duplicateActive[0]?.locationStatus, 'located');
  assert.equal(duplicateActive[0]?.location?.geometry_geojson, earlierLocation.geometry_geojson);
});

test('inactive sensor devices result in inactive status with null location', () => {
  const inactiveI = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [{ ...earlierLocation, device_status: 'I' }],
    granularity: 'minute',
  });
  assert.equal(inactiveI[0]?.locationStatus, 'inactive');
  assert.equal(inactiveI[0]?.location, null);

  const inactiveText = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [{ ...earlierLocation, device_status: 'inactive' }],
    granularity: 'minute',
  });
  assert.equal(inactiveText[0]?.locationStatus, 'inactive');
  assert.equal(inactiveText[0]?.location, null);

  const inactiveR = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [{ ...earlierLocation, device_status: 'R' }],
    granularity: 'minute',
  });
  assert.equal(inactiveR[0]?.locationStatus, 'inactive');
  assert.equal(inactiveR[0]?.location, null);

  const inactiveRemoved = joinPedestrianObservations({
    observations: [observationMinute],
    locations: [{ ...earlierLocation, device_status: 'Removed' }],
    granularity: 'minute',
  });
  assert.equal(inactiveRemoved[0]?.locationStatus, 'inactive');
  assert.equal(inactiveRemoved[0]?.location, null);

  // Active variants resolve to located with location intact
  const activeVariants = ['A', 'Active', 'active', null];
  for (const status of activeVariants) {
    const activeRes = joinPedestrianObservations({
      observations: [observationMinute],
      locations: [{ ...earlierLocation, device_status: status }],
      granularity: 'minute',
    });
    assert.equal(activeRes[0]?.locationStatus, 'located', `Expected located for status: ${status}`);
    assert.ok(activeRes[0]?.location !== null, `Expected non-null location for status: ${status}`);
  }
});

test('edge-of-window timestamps respect valid_from <= observed_at < valid_to', () => {
  const tFrom = '2026-09-27T00:00:00.000Z';
  const tTo = '2026-09-28T00:45:00.000Z';
  const windowLoc: SensorLocation = {
    ...earlierLocation,
    valid_from: tFrom,
    valid_to: tTo,
  };
  const nextLoc: SensorLocation = {
    ...movedLocation,
    valid_from: tTo,
    valid_to: null,
  };

  // Exactly at valid_from: included in windowLoc
  const atFrom = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: tFrom }],
    locations: [windowLoc],
    granularity: 'minute',
  });
  assert.equal(atFrom[0]?.locationStatus, 'located');
  assert.equal(atFrom[0]?.location?.version_id, windowLoc.version_id);

  // 1ms before valid_from: excluded
  const beforeFrom = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: '2026-09-26T23:59:59.999Z' }],
    locations: [windowLoc],
    granularity: 'minute',
  });
  assert.equal(beforeFrom[0]?.locationStatus, 'unlocated');
  assert.equal(beforeFrom[0]?.location, null);

  // 1ms before valid_to: included in windowLoc
  const beforeTo = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: '2026-09-28T00:44:59.999Z' }],
    locations: [windowLoc, nextLoc],
    granularity: 'minute',
  });
  assert.equal(beforeTo[0]?.locationStatus, 'located');
  assert.equal(beforeTo[0]?.location?.version_id, windowLoc.version_id);

  // Exactly at valid_to: excluded from windowLoc, joins nextLoc
  const atToContiguous = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: tTo }],
    locations: [windowLoc, nextLoc],
    granularity: 'minute',
  });
  assert.equal(atToContiguous[0]?.locationStatus, 'located');
  assert.equal(atToContiguous[0]?.location?.version_id, nextLoc.version_id);

  // Exactly at valid_to with no successor window: unlocated
  const atToNoSuccessor = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: tTo }],
    locations: [windowLoc],
    granularity: 'minute',
  });
  assert.equal(atToNoSuccessor[0]?.locationStatus, 'unlocated');
  assert.equal(atToNoSuccessor[0]?.location, null);

  // valid_to is null: matches indefinitely into future
  const farFuture = joinPedestrianObservations({
    observations: [{ ...observationMinute, observed_at: '2036-01-01T00:00:00.000Z' }],
    locations: [nextLoc],
    granularity: 'minute',
  });
  assert.equal(farFuture[0]?.locationStatus, 'located');
  assert.equal(farFuture[0]?.location?.version_id, nextLoc.version_id);
});

test('zero-fill absence strictly preserves missing counts and does not backfill missing rows', () => {
  const nullObservation: PedestrianObservation = {
    ...observationMinute,
    direction_a_count: null,
    direction_b_count: null,
    total_count: null,
  };
  const zeroAndNullObservation: PedestrianObservation = {
    ...observationMinute,
    observed_at: '2026-09-28T00:35:00Z',
    direction_a_count: 0,
    direction_b_count: null,
    total_count: 0,
  };

  const joined = joinPedestrianObservations({
    observations: [nullObservation, zeroAndNullObservation],
    locations: [earlierLocation],
    granularity: 'minute',
  });

  // Length must strictly match input observations (no backfilled minutes)
  assert.equal(joined.length, 2);

  // Nulls must remain null, never fabricated as 0
  assert.strictEqual(joined[0]?.observation.direction_a_count, null);
  assert.strictEqual(joined[0]?.observation.direction_b_count, null);
  assert.strictEqual(joined[0]?.observation.total_count, null);

  // Explicit 0 and null must be preserved as-is
  assert.strictEqual(joined[1]?.observation.direction_a_count, 0);
  assert.strictEqual(joined[1]?.observation.direction_b_count, null);
  assert.strictEqual(joined[1]?.observation.total_count, 0);
});

test('invalid pedestrian observation timestamp fails fast', () => {
  assert.throws(
    () => {
      joinPedestrianObservations({
        observations: [{ ...observationMinute, observed_at: 'invalid-datetime' }],
        locations: [earlierLocation],
        granularity: 'minute',
      });
    },
    { message: 'Invalid pedestrian observation time' },
  );
});
