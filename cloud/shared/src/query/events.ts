import { z } from 'zod';

import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import {
  comparePublishedInstants, MapAdapterError, parsePublishedGeometry, publishedGeoRowSchema, publishedItemBatch,
  publicSourceReference, publishedAssertion, publishedIdentifier, publishedInstant, publishedItemTime,
  publishedLifecycle, publishedLocation, publishedText, resolvePublishedSource,
  type PublishedItemBatch, type PublicSourceReference, type PublicSourceResolver,
} from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type EventItem = Extract<MapItem, { kind: 'event' }>;

/** Events users publish in the app (UC-09); the `user_events` connector exports them with a JSON summary. */
export const USER_EVENTS_SOURCE_ID = 'user.events';
export const USER_EVENTS_TIMEZONE = 'Australia/Melbourne';
export const USER_EVENTS_CATEGORY = 'community';

const userEventSummarySchema = z.object({
  description: z.string().nullish(), placeName: z.string().nullish(), attendeeCount: z.number().int().nonnegative().nullish(),
  anonymousAttendance: z.boolean().nullish(),
});
const originalEventUrlSchema = z.url({ protocol: /^https?$/ });

/** The public summary of a user event: the description and how many are going; the place is the venue. */
function userEventSummary(summary: string | null): { readonly summary: string | null; readonly placeName: string | null } | null {
  if (summary === null || !summary.trimStart().startsWith('{')) return { summary, placeName: null };
  let decoded: unknown;
  try { decoded = JSON.parse(summary); } catch { throw new MapAdapterError(); }
  const detail = userEventSummarySchema.parse(decoded);
  const going = detail.attendeeCount == null || detail.attendeeCount === 0 ? null
    : `${detail.attendeeCount} ${detail.attendeeCount === 1 ? 'person is' : 'people are'} going`;
  const text = [publishedText(detail.description), going].filter((part) => part !== null).join('\n') || null;
  return { summary: text, placeName: publishedText(detail.placeName) };
}

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
    const originalUrl = sourceId === 'ticketmaster.events'
      ? originalEventUrlSchema.parse(row.original_url) : row.original_url;
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
    const rawSummary = publishedText(row.summary);
    const ticketSummary = sourceId === 'ticketmaster.events' && rawSummary !== null
      ? /^Ticketmaster status: [^;]*; local start: ([^;]*); venue: (.*)$/.exec(rawSummary) : null;
    const sourceClock = ticketSummary?.[1]?.trim() ?? null;
    const userSummary = sourceId === USER_EVENTS_SOURCE_ID ? userEventSummary(rawSummary) : null;
    const sourceTimezone = userSummary !== null ? USER_EVENTS_TIMEZONE
      : sourceClock === null ? null : /(?:^|\s)([A-Za-z_]+\/[A-Za-z_]+)$/.exec(sourceClock)?.[1] ?? null;
    const venueName = userSummary !== null ? userSummary.placeName
      : ticketSummary?.[2] === 'unknown' ? null : publishedText(ticketSummary?.[2]);
    const summary = userSummary !== null ? userSummary.summary : rawSummary;
    const parsed = mapItemSchema.parse({ id, versionId, layerId: 'event', kind: 'event',
      title: publishedText(row.title), geometry, location: publishedLocation(row, geometry),
      assertionKind: publishedAssertion(row), lifecycle,
      time: publishedItemTime({ ...row, valid_to: endAt,
        source_time_text: row.source_time_text ?? sourceClock,
        source_timezone: row.source_timezone ?? sourceTimezone }),
      sources: [publicSourceReference(options.source, versionId, originalUrl)],
      details: { summary, venueName, category: userSummary === null ? null : USER_EVENTS_CATEGORY, startAt, endAt,
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
