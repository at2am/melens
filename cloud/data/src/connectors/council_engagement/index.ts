import { z } from 'zod';

import type { Connector, ConnectorErrorCode, ConnectorInput, ConnectorResult } from '../../core/connector.js';
import { HttpClient, HttpFailure } from '../../core/http.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../core/types.js';
import { sourceRecordId, sourceVersionId } from '../../validation/record.js';
import { ENGAGEMENT_COUNCILS, LGA_VINTAGE, type EngagementCouncil } from './councils.js';

export const SOURCE_ID = 'victoria.council.engagement';
/** Identifies the crawler honestly; the sites' robots.txt allows all agents with a 1 s delay. */
export const USER_AGENT = 'MelensDataBot/0.1 (+https://github.com/at2am/melens)';
export const REQUEST_GAP_MS = 1_000;
/** Different councils are different hosts; the gap applies within each host. */
export const COUNCIL_CONCURRENCY = 4;
/** Sites behind Cloudflare return occasional 404s and timeouts; a council is retried whole. */
export const COUNCIL_RETRY_DELAYS_MS = [5_000, 15_000] as const;
/** Melton and Wyndham page their lists three or four projects at a time. */
export const MAX_PAGES_PER_BLOCK = 150;
/** More listed suburbs than this means a council-wide project, not a local one. */
export const MAX_LOCAL_SUBURBS = 6;
/** Some councils tag every category; the summary names the first few. */
export const MAX_SUMMARY_CATEGORIES = 4;
/** Individually malformed cards are skipped; more than this signals a changed format. */
export const MAX_REJECTED_PER_COUNCIL = 2;
export const MAX_REJECTED_SHARE = 0.05;

const LIST_ROUTE = /^\/ccm\/the_hive_projects\/tools\/the_hive_projects_list\/load_more\/(\d+)$/;

const projectSchema = z.object({
  projectID: z.number().int().positive(),
  projectName: z.string().trim().min(1).max(500),
  projectStatus: z.enum(['Open', 'Active', 'Closed']),
  projectPath: z.url(),
  projectDateNum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  projectLocationArray: z.array(z.string()).nullable().optional(),
  projectCategoryArray: z.array(z.string()).nullable().optional(),
}).passthrough();

const pageSchema = z.object({
  result: z.array(z.object({ projectID: z.unknown() }).passthrough()),
  moreToLoad: z.boolean(),
}).passthrough();

export type EngagementProject = z.infer<typeof projectSchema>;

export class EngagementSourceError extends Error {
  constructor(readonly code: ConnectorErrorCode, message: string) {
    super(message);
    this.name = 'EngagementSourceError';
  }
}

/** Find the project-list blocks on a listing page. Only same-host list routes are accepted. */
export function discoverListRoutes(html: string, host: string): string[] {
  const routes = new Set<string>();
  for (const match of html.matchAll(/<section\b[^>]*>/g)) {
    const tag = match[0];
    if (!/\bclass="[^"]*\bprojects-list\b/.test(tag)) continue;
    const route = /\bdata-route="([^"]+)"/.exec(tag)?.[1];
    if (!route) continue;
    let url: URL;
    try { url = new URL(route.replaceAll('&amp;', '&')); } catch { continue; }
    if (url.protocol !== 'https:' || url.host !== host || !LIST_ROUTE.test(url.pathname)) continue;
    routes.add(`https://${host}${url.pathname}`);
  }
  return [...routes].sort();
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Suburb names as listed by the council; "Albert Park/ Middle Park" names two suburbs. */
export function listedSuburbs(project: EngagementProject): string[] {
  const names = new Set<string>();
  for (const entry of project.projectLocationArray ?? []) {
    for (const part of entry.split('/')) {
      const name = part.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Melbourne local midnight of a calendar date, as a UTC timestamp. */
export function melbourneDateStart(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day);
  if (new Date(utcMidnight).toISOString().slice(0, 10) !== date) throw new Error('Invalid project date');
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', timeZoneName: 'longOffset',
  }).formatToParts(new Date(utcMidnight));
  const offset = /GMT([+-])(\d{2}):(\d{2})/.exec(
    parts.find(part => part.type === 'timeZoneName')?.value ?? '');
  if (!offset) throw new Error('Cannot resolve the Melbourne UTC offset');
  const minutes = (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3]));
  return new Date(utcMidnight - minutes * 60_000).toISOString();
}

/** LGA reference plus listed suburbs, or the LGA alone for council-wide projects. */
export function projectArea(council: EngagementCouncil, project: EngagementProject):
  { suburbs: string[]; councilWide: boolean; areaRefs: string[] } {
  const suburbs = listedSuburbs(project);
  const councilWide = suburbs.length === 0 || suburbs.length > MAX_LOCAL_SUBURBS;
  return { suburbs, councilWide, areaRefs: [`ASGS_LGA:${council.lgaCode}:${LGA_VINTAGE}`,
    ...(councilWide ? [] : suburbs.map(name => `suburb:${slugify(name)}`))] };
}

export function normalizeProjects(council: EngagementCouncil, projects: readonly EngagementProject[],
  input: ConnectorInput, fetchedAt: string): { sourceRecords: SourceRecord[]; geoRecords: GeoRecord[];
    geoRecordSources: GeoRecordSource[] } {
  const sourceRecords: SourceRecord[] = [];
  const geoRecords: GeoRecord[] = [];
  const geoRecordSources: GeoRecordSource[] = [];
  for (const project of projects) {
    const url = new URL(project.projectPath);
    if (url.protocol !== 'https:' || url.host !== council.host) {
      throw new EngagementSourceError('schema_changed', `Project link left the ${council.id} site`);
    }
    const originalUrl = url.toString();
    const { suburbs, councilWide, areaRefs } = projectArea(council, project);
    const categories = [...new Set((project.projectCategoryArray ?? [])
      .map(entry => entry.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const publishedAt = project.projectDateNum === null ? null : melbourneDateStart(project.projectDateNum);
    const closed = project.projectStatus === 'Closed';
    const id = sourceRecordId({ sourceId: SOURCE_ID, nativeId: `${council.id}:${project.projectID}`,
      originalUrl: null, sourceTime: null });
    // Only the fields Melens retains define a version; card images and the
    // council's own description text are deliberately excluded.
    const version = sourceVersionId(null, {
      council: council.id, name: project.projectName, status: project.projectStatus,
      url: originalUrl, date: project.projectDateNum, suburbs, categories,
    });
    const provenance = { batch_id: input.runId, source_id: SOURCE_ID, schema_version: 1,
      fetched_at: fetchedAt } as const;
    sourceRecords.push({ ...provenance, source_record_id: id, version_id: version,
      original_url: originalUrl, raw_uri: null, published_at: publishedAt, observed_at: null,
      first_accessible_at: null,
      time_missing_reason: publishedAt === null ? 'Project card has no date' : null,
      valid_from: null, valid_to: null, source_updated_at: null, source_version_ordinal: null,
      record_status: 'active', assertion_kind: 'plan', rights_status: 'restricted' });
    // The summary is composed by Melens from listed facts. It never copies the
    // council's project description, which the site terms do not license.
    const summary = [
      `Community consultation by ${council.name}`,
      `status: ${project.projectStatus}`,
      ...(categories.length ? [`categories: ${categories.slice(0, MAX_SUMMARY_CATEGORIES).join(', ')}${
        categories.length > MAX_SUMMARY_CATEGORIES ? ` +${categories.length - MAX_SUMMARY_CATEGORIES} more` : ''}`] : []),
      councilWide ? 'area: council-wide' : `suburbs: ${suburbs.join(', ')}`,
    ].join('; ');
    geoRecords.push({ ...provenance, geo_record_id: id, version_id: version,
      topic: 'planning', assertion_kind: 'plan', title: project.projectName, summary,
      original_url: originalUrl, geometry_geojson: null, centroid_lat: null, centroid_lon: null,
      location_role: 'area_only', location_confidence: 'resolved_area',
      area_refs: areaRefs,
      published_at: publishedAt, observed_at: null, valid_from: null, valid_to: null,
      source_updated_at: null, source_version_ordinal: null, freshness_state: 'unknown',
      record_status: closed ? 'resolved' : 'active', rights_status: 'restricted',
      public_query_allowed: true });
    geoRecordSources.push({ ...provenance, geo_record_id: id, version_id: version,
      source_record_id: id, source_version_id: version, evidence_role: 'council_engagement_project',
      original_url: originalUrl });
  }
  return { sourceRecords, geoRecords, geoRecordSources };
}

function failure(input: ConnectorInput, code: ConnectorErrorCode, message: string,
  fetchedRecords: number, fetchedPages: number, retryAfterSeconds: number | null = null): ConnectorResult {
  return { kind: 'failure', sourceId: SOURCE_ID, runId: input.runId,
    checkedAt: new Date().toISOString(), code, message, retryAfterSeconds,
    completeness: { complete: false, expected_records: null, fetched_records: fetchedRecords,
      expected_pages: null, fetched_pages: fetchedPages,
      evidence: 'Every configured council must return at least one project from fully paged lists' },
    sourceLatestUpdateAt: null };
}

export class CouncilEngagementConnector implements Connector {
  readonly sourceId = SOURCE_ID;
  #pages = 0;

  constructor(private readonly client = new HttpClient(),
    private readonly councils: readonly EngagementCouncil[] = ENGAGEMENT_COUNCILS,
    private readonly gapMs = REQUEST_GAP_MS,
    private readonly retryDelaysMs: readonly number[] = COUNCIL_RETRY_DELAYS_MS) {}

  private async pause(): Promise<void> {
    if (this.gapMs > 0) await new Promise(resolve => setTimeout(resolve, this.gapMs));
  }

  /**
   * All listed projects of one council. Only HTTP failures are retried; a
   * changed page format fails at once. The news connector reuses this.
   */
  async listProjects(council: EngagementCouncil):
    Promise<{ projects: EngagementProject[]; rejected: number }> {
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.councilProjects(council); }
      catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (!(error instanceof HttpFailure) || delay === undefined) throw error;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private async councilProjects(council: EngagementCouncil):
    Promise<{ projects: EngagementProject[]; rejected: number }> {
    const routes = new Set<string>();
    for (const path of council.listingPaths) {
      await this.pause();
      const page = await this.client.getText({ url: `https://${council.host}${path}`,
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
        timeoutMs: 30_000, maxAttempts: 3, redirect: 'follow' });
      this.#pages += 1;
      for (const route of discoverListRoutes(page.body, council.host)) routes.add(route);
    }
    if (routes.size === 0) {
      throw new EngagementSourceError('schema_changed', `No project lists found for ${council.id}`);
    }
    const projects = new Map<number, EngagementProject>();
    const rejected = new Set<string>();
    for (const route of [...routes].sort()) {
      for (let page = 0; ; page += 1) {
        if (page >= MAX_PAGES_PER_BLOCK) {
          throw new EngagementSourceError('incomplete_window', `Too many pages for ${council.id}`);
        }
        await this.pause();
        const url = new URL(route);
        url.searchParams.set('page', String(page));
        const response = await this.client.getJson({ url,
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest' },
          // 'manual' turns a redirect into an HTTP failure whose body is
          // released; 'error' rejects inside fetch and leaves the socket open.
          timeoutMs: 30_000, maxAttempts: 3, redirect: 'manual' });
        this.#pages += 1;
        const body = pageSchema.parse(response.body);
        for (const card of body.result) {
          const parsed = projectSchema.safeParse(card);
          if (!parsed.success) {
            rejected.add(JSON.stringify(card.projectID ?? null));
            continue;
          }
          const project = parsed.data;
          const existing = projects.get(project.projectID);
          if (existing && (existing.projectPath !== project.projectPath
            || existing.projectStatus !== project.projectStatus)) {
            throw new EngagementSourceError('schema_changed',
              `Conflicting listings for ${council.id} project ${project.projectID}`);
          }
          projects.set(project.projectID, existing ?? project);
        }
        if (!body.moreToLoad) break;
        if (body.result.length === 0) {
          throw new EngagementSourceError('incomplete_window', `Empty page before the end for ${council.id}`);
        }
      }
    }
    // An empty council would erase its current snapshot; treat it as a broken page.
    if (projects.size === 0) {
      throw new EngagementSourceError('incomplete_window', `No projects listed for ${council.id}`);
    }
    if (rejected.size > MAX_REJECTED_PER_COUNCIL
      && rejected.size > MAX_REJECTED_SHARE * (projects.size + rejected.size)) {
      throw new EngagementSourceError('schema_changed', `Too many malformed projects for ${council.id}`);
    }
    return { projects: [...projects.values()].sort((a, b) => a.projectID - b.projectID),
      rejected: rejected.size };
  }

  async collect(input: ConnectorInput): Promise<ConnectorResult> {
    this.#pages = 0;
    if (input.sourceId !== SOURCE_ID || input.window.kind !== 'snapshot') {
      return failure(input, 'validation_failed', 'Council engagement collects complete snapshots only', 0, 0);
    }
    const collected: [EngagementCouncil, EngagementProject[]][] = [];
    let rejected = 0;
    let current = 'none';
    try {
      if (new Set(this.councils.map(council => council.id)).size !== this.councils.length) {
        throw new EngagementSourceError('validation_failed', 'Duplicate council ID');
      }
      const listed = new Array<{ projects: EngagementProject[]; rejected: number } | undefined>(this.councils.length);
      let next = 0;
      let failed: unknown = null;
      const worker = async (): Promise<void> => {
        while (failed === null && next < this.councils.length) {
          const index = next++;
          const council = this.councils[index] as EngagementCouncil;
          try { listed[index] = await this.listProjects(council); }
          catch (error) {
            if (failed === null) { failed = error; current = council.id; }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(COUNCIL_CONCURRENCY, this.councils.length) }, worker));
      if (failed !== null) throw failed;
      this.councils.forEach((council, index) => {
        const entry = listed[index] as { projects: EngagementProject[]; rejected: number };
        collected.push([council, entry.projects]);
        rejected += entry.rejected;
      });
      // One fetch time per snapshot keeps every row of the batch comparable.
      const fetchedAt = new Date().toISOString();
      const sourceRecords: SourceRecord[] = [];
      const geoRecords: GeoRecord[] = [];
      const geoRecordSources: GeoRecordSource[] = [];
      for (const [council, projects] of collected) {
        current = council.id;
        const normalized = normalizeProjects(council, projects, input, fetchedAt);
        sourceRecords.push(...normalized.sourceRecords);
        geoRecords.push(...normalized.geoRecords);
        geoRecordSources.push(...normalized.geoRecordSources);
      }
      return { kind: 'success', sourceId: SOURCE_ID, runId: input.runId, fetchedAt,
        sourceRevision: sourceVersionId(null, sourceRecords.map(row => [row.source_record_id, row.version_id])),
        sourceLatestUpdateAt: null, checkpointAfter: null,
        completeness: { complete: true, method: 'feed_snapshot', expected_records: null,
          fetched_records: sourceRecords.length, expected_pages: null, fetched_pages: this.#pages,
          evidence: `${this.councils.length} councils; every project-list block paged until moreToLoad=false` },
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
      const fetched = collected.reduce((total, [, projects]) => total + projects.length, 0);
      return failure(input, code, `Council engagement snapshot failed at ${current}`,
        fetched, this.#pages, retryAfterSeconds);
    }
  }
}

export const connector: Connector = new CouncilEngagementConnector();
