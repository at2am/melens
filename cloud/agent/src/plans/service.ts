import { AgentServiceError } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import type { SessionStore } from '../sessions/store.js';
import { PLAN_LIMITS, savePlanBodySchema, turnIdOfCard, type SavedPlan } from './schemas.js';
import type { PlanStore } from './store.js';

export interface PlanServiceOptions {
  readonly store: PlanStore;
  /** Where the cards come from: a plan is always copied from the user's own stored turn. */
  readonly sessions: SessionStore;
  /** Every save or delete of a uid counts; reads are free. */
  readonly writeLimiter: RateLimiter;
  readonly clock?: () => Date;
}

/** Saving, listing and removing a uid's plans (agent-protocol.md, Saved plans). */
export class PlanService {
  private readonly store: PlanStore;
  private readonly sessions: SessionStore;
  private readonly writeLimiter: RateLimiter;
  private readonly clock: () => Date;

  constructor(options: PlanServiceOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.writeLimiter = options.writeLimiter;
    this.clock = options.clock ?? (() => new Date());
  }

  async list(uid: string): Promise<SavedPlan[]> {
    return this.store.list(uid, PLAN_LIMITS.maxPlans);
  }

  /**
   * Keeps a plan card of one of the uid's sessions. The card is read from the stored turn, so its sources stay
   * the ones the server verified. Saving a card again returns the plan already kept.
   */
  async save(uid: string, body: unknown): Promise<SavedPlan> {
    const parsed = savePlanBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const { sessionId, cardId } = parsed.data;
    const existing = await this.store.get(uid, cardId);
    if (existing !== null) return existing;
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    const turnId = turnIdOfCard(cardId);
    const turn = turnId === null ? null : await this.sessions.getTurn(uid, sessionId, turnId);
    const card = turn?.cards.find((candidate) => candidate.id === cardId);
    if (turn === null || card === undefined) throw new AgentServiceError('notFound');
    if (card.type !== 'plan') throw new AgentServiceError('invalidRequest', 'not_a_plan');
    if ((await this.store.list(uid, PLAN_LIMITS.maxPlans)).length >= PLAN_LIMITS.maxPlans) {
      throw new AgentServiceError('conflict', 'plan_limit');
    }
    const route = turn.uiActions.findLast((action) => action.action === 'draw_route')?.args;
    const plan: SavedPlan = { id: card.id, sessionId, turnId: turn.id, savedAt: now.toISOString(), card,
      ...(route === undefined ? {} : { route }) };
    await this.store.put(uid, plan);
    return plan;
  }

  async remove(uid: string, planId: string): Promise<void> {
    if (!this.writeLimiter.allow(uid, this.clock())) throw new AgentServiceError('rateLimited');
    if (!await this.store.delete(uid, planId)) throw new AgentServiceError('notFound');
  }
}
