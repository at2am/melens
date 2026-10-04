import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import {
  comparePublishedInstants, MapAdapterError, parsePublishedGeometry, publishedGeoRowSchema, publishedItemBatch,
  publicSourceReference, publishedAssertion, publishedIdentifier, publishedInstant, publishedItemTime,
  publishedLifecycle, publishedLocation, publishedText, resolvePublishedSource,
  type PublishedItemBatch, type PublicSourceReference, type PublicSourceResolver,
} from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type EventItem = Extract<MapItem, { kind: 'event' }>;

export function adaptEventRow(row: ViewRow, options: {
  readonly source: PublicSourceReference;
  readonly mode?: 'current' | 'historical';
  readonly asOf?: string;
}): EventItem {
  try {
    publishedGeoRowSchema.parse(row);
    const sourceId = publishedIdentifier(row.source_id);
    if (options.source.sourceId !== sourceId) throw new MapAdapterError('notPublic');
    if (row.topic !== 'event') throw new MapAdapterError();
    const id = publishedIdentifier(row.geo_record_id);
    const versionId = publishedIdentifier(row.version_id);
    const startAt = publishedInstant(row.valid_from);
    let endAt = publishedInstant(row.valid_to);
    // The current Ticketmaster connector writes startAt as its absent-end
    // sentinel. An unknown duration cannot become a zero-duration public fact.
    if (sourceId === 'ticketmaster.events' && startAt !== null && endAt !== null
      && comparePublishedInstants(startAt, endAt) === 0) endAt = null;
    const geometry = parsePublishedGeometry(row.geometry_geojson);
    const sourceLifecycle = publishedLifecycle(row.record_status);
    if (options.mode === 'current' && sourceLifecycle !== 'active' && sourceLifecycle !== 'planned') {
      throw new MapAdapterError();
    }
    const asOf = publishedInstant(options.asOf);
    const lifecycle = options.mode === 'current' && asOf !== null && sourceLifecycle === 'active'
      && startAt !== null && comparePublishedInstants(startAt, asOf) > 0 ? 'planned' : sourceLifecycle;
    const summary = publishedText(row.summary);
    const ticketSummary = sourceId === 'ticketmaster.events' && summary !== null
      ? /^Ticketmaster status: [^;]*; local start: ([^;]*); venue: (.*)$/.exec(summary) : null;
    const sourceClock = ticketSummary?.[1]?.trim() ?? null;
    const sourceTimezone = sourceClock === null ? null : /(?:^|\s)([A-Za-z_]+\/[A-Za-z_]+)$/.exec(sourceClock)?.[1] ?? null;
    const venueName = ticketSummary?.[2] === 'unknown' ? null : publishedText(ticketSummary?.[2]);
    const parsed = mapItemSchema.parse({ id, versionId, layerId: 'event', kind: 'event',
      title: publishedText(row.title), geometry, location: publishedLocation(row, geometry),
      assertionKind: publishedAssertion(row), lifecycle,
      time: publishedItemTime({ ...row, valid_to: endAt,
        source_time_text: row.source_time_text ?? sourceClock,
        source_timezone: row.source_timezone ?? sourceTimezone }),
      sources: [publicSourceReference(options.source, versionId, row.original_url)],
      details: { summary, venueName, category: null, startAt, endAt,
        status: lifecycle === 'withdrawn' ? 'unknown' : lifecycle },
    });
    if (parsed.kind !== 'event') throw new MapAdapterError();
    return parsed;
  } catch (error) {
    if (error instanceof MapAdapterError) throw error;
    throw new MapAdapterError();
  }
}

export function adaptEventRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode: 'current' | 'historical';
  readonly asOf?: string;
}): PublishedItemBatch<EventItem> {
  return publishedItemBatch(rows.map((row) => adaptEventRow(row, {
    source: resolvePublishedSource(row, options.resolveSource), mode: options.mode,
    ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
  })));
}
