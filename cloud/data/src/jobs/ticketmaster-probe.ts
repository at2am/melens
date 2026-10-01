import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { TicketmasterConnector, parseTicketPage, SOURCE_ID } from '../connectors/ticketmaster/index.js';
import { ticketmasterUpcomingWindow } from '../connectors/ticketmaster/policy.js';
import { parseConnectorInput, type ConnectorResult } from '../core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest } from '../core/http.js';
import { GcsScheduledRequestStore, withScheduledRequestGuard } from './scheduled-guard.js';

const configSchema = z.object({
  projectId: z.literal('melens-510012'),
  bucketName: z.literal('melens-510012-dev-ingest'),
  sourceId: z.literal(SOURCE_ID),
  cloudRunJob: z.literal('melens-dev-ticketmaster-probe'),
});
const utc = z.iso.datetime({ offset: false });
const offsetTime = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const STATUS_CODES = ['onsale', 'offsale', 'canceled', 'cancelled', 'postponed', 'rescheduled'];
const DIAGNOSTIC_PATHS = new Set([
  'page', 'page.size', 'page.totalElements', 'page.totalPages', 'page.number', '_embedded',
  '_embedded.events', '_embedded.events.[].id', '_embedded.events.[].name', '_embedded.events.[].url',
  '_embedded.events.[].dates', '_embedded.events.[].dates.start',
  '_embedded.events.[].dates.start.dateTime', '_embedded.events.[].dates.start.localDate',
  '_embedded.events.[].dates.start.localTime', '_embedded.events.[].dates.start.dateTBA',
  '_embedded.events.[].dates.start.dateTBD', '_embedded.events.[].dates.start.timeTBA',
  '_embedded.events.[].dates.end', '_embedded.events.[].dates.end.dateTime',
  '_embedded.events.[].dates.timezone', '_embedded.events.[].dates.status',
  '_embedded.events.[].dates.status.code', '_embedded.events.[]._embedded',
  '_embedded.events.[]._embedded.venues', '_embedded.events.[]._embedded.venues.[].id',
  '_embedded.events.[]._embedded.venues.[].name', '_embedded.events.[]._embedded.venues.[].location',
  '_embedded.events.[]._embedded.venues.[].location.latitude',
  '_embedded.events.[]._embedded.venues.[].location.longitude',
  '_embedded.events.[]._embedded.venues.[].country',
  '_embedded.events.[]._embedded.venues.[].country.countryCode',
  '_embedded.events.[]._embedded.venues.[].state',
  '_embedded.events.[]._embedded.venues.[].state.stateCode',
]);
const ISSUE_CODES = new Set(['invalid_type', 'invalid_format', 'invalid_value',
  'too_small', 'too_big', 'unrecognized_keys', 'custom']);

export function ticketmasterSchemaDiagnostics(error: z.ZodError) {
  const diagnostics = new Map<string, number>();
  for (const issue of error.issues) {
    const candidate = issue.path.map(segment => typeof segment === 'number' ? '[]'
      : typeof segment === 'string' ? segment : 'unknown').join('.');
    const path = DIAGNOSTIC_PATHS.has(candidate) ? candidate : 'other_schema_path';
    const code = ISSUE_CODES.has(issue.code) ? issue.code : 'other_schema_issue';
    const label = `${path}:${code}`;
    diagnostics.set(label, (diagnostics.get(label) ?? 0) + 1);
  }
  return Object.fromEntries(diagnostics);
}

export function ticketmasterProbeConfig(env: NodeJS.ProcessEnv) {
  const config = configSchema.safeParse({
    projectId: env.GOOGLE_CLOUD_PROJECT,
    bucketName: env.GCS_BUCKET,
    sourceId: env.MELENS_SOURCE_ID,
    cloudRunJob: env.CLOUD_RUN_JOB,
  });
  if (!config.success || !env.TICKETMASTER_DISCOVERY_API_KEY?.trim()) {
    throw new Error('Ticketmaster probe requires its dedicated Cloud Run job and injected secret');
  }
  return config.data;
}

/** Response values remain in memory; telemetry contains fixed labels and counts. */
export class TicketmasterProbeHttpClient extends HttpClient {
  readonly #futureEventIds = new Set<string>();
  readonly #futureVenueIds = new Set<string>();
  readonly #statusCounts = new Map(STATUS_CODES.map(status => [status, 0]));
  #unknownStatusCount = 0;
  #requests = 0;
  readonly #httpStatusCounts = new Map<number, number>();
  #schemaDiagnostics: Record<string, number> = {};

  constructor(private readonly window: { from: string; to: string }) { super(); }

  override async getJson(request: HttpRequest) {
    this.#requests += 1;
    let response;
    try {
      response = await super.getJson({ ...request, maxAttempts: 1, redirect: 'error' });
      this.#httpStatusCounts.set(response.status,
        (this.#httpStatusCounts.get(response.status) ?? 0) + 1);
    } catch (error) {
      if (error instanceof HttpFailure && error.status !== null) {
        this.#httpStatusCounts.set(error.status, (this.#httpStatusCounts.get(error.status) ?? 0) + 1);
      }
      throw error;
    }
    let page;
    try { page = parseTicketPage(response.body); }
    catch (error) {
      if (error instanceof z.ZodError) this.#schemaDiagnostics = ticketmasterSchemaDiagnostics(error);
      throw error;
    }
    for (const event of page._embedded?.events ?? []) {
      const status = event.dates.status?.code.toLowerCase() ?? 'unknown';
      const statusCount = this.#statusCounts.get(status);
      if (statusCount === undefined) this.#unknownStatusCount += 1;
      else this.#statusCounts.set(status, statusCount + 1);
      const start = offsetTime.safeParse(event.dates.start.dateTime);
      if (!start.success || !['onsale', 'offsale', 'rescheduled'].includes(status)
        || event.dates.start.dateTBA || event.dates.start.dateTBD
        || Date.parse(start.data) < Date.parse(this.window.from)
        || Date.parse(start.data) >= Date.parse(this.window.to)) continue;
      this.#futureEventIds.add(event.id);
      for (const venue of event._embedded?.venues ?? []) {
        if (venue.id?.trim()) this.#futureVenueIds.add(venue.id.trim());
      }
    }
    return response;
  }

  summary() {
    return {
      request_attempts: this.#requests,
      http_status_counts: Object.fromEntries(this.#httpStatusCounts),
      schema_issue_counts: this.#schemaDiagnostics,
      provider_status_counts: Object.fromEntries([...this.#statusCounts,
        ['unknown', this.#unknownStatusCount]]),
      eligible_future_event_count: this.#futureEventIds.size,
      eligible_future_distinct_provider_venue_count: this.#futureVenueIds.size,
    };
  }
}

export function ticketmasterProbeSummary(result: ConnectorResult) {
  const completeness = {
    complete: result.completeness.complete,
    expected_records: result.completeness.expected_records === null ? null
      : count.parse(result.completeness.expected_records),
    fetched_records: count.parse(result.completeness.fetched_records),
    expected_pages: result.completeness.expected_pages === null ? null
      : count.parse(result.completeness.expected_pages),
    fetched_pages: count.parse(result.completeness.fetched_pages),
  };
  if (result.kind === 'failure') {
    return { kind: result.kind, source_id: SOURCE_ID, code: result.code,
      checked_at: utc.parse(result.checkedAt), completeness };
  }
  return {
    kind: result.kind, source_id: SOURCE_ID, fetched_at: utc.parse(result.fetchedAt),
    input_count: count.parse(result.inputCount), output_count: count.parse(result.outputCount),
    rejected_count: count.parse(result.rejectedCount), completeness,
    source_record_count: result.sourceRecords.length,
    geo_record_count: result.geoRecords.length,
    located_event_count: result.geoRecords.filter(record => record.geometry_geojson !== null).length,
    events_with_date_count: result.geoRecords.filter(record => record.valid_from !== null).length,
    events_with_source_url_count: result.geoRecords.filter(record => record.original_url !== null).length,
    lifecycle_counts: Object.fromEntries(['active', 'planned', 'cancelled', 'withdrawn', 'resolved']
      .map(status => [status, result.geoRecords.filter(record => record.record_status === status).length])),
  };
}

export async function ticketmasterProbe(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = ticketmasterProbeConfig(env);
  const startedAt = new Date().toISOString();
  const window = ticketmasterUpcomingWindow(startedAt);
  const client = new TicketmasterProbeHttpClient(window);
  const connector = new TicketmasterConnector(client,
    () => env.TICKETMASTER_DISCOVERY_API_KEY, () => startedAt);
  const input = parseConnectorInput({ sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'private-probe' }, checkpoint: null,
    runId: `private_probe_${randomUUID()}` });
  const store = new GcsScheduledRequestStore(new Storage({ projectId: config.projectId }),
    config.bucketName);
  const result = await withScheduledRequestGuard(store,
    { sourceId: SOURCE_ID, dailyCap: 40, executionCap: 10 }, () => connector.collect(input));
  process.stdout.write(JSON.stringify({ ...ticketmasterProbeSummary(result),
    ...client.summary(), published: false, raw_retained: false }) + '\n');
  if (result.kind === 'failure') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ticketmasterProbe().catch(() => {
    process.stderr.write(JSON.stringify({ kind: 'failure', code: 'ticketmaster_probe_failed',
      published: false, raw_retained: false }) + '\n');
    process.exitCode = 1;
  });
}
