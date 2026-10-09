import type { Firestore, Timestamp } from 'firebase-admin/firestore';

import { sessionSummarySchema, storedTurnSchema, type SessionSummary, type StoredTurn } from '../protocol/schemas.js';
import { SESSION_LIMITS, newId, sessionTitle, summaryOf, type LeaseResult, type SessionRecord, type SessionStore } from './store.js';

/**
 * Sessions in the project's Firestore database: `users/{uid}/sessions/{sessionId}` with a `turns`
 * subcollection. Only the agent service reads or writes them; client rules deny all access.
 * `expiresAtTs` carries the TTL policy.
 */
export function createFirestoreSessionStore(options: { readonly projectId: string; readonly databaseId: string }): SessionStore {
  let firestore: Promise<{ db: Firestore; timestamp: (date: Date) => Timestamp }> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore, Timestamp: TimestampClass }] =
      await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    const db = options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
    return { db, timestamp: (date: Date) => TimestampClass.fromDate(date) };
  })();

  const sessions = (db: Firestore, uid: string) => db.collection('users').doc(uid).collection('sessions');

  function recordOf(uid: string, data: Record<string, unknown>): SessionRecord {
    const summary: SessionSummary = sessionSummarySchema.parse({ id: data.id, title: data.title, createdAt: data.createdAt,
      updatedAt: data.updatedAt, turnCount: data.turnCount });
    return { ...summary, uid, pendingQuestion: (data.pendingQuestion as SessionRecord['pendingQuestion']) ?? null,
      activeTurn: (data.activeTurn as SessionRecord['activeTurn']) ?? null, expiresAt: String(data.expiresAt) };
  }

  function docOf(record: SessionRecord, timestamp: (date: Date) => Timestamp): Record<string, unknown> {
    return { id: record.id, title: record.title, createdAt: record.createdAt, updatedAt: record.updatedAt, turnCount: record.turnCount,
      pendingQuestion: record.pendingQuestion, activeTurn: record.activeTurn, expiresAt: record.expiresAt,
      expiresAtTs: timestamp(new Date(record.expiresAt)) };
  }

  return {
    async create(uid, now) {
      const { db, timestamp } = await load();
      const stamp = now.toISOString();
      const record: SessionRecord = { id: newId('s'), uid, title: '', createdAt: stamp, updatedAt: stamp, turnCount: 0,
        pendingQuestion: null, activeTurn: null, expiresAt: new Date(now.getTime() + SESSION_LIMITS.ttlMs).toISOString() };
      await sessions(db, uid).doc(record.id).set(docOf(record, timestamp));
      const all = await sessions(db, uid).orderBy('updatedAt', 'asc').get();
      const excess = all.docs.length - SESSION_LIMITS.sessionsPerUser;
      for (const doc of all.docs.slice(0, Math.max(0, excess))) await db.recursiveDelete(doc.ref);
      return record;
    },
    async list(uid) {
      const { db } = await load();
      const all = await sessions(db, uid).orderBy('updatedAt', 'desc').limit(SESSION_LIMITS.sessionsPerUser).get();
      return all.docs.map((doc) => summaryOf(recordOf(uid, doc.data())));
    },
    async get(uid, sessionId) {
      const { db } = await load();
      const doc = await sessions(db, uid).doc(sessionId).get();
      const data = doc.data();
      return data === undefined ? null : recordOf(uid, data);
    },
    async delete(uid, sessionId) {
      const { db } = await load();
      const ref = sessions(db, uid).doc(sessionId);
      if (!(await ref.get()).exists) return false;
      await db.recursiveDelete(ref);
      return true;
    },
    async listTurns(uid, sessionId, limit) {
      const { db } = await load();
      let query = sessions(db, uid).doc(sessionId).collection('turns').orderBy('seq', 'asc');
      if (limit !== undefined) query = query.limitToLast(limit);
      const all = await query.get();
      return all.docs.map((doc) => { const { expiresAtTs: _ttl, ...turn } = doc.data(); return storedTurnSchema.parse(turn); });
    },
    async acquireTurn(uid, sessionId, turnId, now): Promise<LeaseResult> {
      const { db } = await load();
      const ref = sessions(db, uid).doc(sessionId);
      return db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        const data = doc.data();
        if (data === undefined) return 'missing';
        const record = recordOf(uid, data);
        if (record.activeTurn !== null && record.activeTurn.expiresAt > now.toISOString()) return 'busy';
        transaction.update(ref, { activeTurn: { turnId, expiresAt: new Date(now.getTime() + SESSION_LIMITS.leaseMs).toISOString() } });
        return 'acquired';
      });
    },
    async completeTurn(uid, sessionId, turn, now) {
      const { db, timestamp } = await load();
      const ref = sessions(db, uid).doc(sessionId);
      const expiresAt = new Date(now.getTime() + SESSION_LIMITS.ttlMs);
      const turnCount = await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(ref);
        const data = doc.data();
        if (data === undefined) return 0;
        const record = recordOf(uid, data);
        transaction.set(ref.collection('turns').doc(turn.id), { ...turn, expiresAtTs: timestamp(expiresAt) });
        transaction.update(ref, { title: record.title === '' && turn.input.kind === 'text' ? sessionTitle(turn.input.text) : record.title,
          turnCount: record.turnCount + 1, updatedAt: now.toISOString(), pendingQuestion: turn.question, activeTurn: null,
          expiresAt: expiresAt.toISOString(), expiresAtTs: timestamp(expiresAt) });
        return record.turnCount + 1;
      });
      const excess = turnCount - SESSION_LIMITS.turnsPerSession;
      if (excess > 0) {
        const oldest = await ref.collection('turns').orderBy('seq', 'asc').limit(excess).get();
        for (const doc of oldest.docs) await doc.ref.delete();
      }
    },
    async releaseTurn(uid, sessionId, turnId) {
      const { db } = await load();
      const ref = sessions(db, uid).doc(sessionId);
      await db.runTransaction(async (transaction) => {
        const data = (await transaction.get(ref)).data();
        if (data === undefined) return;
        const active = data.activeTurn as SessionRecord['activeTurn'];
        if (active?.turnId === turnId) transaction.update(ref, { activeTurn: null });
      });
    },
  };
}
