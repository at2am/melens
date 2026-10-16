import { z } from 'zod';
import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import { MapAdapterError, parsePublishedGeometry, publicSourceReference, publishedAssertion,
  publishedGeoRowSchema, publishedIdentifier, publishedItemBatch, publishedItemTime,
  publishedLifecycle, publishedLocation, publishedText, resolvePublishedSource,
  type PublicSourceReference, type PublicSourceResolver, type PublishedItemBatch }
  from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type NewsItem = Extract<MapItem, { kind: 'news' }>;
const metadataSchema = z.object({ summary_text: z.string().max(4_096).optional() });
const articleUrlSchema = z.url({ protocol: /^https?$/ });

/** Published metadata only; article text and inferred incident points are never read. */
export function adaptNewsRow(value: ViewRow, options: {
  readonly source: PublicSourceReference;
  readonly mode?: 'current' | 'historical';
}): NewsItem {
  try {
    const row = publishedGeoRowSchema.parse(value);
    if (row.topic !== 'news' && row.topic !== 'crime_news') throw new MapAdapterError();
    if (row.source_id !== options.source.sourceId) throw new MapAdapterError('notPublic');
    if (publishedAssertion(row) !== 'report') throw new MapAdapterError();
    const lifecycle = publishedLifecycle(row.record_status);
    if (lifecycle === 'withdrawn' || ((options.mode ?? 'current') === 'current'
      && lifecycle !== 'active' && lifecycle !== 'planned')) throw new MapAdapterError();
    const id = publishedIdentifier(row.geo_record_id);
    const versionId = publishedIdentifier(row.version_id);
    const originalUrl = articleUrlSchema.parse(row.original_url);
    const title = publishedText(row.title) ?? 'News report';
    const geometry = parsePublishedGeometry(row.geometry_geojson);
    const location = publishedLocation(row, geometry);
    const time = publishedItemTime(row);
    // These sources publish structured metadata. Do not expose its JSON, article
    // bodies, or source processing/fetch timestamps as publication facts.
    const metadata = row.summary === null ? null : metadataSchema.parse(JSON.parse(row.summary));
    const source = row.source_id === 'gdelt.news'
      ? { ...options.source, attribution: 'The GDELT Project (https://www.gdeltproject.org/)' }
      : options.source;
    const sources = [publicSourceReference(source, versionId, originalUrl)];
    if (row.source_id === 'gdelt.news') sources.push(publicSourceReference({ ...source,
      attribution: 'The GDELT Project — dataset attribution', url: 'https://www.gdeltproject.org/' }, versionId));
    const item = mapItemSchema.parse({
      id, versionId, layerId: 'news', kind: 'news', title, geometry, location,
      assertionKind: 'report', lifecycle, time,
      sources,
      details: { eventId: id, summary: publishedText(metadata?.summary_text),
        articleRefs: [{ articleId: id, url: originalUrl, title, reportedAt: time.reportedAt }],
        localizationEvidence: location.role === 'mention'
          ? 'Mentioned area only; event location is unverified.' : location.evidence,
        dedupStatus: 'unconfirmed' },
    });
    if (item.kind !== 'news') throw new MapAdapterError();
    return item;
  } catch (error) {
    throw error instanceof MapAdapterError ? error : new MapAdapterError();
  }
}

export function adaptNewsRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode?: 'current' | 'historical';
}): PublishedItemBatch<NewsItem> {
  return publishedItemBatch(rows.map((row) => adaptNewsRow(row, {
    source: resolvePublishedSource(row, options.resolveSource),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  })));
}
