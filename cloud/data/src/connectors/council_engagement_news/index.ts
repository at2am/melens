import { z } from 'zod';

import type { Connector, ConnectorErrorCode, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { ENGAGEMENT_COUNCILS, LGA_VINTAGE, type EngagementCouncil } from '../council_engagement/councils.js';
import {
  COUNCIL_CONCURRENCY, COUNCIL_RETRY_DELAYS_MS, CouncilEngagementConnector, EngagementSourceError,
  melbourneDateStart, projectArea, REQUEST_GAP_MS, USER_AGENT, type EngagementProject,
} from '../council_engagement/index.js';

export const SOURCE_ID = 'victoria.council.engagement_news';
/** Sitemaps lag a day or two; two weeks re-reads every recent change on each daily run. */
export const DEFAULT_LOOKBACK_DAYS = 14;
export const MAX_LOOKBACK_DAYS = 365;
/** Unreadable pages are retried by later runs inside the lookback window. */
export const MAX_FAILED_PAGES = 2;
export const MAX_FAILED_SHARE = 0.1;

const NEWS_MARKER = 'page-type-news-full';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];
const DATE_TEXT = new RegExp(`\\b(\\d{1,2}) (${MONTHS.join('|')}) (20\\d{2})\\b`, 'i');
const lastmodSchema = z.union([z.iso.datetime({ offset: true }), z.iso.date()]);

export interface SitemapPage { url: string; lastmod: string }

export interface NewsPage {
  title: string;
  /** The project named in the page title, when the title carries one. */
  projectName: string | null;
  /** Calendar date shown under the headline, YYYY-MM-DD. */
  date: string | null;
}

/** Snapshot revision "latest" reads two weeks; "lookback-90d" backfills 90 days. */
export function lookbackDays(revision: string): number {
  if (revision === 'latest') return DEFAULT_LOOKBACK_DAYS;
  const days = Number(/^lookback-(\d{1,3})d$/.exec(revision)?.[1]);
  if (!Number.isInteger(days) || days < 1 || days > MAX_LOOKBACK_DAYS) {
    throw new EngagementSourceError('validation_failed', 'Unsupported lookback revision');
  }
  return days;
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number(lower.slice(1)));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[lower] ?? '';
  });
}

/**
 * Same-host pages two path segments deep ("/project/page") changed since the
 * cutoff. Project news and project subpages both live there; the page itself
 * tells them apart.
 */
export function parseSitemap(xml: string, host: string, since: number): SitemapPage[] {
  if (!/<urlset\b/.test(xml)) {
    throw new EngagementSourceError('schema_changed', `No sitemap url set for ${host}`);
  }
  const pages = new Map<string, SitemapPage>();
  for (const [entry] of xml.matchAll(/<url>[\s\S]*?<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(entry)?.[1];
    const lastmod = lastmodSchema.safeParse(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(entry)?.[1]);
    if (!loc || !lastmod.success) continue;
    let url: URL;
    try { url = new URL(decodeEntities(loc)); } catch { continue; }
    if (url.protocol !== 'https:' || url.host !== host || url.search) continue;
    const segments = url.pathname.split('/').filter(Boolean);
    const modified = Date.parse(lastmod.data);
    if (segments.length !== 2 || !Number.isFinite(modified) || modified < since) continue;
    const normalized = `https://${host}/${segments.join('/')}`;
    pages.set(normalized, { url: normalized, lastmod: new Date(modified).toISOString() });
  }
  return [...pages.values()].sort((a, b) => a.url.localeCompare(b.url));
}

/** Null for anything that is not a news page, such as a project subpage. */
export function parseNewsPage(html: string): NewsPage | null {
  const marker = html.indexOf(NEWS_MARKER);
  if (marker < 0) return null;
  const ogTitle = /<meta\s+property="og:title"\s+content="([^"]*)"/.exec(html)?.[1];
  const full = ogTitle === undefined ? '' : decodeEntities(ogTitle).trim();
  if (!full) throw new EngagementSourceError('schema_changed', 'News page has no title');
  const split = full.lastIndexOf(' | ');
  const title = (split > 0 ? full.slice(0, split) : full).trim();
  const projectName = split > 0 ? full.slice(split + 3).trim() || null : null;
  const shown = DATE_TEXT.exec(html.slice(marker));
  const date = shown ? [shown[3], String(MONTHS.indexOf((shown[2] as string).toLowerCase()) + 1).padStart(2, '0'),
    (shown[1] as string).padStart(2, '0')].join('-') : null;
  return { title: title.slice(0, 500), projectName, date };
}

export function normalizeNews(council: EngagementCouncil, page: SitemapPage, news: NewsPage,
  project: EngagementProject | null, input: ConnectorInput, fetchedAt: string): {
    sourceRecord: SourceRecord; geoRecord: GeoRecord; geoRecordSource: GeoRecordSource } {
  const path = new URL(page.url).pathname;
  const id = sourceRecordId({ sourceId: SOURCE_ID, nativeId: `${council.id}:${path}`,
    originalUrl: null, sourceTime: null });
  let publishedAt: string | null = null;
  try { publishedAt = news.date === null ? null : melbourneDateStart(news.date); } catch { publishedAt = null; }
  const sourceVersion = sourceVersionId(page.lastmod, { url: page.url, title: news.title,
    project: news.projectName, date: news.date });
  // Location comes from the parent project, so it is part of the derived
  // geographic version only, as GDELT location classification is.
  const area = project === null
    ? { suburbs: [] as string[], councilWide: true, areaRefs: [`ASGS_LGA:${council.lgaCode}:${LGA_VINTAGE}`] }
    : projectArea(council, project);
  const projectName = project?.projectName ?? news.projectName;
  const geoVersion = sourceVersionId(page.lastmod, { sourceVersion, areaRefs: area.areaRefs,
    projectUrl: project?.projectPath ?? null });
  const provenance = { batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
    fetched_at: fetchedAt } as const;
  const sourceRecord: SourceRecord = { ...provenance, source_record_id: id, version_id: sourceVersion,
    original_url: page.url, raw_uri: null, published_at: publishedAt, observed_at: null,
    first_accessible_at: null, time_missing_reason: publishedAt === null ? 'News page shows no date' : null,
    valid_from: null, valid_to: null, source_updated_at: page.lastmod, source_version_ordinal: null,
    record_status: 'active', assertion_kind: 'report', rights_status: 'restricted' };
  // Facts composed by Melens; the council's article text is never stored.
  const summary = JSON.stringify({
    news_scope: council.id === 'melbourne' ? 'city' : 'greater_melbourne',
    summary_text: `Update${projectName ? ` on "${projectName}"` : ''} from ${council.name}`,
    council: council.name, project_name: projectName, project_url: project?.projectPath ?? null,
    area: area.councilWide ? 'council-wide' : area.suburbs,
    location_reason: project === null ? 'council_only' : 'parent_project',
    attribution: { name: council.name, url: page.url },
  });
  const geoRecord: GeoRecord = { ...provenance, geo_record_id: id, version_id: geoVersion,
    topic: 'news', assertion_kind: 'report', title: news.title, summary, original_url: page.url,
    geometry_geojson: null, centroid_lat: null, centroid_lon: null, location_role: 'area_only',
    location_confidence: 'resolved_area', area_refs: area.areaRefs, published_at: publishedAt,
    observed_at: null, valid_from: null, valid_to: null, source_updated_at: page.lastmod,
    source_version_ordinal: null, freshness_state: 'unknown', record_status: 'active',
    rights_status: 'restricted', public_query_allowed: true };
  const geoRecordSource: GeoRecordSource = { ...provenance, geo_record_id: id, version_id: geoVersion,
    source_record_id: id, source_version_id: sourceVersion, evidence_role: 'council_engagement_news',
    original_url: page.url };
  return { sourceRecord, geoRecord, geoRecordSource };
}

interface CouncilNews {
  council: EngagementCouncil;
  items: { page: SitemapPage; news: NewsPage; project: EngagementProject | null }[];
  failedPages: number;
}

function failure(input: ConnectorInput, code: ConnectorErrorCode, message: string, pages: number,
  retryAfterSeconds: number | null = null): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code, message, retryAfterSeconds,
    completeness: { complete: false, expected_records: null, fetched_records: 0, expected_pages: null,
      fetched_pages: pages, evidence: 'Every configured council sitemap must be read' },
    sourceLatestUpdateAt: null };
}

export class CouncilEngagementNewsConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  #pages = 0;

  constructor(private readonly client = new HttpClient(),
    private readonly councils: readonly EngagementCouncil[] = ENGAGEMENT_COUNCILS,
    private readonly gapMs = REQUEST_GAP_MS,
    private readonly retryDelaysMs: readonly number[] = COUNCIL_RETRY_DELAYS_MS,
    private readonly now: () => number = () => Date.now()) {}

  private async pause(): Promise<void> {
    if (this.gapMs > 0) await new Promise(resolve => setTimeout(resolve, this.gapMs));
  }

  private async councilNews(council: EngagementCouncil, since: number): Promise<CouncilNews> {
    await this.pause();
    const sitemap = await this.client.getText({ url: `https://${council.host}/sitemap.xml`,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' },
      timeoutMs: 60_000, maxAttempts: 3, redirect: 'manual' });
    this.#pages += 1;
    const candidates = parseSitemap(sitemap.body, council.host, since);
    const found: { page: SitemapPage; news: NewsPage }[] = [];
    let failedPages = 0;
    for (const page of candidates) {
      await this.pause();
      let html: string;
      try {
        html = (await this.client.getText({ url: page.url,
          headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
          timeoutMs: 30_000, maxAttempts: 2, redirect: 'manual' })).body;
        this.#pages += 1;
      } catch (error) {
        if (!(error instanceof HttpFailure)) throw error;
        this.#pages += 1;
        // A redirect leads to the login page of a private project; it is not public news.
        if (error.status === null || error.status < 300 || error.status >= 400) failedPages += 1;
        continue;
      }
      const news = parseNewsPage(html);
      if (news) found.push({ page, news });
    }
    if (failedPages > MAX_FAILED_PAGES && failedPages > MAX_FAILED_SHARE * candidates.length) {
      throw new EngagementSourceError('incomplete_window', `Too many unreadable pages for ${council.id}`);
    }
    // The project list supplies the suburbs; it is read only when news exists.
    const bySlug = new Map<string, EngagementProject>();
    if (found.length > 0) {
      const projects = await new CouncilEngagementConnector(this.client, [council], this.gapMs, [])
        .listProjects(council);
      for (const project of projects.projects) {
        const slug = new URL(project.projectPath).pathname.split('/').filter(Boolean)[0]?.toLowerCase();
        if (slug && !bySlug.has(slug)) bySlug.set(slug, project);
      }
    }
    return { council, failedPages, items: found.map(item => ({ ...item,
      project: bySlug.get(new URL(item.page.url).pathname.split('/')[1]?.toLowerCase() ?? '') ?? null })) };
  }

  private async withRetry(council: EngagementCouncil, since: number): Promise<CouncilNews> {
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.councilNews(council, since); }
      catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (!(error instanceof HttpFailure) || delay === undefined) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    this.#pages = 0;
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'snapshot') {
      return failure(input, 'validation_failed', 'Council engagement news reads sitemap snapshots only', 0);
    }
    let current = 'none';
    try {
      const since = this.now() - lookbackDays(input.window.revision) * 86_400_000;
      if (new Set(this.councils.map(council => council.id)).size !== this.councils.length) {
        throw new EngagementSourceError('validation_failed', 'Duplicate council ID');
      }
      const results = new Array<CouncilNews | undefined>(this.councils.length);
      let next = 0;
      let failed: unknown = null;
      const worker = async (): Promise<void> => {
        while (failed === null && next < this.councils.length) {
          const index = next++;
          const council = this.councils[index] as EngagementCouncil;
          try { results[index] = await this.withRetry(council, since); }
          catch (error) {
            if (failed === null) { failed = error; current = council.id; }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(COUNCIL_CONCURRENCY, this.councils.length) }, worker));
      if (failed !== null) throw failed;

      const fetchedAt = new Date(this.now()).toISOString();
      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      let rejected = 0;
      for (const result of results as CouncilNews[]) {
        rejected += result.failedPages;
        for (const item of result.items) {
          const rows = normalizeNews(result.council, item.page, item.news, item.project, input, fetchedAt);
          sourceRecords.push(rows.sourceRecord);
          geoRecords.push(rows.geoRecord);
          geoRecordSources.push(rows.geoRecordSource);
        }
      }
      const latest = sourceRecords.map(row => row.source_updated_at as string).sort().at(-1) ?? null;
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt,
        sourceRevision: sourceVersionId(null, sourceRecords.map(row => [row.source_record_id, row.version_id])),
        sourceLatestUpdateAt: latest, checkpointAfter: null,
        completeness: { complete: true, method: 'feed_snapshot', expected_records: null,
          fetched_records: sourceRecords.length + rejected, expected_pages: null, fetched_pages: this.#pages,
          evidence: `${this.councils.length} council sitemaps; every two-level page changed since the lookback cutoff was classified` },
        inputCount: sourceRecords.length + rejected, outputCount: sourceRecords.length, rejectedCount: rejected,
        sourceRecords, geoRecords, geoRecordSources, boundaries: [], areaIndicators: [], parkingBays: [],
        parkingObservations: [], parkingRules: [], sensorLocations: [], pedestrianObservations: [],
        retainableRawRecords: null };
    } catch (error) {
      const code: ConnectorErrorCode = error instanceof EngagementSourceError ? error.code
        : error instanceof HttpFailure ? error.code
          : error instanceof z.ZodError ? 'schema_changed' : 'validation_failed';
      const retryAfterSeconds = error instanceof HttpFailure && error.retryAfterMs !== null
        ? Math.ceil(error.retryAfterMs / 1000) : null;
      return failure(input, code, `Council engagement news failed at ${current}`, this.#pages, retryAfterSeconds);
    }
  }
}

export const connector: Connector = new CouncilEngagementNewsConnector();
