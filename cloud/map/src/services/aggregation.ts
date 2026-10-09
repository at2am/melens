import { createHash } from 'node:crypto';
import {
  MAX_PAGE_ITEMS, MAX_RESPONSE_BYTES, bboxSchema, compareMapItems, mapItemSchema,
  normalizedInstant as canonicalInstant,
} from '@melens/shared/contracts/map-contract';
import type { Bbox, LayerResult, MapItem, TimeWindow } from '@melens/shared/contracts/map-contract';
import { deepFreeze, jsonBytes } from '../util.js';

export type ZoomBand = 'overview' | 'district' | 'neighbourhood' | 'closeUp';
export type AggregateItem = Extract<MapItem, { kind: 'aggregate' }>;

export interface AggregationOptions {
  zoom: number;
  bounds: Bbox;
  /** The client may supply the band already resolved by its 0.2 zoom hysteresis. */
  band?: ZoomBand;
}

export interface AggregateGroup {
  aggregate: AggregateItem;
  /** Exact loaded, versioned members; never a new query over the navigation bounds. */
  members: readonly MapItem[];
}

export interface AggregationResult {
  band: ZoomBand;
  items: MapItem[];
  groups: ReadonlyMap<string, AggregateGroup>;
  excludedIds: string[];
}

const BAND_ZOOM: Record<ZoomBand, number> = {
  overview: 10, district: 12, neighbourhood: 15, closeUp: 18,
};
const CELL_PIXELS = 64;
type PointItem = MapItem & { geometry: Extract<NonNullable<MapItem['geometry']>, { type: 'Point' }> };
type GroupableItem = Extract<MapItem, { kind: 'pedestrian' | 'anomaly' | 'disruption' | 'event' | 'planning' }>;

/** Nominal first-load bands. Stateful boundary hysteresis belongs to the client zoom policy. */
export function nominalZoomBand(zoom: number): ZoomBand {
  if (!Number.isFinite(zoom) || zoom < 0 || zoom > 22) throw new RangeError('Zoom must be finite and between 0 and 22');
  return zoom < 11 ? 'overview' : zoom < 14 ? 'district' : zoom < 17 ? 'neighbourhood' : 'closeUp';
}

/**
 * Pure, bounded presentation grouping of one already admitted, snapshot-bound layer.
 * Coverage/admission/time filtering are upstream responsibilities. Source extents are
 * deliberately unchanged: no unverified line/polygon simplifier is applied.
 */
export function aggregateLayer(layer: LayerResult, options: AggregationOptions): AggregationResult {
  const nominalBand = nominalZoomBand(options.zoom);
  const band = options.band ?? nominalBand;
  if (!Object.hasOwn(BAND_ZOOM, band)) throw new TypeError('Unknown zoom band');
  const bounds = bboxSchema.parse(options.bounds);
  if (layer.items.length > MAX_PAGE_ITEMS) throw new RangeError('Aggregation exceeds the 1,000 loaded-item limit');
  assertByteLimit(layer.items);

  const seenIds = new Set<string>();
  const excludedIds: string[] = [];
  const passthrough: MapItem[] = [];
  const buckets = new Map<string, PointItem[]>();
  for (const candidate of [...layer.items].sort(compareMapItems)) {
    if (candidate.layerId !== layer.layerId) throw new TypeError('Aggregation item does not belong to its layer');
    if (seenIds.has(candidate.id)) throw new TypeError('A snapshot layer must contain one version per stable item id');
    seenIds.add(candidate.id);
    if (!isDrawable(candidate, bounds)) {
      excludedIds.push(candidate.id);
      continue;
    }
    const item = deepFreeze(mapItemSchema.parse(candidate));
    if (item.geometry?.type !== 'Point' || !isGroupable(item)) {
      passthrough.push(item);
      continue;
    }
    const pointItem = item as PointItem;
    const bucketId = JSON.stringify([semanticKey(item), spatialCell(pointItem.geometry.coordinates, band)]);
    const members = buckets.get(bucketId);
    if (members === undefined) buckets.set(bucketId, [pointItem]);
    else members.push(pointItem);
  }

  const groups = new Map<string, AggregateGroup>();
  const items = [...passthrough];
  for (const members of buckets.values()) {
    if (members.length === 1) {
      const item = members[0];
      if (item !== undefined) items.push(item);
      continue;
    }
    const aggregate = createAggregate(members, layer, bounds);
    items.push(aggregate);
    groups.set(aggregate.id, Object.freeze({ aggregate, members: Object.freeze([...members]) }));
  }
  items.sort(compareMapItems);
  assertByteLimit(items);
  return { band, items, groups, excludedIds };
}

function isDrawable(item: MapItem, bounds: Bbox): boolean {
  const geometry = item.geometry;
  if (geometry === null || item.location.precision === 'unlocated' || item.location.role === 'mention') return false;
  if (geometry.type === 'Point') {
    const [longitude, latitude] = geometry.coordinates;
    if (longitude < bounds[0] || longitude > bounds[2] || latitude < bounds[1] || latitude > bounds[3]) return false;
  }
  if (item.kind === 'pedestrian') return item.details.locationStatus === 'located';
  if (item.kind === 'anomaly') return item.details.eligibility === 'eligible' && item.details.classification === 'anomalous';
  if (item.kind === 'areaIndicator') return item.details.mappingState === 'matched'
    && item.location.role === 'statisticalArea' && (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon');
  if (item.kind === 'news' && (geometry.type === 'Point' || geometry.type === 'MultiPoint')) return item.location.role === 'eventSite'
    && item.details.localizationEvidence !== null;
  return true;
}

function isGroupable(item: MapItem): item is GroupableItem {
  return item.kind === 'pedestrian' || item.kind === 'anomaly' || item.kind === 'disruption'
    || item.kind === 'event' || item.kind === 'planning';
}

function normalizedInstant(value: string | null): string | null {
  return value === null ? null : canonicalInstant(value);
}

function sourceIds(item: MapItem): string[] {
  return [...new Set(item.sources.map((source) => source.sourceId))].sort();
}

function semanticKey(item: GroupableItem): string {
  const common = [item.kind, item.assertionKind, item.lifecycle, item.location.role, sourceIds(item)];
  switch (item.kind) {
    case 'pedestrian':
      return JSON.stringify([...common, item.details.granularity, normalizedWindow(item.details.window)]);
    case 'anomaly':
      return JSON.stringify([...common, item.details.baselineDefinitionId, item.details.direction,
        item.details.classification, normalizedWindow(item.details.window)]);
    case 'disruption':
      return JSON.stringify([...common, item.details.extentKind, item.details.status,
        [...item.details.serviceNames].sort(), effectiveTime(item)]);
    case 'event':
      return JSON.stringify([...common, item.details.category, item.details.status,
        normalizedInstant(item.details.startAt), normalizedInstant(item.details.endAt), effectiveTime(item)]);
    case 'planning':
      return JSON.stringify([...common, item.details.projectStatus, effectiveTime(item)]);
  }
}

function normalizedWindow(window: TimeWindow): [string | null, string | null] {
  return [normalizedInstant(window.from), normalizedInstant(window.to)];
}

function effectiveTime(item: MapItem): (string | null)[] {
  return [normalizedInstant(item.time.validFrom), normalizedInstant(item.time.validTo), item.time.periodLabel,
    item.time.sourceTimeText, item.time.sourceTimezone];
}

function spatialCell([longitude, latitude]: [number, number], band: ZoomBand): [number, number] {
  const scale = 256 * 2 ** BAND_ZOOM[band];
  const latitudeRadians = latitude * Math.PI / 180;
  const x = (longitude + 180) / 360 * scale;
  const y = (1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2 * scale;
  return [Math.floor(x / CELL_PIXELS), Math.floor(y / CELL_PIXELS)];
}

function groupWindow(item: MapItem): TimeWindow | null {
  if (item.kind === 'pedestrian' || item.kind === 'anomaly') return {
    from: normalizedInstant(item.details.window.from) ?? item.details.window.from,
    to: normalizedInstant(item.details.window.to) ?? item.details.window.to,
  };
  const from = item.kind === 'event' ? item.details.startAt : item.time.validFrom;
  const to = item.kind === 'event' ? item.details.endAt : item.time.validTo;
  return from === null || to === null ? null : { from: normalizedInstant(from) ?? from, to: normalizedInstant(to) ?? to };
}

function groupMetric(members: readonly MapItem[]): AggregateItem['details']['metric'] {
  const first = members[0];
  if (first === undefined) throw new TypeError('An aggregate needs members');
  if (first.kind === 'pedestrian') {
    const sensors = new Set(members.flatMap((item) => item.kind === 'pedestrian'
      ? [JSON.stringify([sourceIds(item), item.details.sensorId])] : []));
    return { id: 'sensorCount', label: 'Effective sensors', unit: 'sensors', value: sensors.size,
      definition: `Distinct source-scoped effective sensors with ${first.details.granularity} observations in this loaded group and the same window. Underlying sensor counts measure passages, may count repeated persons, and are not summed here.` };
  }
  if (first.kind === 'anomaly') {
    const results = new Set(members.flatMap((item) => item.kind === 'anomaly'
      ? [JSON.stringify([sourceIds(item), item.details.resultId])] : []));
    return { id: 'anomalyCount', label: 'Verified anomaly results', unit: 'anomaly results', value: results.size,
      definition: 'Distinct eligible producer-classified anomaly results in this loaded group, with the same observation window, baseline definition and anomaly direction.' };
  }
  const unit = first.kind === 'event' ? 'event records' : first.kind === 'disruption' ? 'disruption records' : 'planning records';
  return { id: `${first.kind}Count`, label: `Loaded ${unit}`, unit, value: members.length,
    definition: `Matching ${unit} represented by actual loaded members with compatible source, lifecycle and effective-time semantics; this is not a claim about unique people, measured speed or complete source coverage.` };
}

function createAggregate(members: readonly PointItem[], layer: LayerResult, viewportBounds: Bbox): AggregateItem {
  const first = members[0];
  if (first === undefined) throw new TypeError('An aggregate needs members');
  const memberIds = members.map((item) => item.id);
  const metric = groupMetric(members);
  const id = `aggregate.${first.layerId}.${digest(memberIds)}`;
  const sources = [...new Map(members.flatMap((item) => item.sources).map((source) => [JSON.stringify(source), source])).values()]
    .sort((left, right) => compareStrings(JSON.stringify(left), JSON.stringify(right)));
  const time = { ...first.time };
  for (const field of Object.keys(time) as (keyof MapItem['time'])[]) {
    const value = time[field];
    if (members.some((member) => member.time[field] !== value)) time[field] = null;
  }
  const aggregate = {
    id, versionId: `aggregate-v1.${digest([members.map((member) => [member.id, member.versionId]), layer.completeness, layer.coverage])}`,
    layerId: first.layerId, kind: 'aggregate', title: metric.label,
    geometry: { type: 'MultiPoint', coordinates: members.map((member) => [...member.geometry.coordinates]) },
    location: { precision: 'point', role: 'unknown',
      evidence: 'Aggregate contains actual member points. A navigation symbol may use the first point; bounds describe loaded member navigation, not a new affected area.' },
    assertionKind: first.assertionKind, lifecycle: first.lifecycle, time, sources,
    details: {
      representation: 'cluster', memberIds, memberCursor: null,
      resultRange: { scope: 'viewport', returnedCount: members.length,
        totalMatching: layer.completeness === 'complete' ? members.length : null },
      metric, window: groupWindow(first), coverage: structuredClone(layer.coverage),
      bounds: memberBounds(members, viewportBounds), grid: null,
    },
  };
  const parsed = mapItemSchema.parse(aggregate);
  if (parsed.kind !== 'aggregate') throw new TypeError('Expected aggregate');
  return deepFreeze(parsed);
}

function memberBounds(members: readonly PointItem[], viewportBounds: Bbox): Bbox {
  const longitudes = members.map((member) => member.geometry.coordinates[0]);
  const latitudes = members.map((member) => member.geometry.coordinates[1]);
  let west = Math.min(...longitudes);
  let east = Math.max(...longitudes);
  let south = Math.min(...latitudes);
  let north = Math.max(...latitudes);
  // Frozen bbox requires nonzero width/height. One ULP is navigation padding only;
  // source Point geometry is unchanged and never becomes an affected polygon.
  if (west === east) {
    if (west > viewportBounds[0]) west = adjacentFloat(west, -1);
    else east = adjacentFloat(east, 1);
  }
  if (south === north) {
    if (south > viewportBounds[1]) south = adjacentFloat(south, -1);
    else north = adjacentFloat(north, 1);
  }
  return bboxSchema.parse([west, south, east, north]);
}

function adjacentFloat(value: number, direction: 1 | -1): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const increment = (value > 0) === (direction > 0) ? 1n : -1n;
  view.setBigUint64(0, bits + increment);
  return view.getFloat64(0);
}

function compareStrings(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertByteLimit(items: readonly MapItem[]): void {
  if (jsonBytes(items) > MAX_RESPONSE_BYTES) throw new RangeError('Aggregation exceeds the 2 MiB response limit');
}
