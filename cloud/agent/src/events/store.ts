import type { LatLng } from '../protocol/schemas.js';
import type { EventStatus, EventVisibility } from './schemas.js';

/** One user event as stored: the published fields, the owner, the attendance and the export clocks. */
export interface UserEventRecord {
  readonly id: string;
  /** Stays in the store; never part of a response or an export. */
  readonly ownerUid: string;
  readonly title: string;
  readonly description: string;
  readonly point: LatLng;
  readonly placeName: string | null;
  /** UTC instants. */
  readonly startAt: string;
  readonly endAt: string | null;
  readonly timezone: string;
  readonly anonymousAttendance: boolean;
  readonly capacity: number | null;
  readonly status: EventStatus;
  readonly visibility: EventVisibility;
  /** Who joined, in join order; the count is its length. Never leaves the service. */
  readonly attendeeUids: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Incremented on every change the publisher or the attendance makes; the export's version. */
  readonly version: number;
  /** `endAt`, or `startAt` plus the default duration: when the event stops taking place. */
  readonly activeUntil: string;
}

export interface AttendeeRecord {
  readonly uid: string;
  /** The per-event hash the owner sees instead of the uid. */
  readonly memberId: string;
  readonly displayName: string | null;
  readonly joinedAt: string;
}

/** What one transaction writes besides answering. */
export interface EventMutation {
  readonly record?: UserEventRecord;
  readonly setAttendee?: AttendeeRecord;
  readonly deleteAttendeeUid?: string;
}

/**
 * User events and their attendees. Only the agent service reaches the store; the service layer holds every
 * rule, the store only keeps the records consistent.
 */
export interface UserEventStore {
  create(record: UserEventRecord): Promise<void>;
  get(id: string): Promise<UserEventRecord | null>;
  /** Events still taking place at `from` or later (`activeUntil >= from`), any status and visibility, soonest to end first. */
  listActive(from: string, limit: number): Promise<UserEventRecord[]>;
  listOwned(uid: string): Promise<UserEventRecord[]>;
  listJoined(uid: string): Promise<UserEventRecord[]>;
  /**
   * Read-modify-write of one event and its attendees under a transaction. `fn` sees the current record (null when
   * there is none), may throw to abort, and returns what to write together with the answer.
   */
  transact<T>(id: string, fn: (record: UserEventRecord | null) => EventMutation & { readonly result: T }): Promise<T>;
  /** The attendees in join order. */
  listAttendees(id: string): Promise<AttendeeRecord[]>;
}

/** Development and test store; a Cloud Run instance never uses it for real users. */
export class InMemoryUserEventStore implements UserEventStore {
  private readonly events = new Map<string, { record: UserEventRecord; readonly attendees: Map<string, AttendeeRecord> }>();

  async create(record: UserEventRecord): Promise<void> {
    this.events.set(record.id, { record, attendees: new Map() });
  }

  async get(id: string): Promise<UserEventRecord | null> {
    return this.events.get(id)?.record ?? null;
  }

  async listActive(from: string, limit: number): Promise<UserEventRecord[]> {
    return [...this.events.values()].map((entry) => entry.record).filter((record) => record.activeUntil >= from)
      .sort((a, b) => a.activeUntil.localeCompare(b.activeUntil) || a.id.localeCompare(b.id)).slice(0, limit);
  }

  async listOwned(uid: string): Promise<UserEventRecord[]> {
    return [...this.events.values()].map((entry) => entry.record).filter((record) => record.ownerUid === uid);
  }

  async listJoined(uid: string): Promise<UserEventRecord[]> {
    return [...this.events.values()].map((entry) => entry.record).filter((record) => record.attendeeUids.includes(uid));
  }

  async transact<T>(id: string, fn: (record: UserEventRecord | null) => EventMutation & { readonly result: T }): Promise<T> {
    const entry = this.events.get(id);
    const mutation = fn(entry?.record ?? null);
    if (mutation.record !== undefined) {
      if (entry === undefined) this.events.set(id, { record: mutation.record, attendees: new Map() });
      else entry.record = mutation.record;
    }
    const target = this.events.get(id);
    if (target !== undefined) {
      if (mutation.setAttendee !== undefined) target.attendees.set(mutation.setAttendee.uid, mutation.setAttendee);
      if (mutation.deleteAttendeeUid !== undefined) target.attendees.delete(mutation.deleteAttendeeUid);
    }
    return mutation.result;
  }

  async listAttendees(id: string): Promise<AttendeeRecord[]> {
    return [...(this.events.get(id)?.attendees.values() ?? [])].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.uid.localeCompare(b.uid));
  }
}
