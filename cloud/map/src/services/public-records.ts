import { MAX_PAGE_ITEMS, type MapItem } from '@melens/shared/contracts/map-contract';
import type { PublicSourceResolver } from '@melens/shared/query/adapter-common';
import { ADAPTED_LAYERS, EXTERNALLY_VERIFIED_LAYERS, adaptContext, adaptLayerRows } from '@melens/shared/query/layer-adapters';
import type { ViewQueryResult } from '@melens/shared/query/query-runner';
import type { SourceCoverageSnapshot } from '@melens/shared/query/source-coverage';
import { coverageRequest, type SnapshotAccess } from './viewport.js';

export type PublicRecordChecker = NonNullable<SnapshotAccess['checkPublicRecords']>;

/**
 * Stored rows stay readable only while the published views still return the same versions.
 * Adapted layers are rechecked with the fixed public-record query. Everything else, plus the
 * externally verified layers, must also pass the injected trusted verifier.
 */
export function createPublicRecordChecker(options: {
  readonly runQuery: (input: unknown, execution: { readonly signal?: AbortSignal }) => Promise<ViewQueryResult>;
  readonly resolveSource: (coverage: SourceCoverageSnapshot) => PublicSourceResolver;
  readonly external: PublicRecordChecker | undefined;
}): PublicRecordChecker {
  return async (items, snapshot, coverage, execution) => {
    const unique = [...new Map(items.map((item) => [JSON.stringify([item.layerId, item.id, item.versionId]), item])).values()];
    const external = unique.filter((item) => !ADAPTED_LAYERS.has(item.layerId) || EXTERNALLY_VERIFIED_LAYERS.has(item.layerId));
    if (external.length > 0 && (options.external === undefined
      || !await options.external(external, snapshot, coverage, execution))) return false;
    const { cursor: _cursor, snapshotId: _snapshotId, ...context } = coverageRequest(snapshot);
    const asOf = new Date(snapshot.createdAt).toISOString();
    try {
      for (const layerId of new Set(unique.filter((item) => ADAPTED_LAYERS.has(item.layerId)).map((item) => item.layerId))) {
        const expected = unique.filter((item) => item.layerId === layerId);
        const result = await options.runQuery({ family: 'publicRecords', queryId: layerId,
          request: { ...context, pageSize: MAX_PAGE_ITEMS },
          recordKeys: expected.map((item) => ({ id: item.id, versionId: item.versionId, sourceId: item.sources[0]!.sourceId,
            ...(item.kind === 'pedestrian' ? { sensorId: item.details.sensorId, observedAt: item.time.observedAt } : {}),
            ...(item.kind === 'parking' ? { sensorId: item.details.sensorId } : {}) })),
        }, execution);
        const actual = adaptLayerRows(layerId, result.rows, adaptContext(snapshot.request, options.resolveSource(coverage), asOf));
        // The stored item must come back byte for byte; a changed version is a withdrawn right.
        // A parking item's reading is derived from the read time (current, then late), so it is matched on
        // its published identity and version: same batch, same record version, still public.
        const key = (item: MapItem) => layerId === 'parking' ? JSON.stringify([item.id, item.versionId]) : JSON.stringify(item);
        const published = new Set([...actual.items, ...actual.unlocatedItems].map(key));
        if (!expected.every((item) => published.has(key(item)))) return false;
      }
      return true;
    } catch { return false; }
  };
}
