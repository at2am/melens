import { MAX_PAGE_ITEMS, type LayerId, type MapItem } from '@melens/shared/contracts/map-contract';
import type { PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { ADAPTED_LAYERS, EXTERNALLY_VERIFIED_LAYERS, SUPPLEMENTALLY_VERIFIED_LAYERS, adaptContext, adaptLayerRows } from '@melens/shared/query/layer-adapters';
import type { ViewQueryResult } from '@melens/shared/query/query-runner';
import { findPublicSource, type SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';
import { coverageRequest, type SnapshotAccess } from './viewport.js';

export type PublicRecordChecker = NonNullable<SnapshotAccess['checkPublicRecords']>;
/** Which published batch the refreshed geo copy reflects, per source (v_geo_records_current_state). */
export type CopyStateReader = (execution: { readonly signal?: AbortSignal },
  maxAgeMs: number) => Promise<ReadonlyMap<string, string | null>>;

/** Current geo layers: their display reads the refreshed copy, so their rights may too while it is current. */
const GEO_RIGHTS_LAYERS: ReadonlySet<string> = new Set(['planning', 'disruption', 'event', 'news']);
/**
 * How long a successful geo rights proof stands for the same record version and source batch. A
 * new publication of the source ends it at once, and the source's own admission is rechecked on
 * every access, so only a record-level change inside one publication waits this long.
 */
export const VERIFIED_RECORD_TTL_MS = 60_000;
const MAX_VERIFIED_RECORDS = 20_000;
/**
 * The copy only moves forward, so a remembered state can only make a current copy look behind
 * (falling back to the live view), never make a lagging copy look current.
 */
const COPY_STATE_MAX_AGE_MS = 60_000;
const COPY_STATE_RECHECK_AGE_MS = 5_000;

/**
 * Stored rows stay readable only while the published views still return the same versions.
 * Adapted layers are rechecked with the fixed public-record query. Everything else, plus the
 * externally verified layers, must also pass the injected trusted verifier.
 */
export function createPublicRecordChecker(options: {
  readonly runQuery: (input: unknown, execution: { readonly signal?: AbortSignal }) => Promise<ViewQueryResult>;
  readonly resolveSource: (coverage: SourceCoverageSnapshot) => PublicSourceResolver;
  readonly external: PublicRecordChecker | undefined;
  readonly supplementalVerifier?: boolean;
  /** With it, current geo rights read the refreshed copy whenever it reflects every source's latest batch. */
  readonly readCopyState?: CopyStateReader;
  readonly clock?: () => Date;
}): PublicRecordChecker {
  const clock = options.clock ?? (() => new Date());
  const verified = new Map<string, { readonly batchId: string; readonly until: number }>();
  const recordKey = (item: MapItem) => JSON.stringify([item.layerId, item.id, item.versionId, item.sources[0]!.sourceId]);
  const batchOf = (coverage: SourceCoverageSnapshot, item: MapItem) =>
    findPublicSource(coverage, item.sources[0]!.sourceId)?.publishedBatchId ?? null;
  function remember(items: readonly MapItem[], coverage: SourceCoverageSnapshot) {
    const now = clock().getTime();
    if (verified.size + items.length > MAX_VERIFIED_RECORDS) {
      for (const [key, entry] of verified) if (entry.until <= now) verified.delete(key);
      if (verified.size + items.length > MAX_VERIFIED_RECORDS) verified.clear();
    }
    for (const item of items) {
      const batchId = batchOf(coverage, item);
      if (batchId !== null) verified.set(recordKey(item), { batchId, until: now + VERIFIED_RECORD_TTL_MS });
    }
  }
  function stillVerified(item: MapItem, coverage: SourceCoverageSnapshot): boolean {
    const entry = verified.get(recordKey(item));
    return entry !== undefined && entry.until > clock().getTime() && entry.batchId === batchOf(coverage, item);
  }

  return async (items, snapshot, coverage, execution) => {
    const unique = [...new Map(items.map((item) => [JSON.stringify([item.layerId, item.id, item.versionId]), item])).values()];
    const external = unique.filter((item) => !ADAPTED_LAYERS.has(item.layerId) || EXTERNALLY_VERIFIED_LAYERS.has(item.layerId)
      || options.supplementalVerifier === true && SUPPLEMENTALLY_VERIFIED_LAYERS.has(item.layerId));
    if (external.length > 0 && (options.external === undefined
      || !await options.external(external, snapshot, coverage, execution))) return false;
    const { cursor: _cursor, snapshotId: _snapshotId, ...context } = coverageRequest(snapshot);
    const asOf = new Date(snapshot.createdAt).toISOString();
    try {
      const layerIds = [...new Set(unique.filter((item) => ADAPTED_LAYERS.has(item.layerId)).map((item) => item.layerId))];
      const current = context.mode === 'current';
      // Each layer's recheck is independent. A current geo record verified within the last minute
      // for its source's current batch is not read again (a map view, then its details and members).
      const pendingByLayer = new Map(layerIds.map((layerId) => [layerId, unique.filter((item) => item.layerId === layerId
        && !(current && GEO_RIGHTS_LAYERS.has(layerId) && stillVerified(item, coverage)))]));
      const geoSources = [...pendingByLayer].filter(([layerId]) => GEO_RIGHTS_LAYERS.has(layerId))
        .flatMap(([, pending]) => pending.map((item) => item.sources[0]!.sourceId));
      // The copy holds the live view's rows as of each source's refreshed batch. It proves current
      // rights only while that batch is the latest the registry published; otherwise the live view does.
      // The copy's state is read alongside the copy's proof, which is kept only if the state agrees.
      const reflects = (state: ReadonlyMap<string, string | null>) => geoSources.every((sourceId) => {
        const latest = findPublicSource(coverage, sourceId)?.publishedBatchId ?? null;
        return latest !== null && state.get(sourceId) === latest;
      });
      const readCopyState = options.readCopyState;
      const copyCurrent: Promise<boolean> = !current || geoSources.length === 0 || readCopyState === undefined
        ? Promise.resolve(false)
        // A remembered state may predate the publication the registry now shows; read it again once.
        : readCopyState(execution, COPY_STATE_MAX_AGE_MS).then(async (state) => reflects(state)
          || reflects(await readCopyState(execution, COPY_STATE_RECHECK_AGE_MS))).catch(() => false);
      const prove = async (layerId: LayerId, expected: readonly MapItem[], rightsRead: 'served' | undefined) => {
        const result = await options.runQuery({ family: 'publicRecords', queryId: layerId,
          ...(rightsRead === undefined ? {} : { rightsRead }),
          request: { ...context, pageSize: MAX_PAGE_ITEMS },
          recordKeys: expected.map((item) => ({ id: item.id, versionId: item.versionId, sourceId: item.sources[0]!.sourceId,
            ...(item.kind === 'pedestrian' ? { sensorId: item.details.sensorId, observedAt: item.time.observedAt } : {}),
            ...(item.kind === 'parking' ? { sensorId: item.details.sensorId } : {}) })),
        }, execution);
        const actual = adaptLayerRows(layerId, result.rows, adaptContext(snapshot.request, options.resolveSource(coverage), asOf));
        // The stored item must come back byte for byte; a changed version is a withdrawn right.
        // Parking is the exception. Its snapshot is replaced every 2 minutes, so a new batch can land between the
        // first read and this recheck, and its reading is derived from the read time. A newer publication is not a
        // withdrawn right; a withdrawal (source not public, record inactive, rights changed) removes the row from
        // the view. So a parking sensor passes while the public view still returns it.
        const key = (item: MapItem) => layerId === 'parking' ? item.id : JSON.stringify(item);
        const published = new Set([...actual.items, ...actual.unlocatedItems].map(key));
        return expected.every((item) => published.has(key(item)));
      };
      const optimistic = current && geoSources.length > 0 && readCopyState !== undefined;
      const results = await Promise.all(layerIds.map(async (layerId) => {
        const expected = pendingByLayer.get(layerId)!;
        if (expected.length === 0) return true;
        if (!(current && GEO_RIGHTS_LAYERS.has(layerId))) return prove(layerId, expected, undefined);
        const fromCopy = optimistic ? prove(layerId, expected, 'served') : null;
        // Settle the copy's proof before deciding, so its failure never escapes unobserved.
        const [copyProof, useCopy] = await Promise.all([fromCopy?.catch(() => null) ?? null, copyCurrent]);
        const ok = useCopy && copyProof !== null ? copyProof : await prove(layerId, expected, undefined);
        if (ok) remember(expected, coverage);
        return ok;
      }));
      return results.every(Boolean);
    } catch { return false; }
  };
}
