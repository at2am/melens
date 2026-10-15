import { AgentServiceError } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import { feedsBodySchema, type FeedSubscription } from './schemas.js';
import type { FeedStore } from './store.js';

export interface FeedServiceOptions {
  readonly store: FeedStore;
  /** Every save of a uid counts; reads are free. */
  readonly writeLimiter: RateLimiter;
  readonly clock?: () => Date;
}

/** Reading and replacing a uid's feed subscriptions (agent-protocol.md, Feed subscriptions). */
export class FeedService {
  private readonly store: FeedStore;
  private readonly writeLimiter: RateLimiter;
  private readonly clock: () => Date;

  constructor(options: FeedServiceOptions) {
    this.store = options.store;
    this.writeLimiter = options.writeLimiter;
    this.clock = options.clock ?? (() => new Date());
  }

  /** Null when the uid never saved: the app then applies its default feeds. */
  async list(uid: string): Promise<FeedSubscription[] | null> {
    const record = await this.store.get(uid);
    return record === null ? null : [...record.feeds];
  }

  /** Replaces the whole list, in the order given. */
  async replace(uid: string, body: unknown): Promise<FeedSubscription[]> {
    const parsed = feedsBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    await this.store.put(uid, { feeds: parsed.data.feeds, updatedAt: now.toISOString() });
    return parsed.data.feeds;
  }
}
