import { createHash } from 'node:crypto';
import type { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { ConnectorSuccess } from '../core/connector.js';
import type { DataConfig } from '../core/config.js';
import type { AreaRef } from './areas.js';
import { classifyGdeltMentions } from './news-location.js';

const areaSchema = z.object({
  scheme: z.string().min(1), code: z.string().min(1), vintage: z.string().min(1),
  boundary_id: z.string().min(1), name: z.string().min(1),
});
const mentionSchema = z.object({
  name: z.string().min(1), countryCode: z.string().min(1), adm1Code: z.string().min(1),
  featureId: z.string().nullable(),
});
const candidatesSchema = z.array(z.object({
  articleUrl: z.url(), title: z.string().nullable(), gkgProcessedAt: z.iso.datetime(),
  locationMentions: z.array(mentionSchema), rawLocationNames: z.array(z.string()),
  themes: z.array(z.string()),
}));

/** Resolve mention names against an explicit published official area catalogue. */
export function normalizeGdeltNews(result: ConnectorSuccess, areas: readonly AreaRef[]): ConnectorSuccess {
  if (result.sourceId !== 'gdelt.news') return result;
  if (!('articleCandidates' in result)) throw new Error('GDELT article metadata is missing');
  const candidates = candidatesSchema.parse(result.articleCandidates);
  const byUrl = new Map(candidates.map(candidate => [candidate.articleUrl, candidate]));
  const versions = new Map<string, string>();
  const geoRecords = result.geoRecords.map(record => {
    const candidate = record.original_url === null ? undefined : byUrl.get(record.original_url);
    if (!candidate) throw new Error('GDELT geographic record lacks matching source metadata');
    const location = classifyGdeltMentions(candidate.locationMentions, areas);
    const version = createHash('sha256').update(JSON.stringify({
      sourceVersion: record.version_id, policy: 'gdelt-mentions-v1', location,
    })).digest('hex');
    versions.set(record.geo_record_id, version);
    return {
      ...record, version_id: version, title: candidate.title,
      location_role: location.locationRole, location_confidence: location.locationConfidence,
      geometry_geojson: null, centroid_lat: null, centroid_lon: null, area_refs: location.areaRefs,
      summary: JSON.stringify({
        gdelt_location_mentions: candidate.rawLocationNames,
        gdelt_location_evidence: candidate.locationMentions, themes: candidate.themes,
        news_scope: location.scope, location_reason: location.reason,
        gdelt_processed_at: candidate.gkgProcessedAt,
        publication_time_status: 'not_provided', event_grouping: 'normalized_article_url',
        attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' },
      }),
    };
  });
  const geoRecordSources = result.geoRecordSources.map(link => {
    const version = versions.get(link.geo_record_id);
    if (!version) throw new Error('GDELT source link lacks a matching geographic record');
    return { ...link, version_id: version };
  });
  return {
    ...result, geoRecords, geoRecordSources,
    sourceRevision: createHash('sha256').update(JSON.stringify({
      upstream: result.sourceRevision, versions: [...versions.entries()].sort(),
    })).digest('hex'),
  };
}

/** Read only admitted current boundary facts, without copying polygon centroids into news. */
export async function withPublishedNewsLocations(result: ConnectorSuccess, config: DataConfig,
  bigquery: BigQuery): Promise<ConnectorSuccess> {
  if (result.sourceId !== 'gdelt.news') return result;
  if (config.maxBytesBilled == null) throw new Error('BQ_MAXIMUM_BYTES_BILLED is required for news areas');
  const [rows] = await bigquery.query({
    query: `SELECT scheme, code, vintage, boundary_id, name
      FROM \`${config.projectId}.${config.queryDataset}.v_boundaries\`
      WHERE ((UPPER(scheme) IN ('ASGS_GCCSA', 'ASGS_STE', 'ASGS_SA2') AND vintage = '2026')
        OR (UPPER(scheme) = 'ASGS_LGA' AND vintage = '2025')
        OR (UPPER(scheme) = 'COM_MUNICIPAL' AND vintage = '2008-07-01'))
      QUALIFY ROW_NUMBER() OVER (PARTITION BY boundary_id ORDER BY fetched_at DESC) = 1`,
    location: config.region, maximumBytesBilled: config.maxBytesBilled,
  });
  const areas = z.array(areaSchema).parse(rows).map(row => ({
    scheme: row.scheme, code: row.code, vintage: row.vintage,
    boundaryId: row.boundary_id, name: row.name,
  }));
  if (areas.length === 0) throw new Error('Published official news boundary catalogue is empty');
  return normalizeGdeltNews(result, areas);
}
