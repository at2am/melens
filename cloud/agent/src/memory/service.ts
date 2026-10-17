import type { StructuredModel } from '../agent/structured.js';
import { AgentServiceError } from '../protocol/schemas.js';
import type { RateLimiter } from '../rate-limit.js';
import { newId } from '../sessions/store.js';
import { LEARN_SYSTEM, learnPrompt, memoryBlock, memoryChangesSchema, type MemoryChanges } from './prompt.js';
import { MEMORY_LIMITS, SIGNAL_WEIGHTS, browsingSummary, decayed, emptyMemory, memorySettingsBodySchema, signalsBodySchema, viewOf,
  type MemoryFact, type MemoryRecord, type MemoryView } from './schemas.js';
import type { MemoryStore } from './store.js';

export interface MemoryServiceOptions {
  readonly store: MemoryStore;
  /** Every signal batch, setting change and deletion of a uid counts; reads and the updates after a turn are free. */
  readonly writeLimiter: RateLimiter;
  /** The model that reads each exchange for lasting facts; without it the memory keeps only what the user browses. */
  readonly structured: StructuredModel | null;
  readonly clock?: () => Date;
  readonly log?: (line: Record<string, unknown>) => void;
}

function clip(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > MEMORY_LIMITS.factChars ? `${trimmed.slice(0, MEMORY_LIMITS.factChars - 1)}…` : trimmed;
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Applies what the memory model returned to the facts as they are now, which may have changed while it ran: ids it
 * names that are gone are ignored, a fact it adds that is already there is not added twice, and when the memory is
 * full the facts changed longest ago make room.
 */
export function applyChanges(facts: readonly MemoryFact[], changes: MemoryChanges, now: Date): MemoryFact[] {
  const at = now.toISOString();
  const removed = new Set(changes.remove);
  const updates = new Map(changes.update.map((update) => [update.id, update]));
  const kept = facts.filter((fact) => !removed.has(fact.id)).map((fact) => {
    const update = updates.get(fact.id);
    const text = update === undefined ? '' : clip(update.text);
    return text === '' || update === undefined ? fact : { ...fact, kind: update.kind, text, updatedAt: at };
  });
  for (const add of changes.add) {
    const text = clip(add.text);
    if (text === '' || kept.some((fact) => sameText(fact.text, text))) continue;
    kept.push({ id: newId('m'), kind: add.kind, text, updatedAt: at });
  }
  return kept.length <= MEMORY_LIMITS.maxFacts ? kept
    : [...kept].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MEMORY_LIMITS.maxFacts)
      .sort((a, b) => kept.indexOf(a) - kept.indexOf(b));
}

/**
 * The user's memory (agent-protocol.md, Memory): lasting facts the agent learns from each exchange, and what the user
 * browses on the map. The agent reads it at the start of every turn; the user sees, deletes and switches it off.
 */
export class MemoryService {
  private readonly store: MemoryStore;
  private readonly writeLimiter: RateLimiter;
  private readonly structured: StructuredModel | null;
  private readonly clock: () => Date;
  private readonly log: (line: Record<string, unknown>) => void;
  /** The update of each uid running on this instance; the next one waits for it, so one exchange is read at a time. */
  private readonly learning = new Map<string, Promise<void>>();

  constructor(options: MemoryServiceOptions) {
    this.store = options.store;
    this.writeLimiter = options.writeLimiter;
    this.structured = options.structured;
    this.clock = options.clock ?? (() => new Date());
    this.log = options.log ?? (() => {});
  }

  async view(uid: string): Promise<MemoryView> {
    return viewOf(await this.store.get(uid), this.clock());
  }

  /** The block for the turn's message, or null when memory is off or empty. */
  async promptBlock(uid: string): Promise<string | null> {
    return memoryBlock(await this.view(uid));
  }

  /** Switches memory on or off. Off keeps what is remembered but stops using and adding to it. */
  async configure(uid: string, body: unknown): Promise<MemoryView> {
    const parsed = memorySettingsBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const now = this.allowWrite(uid);
    const record = await this.store.update(uid, (current) => ({ ...(current ?? emptyMemory(now)), enabled: parsed.data.enabled,
      updatedAt: now.toISOString() }));
    return viewOf(record, now);
  }

  /** Forgets every fact and all browsing; the on or off setting stays. */
  async clear(uid: string): Promise<void> {
    const now = this.allowWrite(uid);
    await this.store.update(uid, (current) => emptyMemory(now, current?.enabled ?? true));
  }

  async removeFact(uid: string, factId: string): Promise<void> {
    const now = this.allowWrite(uid);
    if (!(await this.store.get(uid))?.facts.some((fact) => fact.id === factId)) throw new AgentServiceError('notFound');
    await this.store.update(uid, (current) => {
      const record = current ?? emptyMemory(now);
      return { ...record, facts: record.facts.filter((fact) => fact.id !== factId), updatedAt: now.toISOString() };
    });
  }

  /** Adds a batch of browsing signals to the weights. While memory is off they are accepted and dropped. */
  async recordSignals(uid: string, body: unknown): Promise<void> {
    const parsed = signalsBodySchema.safeParse(body);
    if (!parsed.success) throw new AgentServiceError('invalidRequest');
    const now = this.allowWrite(uid);
    const current = await this.store.get(uid);
    if (current !== null && !current.enabled) return;
    await this.store.update(uid, (stored) => {
      const record = stored ?? emptyMemory(now);
      if (!record.enabled) return record;
      const layers = decayed(record.layers, record.browsedAt, now);
      const categories = decayed(record.categories, record.browsedAt, now);
      for (const signal of parsed.data.signals) {
        const weight = SIGNAL_WEIGHTS[signal.kind];
        layers[signal.layer] = (layers[signal.layer] ?? 0) + weight;
        if (signal.category !== undefined) categories[signal.category] = (categories[signal.category] ?? 0) + weight;
      }
      const keptCategories = Object.fromEntries(Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, MEMORY_LIMITS.maxCategories));
      return { ...record, layers, categories: keptCategories, browsedAt: now.toISOString(), updatedAt: now.toISOString() };
    });
  }

  /**
   * Reads one finished exchange for lasting facts and stores what changed. It runs after the turn, so it never delays
   * an answer; its model call is logged (`memoryLearned`), not counted in the turn's usage. It never throws.
   */
  learn(uid: string, exchange: { readonly turnId: string; readonly said: string; readonly answer: string }): Promise<void> {
    const previous = this.learning.get(uid) ?? Promise.resolve();
    const next = previous.then(() => this.learnNow(uid, exchange)).catch((error: unknown) => {
      this.log({ severity: 'WARNING', event: 'memoryLearnFailed', turnId: exchange.turnId,
        reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    });
    this.learning.set(uid, next);
    void next.finally(() => { if (this.learning.get(uid) === next) this.learning.delete(uid); });
    return next;
  }

  /** Resolves once the updates of `uid` running on this instance are done. */
  async idle(uid: string): Promise<void> {
    await this.learning.get(uid);
  }

  private async learnNow(uid: string, exchange: { readonly turnId: string; readonly said: string; readonly answer: string }): Promise<void> {
    if (this.structured === null) return;
    const record = await this.store.get(uid);
    if (record !== null && !record.enabled) return;
    const facts = record?.facts ?? [];
    const startedAt = this.clock();
    const result = await this.structured.generate({ system: LEARN_SYSTEM, schema: memoryChangesSchema,
      prompt: learnPrompt(facts, record === null ? { layers: [], categories: [] } : browsingSummary(record, startedAt), exchange.said, exchange.answer),
      signal: AbortSignal.timeout(MEMORY_LIMITS.learnTimeoutMs) });
    const changes = result.value;
    const changed = changes.add.length + changes.update.length + changes.remove.length;
    this.log({ severity: 'INFO', event: 'memoryLearned', turnId: exchange.turnId, model: result.model, changes: changed,
      durationMs: this.clock().getTime() - startedAt.getTime(), input: result.usage?.promptTokenCount ?? 0,
      output: result.usage?.candidatesTokenCount ?? 0, thoughts: result.usage?.thoughtsTokenCount ?? 0, total: result.usage?.totalTokenCount ?? 0 });
    if (changed === 0) return;
    const now = this.clock();
    await this.store.update(uid, (current) => {
      const stored = current ?? emptyMemory(now);
      // Switched off while the model read the exchange: keep nothing from it.
      if (!stored.enabled) return stored;
      return { ...stored, facts: applyChanges(stored.facts, changes, now), updatedAt: now.toISOString() };
    });
  }

  private allowWrite(uid: string): Date {
    const now = this.clock();
    if (!this.writeLimiter.allow(uid, now)) throw new AgentServiceError('rateLimited');
    return now;
  }
}
