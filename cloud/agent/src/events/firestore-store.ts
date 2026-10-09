import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { z } from 'zod';

import { latLngSchema } from '../protocol/schemas.js';
import { EVENT_LIMITS, eventStatusSchema, eventVisibilitySchema } from './schemas.js';
import type { AttendeeRecord, EventMutation, UserEventRecord, UserEventStore } from './store.js';

const instant = z.iso.datetime();

const recordSchema = z.object({
  id: z.string().min(1), ownerUid: z.string().min(1), title: z.string(), description: z.string(), point: latLngSchema,
  placeName: z.string().nullable(), startAt: instant, endAt: instant.nullable(), timezone: z.string().min(1),
  anonymousAttendance: z.boolean(), capacity: z.number().int().nullable(), status: eventStatusSchema, visibility: eventVisibilitySchema,
  attendeeUids: z.array(z.string().min(1)), createdAt: instant, updatedAt: instant, version: z.number().int().positive(), activeUntil: instant,
});

const attendeeSchema = z.object({ uid: z.string().min(1), memberId: z.string().min(1), displayName: z.string().nullable(), joinedAt: instant });

/**
 * User events in the project's Firestore database: `userEvents/{eventId}` with an `attendees` subcollection
 * (one document per uid). Only the agent service reads or writes them; client rules deny all access.
 * `expiresAtTs` carries the TTL policy: 90 days after the event stops taking place.
 */
export function createFirestoreUserEventStore(options: { readonly projectId: string; readonly databaseId: string }): UserEventStore {
  let firestore: Promise<{ db: Firestore; timestamp: (date: Date) => Timestamp }> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore, Timestamp: TimestampClass }] =
      await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    const db = options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
    return { db, timestamp: (date: Date) => TimestampClass.fromDate(date) };
  })();

  const events = (db: Firestore) => db.collection('userEvents');

  function recordOf(data: Record<string, unknown>): UserEventRecord {
    return recordSchema.parse(data);
  }

  function docOf(record: UserEventRecord, timestamp: (date: Date) => Timestamp): Record<string, unknown> {
    return { ...record, attendeeUids: [...record.attendeeUids],
      expiresAtTs: timestamp(new Date(new Date(record.activeUntil).getTime() + EVENT_LIMITS.retentionMs)) };
  }

  /** Rows another writer left malformed are skipped rather than failing the whole read. */
  function records(docs: readonly { data(): Record<string, unknown> | undefined }[]): UserEventRecord[] {
    const result: UserEventRecord[] = [];
    for (const doc of docs) {
      const data = doc.data();
      if (data === undefined) continue;
      const parsed = recordSchema.safeParse(data);
      if (parsed.success) result.push(parsed.data);
    }
    return result;
  }

  return {
    async create(record) {
      const { db, timestamp } = await load();
      await events(db).doc(record.id).set(docOf(record, timestamp));
    },
    async get(id) {
      const { db } = await load();
      const data = (await events(db).doc(id).get()).data();
      if (data === undefined) return null;
      const parsed = recordSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    async listActive(from, limit) {
      const { db } = await load();
      const all = await events(db).where('activeUntil', '>=', from).orderBy('activeUntil', 'asc').limit(limit).get();
      return records(all.docs);
    },
    async listOwned(uid) {
      const { db } = await load();
      return records((await events(db).where('ownerUid', '==', uid).get()).docs);
    },
    async listJoined(uid) {
      const { db } = await load();
      return records((await events(db).where('attendeeUids', 'array-contains', uid).get()).docs);
    },
    async transact(id, fn) {
      const { db, timestamp } = await load();
      const ref = events(db).doc(id);
      return db.runTransaction(async (transaction) => {
        const data = (await transaction.get(ref)).data();
        const mutation: EventMutation & { readonly result: unknown } = fn(data === undefined ? null : recordOf(data));
        if (mutation.record !== undefined) transaction.set(ref, docOf(mutation.record, timestamp));
        if (mutation.setAttendee !== undefined) transaction.set(ref.collection('attendees').doc(mutation.setAttendee.uid), { ...mutation.setAttendee });
        if (mutation.deleteAttendeeUid !== undefined) transaction.delete(ref.collection('attendees').doc(mutation.deleteAttendeeUid));
        return mutation.result as ReturnType<typeof fn>['result'];
      });
    },
    async listAttendees(id) {
      const { db } = await load();
      const all = await events(db).doc(id).collection('attendees').orderBy('joinedAt', 'asc').get();
      const result: AttendeeRecord[] = [];
      for (const doc of all.docs) {
        const parsed = attendeeSchema.safeParse(doc.data());
        if (parsed.success) result.push(parsed.data);
      }
      return result;
    },
  };
}
