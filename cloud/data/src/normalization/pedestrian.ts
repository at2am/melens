import type { PedestrianObservation, SensorLocation } from '../core/types.js';

export interface LocatedPedestrianObservation {
  observation: PedestrianObservation;
  granularity: 'minute' | 'hour';
  location: SensorLocation | null;
  locationStatus: 'located' | 'unlocated' | 'ambiguous' | 'inactive';
}

function isDeviceActive(status: string | null): boolean {
  if (status === null) return true;
  const s = status.trim().toLowerCase();
  return s === 'a' || s === 'active';
}

function classifyLocation(loc: SensorLocation): {
  geometry: string | null;
  state: 'located' | 'unlocated' | 'inactive';
} {
  if (loc.geometry_geojson === null || loc.geometry_geojson.trim() === '') {
    return { geometry: null, state: 'unlocated' };
  }
  const s = loc.device_status?.trim().toLowerCase();
  if (s && s.includes('decommission')) {
    return { geometry: loc.geometry_geojson, state: 'unlocated' };
  }
  if (!isDeviceActive(loc.device_status)) {
    return { geometry: loc.geometry_geojson, state: 'inactive' };
  }
  return { geometry: loc.geometry_geojson, state: 'located' };
}

/**
 * Associate both minute and hourly pedestrian observations with sensor locations
 * based on sensor_id and effective location time window:
 * valid_from <= observation.observed_at < (valid_to ?? infinity).
 *
 * Strictly preserves observation granularity and native timestamps.
 * Missing minutes and unavailable/decommissioned locations never fabricate points or fill counts.
 */
export function joinPedestrianObservations(input: {
  observations: readonly PedestrianObservation[];
  locations: readonly SensorLocation[];
  granularity: 'minute' | 'hour';
}): readonly LocatedPedestrianObservation[] {
  const bySensor = new Map<string, SensorLocation[]>();
  for (const location of input.locations) {
    const list = bySensor.get(location.sensor_id);
    if (list) {
      list.push(location);
    } else {
      bySensor.set(location.sensor_id, [location]);
    }
  }

  return input.observations.map(observation => {
    const time = Date.parse(observation.observed_at);
    if (!Number.isFinite(time)) {
      throw new Error('Invalid pedestrian observation time');
    }

    const eligible = (bySensor.get(observation.sensor_id) ?? []).filter(location => {
      const from = Date.parse(location.valid_from);
      if (!Number.isFinite(from)) return false;
      if (location.valid_to === null) {
        return from <= time;
      }
      const to = Date.parse(location.valid_to);
      if (!Number.isFinite(to)) return false;
      return from <= time && time < to;
    });

    if (eligible.length === 0) {
      return {
        observation,
        granularity: input.granularity,
        location: null,
        locationStatus: 'unlocated',
      };
    }

    eligible.sort((a, b) => {
      const diff = Date.parse(b.valid_from) - Date.parse(a.valid_from);
      if (diff !== 0) return diff;
      return b.valid_from.localeCompare(a.valid_from);
    });

    const latest = eligible[0]!;
    const latestFromMs = Date.parse(latest.valid_from);
    const sameStart = eligible.filter(location =>
      Date.parse(location.valid_from) === latestFromMs);

    const signatures = new Set(
      sameStart.map(loc => {
        const c = classifyLocation(loc);
        return `${c.geometry}\u001f${c.state}`;
      })
    );
    const conflicting = signatures.size > 1;

    const classified = classifyLocation(latest);
    const locationStatus: 'located' | 'unlocated' | 'ambiguous' | 'inactive' =
      conflicting ? 'ambiguous' : classified.state;

    return {
      observation,
      granularity: input.granularity,
      location: locationStatus === 'located' ? latest : null,
      locationStatus,
    };
  });
}
