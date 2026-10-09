import type { MapGeometry, MapItem } from '@melens/shared/contracts/map-contract';

import { toMelbourneIso } from '../agent/time.js';
import type { LatLng } from '../protocol/schemas.js';

/** What list results contain (tools.md, Shared types). */
export interface CompactFeature {
  readonly id: string;
  readonly layer: MapItem['layerId'];
  readonly title: string;
  readonly summary: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly is_prediction: boolean;
  readonly source_url: string | null;
  readonly distance_m: number | null;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

function positions(geometry: MapGeometry): [number, number][] {
  switch (geometry.type) {
    case 'Point': return [geometry.coordinates];
    case 'MultiPoint': case 'LineString': return geometry.coordinates;
    case 'MultiLineString': case 'Polygon': return geometry.coordinates.flat();
    case 'MultiPolygon': return geometry.coordinates.flat(2);
  }
}

/** The centroid of the vertices: exact for points, a fair pin for lines and areas. */
export function centroid(geometry: MapGeometry): LatLng {
  const points = positions(geometry);
  const sum = points.reduce((acc, [lng, lat]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }), { lat: 0, lng: 0 });
  return { lat: Number((sum.lat / points.length).toFixed(6)), lng: Number((sum.lng / points.length).toFixed(6)) };
}

function summaryOf(item: MapItem): string | null {
  switch (item.kind) {
    case 'disruption': return item.details.summary ?? item.details.impact;
    case 'event': return [item.details.venueName, item.details.summary].filter((part): part is string => part !== null).join('. ') || null;
    case 'planning': return item.details.summary ?? item.details.projectStatus;
    case 'news': return item.details.summary;
    case 'pedestrian': return item.details.totalCount === null ? null : `${item.details.totalCount} people counted`;
    case 'anomaly': return item.details.observedValue === null || item.details.baselineValue === null ? null
      : `${item.details.observedValue} observed against a usual ${item.details.baselineValue}`;
    default: return null;
  }
}

function shorten(text: string | null, limit: number): string | null {
  if (text === null) return null;
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function local(instant: string | null): string | null {
  return instant === null ? null : toMelbourneIso(instant);
}

export function compactFeature(item: MapItem, from: LatLng | null): CompactFeature | null {
  if (item.geometry === null) return null;
  const point = centroid(item.geometry);
  const validFrom = item.kind === 'event' ? item.details.startAt ?? item.time.validFrom : item.time.validFrom;
  const validTo = item.kind === 'event' ? item.details.endAt ?? item.time.validTo : item.time.validTo;
  return { id: item.id, layer: item.layerId, title: item.title, summary: shorten(summaryOf(item), 160),
    lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)),
    valid_from: local(validFrom), valid_to: local(validTo), is_prediction: item.assertionKind === 'prediction',
    source_url: item.sources[0]?.url ?? null, distance_m: from === null ? null : haversineMeters(from, point) };
}

/** Case-insensitive keyword match on what the model can see: title and summary. */
export function matchesKeywords(feature: CompactFeature, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${feature.title} ${feature.summary ?? ''}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
