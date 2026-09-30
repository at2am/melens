import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

import type { Connector, ConnectorFailure, ConnectorInput, ConnectorSuccess } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';

export const SOURCE_ID = 'gdelt.news';
const BASE_URL = 'https://data.gdeltproject.org/gdeltv2/';
const FIFTEEN_MINUTES = 900_000;
const MAX_FILES_PER_RUN = 16;
const MAX_ZIP_BYTES = 32_000_000;
const MAX_CSV_BYTES = 100_000_000;
const MAX_ROWS_PER_FILE = 100_000;

export interface GdeltLocationMention {
  name: string;
  countryCode: string;
  adm1Code: string;
  featureId: string | null;
}

export interface GdeltArticleCandidate {
  gkgRecordId: string;
  articleUrl: string;
  gkgProcessedAt: string;
  sourceName: string;
  rawLocationNames: readonly string[];
  victoriaMentions: readonly GdeltLocationMention[];
  themes: readonly string[];
}

export type GdeltSuccess = ConnectorSuccess & {
  /** In-memory metadata for T045/T046; never an assertion of event location. */
  articleCandidates: readonly GdeltArticleCandidate[];
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toUtcTimestamp(gdeltDate: string): string | null {
  if (!/^\d{14}$/.test(gdeltDate)) return null;
  const iso = `${gdeltDate.slice(0, 4)}-${gdeltDate.slice(4, 6)}-${gdeltDate.slice(6, 8)}T${gdeltDate.slice(8, 10)}:${gdeltDate.slice(10, 12)}:${gdeltDate.slice(12, 14)}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function articleUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    for (const key of url.searchParams.keys()) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function parseLocationMentions(raw: string): GdeltLocationMention[] {
  return raw.split(';').flatMap((item) => {
    const fields = item.split('#');
    const name = fields[1]?.trim();
    const countryCode = fields[2]?.trim();
    const adm1Code = fields[3]?.trim();
    if (!name || !countryCode || !adm1Code) return [];
    return [{ name, countryCode, adm1Code, featureId: fields[7]?.trim() || null }];
  });
}

export function parseGkgArchive(bytes: Uint8Array, expectedTimestamp: string): GdeltArticleCandidate[] {
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error('GDELT archive exceeds compressed size limit');
  const entryName = `${expectedTimestamp}.gkg.csv`;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => entry.name === entryName && entry.originalSize <= MAX_CSV_BYTES,
    });
  } catch {
    throw new Error('GDELT archive is invalid');
  }
  const csv = entries[entryName];
  if (!csv) throw new Error('GDELT archive lacks the expected bounded GKG CSV entry');
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(csv).split('\n');
  if (lines.length > MAX_ROWS_PER_FILE + 1) throw new Error('GDELT archive exceeds row limit');
  const candidates: GdeltArticleCandidate[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = line.replace(/\r$/, '').split('\t');
    if (fields.length !== 27) throw new Error('GDELT GKG row does not match the 27-column schema');
    const field = (index: number): string => fields[index] ?? '';
    const processedAt = toUtcTimestamp(field(1));
    const url = articleUrl(field(4));
    if (!field(0) || !processedAt || !url) throw new Error('GDELT GKG row lacks its ID, date, or article URL');
    const mentions = parseLocationMentions(field(10));
    const victoriaMentions = mentions.filter((mention) =>
      mention.countryCode === 'AS' && mention.adm1Code === 'AS07');
    if (victoriaMentions.length === 0) continue;
    candidates.push({
      gkgRecordId: field(0),
      articleUrl: url,
      gkgProcessedAt: processedAt,
      sourceName: field(3),
      rawLocationNames: mentions.map((mention) => mention.name),
      victoriaMentions,
      themes: field(7).split(';').filter(Boolean),
    });
  }
  return candidates;
}

function timestampName(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function failure(input: ConnectorInput, code: ConnectorFailure['code'], message: string,
  fetchedFiles: number, expectedFiles: number, checkedAt: string): ConnectorFailure {
  return {
    kind: 'failure', sourceId: SOURCE_ID, runId: input.runId, checkedAt,
    code, message, retryAfterSeconds: null,
    completeness: {
      complete: false, expected_records: null, fetched_records: 0,
      expected_pages: expectedFiles, fetched_pages: fetchedFiles, evidence: message,
    },
    sourceLatestUpdateAt: null,
  };
}

export class GdeltConnector implements Connector {
  readonly sourceId = SOURCE_ID;

  constructor(private readonly http = new HttpClient(), private readonly baseUrl = BASE_URL) {}

  async collect(input: ConnectorInput): Promise<GdeltSuccess | ConnectorFailure> {
    const checkedAt = new Date().toISOString();
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'time') {
      return failure(input, 'validation_failed', 'GDELT requires its canonical source ID and a UTC time window', 0, 0, checkedAt);
    }
    const from = Date.parse(input.window.from);
    const to = Date.parse(input.window.to);
    const expectedFiles = (to - from) / FIFTEEN_MINUTES;
    if (!Number.isInteger(expectedFiles) || expectedFiles < 1 || expectedFiles > MAX_FILES_PER_RUN
      || from % FIFTEEN_MINUTES !== 0 || to % FIFTEEN_MINUTES !== 0) {
      return failure(input, 'validation_failed', 'GDELT window must align to 15 minutes and contain 1–16 intervals', 0, 0, checkedAt);
    }

    const articles: GdeltArticleCandidate[] = [];
    let fetchedFiles = 0;
    let lastModified: string | null = null;
    for (let timestamp = from; timestamp < to; timestamp += FIFTEEN_MINUTES) {
      const name = timestampName(timestamp);
      const fileUrl = new URL(`${name}.gkg.csv.zip`, this.baseUrl);
      try {
        const response = await this.http.getBytes({ url: fileUrl, timeoutMs: 120_000 });
        const candidates = parseGkgArchive(response.body, name);
        articles.push(...candidates);
        fetchedFiles += 1;
        lastModified = response.lastModified ?? lastModified;
      } catch (error) {
        const code = error instanceof HttpFailure
          ? (error.status === 404 ? 'incomplete_window' : error.code)
          : 'schema_changed';
        return failure(input, code, `GDELT GKG file ${name} could not be fully read`, fetchedFiles, expectedFiles, checkedAt);
      }
    }

    const sourceRecords: SourceRecord[] = [];
    const geoRecords: GeoRecord[] = [];
    const geoRecordSources: GeoRecordSource[] = [];
    const seen = new Set<string>();
    for (const article of articles) {
      const logicalId = digest(`${SOURCE_ID}\0${article.articleUrl}`);
      const versionId = digest(`${article.gkgRecordId}\0${article.gkgProcessedAt}\0${article.rawLocationNames.join(';')}\0${article.themes.join(';')}`);
      const key = `${logicalId}:${versionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const provenance = {
        batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
        fetched_at: checkedAt,
      };
      sourceRecords.push({
        ...provenance, source_record_id: logicalId, version_id: versionId,
        original_url: article.articleUrl, raw_uri: null,
        published_at: null, observed_at: null, first_accessible_at: null,
        time_missing_reason: 'GKG DATE is processing time, not the original article publication or incident time',
        valid_from: null, valid_to: null, source_updated_at: article.gkgProcessedAt,
        source_version_ordinal: null, record_status: 'active', assertion_kind: 'report',
        rights_status: 'review_required',
      });
      geoRecords.push({
        ...provenance, geo_record_id: logicalId, version_id: versionId,
        topic: 'news', assertion_kind: 'report', title: null,
        summary: JSON.stringify({ gdelt_location_mentions: article.rawLocationNames, themes: article.themes }),
        original_url: article.articleUrl, geometry_geojson: null,
        centroid_lat: null, centroid_lon: null, location_role: 'mentioned_place',
        location_confidence: 'unverified', area_refs: [], published_at: null,
        observed_at: null, valid_from: null, valid_to: null,
        source_updated_at: article.gkgProcessedAt, source_version_ordinal: null,
        freshness_state: 'unknown', record_status: 'active',
        rights_status: 'review_required', public_query_allowed: false,
      });
      geoRecordSources.push({
        ...provenance, geo_record_id: logicalId, version_id: versionId,
        source_record_id: logicalId, source_version_id: versionId,
        evidence_role: 'article_metadata', original_url: article.articleUrl,
      });
    }

    return {
      kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt: checkedAt,
      sourceRevision: lastModified, sourceLatestUpdateAt: new Date(to - FIFTEEN_MINUTES).toISOString(),
      checkpointAfter: input.window.to,
      completeness: {
        complete: true, method: 'feed_snapshot', expected_records: null,
        fetched_records: articles.length,
        expected_pages: expectedFiles, fetched_pages: fetchedFiles,
        evidence: 'Every requested 15-minute GKG ZIP and its 27-column CSV were read',
      },
      inputCount: articles.length, outputCount: sourceRecords.length,
      rejectedCount: articles.length - sourceRecords.length,
      sourceRecords, geoRecords, geoRecordSources,
      boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
      parkingRules: [], sensorLocations: [], pedestrianObservations: [],
      retainableRawRecords: null,
      articleCandidates: articles,
    };
  }
}

export const connector = new GdeltConnector();
