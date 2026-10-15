import { SERVICE_BBOX } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

/** Wire schemas and limits of the feed subscription routes (agent-protocol.md, Feed subscriptions). */

export const FEED_LIMITS = {
  maxFeeds: 20,
  name: 60,
  writesPerHour: 120,
} as const;

/** The feed topics of UC-14: community events (UC-09) or one map layer. */
export const FEED_TOPICS = ['community', 'events', 'disruptions', 'news', 'anomalies', 'planning'] as const;
export const feedTopicSchema = z.enum(FEED_TOPICS);
export type FeedTopic = z.infer<typeof feedTopicSchema>;

const feedIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

const distinct = <T>(values: readonly T[]) => new Set(values).size === values.length;

/** West, south, east, north, inside the map contract's service box. */
const serviceBboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]).refine(([west, south, east, north]) =>
  [west, south, east, north].every(Number.isFinite) && west < east && south < north
  && west >= SERVICE_BBOX[0] && south >= SERVICE_BBOX[1] && east <= SERVICE_BBOX[2] && north <= SERVICE_BBOX[3],
'bbox must be ordered and inside the service area');

/** Where a feed reads: the whole service area, a named City of Melbourne small area (the app owns the list), or a box. */
export const feedScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('city') }),
  z.strictObject({ kind: z.literal('area'), areaId: feedIdSchema }),
  z.strictObject({ kind: z.literal('bbox'), bbox: serviceBboxSchema }),
]);
export type FeedScope = z.infer<typeof feedScopeSchema>;

export const feedSubscriptionSchema = z.strictObject({
  id: feedIdSchema,
  name: z.string().trim().min(1).max(FEED_LIMITS.name),
  topics: z.array(feedTopicSchema).min(1).refine(distinct, 'topics must be distinct'),
  scope: feedScopeSchema,
  /** Also read the source jurisdiction's records that have no location. */
  includeUnlocated: z.boolean(),
  communityHorizonDays: z.union([z.literal(1), z.literal(7), z.literal(14)]),
  /** A paused feed stays saved but the app does not load it. */
  enabled: z.boolean(),
});
export type FeedSubscription = z.infer<typeof feedSubscriptionSchema>;

export const feedListSchema = z.array(feedSubscriptionSchema).max(FEED_LIMITS.maxFeeds)
  .refine((feeds) => distinct(feeds.map((feed) => feed.id)), 'feed ids must be distinct');

/** The body of `PUT /v1/feeds`: the whole list, in the order the user keeps it. */
export const feedsBodySchema = z.strictObject({ feeds: feedListSchema });
