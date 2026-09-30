import { z } from 'zod';

import type { GeoRecord } from '../core/types.js';

const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const position = z.tuple([longitude, latitude]);
const ring = z.array(position).min(4).refine(points => {
  const first = points[0];
  const last = points.at(-1);
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}, 'Polygon ring must close');
const geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: z.array(position).min(2) }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }).strict(),
]);

export type ValidGeometry = z.infer<typeof geometry>;

const boundaryGeometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(ring).min(1) }).strict(),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(ring).min(1)).min(1) }).strict(),
]);

export type ValidBoundaryGeometry = z.infer<typeof boundaryGeometry>;

/** Boundaries can be multipolygons even though event geometry is intentionally narrower. */
export function parseBoundaryGeometry(value: unknown): ValidBoundaryGeometry {
  return boundaryGeometry.parse(value);
}

export function parseGeometryGeojson(raw: string): ValidGeometry {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Invalid GeoJSON JSON');
  }
  return geometry.parse(value);
}

export interface GeographyValidation {
  valid: boolean;
  issues: readonly string[];
  /** Null when the geographic mapping must be quarantined; the source fact remains usable. */
  geographicRecord: GeoRecord | null;
}

export function validateGeoRecordGeography(row: GeoRecord): GeographyValidation {
  const issues: string[] = [];
  let parsed: ValidGeometry | null = null;
  if (row.geometry_geojson !== null) {
    try {
      parsed = parseGeometryGeojson(row.geometry_geojson);
    } catch {
      issues.push('Invalid or unsupported GeoJSON geometry or coordinates');
    }
  }
  const hasCentroid = row.centroid_lat !== null || row.centroid_lon !== null;
  if (hasCentroid && (row.centroid_lat === null || row.centroid_lon === null
    || !latitude.safeParse(row.centroid_lat).success || !longitude.safeParse(row.centroid_lon).success)) {
    issues.push('Invalid or incomplete centroid');
  }
  if (hasCentroid && parsed === null) issues.push('Centroid requires reliable geometry');
  if (row.location_confidence === 'resolved_area' && parsed?.type === 'Point') {
    issues.push('Resolved area must not become a precise point');
  }
  if (row.location_role === 'area_only' && parsed?.type === 'Point') {
    issues.push('Area-only location must not become a precise point');
  }
  if (row.location_role === 'unknown' && parsed !== null) {
    issues.push('Unknown location cannot carry geometry');
  }
  if (parsed?.type === 'Point' && !['source_coordinate', 'official_join'].includes(row.location_confidence)) {
    issues.push('Precise point requires source coordinate or official join');
  }
  if (row.location_confidence === 'unverified' && parsed !== null) {
    issues.push('Unverified geometry cannot be published');
  }
  if (row.location_role === 'sensor_site' && !['source_coordinate', 'official_join'].includes(row.location_confidence)) {
    issues.push('Sensor site requires source coordinate or official join');
  }
  if (row.location_confidence === 'resolved_area' && row.location_role !== 'area_only') {
    issues.push('Resolved area confidence requires area-only role');
  }
  return { valid: issues.length === 0, issues, geographicRecord: issues.length === 0 ? row : null };
}
