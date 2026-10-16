import { AgentServiceError, type LatLng, type StopParking } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import type { SessionStore } from '../sessions/store.js';
import { PLAN_LIMITS, refreshStopBodySchema, savePlanBodySchema, turnIdOfCard, type SavedPlan } from './schemas.js';
import type { PlanStore } from './store.js';

export interface PlanServiceOptions {
  readonly store: PlanStore;
  /** Where the cards come from: a plan is always copied from the user's own stored turn. */
  readonly sessions: SessionStore;
  /** Every save or delete of a uid counts; reads are free. */
  readonly writeLimiter: RateLimiter;
  /** Reads the live parking around a stop again (`refreshStopParking`); without it a refresh answers `serviceUnavailable`. */
  readonly refreshParking?: ((request: { readonly uid: string; readonly point: LatLng; readonly name: string;
    readonly previous?: StopParking | undefined; readonly signal: AbortSignal }) => Promise<StopParking>) | null;
  readonly clock?: () => Date;
}

/** Saving, listing and removing a uid's plans (agent-protocol.md, Saved plans). */
export class PlanService {
  private readonly store: PlanStore;
  private readonly sessions: SessionStore;
  private readonly writeLimiter: RateLimiter;
  private readonly refreshParking: PlanServiceOptions['refreshParking'];
  private readonly clock: () => Date;

  constructor(options: PlanServiceOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.writeLimiter = options.writeLimiter;
    this.refreshParking = options.refreshParking ?? null;
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

  /**
   * Reads one live part of a saved plan's stop again and keeps it with the plan: today the parking around the stop,
   * for a user who reached the previous stop and drives on. Any located stop can be refreshed, also in a plan that was
   * not driven, so a user who changes their mind gets parking too. Counts as a write.
   */
  async refreshStop(uid: string, planId: string, index: number, body: unknown, signal: AbortSignal): Promise<SavedPlan> {
    const parsed = refreshStopBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const plan = await this.store.get(uid, planId);
    const item = plan?.card.items[index];
    if (plan === null || item === undefined) throw new AgentServiceError('notFound');
    const point = item.location;
    if (point === undefined) throw new AgentServiceError('invalidRequest', 'no_location');
    if (this.refreshParking == null) throw new AgentServiceError('serviceUnavailable');
    if (!this.writeLimiter.allow(uid, this.clock())) throw new AgentServiceError('rateLimited');
    const parking = await this.refreshParking({ uid, point, name: item.title, previous: item.stop_parking, signal });
    // The plan may have been removed while the sensors were read; a refresh never brings it back.
    if (await this.store.get(uid, planId) === null) throw new AgentServiceError('notFound');
    const refreshed: SavedPlan = { ...plan, card: { ...plan.card,
      items: plan.card.items.map((stop, position) => position === index ? { ...stop, stop_parking: parking } : stop) } };
    await this.store.put(uid, refreshed);
    return refreshed;
  }

  async remove(uid: string, planId: string): Promise<void> {
    if (!this.writeLimiter.allow(uid, this.clock())) throw new AgentServiceError('rateLimited');
    if (!await this.store.delete(uid, planId)) throw new AgentServiceError('notFound');
  }
}
