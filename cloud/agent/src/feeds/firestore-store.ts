import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';

import { feedListSchema } from './schemas.js';
import type { FeedStore } from './store.js';

const recordSchema = z.object({ feeds: feedListSchema, updatedAt: z.iso.datetime() });

/**
 * Feed subscriptions in the project's Firestore database: one document `userFeeds/{uid}` holding the whole
 * list. Only the agent service reads or writes it; client rules deny all access.
 */
export function createFirestoreFeedStore(options: { readonly projectId: string; readonly databaseId: string }): FeedStore {
  let firestore: Promise<Firestore> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    return options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
  })();

  const doc = (db: Firestore, uid: string) => db.collection('userFeeds').doc(uid);

  return {
    async get(uid) {
      const data = (await doc(await load(), uid).get()).data();
      if (data === undefined) return null;
      // A list another writer left malformed reads as never saved, so the app falls back to its defaults.
      const parsed = recordSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    async put(uid, record) {
      await doc(await load(), uid).set({ feeds: record.feeds.map((feed) => ({ ...feed })), updatedAt: record.updatedAt });
    },
  };
}
