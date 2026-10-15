import { SERVICE_BBOX, identifierSchema } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import { latLngSchema } from '../protocol/schemas.js';

/** Wire schemas and limits of the user events routes (agent-protocol.md, User events). */

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

export const EVENT_LIMITS = {
  title: 120,
  description: 2_000,
  placeName: 120,
  displayName: 40,
  capacityMin: 2,
  capacityMax: 1_000,
  /** A published event may have started this long ago. */
  pastStartMs: HOUR,
  aheadMs: 366 * DAY,
  durationMs: 7 * DAY,
  /** Without an end, an event counts as taking place this long after its start. */
  defaultDurationMs: 3 * HOUR,
  discoverSpanMs: 14 * DAY,
  discoverLimit: 200,
  /** How many candidates one discovery reads before the box and time filters. */
  discoverScan: 1_000,
  bboxSideMetres: 10_000,
  /** A removed or finished event stays this long after its last activity, for the export to withdraw it. */
  retentionMs: 90 * DAY,
  writesPerHour: 60,
} as const;

export const MELBOURNE_TIMEZONE = 'Australia/Melbourne';

const text = (max: number) => z.string().trim().max(max);
const offsetTime = z.iso.datetime({ offset: true });
const instant = z.iso.datetime();
const count = z.number().int().nonnegative();

/** A place inside the service area; the map contract's box, west, south, east, north. */
export const servicePointSchema = latLngSchema.refine((point) => point.lng >= SERVICE_BBOX[0] && point.lat >= SERVICE_BBOX[1]
  && point.lng <= SERVICE_BBOX[2] && point.lat <= SERVICE_BBOX[3], 'point must be inside the service area');

/** What the publisher sends; times carry any offset and are stored in UTC. */
export const eventDraftSchema = z.strictObject({
  title: text(EVENT_LIMITS.title).min(1),
  description: text(EVENT_LIMITS.description),
  point: servicePointSchema,
  placeName: text(EVENT_LIMITS.placeName).nullable().optional(),
  startAt: offsetTime,
  endAt: offsetTime.nullable().optional(),
  anonymousAttendance: z.boolean().optional(),
  capacity: z.number().int().min(EVENT_LIMITS.capacityMin).max(EVENT_LIMITS.capacityMax).nullable().optional(),
});
export type EventDraft = z.infer<typeof eventDraftSchema>;

/** `PATCH`: any subset of the draft; `endAt`, `placeName` and `capacity` may be set to null. */
export const eventPatchSchema = eventDraftSchema.partial().refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');
export type EventPatch = z.infer<typeof eventPatchSchema>;

export const joinBodySchema = z.strictObject({ displayName: text(EVENT_LIMITS.displayName).nullable().optional() });
export type JoinBody = z.infer<typeof joinBodySchema>;

const coordinate = (min: number, max: number) => z.coerce.number().min(min).max(max);

/** The query string of `GET /v1/events`. */
export const discoverQuerySchema = z.strictObject({
  north: coordinate(-90, 90), south: coordinate(-90, 90), east: coordinate(-180, 180), west: coordinate(-180, 180),
  from: offsetTime.optional(),
  to: offsetTime.optional(),
}).refine((query) => query.north > query.south && query.east > query.west, 'bbox needs north > south and east > west');
export type DiscoverQuery = z.infer<typeof discoverQuerySchema>;

export const eventStatusSchema = z.enum(['published', 'cancelled', 'removed']);
export type EventStatus = z.infer<typeof eventStatusSchema>;
export const eventVisibilitySchema = z.enum(['visible', 'hidden']);
export type EventVisibility = z.infer<typeof eventVisibilitySchema>;

/** An event as every route returns it. */
export const eventViewSchema = z.strictObject({
  id: identifierSchema,
  title: z.string().min(1).max(EVENT_LIMITS.title),
  description: z.string().max(EVENT_LIMITS.description),
  point: latLngSchema,
  placeName: z.string().min(1).max(EVENT_LIMITS.placeName).nullable(),
  startAt: instant,
  endAt: instant.nullable(),
  timezone: z.literal(MELBOURNE_TIMEZONE),
  anonymousAttendance: z.boolean(),
  capacity: z.number().int().min(EVENT_LIMITS.capacityMin).max(EVENT_LIMITS.capacityMax).nullable(),
  status: z.enum(['published', 'cancelled']),
  attendeeCount: count,
  createdAt: instant,
  updatedAt: instant,
  version: z.number().int().positive(),
  viewer: z.strictObject({ isOwner: z.boolean(), joined: z.boolean() }),
});
export type EventView = z.infer<typeof eventViewSchema>;

export const memberViewSchema = z.strictObject({
  memberId: identifierSchema, displayName: z.string().min(1).max(EVENT_LIMITS.displayName).nullable(), joinedAt: instant,
});
export type MemberView = z.infer<typeof memberViewSchema>;

export const membersViewSchema = z.strictObject({ count, members: z.array(memberViewSchema).nullable() });
export type MembersView = z.infer<typeof membersViewSchema>;

/** Why a join, leave or member action was refused; the suffix of the `conflict` error's `messageKey`. */
export const CONFLICT_REASONS = ['eventFull', 'alreadyJoined', 'eventCancelled', 'eventEnded', 'ownEvent', 'notJoined', 'anonymousEvent'] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];
