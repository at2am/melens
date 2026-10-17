import { AgentServiceError, type Card, type CardItem, type LatLng, type StopParking } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import type { RoutesClient } from '../routes/routes-client.js';
import type { SessionStore } from '../sessions/store.js';
import { PLAN_LIMITS, editPlanBodySchema, refreshStopBodySchema, savePlanBodySchema, turnIdOfCard, type SavedPlan } from './schemas.js';
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
  /** Draws an edited plan's route again (`edit`); without it the edited plan drops its route. */
  readonly routes?: RoutesClient | null | undefined;
  readonly clock?: () => Date;
}

/** Saving, listing and removing a uid's plans (agent-protocol.md, Saved plans). */
export class PlanService {
  private readonly store: PlanStore;
  private readonly sessions: SessionStore;
  private readonly writeLimiter: RateLimiter;
  private readonly refreshParking: PlanServiceOptions['refreshParking'];
  private readonly routes: RoutesClient | null;
  private readonly clock: () => Date;

  constructor(options: PlanServiceOptions) {
    this.store = options.store;
    this.sessions = options.sessions;
    this.writeLimiter = options.writeLimiter;
    this.refreshParking = options.refreshParking ?? null;
    this.routes = options.routes ?? null;
    this.clock = options.clock ?? (() => new Date());
  }

  async list(uid: string): Promise<SavedPlan[]> {
    return this.store.list(uid, PLAN_LIMITS.maxPlans);
  }

  /** The card of the uid's saved plan `planId`, which a `refine` turn changes; null when there is none. */
  async card(uid: string, planId: string): Promise<Card | null> {
    return (await this.store.get(uid, planId))?.card ?? null;
  }

  /**
   * Keeps a plan card of one of the uid's sessions. The card is read from the stored turn, so its sources stay
   * the ones the server verified. Saving a card again returns the plan already kept. A card that `replaces` a
   * saved plan, such as the plan it revises, takes that plan's place in the list and removes it.
   */
  async save(uid: string, body: unknown): Promise<SavedPlan> {
    const parsed = savePlanBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const { sessionId, cardId, replaces } = parsed.data;
    const existing = await this.store.get(uid, cardId);
    if (existing !== null) return existing;
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    const turnId = turnIdOfCard(cardId);
    const turn = turnId === null ? null : await this.sessions.getTurn(uid, sessionId, turnId);
    const card = turn?.cards.find((candidate) => candidate.id === cardId);
    if (turn === null || card === undefined) throw new AgentServiceError('notFound');
    if (card.type !== 'plan') throw new AgentServiceError('invalidRequest', 'not_a_plan');
    // A plan removed in the meantime holds no place: the card is saved as a new plan.
    const replaced = replaces === undefined ? null : await this.store.get(uid, replaces);
    if (replaced === null && (await this.store.list(uid, PLAN_LIMITS.maxPlans)).length >= PLAN_LIMITS.maxPlans) {
      throw new AgentServiceError('conflict', 'plan_limit');
    }
    const route = turn.uiActions.findLast((action) => action.action === 'draw_route')?.args;
    const plan: SavedPlan = { id: card.id, sessionId, turnId: turn.id, savedAt: replaced?.savedAt ?? now.toISOString(),
      ...(replaced === null ? {} : { updatedAt: now.toISOString() }), card, ...(route === undefined ? {} : { route }) };
    if (replaced === null) await this.store.put(uid, plan);
    else await this.store.replace(uid, replaced.id, plan);
    return plan;
  }

  /**
   * The user's own edits of a saved plan: a new title, or some of its stops in a new order. No model runs and every
   * kept stop keeps its source. A stop whose stop before it changed loses its getting_there, which described the old
   * leg. A plan with a route gets it computed again through its located stops in their new order, and each leg gives
   * the stop it reaches its time; a route that cannot be computed is dropped rather than left wrong. `done` marks how far
   * the user has got; stops that move or go start the progress again, unless the same edit gives `done`. Counts as a write.
   */
  async edit(uid: string, planId: string, body: unknown, signal: AbortSignal): Promise<SavedPlan> {
    const parsed = editPlanBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const plan = await this.store.get(uid, planId);
    if (plan === null) throw new AgentServiceError('notFound');
    const { title, stops, done } = parsed.data;
    const items = plan.card.items;
    if (stops?.some((index) => index >= items.length) === true) throw new AgentServiceError('invalidRequest', 'no_stop');
    if (done !== undefined && done > (stops ?? items).length) throw new AgentServiceError('invalidRequest', 'no_stop');
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    const moved = stops !== undefined && (stops.length !== items.length || stops.some((index, position) => index !== position));
    let edited: CardItem[] = items;
    let route = plan.route;
    if (moved) {
      edited = stops.map((index, position) => {
        const item = items[index]!;
        const samePrevious = position === 0 ? index === 0 : stops[position - 1] === index - 1;
        if (samePrevious) return item;
        const { getting_there: _gettingThere, ...rest } = item;
        return rest;
      });
      ({ items: edited, route } = await this.reroute(plan.route, edited, signal));
    }
    // The plan may have been removed while the route was computed; an edit never brings it back.
    if (await this.store.get(uid, planId) === null) throw new AgentServiceError('notFound');
    const { route: _route, done: previousDone, ...rest } = plan;
    const progress = done ?? (moved ? undefined : previousDone);
    const updated: SavedPlan = { ...rest, updatedAt: now.toISOString(),
      card: { ...plan.card, ...(title === undefined ? {} : { title }), items: edited }, ...(route === undefined ? {} : { route }),
      ...(progress === undefined || progress === 0 ? {} : { done: progress }) };
    await this.store.put(uid, updated);
    return updated;
  }

  /** The route through `items` in their order, in the mode of the plan's route, or none. */
  private async reroute(previous: Record<string, unknown> | undefined, items: CardItem[], signal: AbortSignal):
    Promise<{ items: CardItem[]; route?: Record<string, unknown> }> {
    if (previous === undefined || this.routes === null) return { items };
    const mode = previous.mode === 'transit' ? 'transit' : 'walk';
    const located = items.flatMap((item, index) => item.location === undefined ? [] : [{ index, point: item.location, label: item.title }]);
    // Transit routes run between two points only (draw_route).
    if (located.length < 2 || (mode === 'transit' && located.length !== 2)) return { items };
    let computed;
    try {
      computed = await this.routes.compute({ waypoints: located.map(({ point }) => point), mode, signal });
    } catch (error) {
      if (signal.aborted) throw error;
      return { items };
    }
    const timed = [...items];
    for (const leg of computed.legs) {
      const stop = located[leg.to];
      if (stop === undefined || timed[stop.index]!.getting_there !== undefined) continue;
      timed[stop.index] = { ...timed[stop.index]!, getting_there: `${leg.duration_min} min ${mode === 'walk' ? 'walk' : 'by public transport'}` };
    }
    return { items: timed, route: { polyline: computed.polyline, mode, distance_m: computed.distance_m, duration_min: computed.duration_min,
      waypoints: located.map(({ point, label }) => ({ ...point, label })) } };
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
