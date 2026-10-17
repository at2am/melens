import type { MemoryRecord } from './schemas.js';

/** A uid's memory in one record. Only the agent service reaches the store; the service checks every rule. */
export interface MemoryStore {
  /** Null when the uid has none, or when the stored record no longer parses. */
  get(uid: string): Promise<MemoryRecord | null>;
  /**
   * Reads the record, applies `change` and stores what it returns, atomically against other writers of the uid.
   * `change` may run more than once, so it must not have side effects. Returns what was stored.
   */
  update(uid: string, change: (current: MemoryRecord | null) => MemoryRecord): Promise<MemoryRecord>;
}

/** Development and test store; a Cloud Run instance never uses it for real users. */
export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, MemoryRecord>();

  async get(uid: string): Promise<MemoryRecord | null> {
    return this.records.get(uid) ?? null;
  }

  async update(uid: string, change: (current: MemoryRecord | null) => MemoryRecord): Promise<MemoryRecord> {
    const next = change(this.records.get(uid) ?? null);
    this.records.set(uid, next);
    return next;
  }
}
