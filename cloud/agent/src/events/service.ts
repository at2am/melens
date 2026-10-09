import { createHash } from 'node:crypto';

import { haversineMeters } from '../features/compact.js';
import { AgentServiceError } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import { newId } from '../sessions/store.js';
import { EVENT_LIMITS, MELBOURNE_TIMEZONE, discoverQuerySchema, eventDraftSchema, eventPatchSchema, joinBodySchema,
  type ConflictReason, type EventDraft, type EventPatch, type EventView, type MembersView } from './schemas.js';
import type { AttendeeRecord, UserEventRecord, UserEventStore } from './store.js';

export interface UserEventServiceOptions {
  readonly store: UserEventStore;
  /** Every write of a uid counts; reads are free. */
  readonly writeLimiter: RateLimiter;
  readonly clock?: () => Date;
}

function conflict(reason: ConflictReason): AgentServiceError {
  return new AgentServiceError('conflict', reason);
}

function instantOf(value: string): string {
  return new Date(value).toISOString();
}

/** The per-event name of a member: the owner never sees a uid. */
export function memberIdOf(eventId: string, uid: string): string {
  return `m_${createHash('sha256').update(`${eventId}:${uid}`).digest('base64url').slice(0, 16)}`;
}

function activeUntilOf(startAt: string, endAt: string | null): string {
  return endAt ?? new Date(new Date(startAt).getTime() + EVENT_LIMITS.defaultDurationMs).toISOString();
}

/** The rules a start and end must meet when they are set; a start kept from before may stay in the past. */
function checkTimes(startAt: string, endAt: string | null, now: Date, options: { readonly startChanged: boolean }): void {
  const start = new Date(startAt).getTime();
  if (options.startChanged && (start < now.getTime() - EVENT_LIMITS.pastStartMs || start > now.getTime() + EVENT_LIMITS.aheadMs)) {
    throw new AgentServiceError('invalidRequest');
  }
  if (endAt !== null) {
    const end = new Date(endAt).getTime();
    if (end <= start || end - start > EVENT_LIMITS.durationMs) throw new AgentServiceError('invalidRequest');
  }
}

function nameOf(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function startsFirst(a: UserEventRecord, b: UserEventRecord): number {
  return a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id);
}

/** Publishing, discovering, joining and managing user events (agent-protocol.md, User events). */
export class UserEventService {
  private readonly store: UserEventStore;
  private readonly writeLimiter: RateLimiter;
  private readonly clock: () => Date;

  constructor(options: UserEventServiceOptions) {
    this.store = options.store;
    this.writeLimiter = options.writeLimiter;
    this.clock = options.clock ?? (() => new Date());
  }

  private write(uid: string): Date {
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    return now;
  }

  /** What a reader may see: a removed event is gone for everyone, a hidden one for everyone but its owner. */
  private visibleTo(record: UserEventRecord | null, uid: string): record is UserEventRecord {
    if (record === null || record.status === 'removed') return false;
    return record.visibility === 'visible' || record.ownerUid === uid;
  }

  private viewOf(record: UserEventRecord, uid: string): EventView {
    if (record.status === 'removed') throw new AgentServiceError('notFound');
    return { id: record.id, title: record.title, description: record.description, point: record.point, placeName: record.placeName,
      startAt: record.startAt, endAt: record.endAt, timezone: MELBOURNE_TIMEZONE, anonymousAttendance: record.anonymousAttendance,
      capacity: record.capacity, status: record.status, attendeeCount: record.attendeeUids.length,
      createdAt: record.createdAt, updatedAt: record.updatedAt, version: record.version,
      viewer: { isOwner: record.ownerUid === uid, joined: record.attendeeUids.includes(uid) } };
  }

  async publish(uid: string, body: unknown): Promise<EventView> {
    const parsed = eventDraftSchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const draft: EventDraft = parsed.data;
    const now = this.write(uid);
    const startAt = instantOf(draft.startAt);
    const endAt = draft.endAt == null ? null : instantOf(draft.endAt);
    checkTimes(startAt, endAt, now, { startChanged: true });
    const stamp = now.toISOString();
    const record: UserEventRecord = { id: newId('ue'), ownerUid: uid, title: draft.title, description: draft.description, point: draft.point,
      placeName: nameOf(draft.placeName), startAt, endAt, timezone: MELBOURNE_TIMEZONE, anonymousAttendance: draft.anonymousAttendance ?? false,
      capacity: draft.capacity ?? null, status: 'published', visibility: 'visible', attendeeUids: [], createdAt: stamp, updatedAt: stamp,
      version: 1, activeUntil: activeUntilOf(startAt, endAt) };
    await this.store.create(record);
    return this.viewOf(record, uid);
  }

  async discover(uid: string, query: unknown): Promise<EventView[]> {
    const parsed = discoverQuerySchema.safeParse(query);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const box = parsed.data;
    if (haversineMeters({ lat: box.south, lng: box.west }, { lat: box.south, lng: box.east }) > EVENT_LIMITS.bboxSideMetres
      || haversineMeters({ lat: box.south, lng: box.west }, { lat: box.north, lng: box.west }) > EVENT_LIMITS.bboxSideMetres) {
      throw new AgentServiceError('invalidRequest');
    }
    const now = this.clock();
    const from = box.from === undefined ? now.toISOString() : instantOf(box.from);
    const to = box.to === undefined ? new Date(new Date(from).getTime() + EVENT_LIMITS.discoverSpanMs).toISOString() : instantOf(box.to);
    if (from >= to) throw new AgentServiceError('invalidRequest');
    const candidates = await this.store.listActive(from, EVENT_LIMITS.discoverScan);
    return candidates.filter((record) => this.visibleTo(record, uid) && record.visibility === 'visible' && record.startAt < to
      && record.point.lat <= box.north && record.point.lat >= box.south && record.point.lng <= box.east && record.point.lng >= box.west)
      .sort(startsFirst).slice(0, EVENT_LIMITS.discoverLimit).map((record) => this.viewOf(record, uid));
  }

  async mine(uid: string): Promise<{ readonly owned: EventView[]; readonly joined: EventView[] }> {
    const [owned, joined] = await Promise.all([this.store.listOwned(uid), this.store.listJoined(uid)]);
    const views = (records: UserEventRecord[]) => records.filter((record) => this.visibleTo(record, uid)).sort(startsFirst)
      .map((record) => this.viewOf(record, uid));
    return { owned: views(owned), joined: views(joined.filter((record) => record.ownerUid !== uid)) };
  }

  async get(uid: string, id: string): Promise<EventView> {
    const record = await this.store.get(id);
    if (!this.visibleTo(record, uid)) throw new AgentServiceError('notFound');
    return this.viewOf(record, uid);
  }

  /** The owner's event, or `notFound` for a stranger (never `forbidden` on an invisible one) and `forbidden` for a visible one. */
  private owned(record: UserEventRecord | null, uid: string): UserEventRecord {
    if (!this.visibleTo(record, uid)) throw new AgentServiceError('notFound');
    if (record.ownerUid !== uid) throw new AgentServiceError('forbidden');
    return record;
  }

  async update(uid: string, id: string, body: unknown): Promise<EventView> {
    const parsed = eventPatchSchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const patch: EventPatch = parsed.data;
    const now = this.write(uid);
    return this.store.transact(id, (current) => {
      const record = this.owned(current, uid);
      const startAt = patch.startAt === undefined ? record.startAt : instantOf(patch.startAt);
      const endAt = patch.endAt === undefined ? record.endAt : patch.endAt === null ? null : instantOf(patch.endAt);
      checkTimes(startAt, endAt, now, { startChanged: startAt !== record.startAt });
      const next: UserEventRecord = { ...record,
        title: patch.title ?? record.title,
        description: patch.description ?? record.description,
        point: patch.point ?? record.point,
        placeName: patch.placeName === undefined ? record.placeName : nameOf(patch.placeName),
        startAt, endAt, activeUntil: activeUntilOf(startAt, endAt),
        anonymousAttendance: patch.anonymousAttendance ?? record.anonymousAttendance,
        capacity: patch.capacity === undefined ? record.capacity : patch.capacity,
        updatedAt: now.toISOString(), version: record.version + 1 };
      if (next.capacity !== null && next.capacity < next.attendeeUids.length) throw new AgentServiceError('invalidRequest');
      return { record: next, result: this.viewOf(next, uid) };
    });
  }

  async cancel(uid: string, id: string): Promise<EventView> {
    const now = this.write(uid);
    return this.store.transact(id, (current) => {
      const record = this.owned(current, uid);
      if (record.status === 'cancelled') return { result: this.viewOf(record, uid) };
      const next: UserEventRecord = { ...record, status: 'cancelled', updatedAt: now.toISOString(), version: record.version + 1 };
      return { record: next, result: this.viewOf(next, uid) };
    });
  }

  async remove(uid: string, id: string): Promise<void> {
    const now = this.write(uid);
    await this.store.transact(id, (current) => {
      const record = this.owned(current, uid);
      const next: UserEventRecord = { ...record, status: 'removed', updatedAt: now.toISOString(), version: record.version + 1 };
      return { record: next, result: undefined };
    });
  }

  async join(uid: string, id: string, body: unknown): Promise<EventView> {
    const parsed = joinBodySchema.safeParse(body ?? {});
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const displayName = nameOf(parsed.data.displayName);
    const now = this.write(uid);
    return this.store.transact(id, (current) => {
      if (!this.visibleTo(current, uid)) throw new AgentServiceError('notFound');
      const record = current;
      if (record.ownerUid === uid) throw conflict('ownEvent');
      if (record.status === 'cancelled') throw conflict('eventCancelled');
      if (record.activeUntil <= now.toISOString()) throw conflict('eventEnded');
      if (record.attendeeUids.includes(uid)) throw conflict('alreadyJoined');
      if (record.capacity !== null && record.attendeeUids.length >= record.capacity) throw conflict('eventFull');
      const stamp = now.toISOString();
      const attendee: AttendeeRecord = { uid, memberId: memberIdOf(record.id, uid), displayName, joinedAt: stamp };
      const next: UserEventRecord = { ...record, attendeeUids: [...record.attendeeUids, uid], updatedAt: stamp, version: record.version + 1 };
      return { record: next, setAttendee: attendee, result: this.viewOf(next, uid) };
    });
  }

  async leave(uid: string, id: string): Promise<EventView> {
    const now = this.write(uid);
    return this.store.transact(id, (current) => {
      if (!this.visibleTo(current, uid)) throw new AgentServiceError('notFound');
      const record = current;
      if (!record.attendeeUids.includes(uid)) throw conflict('notJoined');
      const next: UserEventRecord = { ...record, attendeeUids: record.attendeeUids.filter((member) => member !== uid),
        updatedAt: now.toISOString(), version: record.version + 1 };
      return { record: next, deleteAttendeeUid: uid, result: this.viewOf(next, uid) };
    });
  }

  async members(uid: string, id: string): Promise<MembersView> {
    const record = this.owned(await this.store.get(id), uid);
    if (record.anonymousAttendance) return { count: record.attendeeUids.length, members: null };
    // The event's own list is the join order; the attendee documents carry the names.
    const attendees = new Map((await this.store.listAttendees(id)).map((attendee) => [attendee.uid, attendee]));
    return { count: record.attendeeUids.length, members: record.attendeeUids.flatMap((uid) => {
      const attendee = attendees.get(uid);
      return attendee === undefined ? [] : [{ memberId: attendee.memberId, displayName: attendee.displayName, joinedAt: attendee.joinedAt }];
    }) };
  }

  async removeMember(uid: string, id: string, memberId: string): Promise<void> {
    const now = this.write(uid);
    const attendees = await this.store.listAttendees(id);
    await this.store.transact(id, (current) => {
      const record = this.owned(current, uid);
      if (record.anonymousAttendance) throw conflict('anonymousEvent');
      const member = attendees.find((attendee) => attendee.memberId === memberId && record.attendeeUids.includes(attendee.uid));
      if (member === undefined) throw new AgentServiceError('notFound');
      const next: UserEventRecord = { ...record, attendeeUids: record.attendeeUids.filter((attendee) => attendee !== member.uid),
        updatedAt: now.toISOString(), version: record.version + 1 };
      return { record: next, deleteAttendeeUid: member.uid, result: undefined };
    });
  }
}
