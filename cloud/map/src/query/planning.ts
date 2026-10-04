import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import { MapAdapterError, parsePublishedGeometry, publicSourceReference, publishedAssertion,
  publishedGeoRowSchema, publishedIdentifier, publishedItemBatch, publishedItemTime,
  publishedLifecycle, publishedLocation, publishedText, resolvePublishedSource,
  type PublicSourceReference, type PublicSourceResolver, type PublishedItemBatch }
  from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type PlanningItem = Extract<MapItem, { kind: 'planning' }>;

/** Input is the fixed published planning projection, never a provider payload. */
export function adaptPlanningRow(value: ViewRow, options: {
  readonly source: PublicSourceReference;
  readonly mode?: 'current' | 'historical';
}): PlanningItem {
  try {
    const row = publishedGeoRowSchema.parse(value);
    if (row.topic !== 'planning') throw new MapAdapterError();
    if (row.source_id !== options.source.sourceId) throw new MapAdapterError('notPublic');
    const lifecycle = publishedLifecycle(row.record_status);
    if ((options.mode ?? 'current') === 'current'
      && (lifecycle === 'cancelled' || lifecycle === 'resolved' || lifecycle === 'withdrawn')) {
      throw new MapAdapterError();
    }
    const id = publishedIdentifier(row.geo_record_id);
    const versionId = publishedIdentifier(row.version_id);
    const geometry = parsePublishedGeometry(row.geometry_geojson);
    const item = mapItemSchema.parse({
      id, versionId, layerId: 'planning', kind: 'planning',
      title: publishedText(row.title) ?? id, geometry,
      location: publishedLocation(row, geometry), assertionKind: publishedAssertion(row), lifecycle,
      time: publishedItemTime(row), sources: [publicSourceReference(options.source, versionId, row.original_url)],
      details: {
        summary: publishedText(row.summary),
        // The published projection has no structured permit/status columns.
        // Source statuses remain in the original summary; lifecycle is not a permit status.
        projectStatus: null, permitId: null,
      },
    });
    if (item.kind !== 'planning') throw new MapAdapterError();
    return item;
  } catch (error) {
    throw error instanceof MapAdapterError ? error : new MapAdapterError();
  }
}

export function adaptPlanningRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode?: 'current' | 'historical';
}): PublishedItemBatch<PlanningItem> {
  return publishedItemBatch(rows.map((row) => adaptPlanningRow(row, {
    source: resolvePublishedSource(row, options.resolveSource),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  })));
}
