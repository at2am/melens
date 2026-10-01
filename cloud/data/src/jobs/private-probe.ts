import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { TransportGtfsRealtimeConnector } from '../connectors/tv_gtfs_realtime/index.js';
import { PlannedRoadConnector } from '../connectors/tv_road_planned/index.js';
import { UnplannedRoadConnector } from '../connectors/tv_road_unplanned/index.js';
import { parseConnectorInput, type Connector, type ConnectorResult } from '../core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest } from '../core/http.js';
import { GcsScheduledRequestStore, withScheduledRequestGuard } from './scheduled-guard.js';

const sourceSchema = z.enum([
  'victoria.transport.road_unplanned',
  'victoria.transport.road_planned',
  'victoria.transport.gtfs_realtime',
]);
const configSchema = z.object({
  projectId: z.literal('melens-510012'),
  bucketName: z.literal('melens-510012-dev-ingest'),
  sourceId: sourceSchema,
  cloudRunJob: z.literal('melens-dev-transport-probe'),
});

export function privateProbeConfig(env: NodeJS.ProcessEnv) {
  const config = configSchema.safeParse({
    projectId: env.GOOGLE_CLOUD_PROJECT,
    bucketName: env.GCS_BUCKET,
    sourceId: env.MELENS_SOURCE_ID,
    cloudRunJob: env.CLOUD_RUN_JOB,
  });
  if (!config.success || !env.TRANSPORT_VICTORIA_KEY_ID) {
    throw new Error('Private probe requires the reviewed Cloud Run job and secret reference');
  }
  return config.data;
}

function valueType(value: unknown): string {
  return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
}

/** Shape diagnostics contain types of known schema fields, never source values. */
function roadShape(body: unknown) {
  const top = z.object({ meta: z.unknown().optional(), data: z.unknown().optional(),
    features: z.array(z.unknown()).optional() })
    .safeParse(body);
  if (!top.success) return { body_type: valueType(body) };
  const meta = z.object({ total_records: z.unknown().optional(),
    total_pages: z.unknown().optional(), page: z.unknown().optional(),
    count: z.unknown().optional() }).safeParse(top.data.meta);
  const data = z.object({ features: z.array(z.unknown()).optional() }).safeParse(top.data.data);
  const features = (data.success ? data.data.features : undefined) ?? top.data.features ?? [];
  const feature = z.object({ properties: z.record(z.string(), z.unknown()) })
    .safeParse(features[0]);
  const timestampFormats: Record<string, Record<string, number>> = {};
  for (const field of ['created', 'lastUpdated', 'lastClosed', 'endTime', 'nextUpdateDue']) {
    const counts: Record<string, number> = {};
    for (const item of features) {
      const parsed = z.object({ properties: z.record(z.string(), z.unknown()) }).safeParse(item);
      const value = parsed.success ? parsed.data.properties[field] : undefined;
      const format = typeof value !== 'string' ? 'absent_or_not_text'
        : !Number.isFinite(Date.parse(value)) ? 'invalid'
          : /Z$/i.test(value) ? 'explicit_utc'
            : /[+-]\d{2}:?\d{2}$/.test(value) ? 'explicit_offset' : 'offsetless';
      counts[format] = (counts[format] ?? 0) + 1;
    }
    timestampFormats[field] = counts;
  }
  return {
    meta_type: valueType(top.data.meta),
    meta_field_types: meta.success ? Object.fromEntries(
      Object.entries(meta.data).map(([key, value]) => [key, valueType(value)])) : null,
    data_type: valueType(top.data.data),
    page_feature_count: features.length,
    property_field_types: feature.success ? Object.fromEntries([
      'id', 'impactId', 'status', 'eventLocationStatus', 'created', 'lastUpdated', 'lastClosed',
    ].map(key => [key, valueType(feature.data.properties[key])])) : null,
    timestamp_formats_by_field: timestampFormats,
  };
}

class PrivateProbeHttpClient extends HttpClient {
  private nextRequestAt = 0;
  readonly diagnostics: unknown[] = [];

  private async pace() {
    const wait = this.nextRequestAt - Date.now();
    if (wait > 0) await delay(wait);
    this.nextRequestAt = Date.now() + 3100;
  }

  private boundedRequest(request: HttpRequest): HttpRequest {
    const deadline = AbortSignal.timeout(request.timeoutMs ?? 20_000);
    return { ...request, maxAttempts: 1, redirect: 'error',
      signal: request.signal ? AbortSignal.any([request.signal, deadline]) : deadline };
  }

  override async getJson(request: HttpRequest) {
    await this.pace();
    try {
      const response = await super.getJson(this.boundedRequest(request));
      this.diagnostics.push({ http_status: response.status, shape: roadShape(response.body) });
      return response;
    } catch (error) {
      if (error instanceof HttpFailure) {
        this.diagnostics.push({ http_status: error.status, code: error.code });
      }
      throw error;
    }
  }

  override async getBytes(request: HttpRequest) {
    await this.pace();
    try {
      const response = await super.getBytes(this.boundedRequest(request));
      this.diagnostics.push({ http_status: response.status, response_bytes: response.body.length });
      return response;
    } catch (error) {
      if (error instanceof HttpFailure) {
        this.diagnostics.push({ http_status: error.status, code: error.code });
      }
      throw error;
    }
  }
}

export function privateProbeSummary(result: ConnectorResult) {
  return result.kind === 'success' ? {
    kind: result.kind, source_id: result.sourceId, fetched_at: result.fetchedAt,
    source_latest_update_at: result.sourceLatestUpdateAt,
    input_count: result.inputCount, output_count: result.outputCount,
    rejected_count: result.rejectedCount, completeness: result.completeness,
    geo_records: result.geoRecords.length,
    located_records: result.geoRecords.filter(record => record.geometry_geojson !== null).length,
    future_source_timestamp_count: result.sourceRecords.filter(record =>
      record.source_updated_at !== null
      && Date.parse(record.source_updated_at) > Date.parse(result.fetchedAt) + 300_000).length,
  } : {
    kind: result.kind, source_id: result.sourceId, code: result.code,
    checked_at: result.checkedAt, completeness: result.completeness,
  };
}

export async function privateProbe(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = privateProbeConfig(env);
  const client = new PrivateProbeHttpClient();
  const connector: Connector = config.sourceId === 'victoria.transport.road_unplanned'
    ? new UnplannedRoadConnector(client)
    : config.sourceId === 'victoria.transport.road_planned'
      ? new PlannedRoadConnector(client) : new TransportGtfsRealtimeConnector(client);
  const input = parseConnectorInput({ sourceId: config.sourceId,
    window: { kind: 'snapshot', revision: 'private-probe' }, checkpoint: null,
    runId: `private_probe_${randomUUID()}` });
  const store = new GcsScheduledRequestStore(new Storage({ projectId: config.projectId }),
    config.bucketName);
  const result = await withScheduledRequestGuard(store,
    { sourceId: config.sourceId, dailyCap: 100, executionCap: 20 },
    () => connector.collect(input));
  process.stdout.write(JSON.stringify({ ...privateProbeSummary(result),
    diagnostics: client.diagnostics, published: false, raw_retained: false }) + '\n');
  if (result.kind === 'failure') process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  privateProbe().catch(() => {
    process.stderr.write(JSON.stringify({ kind: 'failure', code: 'private_probe_failed',
      published: false, raw_retained: false }) + '\n');
    process.exitCode = 1;
  });
}
