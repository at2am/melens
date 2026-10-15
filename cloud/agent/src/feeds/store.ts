import type { FeedSubscription } from './schemas.js';

/** A uid's feed subscriptions as stored: the whole list, replaced on every save. */
export interface FeedRecord {
  readonly feeds: readonly FeedSubscription[];
  readonly updatedAt: string;
}

/** Feed subscriptions per uid. Only the agent service reaches the store; the service checks every rule. */
export interface FeedStore {
  /** Null when the uid never saved, or when the stored list no longer parses. */
  get(uid: string): Promise<FeedRecord | null>;
  put(uid: string, record: FeedRecord): Promise<void>;
}

/** Development and test store; a Cloud Run instance never uses it for real users. */
export class InMemoryFeedStore implements FeedStore {
  private readonly records = new Map<string, FeedRecord>();

  async get(uid: string): Promise<FeedRecord | null> {
    return this.records.get(uid) ?? null;
  }

  async put(uid: string, record: FeedRecord): Promise<void> {
    this.records.set(uid, record);
  }
}
