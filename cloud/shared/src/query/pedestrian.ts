import { createHash } from 'node:crypto';
import { z } from 'zod';

import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import {
  comparePublishedInstants, MapAdapterError, offsetPublishedInstant, publishedItemBatch,
  parsePublishedGeometry, publicSourceReference, publishedIdentifier, publishedInstant,
  resolvePublishedSource, type PublishedItemBatch, type PublicSourceReference, type PublicSourceResolver,
} from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type PedestrianItem = Extract<MapItem, { kind: 'pedestrian' }>;
const observationSchema = z.object({
  rights_evidence: z.literal('latest_published_record_v1'),
  source_record_id: z.string().min(1), version_id: z.string().min(1),
  location_source_record_id: z.string().min(1).nullable(), location_version_id: z.string().min(1).nullable(),
  source_id: z.string(), batch_id: z.string(), sensor_id: z.string(), observed_at: z.string(),
  direction_a_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  direction_b_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  total_count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  record_granularity: z.enum(['sensor_minute', 'sensor_hour']),
  location_status: z.enum(['located', 'unlocated', 'ambiguous', 'inactive']),
});

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Rows come from the published observation view, never an upstream response. */
export function adaptPedestrianRow(row: ViewRow, options: {
  readonly source: PublicSourceReference;
  readonly locationSource?: PublicSourceReference;
}): PedestrianItem {
  try {
    const observation = observationSchema.parse(row);
    const sourceId = publishedIdentifier(observation.source_id);
    if (options.source.sourceId !== sourceId) throw new MapAdapterError('notPublic');
    publishedIdentifier(observation.source_record_id);
    const recordVersionId = publishedIdentifier(observation.version_id);
    const sensorId = publishedIdentifier(observation.sensor_id);
    const batchId = publishedIdentifier(observation.batch_id);
    const observedAt = publishedInstant(observation.observed_at);
    if (observedAt === null) throw new MapAdapterError();
    const granularity = observation.record_granularity === 'sensor_minute' ? 'minute' : 'hour';
    const window = { from: observedAt, to: offsetPublishedInstant(observedAt,
      granularity === 'minute' ? 60_000 : 3_600_000) };
    const locationValidFrom = publishedInstant(row.location_valid_from);
    const locationValidTo = publishedInstant(row.location_valid_to);
    if (locationValidFrom !== null && locationValidTo !== null
      && comparePublishedInstants(locationValidFrom, locationValidTo) >= 0) throw new MapAdapterError();
    const locationSourceId = row.location_source_id == null ? null : publishedIdentifier(row.location_source_id);
    if ((locationSourceId === null) !== (observation.location_source_record_id === null)
      || (locationSourceId === null) !== (observation.location_version_id === null)) throw new MapAdapterError();
    if (observation.location_source_record_id !== null) publishedIdentifier(observation.location_source_record_id);
    if (observation.location_version_id !== null) publishedIdentifier(observation.location_version_id);
    if (locationSourceId !== null && options.locationSource?.sourceId !== locationSourceId) {
      throw new MapAdapterError('notPublic');
    }
    let locationStatus = observation.location_status;
    let geometry = parsePublishedGeometry(row.geometry_geojson);
    if (locationStatus !== 'located') geometry = null;
    else {
      if (locationSourceId === null || geometry?.type !== 'Point' || locationValidFrom === null) {
        throw new MapAdapterError();
      }
      // Recheck the full count window at the adapter boundary as well as in SQL.
      if (comparePublishedInstants(locationValidFrom, window.from) > 0
        || (locationValidTo !== null && comparePublishedInstants(locationValidTo, window.to) < 0)) {
        geometry = null;
        locationStatus = 'unlocated';
      }
    }
    const normalizedObservedAt = offsetPublishedInstant(observedAt, 0);
    const id = `pedestrian:${hash([sourceId, sensorId, normalizedObservedAt])}`;
    // Native revisions bind stored snapshots to the exact permission-checked
    // observation and effective location, including unchanged visible counts.
    const versionId = `pedestrian-v1:${hash([batchId, observation.source_record_id, recordVersionId,
      observation.location_source_record_id, observation.location_version_id, id, observation.total_count,
      observation.direction_a_count, observation.direction_b_count, granularity,
      geometry, locationStatus, locationSourceId, locationValidFrom, locationValidTo])}`;
    const sources = [publicSourceReference(options.source, versionId)];
    if (options.locationSource !== undefined && locationSourceId !== null) {
      sources.push({ ...options.locationSource, versionRef: observation.location_version_id });
    }
    const parsed = mapItemSchema.parse({
      id, versionId, layerId: 'pedestrian', kind: 'pedestrian', title: `Sensor ${sensorId}`,
      geometry, location: { precision: geometry === null ? 'unlocated' : 'point',
        role: 'sensor', evidence: geometry === null ? null : 'Published observation-effective sensor coordinates' },
      assertionKind: 'observation', lifecycle: 'active',
      time: { observedAt, reportedAt: null, validFrom: window.from, validTo: window.to,
        fetchedAt: publishedInstant(row.fetched_at), periodLabel: null,
        sourceTimeText: null, sourceTimezone: null }, sources,
      details: { sensorId, totalCount: observation.total_count,
        directionACount: observation.direction_a_count, directionBCount: observation.direction_b_count,
        granularity, window, locationValidFrom, locationValidTo, locationStatus },
    });
    if (parsed.kind !== 'pedestrian') throw new MapAdapterError();
    return parsed;
  } catch (error) {
    if (error instanceof MapAdapterError) throw error;
    throw new MapAdapterError();
  }
}

/** A null resolver result is a source admission failure, never a missing count. */
export function adaptPedestrianRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode: 'current' | 'historical';
}): PublishedItemBatch<PedestrianItem> {
  return publishedItemBatch(rows.map((row) => {
    const source = resolvePublishedSource(row, options.resolveSource);
    const locationSourceId = row.location_source_id == null ? null : publishedIdentifier(row.location_source_id);
    const locationSource = locationSourceId === null ? null : options.resolveSource(locationSourceId);
    if (locationSourceId !== null && (locationSource === null || locationSource.sourceId !== locationSourceId)) {
      throw new MapAdapterError('notPublic');
    }
    return adaptPedestrianRow(row, { source, ...(locationSource === null ? {} : { locationSource }) });
  }));
}
