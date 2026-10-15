import { z } from 'zod';

import {
  MAX_PAGE_ITEMS, identifierSchema as identifier, mapItemSchema, normalizedViewportIdentity, timeWindowSchema,
  type MapItem, type TimeWindow, type ViewportQuery,
} from '../contracts/map-contract.js';
import { MapQueryError } from '../errors.js';
import type { ViewportLayerLoader } from './layer-loaders.js';
import { publishedItemBatch, type PublishedItemBatch } from './adapter-common.js';
import {
  assessLayerCoverage, compareSourceInstants, finalizeLayerResult, findPublicSource,
  type CoverageAreaResolver, type LayerCoverageAssessment, type SourceCoverageSnapshot,
} from './source-coverage.js';

/** A replay title always says so; the consumer refuses a replay result without it. */
export const REPLAY_TITLE_PREFIX = 'Replay · ';

export type AnomalyItem = Extract<MapItem, { kind: 'anomaly' }>;
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const distinctIds = z.array(identifier).min(1).max(MAX_PAGE_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length);
const anomalyItemSchema = mapItemSchema.transform((item, context) => {
  if (item.kind !== 'anomaly') {
    context.addIssue({ code: 'custom', message: 'Expected an anomaly producer result' });
    return z.NEVER;
  }
  return item;
});

const producerBatchSchema = z.strictObject({
  verification: z.literal('verifiedPublic'),
  dataMode: z.literal('live'),
  /**
   * A replay of a historical day: every result says so in its title, and its window is the historical hour, not a window
   * inside the request. Every other check (publication, linkage, exact windows, sensor location) still applies.
   */
  replay: z.boolean().optional(),
  queryIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  publicationProofs: z.array(z.strictObject({
    sourceId: identifier, publishedBatchId: identifier, publishedAt: timeWindowSchema.shape.from,
  })).min(1).max(MAX_PAGE_ITEMS),
  records: z.array(z.strictObject({
    item: anomalyItemSchema,
    evidence: z.strictObject({
      resultId: identifier, observationId: identifier.nullable(), baselineDefinitionId: identifier.nullable(),
      observationWindow: timeWindowSchema.nullable(), baselineAppliesToWindow: timeWindowSchema.nullable(),
      sourceIds: distinctIds,
    }),
  })).max(MAX_PAGE_ITEMS),
  completeness: z.enum(['complete', 'partial']),
  totalMatching: count.nullable(), unresolvedCount: count.nullable(),
});

/** This is an injected producer boundary, not a client-supplied HTTP payload. */
export type VerifiedAnomalyBatch = z.infer<typeof producerBatchSchema>;
export interface VerifiedAnomalyProducer {
  read(request: ViewportQuery, execution: {
    readonly signal?: AbortSignal; readonly rowLimit: number; readonly resultBudgetBytes: number;
  }): Promise<unknown>;
}
export interface ConsumedAnomalyBatch extends PublishedItemBatch<AnomalyItem> {
  readonly completeness: 'complete' | 'partial';
  readonly totalMatching: number | null;
  readonly verifiedUnresolvedCount: number | null;
  readonly publicationSourceIds: readonly string[];
}

function unavailableAssessment(): LayerCoverageAssessment {
  return { availability: 'unavailable', freshness: 'unknown', sourceIds: [], updatedAt: null,
    coverage: { state: 'unknown', areaRefs: [], window: null, evidenceSourceIds: [] } };
}

/** Registry metadata alone cannot establish that a reviewed producer is wired. */
export function anomalyCatalogAssessment(options: {
  readonly coverage: SourceCoverageSnapshot; readonly producerConfigured: boolean;
}): LayerCoverageAssessment {
  return options.producerConfigured
    ? assessLayerCoverage({ snapshot: options.coverage, layerId: 'anomaly' }) : unavailableAssessment();
}

const equalWindow = (left: TimeWindow, right: TimeWindow) =>
  compareSourceInstants(left.from, right.from) === 0 && compareSourceInstants(left.to, right.to) === 0;
const containedWindow = (inner: TimeWindow, outer: TimeWindow) =>
  compareSourceInstants(inner.from, outer.from) >= 0 && compareSourceInstants(inner.to, outer.to) <= 0;
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const orderedRight = [...right].sort();
  return left.length === right.length && [...left].sort().every((id, index) => id === orderedRight[index]);
}

/** Validate linkage and current publication; never detect, recalculate, or fill missing values. */
export function consumeVerifiedAnomalyBatch(value: unknown, options: {
  readonly request: ViewportQuery; readonly coverage: SourceCoverageSnapshot;
  readonly rowLimit: number; readonly resultBudgetBytes: number;
}): ConsumedAnomalyBatch {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new MapQueryError('serviceUnavailable');
    if (Buffer.byteLength(encoded, 'utf8') > options.resultBudgetBytes) throw new MapQueryError('budgetExceeded');
    const batch = producerBatchSchema.parse(value);
    if (batch.records.length > options.rowLimit) throw new MapQueryError('budgetExceeded');
    if (options.coverage.completeness !== 'complete'
      || batch.queryIdentity !== normalizedViewportIdentity(options.request)) throw new MapQueryError('serviceUnavailable');
    const proofIds = batch.publicationProofs.map((proof) => proof.sourceId);
    if (new Set(proofIds).size !== proofIds.length) throw new MapQueryError('serviceUnavailable');
    for (const proof of batch.publicationProofs) {
      const source = findPublicSource(options.coverage, proof.sourceId);
      if (source === null || source.publishedBatchId !== proof.publishedBatchId
        || source.publishedAt === null || compareSourceInstants(source.publishedAt, proof.publishedAt) !== 0) {
        throw new MapQueryError('notAvailable');
      }
    }
    if (!batch.publicationProofs.some((proof) =>
      findPublicSource(options.coverage, proof.sourceId)?.topic === 'anomaly')) throw new MapQueryError('notAvailable');
    const resultIds = new Set<string>();
    const items = batch.records.map(({ item, evidence }): AnomalyItem => {
      if (item.kind !== 'anomaly') throw new MapQueryError('serviceUnavailable');
      const details = item.details;
      if (item.lifecycle === 'withdrawn') throw new MapQueryError('notAvailable');
      if (batch.replay === true && !item.title.startsWith(REPLAY_TITLE_PREFIX)) throw new MapQueryError('serviceUnavailable');
      if (item.assertionKind !== 'observation' || !(batch.replay === true || containedWindow(details.window, options.request.window))
        || resultIds.has(details.resultId) || details.resultId !== evidence.resultId
        || details.observationId !== evidence.observationId
        || details.baselineDefinitionId !== evidence.baselineDefinitionId) throw new MapQueryError('serviceUnavailable');
      resultIds.add(details.resultId);
      if (details.observationId === null) {
        if (evidence.observationWindow !== null || details.observedValue !== null
          || details.classification !== 'unclassified') throw new MapQueryError('serviceUnavailable');
      } else if (evidence.observationWindow === null || !equalWindow(details.window, evidence.observationWindow)) {
        throw new MapQueryError('serviceUnavailable');
      }
      if (details.baselineDefinitionId === null) {
        if (evidence.baselineAppliesToWindow !== null || details.baselineValue !== null || details.delta !== null) {
          throw new MapQueryError('serviceUnavailable');
        }
      } else if (evidence.baselineAppliesToWindow === null || !equalWindow(details.window, evidence.baselineAppliesToWindow)) {
        throw new MapQueryError('serviceUnavailable');
      }
      if (item.time.validFrom === null || item.time.validTo === null
        || !equalWindow(details.window, { from: item.time.validFrom, to: item.time.validTo })
        || item.time.observedAt !== null && compareSourceInstants(item.time.observedAt, details.window.from) !== 0) {
        throw new MapQueryError('serviceUnavailable');
      }
      const sourceIds = item.sources.map((source) => source.sourceId);
      if (!sameIds(sourceIds, evidence.sourceIds) || new Set(sourceIds).size !== sourceIds.length
        || item.sources.some((source) => !proofIds.includes(source.sourceId) || source.versionRef === null)
        || !sourceIds.some((id) => findPublicSource(options.coverage, id)?.topic === 'anomaly')) {
        throw new MapQueryError('notAvailable');
      }
      if (sourceIds.some((id) => {
        const source = findPublicSource(options.coverage, id);
        return source?.topic === 'anomaly' && source.publishedAt !== null
          && compareSourceInstants(source.publishedAt, details.window.to) < 0;
      })) throw new MapQueryError('serviceUnavailable');
      if (item.geometry !== null) {
        if (item.geometry.type !== 'Point' || item.location.role !== 'sensor' || item.location.evidence === null) {
          throw new MapQueryError('serviceUnavailable');
        }
        const [longitude, latitude] = item.geometry.coordinates;
        const [west, south, east, north] = options.request.bbox;
        if (longitude < west || longitude > east || latitude < south || latitude > north) {
          throw new MapQueryError('serviceUnavailable');
        }
      }
      return item;
    });
    const published = publishedItemBatch(items);
    if (batch.completeness === 'partial' && batch.totalMatching !== null
      || batch.completeness === 'complete' && batch.totalMatching !== published.items.length
      || batch.unresolvedCount !== null && batch.unresolvedCount < published.unlocatedItems.length) {
      throw new MapQueryError('serviceUnavailable');
    }
    return { ...published, completeness: batch.completeness, totalMatching: batch.totalMatching,
      verifiedUnresolvedCount: batch.unresolvedCount, publicationSourceIds: [...proofIds].sort() };
  } catch (error) {
    if (error instanceof MapQueryError) throw error;
    throw new MapQueryError('serviceUnavailable');
  }
}

export function createAnomalyLayerLoader(options: {
  readonly producer?: VerifiedAnomalyProducer; readonly resolveArea?: CoverageAreaResolver;
} = {}): ViewportLayerLoader {
  return async (request, layerId, coverage, execution) => {
    if (layerId !== 'anomaly') throw new MapQueryError('invalidRequest');
    if (options.producer === undefined) return { result: finalizeLayerResult({ layerId,
      assessment: unavailableAssessment(), items: [], completeness: 'partial',
      unresolvedCount: null, totalMatching: null, querySucceeded: false }) };
    try {
      const batch = consumeVerifiedAnomalyBatch(await options.producer.read(request, execution),
        { request, coverage, rowLimit: execution.rowLimit, resultBudgetBytes: execution.resultBudgetBytes });
      const assessment = assessLayerCoverage({ snapshot: coverage, layerId,
        request, ...(options.resolveArea === undefined ? {} : { resolveArea: options.resolveArea }) });
      // An empty producer query must prove all contributing anomaly publications.
      const allPublicationsProven = assessment.sourceIds.every((id) => batch.publicationSourceIds.includes(id));
      return { result: finalizeLayerResult({ layerId,
        assessment: { ...assessment, sourceIds: [...batch.publicationSourceIds],
          queryCoverageVerified: assessment.queryCoverageVerified === true && allPublicationsProven },
        items: batch.items, completeness: batch.completeness,
        unresolvedCount: batch.verifiedUnresolvedCount, totalMatching: batch.totalMatching,
        observedWindow: batch.items.length === 0 ? null : {
          from: batch.items.map((item) => item.details.window.from).sort(compareSourceInstants)[0]!,
          to: batch.items.map((item) => item.details.window.to).sort(compareSourceInstants).at(-1)!,
        } }) };
    } catch (error) {
      if (error instanceof MapQueryError) throw error;
      throw new MapQueryError('serviceUnavailable');
    }
  };
}

/**
 * A failing anomaly read (the view is not applied yet, a publication does not match) makes the anomaly layer unavailable;
 * it never fails the whole viewport request that also carries the other layers. A cancelled read still cancels the request.
 */
export function failSoftAnomalyLayerLoader(loader: ViewportLayerLoader): ViewportLayerLoader {
  return async (request, layerId, coverage, execution) => {
    try {
      return await loader(request, layerId, coverage, execution);
    } catch (error) {
      if (execution.signal?.aborted) throw error;
      return { result: finalizeLayerResult({ layerId, assessment: unavailableAssessment(), items: [], completeness: 'partial',
        unresolvedCount: null, totalMatching: null, querySucceeded: false }) };
    }
  };
}
