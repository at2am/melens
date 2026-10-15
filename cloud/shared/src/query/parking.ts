import { createHash } from 'node:crypto';
import { z } from 'zod';

import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import {
  MapAdapterError, publicSourceReference, publishedIdentifier, publishedInstant, publishedItemBatch,
  resolvePublishedSource, type PublicSourceReference, type PublicSourceResolver, type PublishedItemBatch,
} from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type ParkingItem = Extract<MapItem, { kind: 'parking' }>;

const freshness = z.enum(['current', 'late', 'stale', 'unknown']);
const rowSchema = z.object({
  source_id: z.string(), batch_id: z.string(), sensor_id: z.string(), version_id: z.string(),
  occupied: z.boolean().nullable(),
  zone_number: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  occupancy_freshness: freshness,
  availability_note: z.string(),
  // The view never claims legal permission. If it ever does, the row is refused rather than relayed.
  may_park_now: z.literal('unknown'),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
});

type State = ParkingItem['details']['state'];
type NoDataReason = NonNullable<ParkingItem['details']['noDataReason']>;

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * What a map may draw for this sensor. Order matters: a holiday or a missing status is named before
 * "not reporting", and a stale reading is never relayed as occupied or vacant.
 */
export function parkingDrawState(input: {
  readonly occupied: boolean | null; readonly statusChangedAt: string | null;
  readonly freshness: z.infer<typeof freshness>; readonly note: string;
}): { state: State; reason: NoDataReason | null } {
  if (input.note === 'sensor_not_operational_public_holiday') return { state: 'noData', reason: 'publicHoliday' };
  if (input.note === 'sensor_holiday_status_unknown') return { state: 'noData', reason: 'holidayUnknown' };
  if (input.occupied === null || input.statusChangedAt === null) return { state: 'noData', reason: 'noStatus' };
  if (input.freshness !== 'current' && input.freshness !== 'late') return { state: 'noData', reason: 'notReporting' };
  return { state: input.occupied ? 'occupied' : 'vacant', reason: null };
}

/** Rows come from the published latest-snapshot view, never from the City of Melbourne API. */
export function adaptParkingRow(row: ViewRow, options: { readonly source: PublicSourceReference }): ParkingItem {
  try {
    const parsed = rowSchema.parse(row);
    const sourceId = publishedIdentifier(parsed.source_id);
    if (options.source.sourceId !== sourceId) throw new MapAdapterError('notPublic');
    const sensorId = publishedIdentifier(parsed.sensor_id);
    const batchId = publishedIdentifier(parsed.batch_id);
    const statusChangedAt = publishedInstant(row.status_changed_at);
    const lastReportedAt = publishedInstant(row.source_updated_at);
    const { state, reason } = parkingDrawState({ occupied: parsed.occupied, statusChangedAt,
      freshness: parsed.occupancy_freshness, note: parsed.availability_note });
    const id = publishedIdentifier(`parking:${sensorId}`);
    // The version is the published record: its batch and source version. Each snapshot is a new version, so
    // clients never keep an old reading. The draw state is left out on purpose: the view derives freshness
    // from the read time, so it can move from current to late between two reads of the same publication,
    // and the public-record recheck must still recognise that record as the same one.
    const versionId = `parking-v2:${hash([batchId, id, publishedIdentifier(row.version_id), parsed.latitude,
      parsed.longitude])}`;
    const item = mapItemSchema.parse({
      id, versionId, layerId: 'parking', kind: 'parking',
      title: `Parking sensor ${sensorId.replace(/^kerbside:/, '')}`,
      geometry: { type: 'Point', coordinates: [parsed.longitude, parsed.latitude] },
      location: { precision: 'point', role: 'sensor', evidence: 'Official sensor coordinates' },
      assertionKind: 'observation', lifecycle: 'active',
      time: { observedAt: statusChangedAt, reportedAt: lastReportedAt, validFrom: null, validTo: null,
        fetchedAt: publishedInstant(row.fetched_at), periodLabel: null, sourceTimeText: null, sourceTimezone: null },
      sources: [publicSourceReference(options.source, versionId, row.original_url)],
      details: { sensorId, state, noDataReason: reason, reading: parsed.occupancy_freshness,
        lastReportedAt, statusChangedAt, zoneNumber: parsed.zone_number,
        legalParking: 'unknown', mayBeObstructed: true },
    });
    if (item.kind !== 'parking') throw new MapAdapterError();
    return item;
  } catch (error) {
    throw error instanceof MapAdapterError ? error : new MapAdapterError();
  }
}

/** Only the current snapshot exists, so there is no historical parking read. */
export function adaptParkingRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode?: 'current' | 'historical';
}): PublishedItemBatch<ParkingItem> {
  if (options.mode === 'historical') throw new MapAdapterError('notPublic');
  return publishedItemBatch(rows.map((row) =>
    adaptParkingRow(row, { source: resolvePublishedSource(row, options.resolveSource) })));
}
