import { layerIdSchema } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

/** Wire schemas and limits of the memory routes (agent-protocol.md, Memory). */

export const MEMORY_LIMITS = {
  maxFacts: 24,
  factChars: 160,
  /** Browsing signals one request may carry; the app sends them in batches. */
  signalsPerRequest: 50,
  /** Event categories kept per uid; the lightest go first. */
  maxCategories: 30,
  categoryChars: 40,
  /** Browsing weight halves over this many days, so the summary follows what the user looks at now. */
  halfLifeDays: 14,
  /** A uid's memory is deleted this long after its last change (Firestore TTL on `expiresAtTs`). */
  retentionDays: 180,
  /** Every signal batch, setting change and deletion of a uid counts; reads are free. */
  writesPerHour: 240,
  /** The memory update after a turn gives up after this long; the turn has long finished. */
  learnTimeoutMs: 20_000,
} as const;

/** What a remembered fact is about. `travel` is how they get around: it decides parking, routes and plan questions. */
export const MEMORY_KINDS = ['travel', 'interest', 'routine', 'preference', 'other'] as const;
export const memoryKindSchema = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

const factIdSchema = z.string().regex(/^m_[A-Za-z0-9_-]{1,40}$/);

/** One lasting thing the user said about themselves in a chat, in a short English sentence. */
export const memoryFactSchema = z.strictObject({
  id: factIdSchema,
  kind: memoryKindSchema,
  text: z.string().trim().min(1).max(MEMORY_LIMITS.factChars),
  updatedAt: z.iso.datetime(),
});
export type MemoryFact = z.infer<typeof memoryFactSchema>;

/** What the user browses: each map layer, and the app's own community events (UC-09). */
export const interestLayerSchema = z.enum([...layerIdSchema.options, 'community']);
export type InterestLayer = z.infer<typeof interestLayerSchema>;

const categorySchema = z.string().trim().min(1).max(MEMORY_LIMITS.categoryChars).transform((value) => value.toLowerCase());

/**
 * One thing the user did on the map: turned a layer on (`show`) or opened a record (`open`), with the event category
 * when the record has one. Signals carry no place, no record id and no time.
 */
export const browsingSignalSchema = z.strictObject({
  kind: z.enum(['show', 'open']),
  layer: interestLayerSchema,
  category: categorySchema.optional(),
});
export type BrowsingSignal = z.infer<typeof browsingSignalSchema>;

export const SIGNAL_WEIGHTS = { show: 1, open: 2 } as const;

/** The body of `POST /v1/memory/signals`. */
export const signalsBodySchema = z.strictObject({ signals: z.array(browsingSignalSchema).min(1).max(MEMORY_LIMITS.signalsPerRequest) });

/** The body of `PATCH /v1/memory`. */
export const memorySettingsBodySchema = z.strictObject({ enabled: z.boolean() });

const weightsSchema = z.record(z.string(), z.number().nonnegative());

/** A uid's memory as stored. Weights fade with `MEMORY_LIMITS.halfLifeDays` from `browsedAt`. */
export const memoryRecordSchema = z.object({
  /** Off: the agent neither reads nor adds to it, and browsing signals are dropped. */
  enabled: z.boolean(),
  facts: z.array(memoryFactSchema).max(MEMORY_LIMITS.maxFacts),
  layers: weightsSchema,
  categories: weightsSchema,
  browsedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export function emptyMemory(now: Date, enabled = true): MemoryRecord {
  return { enabled, facts: [], layers: {}, categories: {}, browsedAt: null, updatedAt: now.toISOString() };
}

/** What the user browses most, as `GET /v1/memory` returns it and the agent reads it. */
export interface BrowsingSummary {
  /** The layers with enough weight, heaviest first, with their share of all layer weight. */
  readonly layers: readonly { readonly layer: InterestLayer; readonly share: number }[];
  /** The event categories with enough weight, heaviest first. */
  readonly categories: readonly string[];
}

/** The response of `GET /v1/memory`. */
export interface MemoryView {
  readonly enabled: boolean;
  readonly facts: readonly MemoryFact[];
  readonly browsing: BrowsingSummary;
  readonly updatedAt: string | null;
}

/** A layer joins the summary once the user turned it on or opened its records a few times recently. */
export const BROWSING_SUMMARY = { minLayerWeight: 3, maxLayers: 4, minCategoryWeight: 2, maxCategories: 5 } as const;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** The weights as they stand at `now`: each halves every `halfLifeDays`, and one that has all but faded is dropped. */
export function decayed(weights: Readonly<Record<string, number>>, since: string | null, now: Date): Record<string, number> {
  const days = since === null ? 0 : Math.max(0, (now.getTime() - Date.parse(since)) / DAY_MS);
  const factor = 0.5 ** (days / MEMORY_LIMITS.halfLifeDays);
  return Object.fromEntries(Object.entries(weights).map(([key, weight]) => [key, weight * factor] as const).filter(([, weight]) => weight >= 0.05));
}

function heaviest(weights: Readonly<Record<string, number>>, min: number, max: number): [string, number][] {
  return Object.entries(weights).filter(([, weight]) => weight >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max);
}

export function browsingSummary(record: MemoryRecord, now: Date): BrowsingSummary {
  const layers = decayed(record.layers, record.browsedAt, now);
  const total = Object.values(layers).reduce((sum, weight) => sum + weight, 0);
  return {
    layers: heaviest(layers, BROWSING_SUMMARY.minLayerWeight, BROWSING_SUMMARY.maxLayers).map(([layer, weight]) =>
      ({ layer: layer as InterestLayer, share: Math.round((weight / total) * 100) / 100 })),
    categories: heaviest(decayed(record.categories, record.browsedAt, now), BROWSING_SUMMARY.minCategoryWeight, BROWSING_SUMMARY.maxCategories)
      .map(([category]) => category),
  };
}

export function viewOf(record: MemoryRecord | null, now: Date): MemoryView {
  if (record === null) return { enabled: true, facts: [], browsing: { layers: [], categories: [] }, updatedAt: null };
  return { enabled: record.enabled, facts: record.facts, browsing: browsingSummary(record, now), updatedAt: record.updatedAt };
}
