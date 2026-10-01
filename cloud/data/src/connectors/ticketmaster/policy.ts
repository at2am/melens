import { z } from 'zod';

import { sourceRecordId } from '../../validation/record.js';

export const TICKETMASTER_CACHE_SECONDS = 24 * 60 * 60;
export const TICKETMASTER_REFRESH_SECONDS = 12 * 60 * 60;
export const TICKETMASTER_LOOKAHEAD_SECONDS = 30 * 24 * 60 * 60;
export const TICKETMASTER_CLEANUP_SECONDS = 6 * 60 * 60;
export const TICKETMASTER_CLEANUP_AGE_SECONDS = 18 * 60 * 60;
export const TICKETMASTER_ATTRIBUTION = 'Event information provided by Ticketmaster';

const utcTimestamp = z.iso.datetime({ offset: false });

/** This is the application's cache policy, not a 24-hour limit in the API terms. */
export function ticketmasterCacheExpiresAt(fetchedAt: string): string {
  return new Date(Date.parse(utcTimestamp.parse(fetchedAt))
    + TICKETMASTER_CACHE_SECONDS * 1000).toISOString();
}

export function ticketmasterCacheIsVisible(input: {
  fetchedAt: string;
  now: string;
  suppressed: boolean;
}): boolean {
  const fetched = utcTimestamp.safeParse(input.fetchedAt);
  const now = utcTimestamp.safeParse(input.now);
  if (!fetched.success || !now.success || input.suppressed) return false;
  const age = Date.parse(now.data) - Date.parse(fetched.data);
  return age >= 0 && age < TICKETMASTER_CACHE_SECONDS * 1000;
}

export function ticketmasterContentRecordId(nativeId: string): string {
  return sourceRecordId({ sourceId: 'ticketmaster.events',
    nativeId: z.string().trim().min(1).parse(nativeId), originalUrl: null, sourceTime: null });
}

export function ticketmasterUpcomingWindow(now: string): { from: string; to: string } {
  const from = new Date(utcTimestamp.parse(now)).toISOString();
  return { from, to: new Date(Date.parse(from)
    + TICKETMASTER_LOOKAHEAD_SECONDS * 1000).toISOString() };
}
