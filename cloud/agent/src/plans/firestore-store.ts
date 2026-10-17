import type { Firestore } from 'firebase-admin/firestore';

import { savedPlanSchema } from './schemas.js';
import type { PlanStore } from './store.js';

/**
 * Saved plans in the project's Firestore database: `userPlans/{uid}/plans/{planId}`, one document per plan.
 * Only the agent service reads or writes them; client rules deny all access. Plans have no TTL: the user
 * removes them.
 */
export function createFirestorePlanStore(options: { readonly projectId: string; readonly databaseId: string }): PlanStore {
  let firestore: Promise<Firestore> | null = null;
  const load = () => firestore ??= (async () => {
    const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/firestore')]);
    const app = getApps()[0] ?? initializeApp({ projectId: options.projectId });
    return options.databaseId === '(default)' ? getFirestore(app) : getFirestore(app, options.databaseId);
  })();

  const plans = (db: Firestore, uid: string) => db.collection('userPlans').doc(uid).collection('plans');

  return {
    async list(uid, limit) {
      const all = await plans(await load(), uid).orderBy('savedAt', 'desc').limit(limit).get();
      // A document another writer left malformed is skipped rather than failing the whole list.
      return all.docs.flatMap((doc) => {
        const parsed = savedPlanSchema.safeParse(doc.data());
        return parsed.success ? [parsed.data] : [];
      });
    },
    async get(uid, planId) {
      const data = (await plans(await load(), uid).doc(planId).get()).data();
      if (data === undefined) return null;
      const parsed = savedPlanSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    async put(uid, plan) {
      await plans(await load(), uid).doc(plan.id).set(JSON.parse(JSON.stringify(plan)) as Record<string, unknown>);
    },
    async replace(uid, replacedId, plan) {
      const db = await load();
      const batch = db.batch();
      batch.delete(plans(db, uid).doc(replacedId));
      batch.set(plans(db, uid).doc(plan.id), JSON.parse(JSON.stringify(plan)) as Record<string, unknown>);
      await batch.commit();
    },
    async delete(uid, planId) {
      const ref = plans(await load(), uid).doc(planId);
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      return true;
    },
  };
}
