import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

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
  title: string | null;
  rawLocationNames: readonly string[];
  locationMentions: readonly GdeltLocationMention[];
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
  const time = Date.parse(iso);
  return !Number.isFinite(time) || new Date(time).toISOString().slice(0, 19) !== iso.slice(0, 19)
    ? null : iso;
}

/** The GKG Extras PAGE_TITLE is metadata supplied by GDELT, not scraped article text. */
export function parsePageTitle(extras: string): string | null {
  const value = /<PAGE_TITLE>([^]*?)<\/PAGE_TITLE>/.exec(extras)?.[1];
  if (!value || value.length > 8_000) return null;
  try {
    const parsed: unknown = new XMLParser({ parseTagValue: false, trimValues: true,
      htmlEntities: true })
      .parse(`<title>${value}</title>`);
    const result = z.object({ title: z.string().trim().min(1).max(2_000) }).safeParse(parsed);
    return result.success ? result.data.title : null;
  } catch { return null; }
}

async function boundedArchive(stream: ReadableStream<Uint8Array<ArrayBuffer>>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_ZIP_BYTES) throw new Error('GDELT archive exceeds compressed size limit');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function articleUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    const keys = [...url.searchParams.keys()];
    for (const key of keys) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseLocationMentions(raw: string): GdeltLocationMention[] {
  const seen = new Set<string>();
  const mentions: GdeltLocationMention[] = [];
  for (const item of raw.split(';')) {
    const fields = item.split('#');
    const name = fields[1]?.trim();
    const countryCode = fields[2]?.trim();
    const adm1Code = fields[3]?.trim();
    if (!name || !countryCode || !adm1Code) continue;
    const featureId = fields[7]?.trim() || null;
    const key = `${countryCode}#${adm1Code}#${name}#${featureId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push({ name, countryCode, adm1Code, featureId });
  }
  return mentions;
}

export function parseGkgArchive(bytes: Uint8Array, expectedTimestamp: string): GdeltArticleCandidate[] {
  if (bytes.byteLength > MAX_ZIP_BYTES) throw new Error('GDELT archive exceeds compressed size limit');
  const entryName = `${expectedTimestamp}.gkg.csv`;
  let entries: Record<string, Uint8Array>;
  let selectedEntries = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (entry) => {
        const selected = entry.name === entryName || entry.name.endsWith(`/${entryName}`)
          || entry.name.toLowerCase() === entryName.toLowerCase();
        if (!selected) return false;
        selectedEntries += 1;
        if (selectedEntries > 1) throw new Error('Duplicate GKG CSV entries');
        return entry.originalSize <= MAX_CSV_BYTES;
      },
    });
  } catch {
    throw new Error('GDELT archive is invalid');
  }
  const entryKey = Object.keys(entries).find((k) =>
    k === entryName || k.endsWith(`/${entryName}`) || k.toLowerCase() === entryName.toLowerCase()
  );
  const csv = entryKey ? entries[entryKey] : undefined;
  if (!csv) throw new Error('GDELT archive lacks the expected bounded GKG CSV entry');
  if (csv.byteLength > MAX_CSV_BYTES) throw new Error('GDELT archive exceeds expanded size limit');
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
      title: parsePageTitle(field(26)),
      rawLocationNames: Array.from(new Set(mentions.map((mention) => mention.name))),
      locationMentions: mentions,
      victoriaMentions,
      themes: Array.from(new Set(field(7).split(';').filter(Boolean))),
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
        const response = await this.http.getStream({ url: fileUrl, timeoutMs: 120_000,
          maxAttempts: 1, redirect: 'error' });
        const candidates = parseGkgArchive(await boundedArchive(response.body), name);
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

    const rawCandidateCount = articles.length;
    // Deduplicate candidate articles by normalized URL (logicalId) within the same window
    const mergedArticles = new Map<string, GdeltArticleCandidate>();

    for (const article of articles) {
      const logicalId = digest(`${SOURCE_ID}\0${article.articleUrl}`);
      const existing = mergedArticles.get(logicalId);
      if (!existing) {
        mergedArticles.set(logicalId, {
          gkgRecordId: article.gkgRecordId,
          articleUrl: article.articleUrl,
          gkgProcessedAt: article.gkgProcessedAt,
          sourceName: article.sourceName,
          title: article.title,
          rawLocationNames: [...article.rawLocationNames],
          locationMentions: [...article.locationMentions],
          victoriaMentions: [...article.victoriaMentions],
          themes: [...article.themes],
        });
      } else {
        // Merge identical article occurring in the same window (e.g. across multiple 15-min intervals or duplicate entries)
        const timeDiff = article.gkgProcessedAt.localeCompare(existing.gkgProcessedAt);
        // Deterministic tie-break: prefer later timestamp; if identical timestamp, tie-break by gkgRecordId string comparison
        const isPreferred = timeDiff > 0 || (timeDiff === 0 && article.gkgRecordId.localeCompare(existing.gkgRecordId) > 0);
        const gkgRecordId = isPreferred ? article.gkgRecordId : existing.gkgRecordId;
        const gkgProcessedAt = isPreferred ? article.gkgProcessedAt : existing.gkgProcessedAt;
        const sourceName = (isPreferred ? article.sourceName : existing.sourceName) || existing.sourceName || article.sourceName;
        const title = isPreferred ? article.title : existing.title;

        // Merge locations and themes deterministically
        const rawLocationNames = Array.from(new Set([...existing.rawLocationNames, ...article.rawLocationNames])).sort();
        const themes = Array.from(new Set([...existing.themes, ...article.themes])).sort();

        // Merge victoriaMentions by unique key and sort deterministically
        const mentionMap = new Map<string, GdeltLocationMention>();
        for (const m of [...existing.locationMentions, ...article.locationMentions]) {
          const key = `${m.countryCode}#${m.adm1Code}#${m.name}#${m.featureId ?? ''}`;
          if (!mentionMap.has(key)) mentionMap.set(key, m);
        }
        const locationMentions = Array.from(mentionMap.values()).sort((a, b) =>
          `${a.countryCode}#${a.adm1Code}#${a.name}#${a.featureId ?? ''}`.localeCompare(
            `${b.countryCode}#${b.adm1Code}#${b.name}#${b.featureId ?? ''}`
          )
        );
        const victoriaMentions = locationMentions.filter(m => m.countryCode === 'AS' && m.adm1Code === 'AS07');

        mergedArticles.set(logicalId, {
          gkgRecordId,
          articleUrl: existing.articleUrl,
          gkgProcessedAt,
          sourceName,
          title,
          rawLocationNames,
          locationMentions,
          victoriaMentions,
          themes,
        });
      }
    }

    const sourceRecords: SourceRecord[] = [];
    const geoRecords: GeoRecord[] = [];
    const geoRecordSources: GeoRecordSource[] = [];

    // Sort entries deterministically by logicalId to ensure replay order is invariant to input order
    const sortedEntries = Array.from(mergedArticles.entries()).sort(([idA], [idB]) => idA.localeCompare(idB));

    for (const [logicalId, article] of sortedEntries) {
      const versionId = digest(JSON.stringify({ gkgRecordId: article.gkgRecordId,
        gkgProcessedAt: article.gkgProcessedAt, title: article.title,
        locationMentions: article.locationMentions, themes: article.themes }));
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
        rights_status: 'verified_open',
      });
      geoRecords.push({
        ...provenance, geo_record_id: logicalId, version_id: versionId,
        topic: 'news', assertion_kind: 'report', title: article.title,
        summary: JSON.stringify({ gdelt_location_mentions: article.rawLocationNames, themes: article.themes }),
        original_url: article.articleUrl, geometry_geojson: null,
        centroid_lat: null, centroid_lon: null, location_role: 'mentioned_place',
        location_confidence: 'unverified', area_refs: [], published_at: null,
        observed_at: null, valid_from: null, valid_to: null,
        source_updated_at: article.gkgProcessedAt, source_version_ordinal: null,
        freshness_state: 'unknown', record_status: 'active',
        rights_status: 'verified_open', public_query_allowed: true,
      });
      geoRecordSources.push({
        ...provenance, geo_record_id: logicalId, version_id: versionId,
        source_record_id: logicalId, source_version_id: versionId,
        evidence_role: 'article_metadata', original_url: article.articleUrl,
      });
    }

    const deduplicatedCandidates = sortedEntries.map(([, article]) => article);

    return {
      kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt: checkedAt,
      sourceRevision: lastModified, sourceLatestUpdateAt: new Date(to - FIFTEEN_MINUTES).toISOString(),
      checkpointAfter: input.window.to,
      completeness: {
        complete: true, method: 'feed_snapshot', expected_records: null,
        fetched_records: rawCandidateCount,
        expected_pages: expectedFiles, fetched_pages: fetchedFiles,
        evidence: 'Every requested 15-minute GKG ZIP and its 27-column CSV were read',
      },
      inputCount: rawCandidateCount, outputCount: sourceRecords.length,
      rejectedCount: rawCandidateCount - sourceRecords.length,
      sourceRecords, geoRecords, geoRecordSources,
      boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
      parkingRules: [], sensorLocations: [], pedestrianObservations: [],
      retainableRawRecords: null,
      articleCandidates: deduplicatedCandidates,
    };
  }
}

export const connector = new GdeltConnector();
