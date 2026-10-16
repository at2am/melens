import { z } from 'zod';

import { boundaryFilterSchema, mapItemSchema, type MapItem, type ViewportQuery }
  from '../contracts/map-contract.js';
import { MapAdapterError, parsePublishedGeometry, publicSourceReference, publishedIdentifier,
  publishedItemBatch, publishedItemTime, publishedText, resolvePublishedSource,
  type PublicSourceReference, type PublicSourceResolver, type PublishedItemBatch }
  from './adapter-common.js';
import type { ViewRow } from './query-runner.js';
import { BOUNDARY_SCHEMES as schemes } from './sql.js';

export type BoundarySelection = NonNullable<ViewportQuery['boundaryFilter']>;
export type BoundaryItem = Extract<MapItem, { kind: 'boundary' }>;

const boundaryRowSchema = z.object({
  rights_evidence: z.literal('latest_published_record_v1'),
  boundary_id: z.string(), version_id: z.string(), scheme: z.string(), code: z.string(),
  name: z.string(), vintage: z.string(), geometry_geojson: z.string(),
  valid_from: z.string().nullable(), valid_to: z.string().nullable(),
  source_record_id: z.string(), source_id: z.string(), fetched_at: z.string().nullable(),
});

export function adaptBoundaryRow(value: ViewRow, options: {
  readonly selection: BoundarySelection;
  readonly source: PublicSourceReference;
}): BoundaryItem {
  try {
    const selection = boundaryFilterSchema.parse(options.selection);
    const row = boundaryRowSchema.parse(value);
    if (row.scheme !== schemes[selection.level] || row.vintage !== selection.vintage) {
      throw new MapAdapterError();
    }
    if (row.source_id !== options.source.sourceId) throw new MapAdapterError('notPublic');
    const id = publishedIdentifier(row.boundary_id);
    const versionId = publishedIdentifier(row.version_id);
    publishedIdentifier(row.source_record_id);
    if (id !== `${row.scheme}:${row.code}:${row.vintage}`) throw new MapAdapterError();
    const geometry = parsePublishedGeometry(row.geometry_geojson);
    if (geometry === null || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
      throw new MapAdapterError();
    }
    const name = publishedText(row.name);
    if (name === null) throw new MapAdapterError();
    const item = mapItemSchema.parse({
      id, versionId, kind: 'boundary', layerId: 'boundary', title: name, geometry,
      location: { precision: 'area', role: 'statisticalArea', evidence: 'Published source boundary' },
      assertionKind: 'observation', lifecycle: 'active',
      time: { ...publishedItemTime(row), periodLabel: row.vintage },
      sources: [publicSourceReference(options.source, versionId)],
      details: { boundaryId: id, boundaryLevel: selection.level, vintage: row.vintage, name },
    });
    if (item.kind !== 'boundary') throw new MapAdapterError();
    return item;
  } catch (error) {
    throw error instanceof MapAdapterError ? error : new MapAdapterError();
  }
}

export function adaptBoundaryRows(rows: readonly ViewRow[], options: {
  readonly selection: BoundarySelection;
  readonly resolveSource: PublicSourceResolver;
}): PublishedItemBatch<BoundaryItem> {
  // Validate the requested vintage even when the successful query returns no rows.
  boundaryFilterSchema.parse(options.selection);
  return publishedItemBatch(rows.map((row) => adaptBoundaryRow(row, {
    selection: options.selection, source: resolvePublishedSource(row, options.resolveSource),
  })));
}
