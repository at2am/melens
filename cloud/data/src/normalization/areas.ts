import { BigQuery } from '@google-cloud/bigquery';

import type { DataConfig } from '../core/config.js';

export interface AreaRef {
  scheme: string;
  code: string;
  vintage: string;
  boundaryId: string;
  name: string;
}

export interface BoundaryVintage {
  scheme: string;
  vintage: string;
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) throw new Error('Invalid area name');
  return trimmed;
}

function validateVintage(value: BoundaryVintage): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.scheme)
    || !/^[0-9A-Za-z._-]+$/.test(value.vintage)) {
    throw new Error('Invalid boundary scheme or vintage');
  }
}

export function comparableAreaIds(from: AreaRef, to: AreaRef,
  explicitMapping: ReadonlyMap<string, string> | null): readonly [string, string] {
  if (from.scheme === to.scheme && from.vintage === to.vintage && from.code === to.code) {
    return [from.boundaryId, to.boundaryId];
  }
  if (explicitMapping?.get(from.boundaryId) !== to.boundaryId) {
    throw new Error('Cross-vintage or cross-scheme comparison requires an explicit boundary mapping');
  }
  return [from.boundaryId, to.boundaryId];
}

/** Match against published official polygons at an explicitly selected vintage. */
export async function resolvePointAreas(input: {
  bigquery: BigQuery;
  config: DataConfig;
  longitude: number;
  latitude: number;
  vintages: readonly BoundaryVintage[];
}): Promise<readonly AreaRef[]> {
  if (input.config.maxBytesBilled === null || input.config.maxBytesBilled === undefined) {
    throw new Error('BQ_MAXIMUM_BYTES_BILLED is required for area queries');
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180
    || !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw new Error('Invalid WGS84 point');
  }
  const areas: AreaRef[] = [];
  for (const vintage of input.vintages) {
    validateVintage(vintage);
    const [rows] = await input.bigquery.query({
      query: `SELECT b.scheme, b.code, b.vintage, b.boundary_id, b.name
        FROM \`${input.config.projectId}.${input.config.queryDataset}.v_boundaries\` AS b
        WHERE b.scheme = @scheme AND b.vintage = @vintage
          AND ST_COVERS(b.geometry, ST_GEOGPOINT(@longitude, @latitude))`,
      params: { scheme: vintage.scheme, vintage: vintage.vintage,
        longitude: input.longitude, latitude: input.latitude },
      location: input.config.region,
      maximumBytesBilled: input.config.maxBytesBilled,
    });
    for (const row of rows) {
      if (typeof row.scheme === 'string' && typeof row.code === 'string'
        && typeof row.vintage === 'string' && typeof row.boundary_id === 'string'
        && typeof row.name === 'string') {
        areas.push({ scheme: row.scheme, code: row.code, vintage: row.vintage,
          boundaryId: row.boundary_id, name: row.name });
      }
    }
  }
  return areas;
}

/** A name lookup returns every candidate. Callers must not invent a point for ambiguous names. */
export async function findNamedAreas(input: {
  bigquery: BigQuery;
  config: DataConfig;
  name: string;
  vintage: BoundaryVintage;
}): Promise<readonly AreaRef[]> {
  if (input.config.maxBytesBilled === null || input.config.maxBytesBilled === undefined) {
    throw new Error('BQ_MAXIMUM_BYTES_BILLED is required for area queries');
  }
  const name = validateName(input.name);
  validateVintage(input.vintage);
  const [rows] = await input.bigquery.query({
    query: `SELECT b.scheme, b.code, b.vintage, b.boundary_id, b.name
      FROM \`${input.config.projectId}.${input.config.queryDataset}.v_boundaries\` AS b
      WHERE b.scheme = @scheme AND b.vintage = @vintage
        AND LOWER(b.name) = LOWER(@name)`,
    params: { scheme: input.vintage.scheme, vintage: input.vintage.vintage, name },
    location: input.config.region,
    maximumBytesBilled: input.config.maxBytesBilled,
  });
  return rows.filter(row => typeof row.scheme === 'string' && typeof row.code === 'string'
    && typeof row.vintage === 'string' && typeof row.boundary_id === 'string'
    && typeof row.name === 'string').map(row => ({
    scheme: row.scheme, code: row.code, vintage: row.vintage,
    boundaryId: row.boundary_id, name: row.name,
  }));
}
