import type { SavedPlan } from './schemas.js';

/** Saved plans per uid. Only the agent service reaches the store; the service checks every rule. */
export interface PlanStore {
  /** Newest first, at most `limit`. */
  list(uid: string, limit: number): Promise<SavedPlan[]>;
  get(uid: string, planId: string): Promise<SavedPlan | null>;
  put(uid: string, plan: SavedPlan): Promise<void>;
  /** False when there was nothing to delete. */
  delete(uid: string, planId: string): Promise<boolean>;
}

/** Development and test store; a Cloud Run instance never uses it for real users. */
export class InMemoryPlanStore implements PlanStore {
  private readonly plans = new Map<string, Map<string, SavedPlan>>();

  private user(uid: string): Map<string, SavedPlan> {
    let plans = this.plans.get(uid);
    if (plans === undefined) { plans = new Map(); this.plans.set(uid, plans); }
    return plans;
  }

  async list(uid: string, limit: number): Promise<SavedPlan[]> {
    return [...this.user(uid).values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, limit);
  }

  async get(uid: string, planId: string): Promise<SavedPlan | null> {
    return this.user(uid).get(planId) ?? null;
  }

  async put(uid: string, plan: SavedPlan): Promise<void> {
    this.user(uid).set(plan.id, plan);
  }

  async delete(uid: string, planId: string): Promise<boolean> {
    return this.user(uid).delete(planId);
  }
}
