import { z } from 'zod';

import { mapItemSchema, type MapItem } from '../contracts/map-contract.js';
import {
  comparePublishedInstants, MapAdapterError, parsePublishedGeometry, publicSourceReference, publishedGeoRowSchema, publishedItemBatch,
  publishedAssertion, publishedIdentifier, publishedInstant, publishedItemTime, publishedLifecycle, publishedLocation,
  publishedText, resolvePublishedSource, type PublishedItemBatch, type PublicSourceReference, type PublicSourceResolver,
} from './adapter-common.js';
import type { ViewRow } from './query-runner.js';

export type DisruptionItem = Extract<MapItem, { kind: 'disruption' }>;
/** GTFS Realtime Alert.Effect, which service alerts carry as its enum number. */
const GTFS_EFFECTS: Readonly<Record<number, string>> = {
  1: 'No service', 2: 'Reduced service', 3: 'Significant delays', 4: 'Detour', 5: 'Additional service',
  6: 'Modified service', 7: 'Other effect', 8: 'Unknown effect', 9: 'Stop moved', 10: 'No effect',
  11: 'Accessibility issue',
};
const effectSchema = z.union([z.string(), z.number().int()
  .transform((value) => GTFS_EFFECTS[value] ?? null)]).nullish();

const detailSchema = z.object({
  description: z.string().nullish(), effect: effectSchema,
  impact: z.object({ impactType: z.string().nullish(), direction: z.string().nullish(),
    delay: z.string().nullish(), numberLanesImpacted: z.string().nullish(),
    speedLimitOnSite: z.string().nullish() }).nullish(),
  validity_note: z.string().nullish(), source_timezone: z.string().nullish(),
  timezone_status: z.string().nullish(), created: z.string().nullish(), last_updated: z.string().nullish(),
  last_closed: z.string().nullish(), end_time: z.string().nullish(), source_last_updated: z.string().nullish(),
  duration: z.object({ start: z.string().nullish(), end: z.string().nullish() }).nullish(),
  selectors: z.array(z.object({ routeId: z.string().nullable().optional(),
    stopId: z.string().nullable().optional() })).optional(),
  // Names of the routes the alert names, joined from the static schedule by the data job.
  service_names: z.array(z.string()).optional(),
});

function disruptionDetail(row: ViewRow): {
  summary: string | null; impact: string | null; routeSelected: boolean; sourceTimeText: string | null;
  sourceTimezone: string | null; serviceNames: string[];
} {
  const summary = row.summary;
  if (summary == null || (typeof summary === 'string' && !summary.trimStart().startsWith('{'))) {
    return { summary: publishedText(summary), impact: null, routeSelected: false,
      sourceTimeText: null, sourceTimezone: null, serviceNames: [] };
  }
  if (typeof summary !== 'string') throw new MapAdapterError();
  let decoded: unknown;
  try { decoded = JSON.parse(summary); } catch { throw new MapAdapterError(); }
  const detail = detailSchema.parse(decoded);
  const publicSummary = [publishedText(detail.description), publishedText(detail.validity_note)]
    .filter((value) => value !== null).join('\n') || null;
  const impact = [publishedText(detail.effect), ...(detail.impact == null ? [] : [
    publishedText(detail.impact.impactType),
    detail.impact.direction == null ? null : `Direction: ${detail.impact.direction}`,
    detail.impact.delay == null ? null : `Delay: ${detail.impact.delay}`,
    detail.impact.numberLanesImpacted == null ? null : `Lanes impacted: ${detail.impact.numberLanesImpacted}`,
    detail.impact.speedLimitOnSite == null ? null : `Site speed limit: ${detail.impact.speedLimitOnSite}`,
  ])].filter((value) => value !== null).join('; ') || null;
  const clocks = [
    ['created', detail.created], ['last updated', detail.last_updated ?? detail.source_last_updated],
    ['last closed', detail.last_closed], ['end', detail.end_time],
    ['start', detail.duration?.start], ['end', detail.duration?.end],
  ].flatMap(([label, value]) => value == null ? [] : [`${label}: ${value}`]);
  return { summary: publicSummary, impact, sourceTimeText: clocks.join('; ') || null,
    sourceTimezone: publishedText(detail.source_timezone),
    serviceNames: [...new Set((detail.service_names ?? []).flatMap((name) => publishedText(name) ?? []))],
    routeSelected: detail.selectors?.some((selector) => selector.routeId != null) ?? false };
}

export function adaptDisruptionRow(row: ViewRow, options: {
  readonly source: PublicSourceReference;
  readonly mode?: 'current' | 'historical';
  readonly asOf?: string;
}): DisruptionItem {
  try {
    publishedGeoRowSchema.parse(row);
    const sourceId = publishedIdentifier(row.source_id);
    if (options.source.sourceId !== sourceId) throw new MapAdapterError('notPublic');
    if (row.topic !== 'road_disruption' && row.topic !== 'transport') throw new MapAdapterError();
    const id = publishedIdentifier(row.geo_record_id);
    const versionId = publishedIdentifier(row.version_id);
    const geometry = parsePublishedGeometry(row.geometry_geojson);
    let location = publishedLocation(row, geometry, { areaRole: 'affectedExtent' });
    const road = row.topic === 'road_disruption';
    if (road && (location.precision === 'line' || location.precision === 'area')) {
      location = { ...location, role: 'affectedExtent' };
    }
    const detail = disruptionDetail(row);
    const sourceLifecycle = publishedLifecycle(row.record_status);
    if (options.mode === 'current' && sourceLifecycle !== 'active' && sourceLifecycle !== 'planned') {
      throw new MapAdapterError();
    }
    const time = publishedItemTime({ ...row,
      source_time_text: row.source_time_text ?? detail.sourceTimeText,
      source_timezone: row.source_timezone ?? detail.sourceTimezone });
    const asOf = publishedInstant(options.asOf);
    const lifecycle = options.mode === 'current' && asOf !== null && sourceLifecycle === 'active'
      && time.validFrom !== null && comparePublishedInstants(time.validFrom, asOf) > 0 ? 'planned' : sourceLifecycle;
    const extentKind = road ? location.precision === 'line' ? 'roadSegment'
      : location.precision === 'area' ? 'area' : 'unknown'
      : geometry?.type === 'Point' && row.location_confidence === 'official_join' ? 'stop'
        : location.precision === 'line' || detail.routeSelected ? 'route'
          : location.precision === 'area' ? 'area' : 'unknown';
    const parsed = mapItemSchema.parse({ id, versionId, layerId: 'disruption', kind: 'disruption',
      title: publishedText(row.title), geometry, location, assertionKind: publishedAssertion(row), lifecycle,
      time,
      sources: [publicSourceReference(options.source, versionId, row.original_url)],
      details: { summary: detail.summary, impact: detail.impact,
        // Selector IDs are not service names; only names joined from the static schedule are.
        serviceNames: detail.serviceNames, status: lifecycle === 'withdrawn' ? 'unknown' : lifecycle, extentKind },
    });
    if (parsed.kind !== 'disruption') throw new MapAdapterError();
    return parsed;
  } catch (error) {
    if (error instanceof MapAdapterError) throw error;
    throw new MapAdapterError();
  }
}

export function adaptDisruptionRows(rows: readonly ViewRow[], options: {
  readonly resolveSource: PublicSourceResolver;
  readonly mode: 'current' | 'historical';
  readonly asOf?: string;
}): PublishedItemBatch<DisruptionItem> {
  return publishedItemBatch(rows.map((row) => adaptDisruptionRow(row, {
    source: resolvePublishedSource(row, options.resolveSource), mode: options.mode,
    ...(options.asOf === undefined ? {} : { asOf: options.asOf }),
  })));
}
