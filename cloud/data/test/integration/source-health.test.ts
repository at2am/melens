import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { BigQuery, type JobMetadata } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import type { DataSource, FreshnessState, GeoRecord, SourceRecord, SyncBatch } from '../../src/core/types.js';
import { computeCoverageStatus, computeSourceHealth, type SourceHealth } from '../../src/core/health.js';
import { addCompletedWindow, type CheckpointManifest, GcsStore, type StoredObject } from '../../src/core/gcs.js';
import { BigQueryPublisher, stableBatchId } from '../../src/core/publisher.js';
import type { ConnectorFailure, ConnectorSuccess } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';

interface HealthFixture {
  sources: {
    pedestrian_minute: DataSource;
    road_unplanned: DataSource;
    police_news: DataSource;
    paused_parking: DataSource;
  };
  scenarios: {
    failed_check: {
      error_code: string;
      message: string;
      consecutive_failures: number;
      checked_at: string;
    };
    recovered_replay: {
      initial_checkpoint: string;
      window1: { from: string; to: string; batchId: string };
      window2: { from: string; to: string; batchId: string };
    };
    late_check: {
      now: string;
      last_success_at: string;
      last_checked_at: string;
      budget_seconds: number;
    };
    stale_check: {
      now: string;
      last_success_at: string;
      last_checked_at: string;
      budget_seconds: number;
    };
    unchanged_upstream: {
      now: string;
      last_checked_at: string;
      last_success_at: string;
      latest_upstream_update_at: string;
    };
    uncovered_area: {
      area_ref: string;
      area_name: string;
    };
    duplicate_records: readonly [GeoRecord, GeoRecord];
  };
}

async function loadFixture(): Promise<HealthFixture> {
  try {
    const raw = await readFile(new URL('../fixtures/source_health.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as HealthFixture;
  } catch {
    const raw = await readFile(new URL('../../test/fixtures/source_health.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as HealthFixture;
  }
}

async function readSql(name: string): Promise<string> {
  try {
    return await readFile(new URL(`../../../sql/${name}`, import.meta.url), 'utf8');
  } catch {
    return await readFile(new URL(`../../sql/${name}`, import.meta.url), 'utf8');
  }
}

async function loadSchemas(): Promise<Map<string, Array<{ name: string; type: string; mode: string }>>> {
  const ddl = await readSql('001_tables.sql');
  return new Map([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS `melens_ingest\.(\w+)` \(([\s\S]*?)\n\)/g)]
    .map(match => [match[1] ?? '', [...(match[2] ?? '').matchAll(/^  (\w+) (ARRAY<\w+>|\w+)( NOT NULL)?/gm)]
      .map(field => ({
        name: field[1] ?? '',
        type: field[2]?.replace(/^ARRAY<|>$/g, '') ?? '',
        mode: field[2]?.startsWith('ARRAY') ? 'REPEATED' : field[3] ? 'REQUIRED' : 'NULLABLE',
      }))]));
}

// ---------------------------------------------------------------------------
// Local Test Publisher Double (Exercises real BigQueryPublisher & GCS storage)
// ---------------------------------------------------------------------------

class FakeStore {
  readonly objects = new Map<string, readonly unknown[]>();
  readonly deleted = new Set<string>();
  readonly locks = new Set<string>();
  manifest: CheckpointManifest = {
    sourceId: 'fixture',
    checkpoint: '2026-09-28T00:00:00Z',
    completedWindows: [],
  };
  failCheckpoint = false;
  failCleanup = false;

  async withBatchLease<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new Error('Publication already in progress');
    this.locks.add(id);
    try {
      return await work();
    } finally {
      this.locks.delete(id);
    }
  }

  async readCheckpoint(sourceId: string, initial: string | null) {
    if (this.manifest.sourceId !== sourceId && initial !== null) {
      this.manifest = { sourceId, checkpoint: initial, completedWindows: [] };
    }
    return { manifest: this.manifest, generation: '1' };
  }

  async markPublishedWindow(_id: string, _initial: string, window: { from: string; to: string; batchId: string }) {
    if (this.failCheckpoint) throw new Error('Simulated checkpoint failure');
    this.manifest = addCompletedWindow(this.manifest, window);
    return this.manifest;
  }

  async saveNdjson(input: { kind: string; sourceId: string; batchId: string; rows: readonly unknown[] }): Promise<StoredObject> {
    const hash = createHash('sha256').update(JSON.stringify(input.rows)).digest('hex');
    const uri = `gs://fixture/${input.kind}/${input.sourceId}/${input.batchId}/${hash}.ndjson`;
    this.objects.set(uri, input.rows);
    this.deleted.delete(uri);
    return { uri, sha256: hash, generation: '1', expiresAt: '2026-09-28T01:00:00Z' };
  }

  async deleteObject(object: StoredObject) {
    this.deleted.add(object.uri);
  }

  async deleteStagingObjects(uris: readonly string[]) {
    if (this.failCleanup) throw new Error('Simulated cleanup failure');
    uris.forEach(uri => this.deleted.add(uri));
  }

  async purgeSourceCopies(sourceId: string) {
    let count = 0;
    for (const [uri] of this.objects) {
      if (uri.includes(`/${sourceId}/`)) {
        this.deleted.add(uri);
        count++;
      }
    }
    return count;
  }
}

class FakeBigQuery {
  readonly states: SyncBatch[] = [];
  readonly sourceRows: Record<string, unknown>[] = [];
  readonly facts = new Map<string, Record<string, unknown>[]>();
  readonly loadedTables: string[] = [];
  readonly jobs = new Map<string, JobMetadata>();

  constructor(
    private readonly store: FakeStore,
    private readonly schemas: Map<string, Array<{ name: string; type: string; mode: string }>>,
  ) {}

  async getProjectId() {
    return 'melens-fixture';
  }

  latest(batchId: unknown) {
    return this.states
      .filter(row => row.batch_id === batchId)
      .sort((a, b) => Date.parse(b.state_updated_at) - Date.parse(a.state_updated_at))[0];
  }

  visible(table: string) {
    return (this.facts.get(table) ?? []).filter(row => this.latest(row.batch_id)?.state === 'published');
  }

  /**
   * Test-local simulated validation helper: performs in-memory sanity checks
   * on loaded batch rows to approximate warehouse constraint evaluation.
   * NOTE: This is a local simulation helper for fake BigQuery, NOT real GoogleSQL.
   */
  private simulateLocalTableValidation(table: string, params: Record<string, string>, _sql: string): Record<string, unknown>[] {
    const actual = (this.facts.get(table) ?? []).filter(row => row.batch_id === params.batchId);
    const fields = (this.schemas.get(table) ?? [])
      .map(field => field.name)
      .filter(name => name !== undefined && !['batch_id', 'fetched_at', 'raw_uri', 'first_accessible_at', 'freshness_state'].includes(name));
    const content = (row: Record<string, unknown>) => JSON.stringify(fields.map(name => row[name ?? ''] ?? null));
    const contents = new Set(actual.map(content));

    let invalidCount = 0;
    const publishedBatches = new Set(
      this.states.filter(b => b.state === 'published' && b.published_at !== null).map(b => b.batch_id),
    );
    const isVisibleBatch = (batchId: unknown) => batchId === params.batchId || publishedBatches.has(String(batchId));

    if (table === 'geo_record_sources') {
      const sourceRecords = this.facts.get('source_records') ?? [];
      const geoRecords = this.facts.get('geo_records') ?? [];
      for (const row of actual) {
        const srExists = sourceRecords.some(sr =>
          sr.source_record_id === row.source_record_id &&
          sr.version_id === row.source_version_id &&
          sr.source_id === row.source_id &&
          isVisibleBatch(sr.batch_id),
        );
        const grExists = geoRecords.some(gr =>
          gr.geo_record_id === row.geo_record_id &&
          gr.version_id === row.version_id &&
          isVisibleBatch(gr.batch_id),
        );
        if (!srExists || !grExists) {
          invalidCount++;
        }
      }
    } else if (table === 'geo_records') {
      const geoSources = this.facts.get('geo_record_sources') ?? [];
      for (const row of actual) {
        const linkExists = geoSources.some(gs =>
          gs.geo_record_id === row.geo_record_id &&
          gs.version_id === row.version_id &&
          isVisibleBatch(gs.batch_id),
        );
        if (!linkExists) {
          invalidCount++;
        }
        if (typeof row.source_version_ordinal === 'number' && row.source_version_ordinal < 0) {
          invalidCount++;
        }
        if (typeof row.centroid_lat === 'number' && (row.centroid_lat < -90 || row.centroid_lat > 90)) {
          invalidCount++;
        }
      }
    }

    return [{
      distinct_count: contents.size,
      unexpected: 0,
      invalid: invalidCount,
      conflicts: 0,
      ambiguous: 0,
    }];
  }

  /**
   * Test-local simulated view helper for v_geo_records_current.
   * NOTE: Approximates 002_core_views.sql in memory for local tests.
   */
  private simulateLocalGeoRecordsCurrentView(params: Record<string, string>): Record<string, unknown>[] {
    const publishedBatches = new Map<string, string>();
    for (const batch of this.states) {
      if (this.latest(batch.batch_id)?.state === 'published' && batch.published_at !== null) {
        publishedBatches.set(batch.batch_id, batch.published_at);
      }
    }

    const latestSources = new Map<string, Record<string, unknown>>();
    for (const s of this.sourceRows) {
      const id = String(s.source_id ?? '');
      const existing = latestSources.get(id);
      if (!existing || Date.parse(String(s.updated_at ?? '')) >= Date.parse(String(existing.updated_at ?? ''))) {
        latestSources.set(id, s);
      }
    }
    const isSourceAdmitted = (sourceId: string) => {
      if (latestSources.size === 0) return true;
      const s = latestSources.get(sourceId);
      if (!s) return false;
      const license = String(s.license_status ?? '');
      const access = String(s.access_status ?? '');
      return ['verified_open', 'restricted'].includes(license) && access === 'active';
    };

    const sourceRecords = (this.facts.get('source_records') ?? []) as Array<Record<string, unknown>>;
    const geoRecordSources = (this.facts.get('geo_record_sources') ?? []) as Array<Record<string, unknown>>;
    const publishedSourceRecords = new Set<string>();
    for (const sr of sourceRecords) {
      const bId = String(sr.batch_id ?? '');
      const sId = String(sr.source_id ?? '');
      const rStatus = String(sr.rights_status ?? '');
      if (publishedBatches.has(bId) && isSourceAdmitted(sId) && ['verified_open', 'restricted'].includes(rStatus)) {
        publishedSourceRecords.add(`${sId}::${sr.source_record_id}::${sr.version_id}`);
      }
    }
    const validGeoVersions = new Set<string>();
    for (const grs of geoRecordSources) {
      const key = `${grs.source_id}::${grs.source_record_id}::${grs.source_version_id}`;
      if (publishedSourceRecords.has(key)) {
        validGeoVersions.add(`${grs.geo_record_id}::${grs.version_id}`);
      }
    }

    const geoRows = ((this.facts.get('geo_records') ?? []) as unknown as GeoRecord[])
      .filter(r => {
        if (!publishedBatches.has(r.batch_id)) return false;
        if (!isSourceAdmitted(r.source_id)) return false;
        if (geoRecordSources.length > 0 && !validGeoVersions.has(`${r.geo_record_id}::${r.version_id}`)) return false;
        if (r.public_query_allowed !== true) return false;
        if (!['verified_open', 'restricted'].includes(r.rights_status)) return false;
        return true;
      })
      .map(r => ({
        ...r,
        batch_published_at: publishedBatches.get(r.batch_id) ?? '',
      }));

    let current = resolveCurrentGeoRecords(geoRows, Object.fromEntries(publishedBatches));
    const targetGeoId = params.geo_record_id ?? params.geoRecordId ?? params.geoId;
    if (targetGeoId) {
      current = current.filter(r => r.geo_record_id === targetGeoId);
    }
    const targetSourceId = params.source_id ?? params.sourceId;
    if (targetSourceId) {
      current = current.filter(r => r.source_id === targetSourceId);
    }
    return current as unknown as Record<string, unknown>[];
  }

  /**
   * Test-local simulated view helper for v_geo_records_history.
   * NOTE: Approximates 002_core_views.sql in memory for local tests.
   */
  private simulateLocalGeoRecordsHistoryView(params: Record<string, string>): Record<string, unknown>[] {
    const publishedBatches = new Map<string, string>();
    for (const batch of this.states) {
      if (this.latest(batch.batch_id)?.state === 'published' && batch.published_at !== null) {
        publishedBatches.set(batch.batch_id, batch.published_at);
      }
    }

    const latestSources = new Map<string, Record<string, unknown>>();
    for (const s of this.sourceRows) {
      const id = String(s.source_id ?? '');
      const existing = latestSources.get(id);
      if (!existing || Date.parse(String(s.updated_at ?? '')) >= Date.parse(String(existing.updated_at ?? ''))) {
        latestSources.set(id, s);
      }
    }
    const isSourceAdmitted = (sourceId: string) => {
      if (latestSources.size === 0) return true;
      const s = latestSources.get(sourceId);
      if (!s) return false;
      const license = String(s.license_status ?? '');
      const access = String(s.access_status ?? '');
      return ['verified_open', 'restricted'].includes(license) && access === 'active';
    };

    const sourceRecords = (this.facts.get('source_records') ?? []) as Array<Record<string, unknown>>;
    const geoRecordSources = (this.facts.get('geo_record_sources') ?? []) as Array<Record<string, unknown>>;
    const publishedSourceRecords = new Set<string>();
    for (const sr of sourceRecords) {
      const bId = String(sr.batch_id ?? '');
      const sId = String(sr.source_id ?? '');
      const rStatus = String(sr.rights_status ?? '');
      if (publishedBatches.has(bId) && isSourceAdmitted(sId) && ['verified_open', 'restricted'].includes(rStatus)) {
        publishedSourceRecords.add(`${sId}::${sr.source_record_id}::${sr.version_id}`);
      }
    }
    const validGeoVersions = new Set<string>();
    for (const grs of geoRecordSources) {
      const key = `${grs.source_id}::${grs.source_record_id}::${grs.source_version_id}`;
      if (publishedSourceRecords.has(key)) {
        validGeoVersions.add(`${grs.geo_record_id}::${grs.version_id}`);
      }
    }

    const geoRows = ((this.facts.get('geo_records') ?? []) as unknown as GeoRecord[])
      .filter(r => {
        if (!publishedBatches.has(r.batch_id)) return false;
        if (!isSourceAdmitted(r.source_id)) return false;
        if (geoRecordSources.length > 0 && !validGeoVersions.has(`${r.geo_record_id}::${r.version_id}`)) return false;
        if (r.public_query_allowed !== true) return false;
        if (!['verified_open', 'restricted'].includes(r.rights_status)) return false;
        return true;
      })
      .map(r => ({
        ...r,
        batch_published_at: publishedBatches.get(r.batch_id) ?? '',
      }));

    let history = deduplicatePhysicalGeoRecords(geoRows, Object.fromEntries(publishedBatches));
    const targetGeoId = params.geo_record_id ?? params.geoRecordId ?? params.geoId;
    if (targetGeoId) {
      history = history.filter(r => r.geo_record_id === targetGeoId);
    }
    const targetSourceId = params.source_id ?? params.sourceId;
    if (targetSourceId) {
      history = history.filter(r => r.source_id === targetSourceId);
    }
    return history as unknown as Record<string, unknown>[];
  }

  /**
   * Test-local simulated view helper for v_source_health.
   * NOTE: Approximates 008_health_views.sql in memory for local tests.
   */
  private simulateLocalSourceHealthView(params: Record<string, string>): Record<string, unknown>[] {
    const latestSources = new Map<string, Record<string, unknown>>();
    for (const s of this.sourceRows) {
      const id = String(s.source_id ?? '');
      const existing = latestSources.get(id);
      if (!existing || Date.parse(String(s.updated_at ?? '')) >= Date.parse(String(existing.updated_at ?? ''))) {
        latestSources.set(id, s);
      }
    }

    const results: Record<string, unknown>[] = [];
    const now = Date.now();
    const targetSourceId = params.source_id ?? params.sourceId;

    for (const source of latestSources.values()) {
      const sourceId = String(source.source_id ?? '');
      if (targetSourceId && targetSourceId !== sourceId) continue;

      const sourceBatches = this.states.filter(b => b.source_id === sourceId);
      const latestBatchStates = new Map<string, SyncBatch>();
      for (const b of sourceBatches) {
        const existing = latestBatchStates.get(b.batch_id);
        if (!existing || Date.parse(b.state_updated_at) >= Date.parse(existing.state_updated_at)) {
          latestBatchStates.set(b.batch_id, b);
        }
      }

      const sortedChecks = [...latestBatchStates.values()].sort((a, b) => {
        const startedDiff = Date.parse(b.started_at) - Date.parse(a.started_at);
        if (startedDiff !== 0) return startedDiff;
        return Date.parse(b.state_updated_at) - Date.parse(a.state_updated_at);
      });
      const latestCheck = sortedChecks[0] ?? null;

      const publishedBatches = [...latestBatchStates.values()]
        .filter(b => b.state === 'published' && b.published_at !== null)
        .sort((a, b) => {
          const pubDiff = Date.parse(b.published_at!) - Date.parse(a.published_at!);
          if (pubDiff !== 0) return pubDiff;
          return Date.parse(b.started_at) - Date.parse(a.started_at);
        });
      const latestPublished = publishedBatches[0] ?? null;

      const cadence = source.cadence_seconds != null ? Number(source.cadence_seconds) : null;
      const interval = source.check_interval_seconds != null ? Number(source.check_interval_seconds) : null;
      const budgetSeconds = cadence != null ? 2 * cadence : interval != null ? 2 * interval : null;

      const lastCheckedAt = source.last_checked_at ? String(source.last_checked_at) : null;
      const lastSuccessAt = source.last_success_at ? String(source.last_success_at) : null;
      const lastSourceUpdateAt = source.last_source_update_at ? String(source.last_source_update_at) : null;
      const licenseStatus = String(source.license_status ?? '');
      const accessStatus = String(source.access_status ?? '');

      let healthState: string;
      if (licenseStatus === 'review_required' || accessStatus !== 'active') {
        healthState = 'unknown';
      } else if (!lastCheckedAt || !lastSuccessAt) {
        healthState = 'unknown';
      } else {
        const successAge = Math.floor((now - Date.parse(lastSuccessAt)) / 1000);
        if (latestCheck?.state === 'failed' && budgetSeconds !== null && successAge > budgetSeconds) {
          healthState = 'source_unavailable';
        } else if (latestCheck?.state === 'failed') {
          healthState = 'unknown';
        } else if (budgetSeconds === null) {
          healthState = 'healthy_versioned';
        } else if (successAge <= budgetSeconds) {
          healthState = 'current';
        } else if (successAge <= 2 * budgetSeconds) {
          healthState = 'late';
        } else {
          healthState = 'stale';
        }
      }

      results.push({
        ...source,
        budget_seconds: budgetSeconds,
        latest_batch_id: latestCheck?.batch_id ?? null,
        latest_batch_state: latestCheck?.state ?? null,
        latest_error_code: latestCheck?.error_code ?? null,
        latest_published_batch_id: latestPublished?.batch_id ?? null,
        latest_published_at: latestPublished?.published_at ?? null,
        latest_published_window_from: latestPublished?.window_from ?? null,
        latest_published_window_to: latestPublished?.window_to ?? null,
        latest_published_output_count: latestPublished?.output_count ?? null,
        health_state: healthState,
        upstream_update_age_seconds: lastSourceUpdateAt ? Math.floor((now - Date.parse(lastSourceUpdateAt)) / 1000) : null,
        successful_check_age_seconds: lastSuccessAt ? Math.floor((now - Date.parse(lastSuccessAt)) / 1000) : null,
      });
    }

    return results;
  }

  /**
   * Test-local simulated view helper for v_source_coverage.
   * NOTE: Approximates 008_health_views.sql in memory for local tests.
   */
  private simulateLocalSourceCoverageView(params: Record<string, string>): Record<string, unknown>[] {
    const healthRows = this.simulateLocalSourceHealthView(params);
    return healthRows.map(h => {
      const licenseStatus = String(h['license_status'] ?? '');
      const accessStatus = String(h['access_status'] ?? '');
      const areaRefs = h['coverage_area_refs'] as unknown[];
      const coverageFrom = h['coverage_from'];
      let coverageEvidenceState = 'verified';
      if (licenseStatus === 'review_required' || accessStatus !== 'active') {
        coverageEvidenceState = 'unknown';
      } else if (!areaRefs || (Array.isArray(areaRefs) && areaRefs.length === 0)) {
        coverageEvidenceState = 'unknown';
      } else if (!coverageFrom) {
        coverageEvidenceState = 'unknown';
      }
      return {
        ...h,
        coverage_evidence_state: coverageEvidenceState,
      };
    });
  }

  /**
   * Test-local simulated view helper for v_source_abnormal_delay.
   * NOTE: Approximates 008_health_views.sql in memory for local tests.
   */
  private simulateLocalSourceAbnormalDelayView(params: Record<string, string>): Record<string, unknown>[] {
    const healthRows = this.simulateLocalSourceHealthView(params);
    return healthRows.filter(h => ['late', 'stale', 'source_unavailable', 'unknown'].includes(String(h['health_state'])));
  }

  async query(input: { query: string; params?: Record<string, string> }): Promise<[Record<string, unknown>[]]> {
    const sql = input.query;
    const params = input.params ?? {};
    if (sql.includes('INSERT INTO') && sql.includes('sync_batches')) {
      const row = JSON.parse(params.payload ?? '{}') as SyncBatch;
      this.states.push(row);
      return [[]];
    }
    if (sql.includes('TO_JSON_STRING(t) AS batch')) {
      const latest = this.latest(params.batchId);
      return [latest ? [{ batch: JSON.stringify(latest) }] : []];
    }
    if (sql.includes('CAST(last_success_at AS STRING)')) {
      const sourceId = params.sourceId ?? params.source_id;
      if (sourceId) {
        const rows = this.sourceRows.filter(r => r.source_id === sourceId);
        return [rows.slice(-1)];
      }
      return [this.sourceRows.slice(-1)];
    }
    const table = /\/\* validate:(\w+) \*\//.exec(sql)?.[1];
    if (table) {
      return [this.simulateLocalTableValidation(table, params, sql)];
    }
    if (sql.includes('UPDATE') && sql.includes('sync_batches')) return [[]];

    if (sql.includes('DELETE FROM')) {
      const sourceId = params.sourceId ?? params.source_id;
      if (sourceId) {
        for (const [t, rows] of this.facts.entries()) {
          this.facts.set(t, rows.filter(r => r.source_id !== sourceId));
        }
      }
      return [[]];
    }

    if (sql.includes('INSERT INTO') && sql.includes('data_sources')) {
      const sourceId = params.sourceId ?? params.source_id;
      if (sourceId) {
        this.sourceRows.push({
          source_id: sourceId,
          legacy_ids: [],
          provider: 'City of Melbourne',
          dataset_title: 'Unadmitted Source Test',
          landing_url: 'https://example.org',
          topic: 'pedestrian',
          scope: 'city',
          coverage_area_refs: ['melbourne:cbd'],
          coverage_from: '2026-09-28T00:00:00Z',
          coverage_to: null,
          cadence_seconds: 60,
          check_interval_seconds: 60,
          record_granularity: 'observation',
          admission_evidence: { missing_requirements: ['review_needed'] },
          connector_owner: 'tester',
          license_status: 'review_required',
          access_status: 'review_required',
          last_checked_at: '2026-09-28T01:00:00Z',
          last_success_at: '2026-09-28T01:00:00Z',
          last_source_update_at: null,
          updated_at: '2026-09-28T01:00:00Z',
        });
      }
      return [[]];
    }

    if (sql.includes('v_source_abnormal_delay')) {
      return [this.simulateLocalSourceAbnormalDelayView(params)];
    }
    if (sql.includes('v_source_coverage')) {
      return [this.simulateLocalSourceCoverageView(params)];
    }
    if (sql.includes('v_source_health')) {
      return [this.simulateLocalSourceHealthView(params)];
    }

    // Local evaluation of consumption views matching 002_core_views.sql
    if (sql.includes('v_geo_records_current')) {
      return [this.simulateLocalGeoRecordsCurrentView(params)];
    }

    if (sql.includes('v_geo_records_history')) {
      return [this.simulateLocalGeoRecordsHistoryView(params)];
    }

    return [[]];
  }

  dataset() {
    return {
      table: (table: string) => ({
        getMetadata: async () => [{ schema: { fields: this.schemas.get(table) ?? [] } }],
      }),
    };
  }

  async createJob(input: { jobId: string; configuration: NonNullable<JobMetadata['configuration']> }) {
    const table = input.configuration.load?.destinationTable?.tableId;
    if (!table) throw new Error('Missing load destination');
    const uri = input.configuration.load?.sourceUris?.[0];
    const rows = (this.store.objects.get(uri ?? '') ?? []) as Record<string, unknown>[];
    this.jobs.set(input.jobId, {
      configuration: input.configuration,
      status: { state: 'DONE' },
      statistics: { load: { outputRows: String(rows.length) } },
    });
    this.loadedTables.push(table);
    if (table === 'data_sources') {
      this.sourceRows.push(...rows);
    } else {
      this.facts.set(table, [...(this.facts.get(table) ?? []), ...rows]);
    }
    return [];
  }

  job(id: string) {
    return { getMetadata: async () => [this.jobs.get(id)] };
  }
}

const config: DataConfig = {
  projectId: 'melens-fixture',
  region: 'australia-southeast2',
  bucketName: 'fixture',
  ingestDataset: 'melens_ingest',
  queryDataset: 'melens_query',
  secretNames: [],
};

async function setupPublisher() {
  const schemas = await loadSchemas();
  const store = new FakeStore();
  const bigquery = new FakeBigQuery(store, schemas);
  const writeRows = async (input: { table: string; rows: readonly Record<string, unknown>[] }) => {
    bigquery.loadedTables.push(input.table);
    if (input.table === 'data_sources') {
      bigquery.sourceRows.push(...input.rows);
    } else {
      bigquery.facts.set(input.table, [...(bigquery.facts.get(input.table) ?? []), ...input.rows]);
    }
  };
  const publisher = new BigQueryPublisher(
    config,
    bigquery as unknown as BigQuery,
    store as unknown as GcsStore,
    writeRows as unknown as any,
  );
  return { store, bigquery, publisher };
}

function makeGeoRecord(overrides: Partial<GeoRecord> & { geo_record_id: string; version_id: string }): GeoRecord {
  return {
    batch_id: 'pending',
    source_id: 'melbourne.pedestrian.minute',
    schema_version: 1,
    fetched_at: '2026-09-28T01:00:00Z',
    topic: 'pedestrian',
    assertion_kind: 'report',
    title: 'Reading',
    summary: null,
    original_url: 'https://example.org/1',
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    centroid_lat: -37.81,
    centroid_lon: 144.96,
    location_role: 'event_site',
    location_confidence: 'source_coordinate',
    area_refs: [],
    published_at: '2026-09-28T01:00:00Z',
    observed_at: null,
    valid_from: null,
    valid_to: null,
    source_updated_at: null,
    source_version_ordinal: null,
    freshness_state: 'current',
    record_status: 'active',
    rights_status: 'verified_open',
    public_query_allowed: true,
    ...overrides,
  };
}

function makeSuccessFixture(
  source: DataSource,
  windowFrom: string,
  windowTo: string,
  geoRecords: GeoRecord[] = [],
  revisionOverride?: string,
): ConnectorSuccess {
  const batchId = 'fixture-batch';
  const checkedAt = windowTo;
  const sourceRecord: SourceRecord = {
    batch_id: batchId,
    source_id: source.source_id,
    schema_version: 1,
    fetched_at: checkedAt,
    source_record_id: `${source.source_id}:1`,
    version_id: 'v1',
    original_url: 'https://example.org/1',
    raw_uri: null,
    published_at: checkedAt,
    observed_at: null,
    first_accessible_at: null,
    time_missing_reason: null,
    valid_from: null,
    valid_to: null,
    source_updated_at: null,
    source_version_ordinal: null,
    record_status: 'active',
    assertion_kind: 'report',
    rights_status: 'verified_open',
  };
  return {
    kind: 'success',
    sourceId: source.source_id,
    runId: `run-${windowFrom}`,
    fetchedAt: checkedAt,
    sourceRevision: revisionOverride ?? `rev-${windowTo}`,
    sourceLatestUpdateAt: checkedAt,
    checkpointAfter: windowTo,
    completeness: {
      complete: true,
      method: 'feed_snapshot',
      expected_records: geoRecords.length + 1,
      fetched_records: geoRecords.length + 1,
      expected_pages: 1,
      fetched_pages: 1,
      evidence: 'fixture',
    },
    inputCount: geoRecords.length + 1,
    outputCount: geoRecords.length + 1,
    rejectedCount: 0,
    sourceRecords: [sourceRecord],
    geoRecords,
    geoRecordSources: geoRecords.map(g => ({
      batch_id: batchId,
      source_id: source.source_id,
      schema_version: 1,
      fetched_at: checkedAt,
      geo_record_id: g.geo_record_id,
      version_id: g.version_id,
      source_record_id: sourceRecord.source_record_id,
      source_version_id: sourceRecord.version_id,
      evidence_role: 'primary',
      original_url: sourceRecord.original_url,
    })),
    boundaries: [],
    areaIndicators: [],
    parkingBays: [],
    parkingObservations: [],
    parkingRules: [],
    sensorLocations: [],
    pedestrianObservations: [],
    retainableRawRecords: null,
  };
}

// ---------------------------------------------------------------------------
// Test-Local Simulated Helper Functions: In-Memory Provenance Ordering & Deduplication
// NOTE: These are test-local simulation helpers that approximate 002_core_views.sql
// logic in memory for unit tests. They are local helper functions, NOT real SQL
// validation or warehouse query execution.
// ---------------------------------------------------------------------------

/**
 * Test-local simulated helper function: Resolves deduplicated physical records under at-least-once delivery,
 * approximating 002_core_views.sql (deduplicated CTE) in test memory:
 * QUALIFY ROW_NUMBER() OVER (
 *   PARTITION BY geo_record_id, version_id
 *   ORDER BY batch_published_at DESC, fetched_at DESC, batch_id DESC
 * ) = 1
 * NOTE: This is a test-local simulation helper, NOT real SQL validation or a warehouse query engine.
 */
export function deduplicatePhysicalGeoRecords(
  rows: readonly GeoRecord[],
  batchPublishedAt?: Record<string, string>,
): GeoRecord[] {
  const groups = new Map<string, GeoRecord[]>();
  for (const row of rows) {
    const key = `${row.geo_record_id}::${row.version_id}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result: GeoRecord[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const pubA = batchPublishedAt?.[a.batch_id] ?? a.published_at ?? '';
      const pubB = batchPublishedAt?.[b.batch_id] ?? b.published_at ?? '';
      if (pubA !== pubB) return pubB.localeCompare(pubA);

      const fetchA = a.fetched_at ?? '';
      const fetchB = b.fetched_at ?? '';
      if (fetchA !== fetchB) return fetchB.localeCompare(fetchA);

      return (b.batch_id ?? '').localeCompare(a.batch_id ?? '');
    });
    const winner = list[0];
    if (winner) result.push(winner);
  }
  return result;
}

/**
 * Test-local simulated helper function: Provenance comparator for logical records of the same entity (geo_record_id),
 * approximating canonical SQL ordering in test memory:
 * ORDER BY source_updated_at DESC NULLS LAST,
 *          source_version_ordinal DESC NULLS LAST,
 *          version_id DESC
 * NOTE: This is a test-local simulation helper, NOT real SQL validation.
 */
export function compareProvenance(a: GeoRecord, b: GeoRecord): number {
  // 1. source_updated_at DESC NULLS LAST
  const timeA = a.source_updated_at ? Date.parse(a.source_updated_at) : null;
  const timeB = b.source_updated_at ? Date.parse(b.source_updated_at) : null;
  const validTimeA = timeA !== null && Number.isFinite(timeA);
  const validTimeB = timeB !== null && Number.isFinite(timeB);

  if (validTimeA && validTimeB) {
    if (timeA !== timeB) {
      return timeB - timeA; // later time first (DESC)
    }
  } else if (validTimeA && !validTimeB) {
    return -1; // non-null before null (NULLS LAST)
  } else if (!validTimeA && validTimeB) {
    return 1; // null after non-null
  }

  // 2. source_version_ordinal DESC NULLS LAST
  const ordA = a.source_version_ordinal;
  const ordB = b.source_version_ordinal;
  const validOrdA = ordA !== null && Number.isFinite(ordA);
  const validOrdB = ordB !== null && Number.isFinite(ordB);

  if (validOrdA && validOrdB) {
    if (ordA !== ordB) {
      return ordB - ordA; // higher ordinal first (DESC)
    }
  } else if (validOrdA && !validOrdB) {
    return -1; // non-null before null (NULLS LAST)
  } else if (!validOrdA && validOrdB) {
    return 1; // null after non-null
  }

  // 3. version_id DESC
  const verA = a.version_id ?? '';
  const verB = b.version_id ?? '';
  return verB.localeCompare(verA);
}

/**
 * Test-local simulated helper function: Resolves current logical records for an entity under canonical SQL rules:
 * 1. Deduplicates physical writes per (geo_record_id, version_id).
 * 2. Selects latest version per geo_record_id by provenance ordering:
 *    source_updated_at DESC NULLS LAST, source_version_ordinal DESC NULLS LAST, version_id DESC.
 * 3. Applies lifecycle exclusion: record_status NOT IN ('cancelled', 'resolved', 'withdrawn').
 * NOTE: This is a test-local simulation helper, NOT real SQL validation or a warehouse query engine.
 */
export function resolveCurrentGeoRecords(
  rows: readonly GeoRecord[],
  batchPublishedAt?: Record<string, string>,
): GeoRecord[] {
  const physicalDeduped = deduplicatePhysicalGeoRecords(rows, batchPublishedAt);
  const entityGroups = new Map<string, GeoRecord[]>();
  for (const row of physicalDeduped) {
    const list = entityGroups.get(row.geo_record_id) ?? [];
    list.push(row);
    entityGroups.set(row.geo_record_id, list);
  }

  const current: GeoRecord[] = [];
  for (const list of entityGroups.values()) {
    list.sort(compareProvenance);
    const latest = list[0];
    if (latest && !['cancelled', 'resolved', 'withdrawn'].includes(latest.record_status)) {
      current.push(latest);
    }
  }
  return current;
}

// ---------------------------------------------------------------------------
// 1. 验证失败来源 (Failed sources via publisher & core health functions)
// ---------------------------------------------------------------------------

test('failed connector run records failure via publisher, does not advance last_success, and empty records cannot certify no events', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const previousSuccess = '2026-09-28T01:00:00Z';
  const checkedAt = '2026-09-28T01:01:00Z'; // within 120s budget

  const { publisher, bigquery, store } = await setupPublisher();

  // Initial healthy publication establishes checkpoint and last_success_at
  const initialWindow = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: previousSuccess,
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', previousSuccess),
  };
  await publisher.publish(initialWindow);
  assert.equal(store.manifest.checkpoint, previousSuccess);
  assert.equal(bigquery.sourceRows.at(-1)?.last_success_at, previousSuccess);

  // Failure occurs via publisher.recordConnectorFailure
  const failure: ConnectorFailure = {
    kind: 'failure',
    sourceId: source.source_id,
    runId: 'run-failed-1',
    checkedAt,
    code: 'upstream_unavailable',
    message: 'Upstream service 503',
    retryAfterSeconds: null,
    sourceLatestUpdateAt: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'failed_upstream',
    },
  };
  await publisher.recordConnectorFailure(source, failure, previousSuccess, checkedAt);

  // Check publisher state: failed batch recorded, checkpoint NOT advanced
  assert.equal(bigquery.states.at(-1)?.state, 'failed');
  assert.equal(bigquery.states.at(-1)?.error_code, 'upstream_unavailable');
  assert.equal(store.manifest.checkpoint, previousSuccess);

  // Test real computeSourceHealth against operational state
  const failedSource: DataSource = {
    ...source,
    last_checked_at: checkedAt,
    last_success_at: previousSuccess,
  };
  const health = computeSourceHealth({
    source: failedSource,
    now: checkedAt,
    lastCheckedAt: failedSource.last_checked_at,
    lastSuccessAt: failedSource.last_success_at,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 1,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'unknown');
  assert.equal(health.lastSuccessAt, previousSuccess);
  assert.equal(health.lastCheckedAt, checkedAt);
  assert.equal(health.consecutiveFailures, 1);
  assert.match(health.reason, /latest check failed/);

  // When query executes and matching records is 0, status must NOT be 'no_matching_records'
  const coverageStatus = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageStatus, 'unknown');
  assert.notEqual(coverageStatus, 'no_matching_records');
  assert.notEqual(coverageStatus, 'covered');
});

test('persistent failure exceeding freshness budget degrades health to stale and coverage to source_unavailable', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  // Interval is 60s, budget is 120s
  const lastSuccess = '2026-09-28T01:00:00Z';
  const now = '2026-09-28T01:05:00Z'; // 300s later (> 2x budget of 120s)

  const health = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: lastSuccess,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 3,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'stale');
  assert.match(health.reason, /exceeds twice the freshness budget/);

  // Compute coverage status when all covering sources are stale
  const coverage = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'source_unavailable');
  assert.notEqual(coverage, 'no_matching_records');
});

test('failed source without prior success degrades coverage to source_unavailable', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const now = '2026-09-28T01:00:00Z';

  // Source has never succeeded and currently fails
  const health = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: null,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 2,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'unknown');
  assert.equal(health.lastSuccessAt, null);

  // Coverage evaluation confirms allUnavailable -> source_unavailable
  const coverage = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'source_unavailable');
  assert.notEqual(coverage, 'no_matching_records');
});

test('transient vs persistent failures: health transitions through unknown, late, and stale while tracking consecutive failures', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute; // cadence 60s -> budget 120s
  const t0 = '2026-09-28T00:00:00Z';

  // 1. Initial healthy state at t0
  const initialHealth = computeSourceHealth({
    source,
    now: t0,
    lastCheckedAt: t0,
    lastSuccessAt: t0,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(initialHealth.state, 'current');

  // 2. Transient failure at t0 + 30s (age 30s <= budget 120s)
  const tTransient = '2026-09-28T00:00:30Z';
  const transientHealth = computeSourceHealth({
    source,
    now: tTransient,
    lastCheckedAt: tTransient,
    lastSuccessAt: t0,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 1,
    knownGapCount: 0,
  });
  assert.equal(transientHealth.state, 'unknown');
  assert.equal(transientHealth.consecutiveFailures, 1);
  assert.match(transientHealth.reason, /latest check failed/);

  // Coverage status for transient failure with 0 records is 'unknown', NEVER 'no_matching_records'
  assert.equal(
    computeCoverageStatus({ coveringSources: [transientHealth], matchingRecords: 0, completeWindow: true }),
    'unknown',
  );

  // 3. Second failure at t0 + 150s (age 150s > budget 120s and <= 240s)
  const tLate = '2026-09-28T00:02:30Z';
  const lateHealth = computeSourceHealth({
    source,
    now: tLate,
    lastCheckedAt: tLate,
    lastSuccessAt: t0,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 2,
    knownGapCount: 0,
  });
  assert.equal(lateHealth.state, 'late');
  assert.equal(lateHealth.consecutiveFailures, 2);
  assert.match(lateHealth.reason, /exceeds the freshness budget/);

  // Coverage with 0 records under late source is 'unknown'
  assert.equal(
    computeCoverageStatus({ coveringSources: [lateHealth], matchingRecords: 0, completeWindow: true }),
    'unknown',
  );

  // 4. Third failure at t0 + 300s (age 300s > 2x budget 240s)
  const tStale = '2026-09-28T00:05:00Z';
  const staleHealth = computeSourceHealth({
    source,
    now: tStale,
    lastCheckedAt: tStale,
    lastSuccessAt: t0,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 3,
    knownGapCount: 0,
  });
  assert.equal(staleHealth.state, 'stale');
  assert.equal(staleHealth.consecutiveFailures, 3);
  assert.match(staleHealth.reason, /exceeds twice the freshness budget/);

  // At stale state, coverage evaluation confirms allUnavailable -> 'source_unavailable'
  const coverageStale = computeCoverageStatus({
    coveringSources: [staleHealth],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageStale, 'source_unavailable');
  assert.notEqual(coverageStale, 'no_matching_records');
});

// ---------------------------------------------------------------------------
// 2. 恢复后重放 (Replay after recovery & checkpoint progression)
// ---------------------------------------------------------------------------

test('failed source recovers: replaying missing window resolves gaps, advances checkpoint, and restores health', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  const { initial_checkpoint, window1, window2 } = fixture.scenarios.recovered_replay;

  let manifest: CheckpointManifest = {
    sourceId: source.source_id,
    checkpoint: initial_checkpoint,
    completedWindows: [],
  };

  // Step 1: window1 [00:00, 01:00] failed, window2 [01:00, 02:00] succeeds first (out-of-order)
  manifest = addCompletedWindow(manifest, window2);
  // Checkpoint cannot advance past window1 gap
  assert.equal(manifest.checkpoint, initial_checkpoint);
  assert.equal(manifest.completedWindows.length, 1);

  // Health during the gap: knownGapCount = 1 forces unknown health
  const gapHealth = computeSourceHealth({
    source,
    now: '2026-09-28T02:01:00Z',
    lastCheckedAt: '2026-09-28T02:00:00Z',
    lastSuccessAt: '2026-09-28T02:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 1, // gap from window1
  });
  assert.equal(gapHealth.state, 'unknown');
  assert.match(gapHealth.reason, /coverage gap is known/);
  assert.equal(
    computeCoverageStatus({ coveringSources: [gapHealth], matchingRecords: 0, completeWindow: true }),
    'unknown',
  );

  // Step 2: Replay window1 after recovery
  manifest = addCompletedWindow(manifest, window1);
  // Gap closed: checkpoint advances through window2 to 02:00:00Z
  assert.equal(manifest.checkpoint, window2.to);
  assert.deepEqual(manifest.completedWindows, []);

  // Health after recovery and replay: knownGapCount = 0 restores current
  const recoveredSource: DataSource = {
    ...source,
    last_checked_at: window2.to,
    last_success_at: window2.to,
  };
  const recoveredHealth = computeSourceHealth({
    source: recoveredSource,
    now: '2026-09-28T02:01:00Z',
    lastCheckedAt: window2.to,
    lastSuccessAt: window2.to,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: window2.to,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(recoveredHealth.state, 'current');

  // Now, empty records for covered window is certified as no_matching_records
  const coverageNoRecords = computeCoverageStatus({
    coveringSources: [recoveredHealth],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageNoRecords, 'no_matching_records');

  // Records present is certified as covered
  const coverageWithRecords = computeCoverageStatus({
    coveringSources: [recoveredHealth],
    matchingRecords: 15,
    completeWindow: true,
  });
  assert.equal(coverageWithRecords, 'covered');
});

test('complex multi-window out-of-order replay closes multi-hour gaps and leaps checkpoint forward', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  const initialCheckpoint = '2026-09-28T00:00:00Z';

  const w1 = { from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z', batchId: 'b1' };
  const w2 = { from: '2026-09-28T01:00:00Z', to: '2026-09-28T02:00:00Z', batchId: 'b2' };
  const w3 = { from: '2026-09-28T02:00:00Z', to: '2026-09-28T03:00:00Z', batchId: 'b3' };
  const w4 = { from: '2026-09-28T03:00:00Z', to: '2026-09-28T04:00:00Z', batchId: 'b4' };

  let manifest: CheckpointManifest = {
    sourceId: source.source_id,
    checkpoint: initialCheckpoint,
    completedWindows: [],
  };

  // Arrival order: w2 arrives, then w4, then w3
  manifest = addCompletedWindow(manifest, w2);
  manifest = addCompletedWindow(manifest, w4);
  manifest = addCompletedWindow(manifest, w3);

  // Checkpoint is still stuck at initial because w1 is missing
  assert.equal(manifest.checkpoint, initialCheckpoint);
  assert.equal(manifest.completedWindows.length, 3);

  // During this gap, health must be unknown and cannot certify zero records
  const healthDuringGap = computeSourceHealth({
    source,
    now: '2026-09-28T04:00:30Z',
    lastCheckedAt: '2026-09-28T04:00:00Z',
    lastSuccessAt: '2026-09-28T04:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T04:00:00Z',
    consecutiveFailures: 0,
    knownGapCount: 1, // w1 is missing
  });
  assert.equal(healthDuringGap.state, 'unknown');
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthDuringGap], matchingRecords: 0, completeWindow: true }),
    'unknown',
  );

  // Now w1 is replayed and completes
  manifest = addCompletedWindow(manifest, w1);

  // All 4 contiguous windows are resolved: checkpoint leaps forward across all windows to 04:00:00Z
  assert.equal(manifest.checkpoint, w4.to);
  assert.deepEqual(manifest.completedWindows, []);

  // Post-replay health returns to current
  const healthRecovered = computeSourceHealth({
    source,
    now: '2026-09-28T04:00:30Z',
    lastCheckedAt: '2026-09-28T04:00:00Z',
    lastSuccessAt: '2026-09-28T04:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T04:00:00Z',
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthRecovered.state, 'current');
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthRecovered], matchingRecords: 0, completeWindow: true }),
    'no_matching_records',
  );
});

test('source recovery after repeated failures resets consecutive_failures and restores current health', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned; // interval 60s, budget 120s
  const recoveryTime = '2026-09-28T02:00:00Z';

  // Prior failed state had 5 consecutive failures; recovery resets consecutiveFailures to 0
  const recoveredHealth = computeSourceHealth({
    source: {
      ...source,
      last_checked_at: recoveryTime,
      last_success_at: recoveryTime,
    },
    now: '2026-09-28T02:00:30Z',
    lastCheckedAt: recoveryTime,
    lastSuccessAt: recoveryTime,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: recoveryTime,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });

  assert.equal(recoveredHealth.state, 'current');
  assert.equal(recoveredHealth.consecutiveFailures, 0);
  assert.match(recoveredHealth.reason, /latest check succeeded within the freshness budget/);

  // Coverage certifies no matching records upon successful recovery
  const coverage = computeCoverageStatus({
    coveringSources: [recoveredHealth],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'no_matching_records');
});

// ---------------------------------------------------------------------------
// 3. 延迟/过期状态 (Late and stale freshness budgets)
// ---------------------------------------------------------------------------

test('freshness budget is 2x interval: transitions smoothly through current, late, and stale', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  // cadence = 60s, budget = 120s
  const baseSuccess = '2026-09-28T00:00:00Z';

  // 1. age = 60s (<= 120s budget) -> current
  const current = computeSourceHealth({
    source,
    now: '2026-09-28T00:01:00Z',
    lastCheckedAt: '2026-09-28T00:01:00Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(current.state, 'current');
  assert.equal(current.budgetSeconds, 120);

  // 2. age = 150s (> 120s budget and <= 240s) -> late
  const late = computeSourceHealth({
    source,
    now: '2026-09-28T00:02:30Z',
    lastCheckedAt: '2026-09-28T00:02:30Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(late.state, 'late');
  assert.match(late.reason, /exceeds the freshness budget/);

  // 3. age = 300s (> 240s twice budget) -> stale
  const stale = computeSourceHealth({
    source,
    now: '2026-09-28T00:05:00Z',
    lastCheckedAt: '2026-09-28T00:05:00Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(stale.state, 'stale');
  assert.match(stale.reason, /exceeds twice the freshness budget/);
});

test('freshness budget exact boundary thresholds: checks transitions at exact second boundaries', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  // cadence = 60s, budget = 120s (2x interval), 2x budget = 240s (4x interval)
  const baseSuccess = '2026-09-28T00:00:00Z';

  // Boundary 1: age = 0s -> current
  const at0 = computeSourceHealth({
    source,
    now: '2026-09-28T00:00:00Z',
    lastCheckedAt: baseSuccess,
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(at0.state, 'current');

  // Boundary 2: age = 120s exactly (<= budget) -> current
  const at120 = computeSourceHealth({
    source,
    now: '2026-09-28T00:02:00Z',
    lastCheckedAt: '2026-09-28T00:02:00Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(at120.state, 'current');

  // Boundary 3: age = 121s (121 > 120 and 121 <= 240) -> late
  const at121 = computeSourceHealth({
    source,
    now: '2026-09-28T00:02:01Z',
    lastCheckedAt: '2026-09-28T00:02:01Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(at121.state, 'late');

  // Boundary 4: age = 240s exactly (240 <= 240) -> late
  const at240 = computeSourceHealth({
    source,
    now: '2026-09-28T00:04:00Z',
    lastCheckedAt: '2026-09-28T00:04:00Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(at240.state, 'late');

  // Boundary 5: age = 241s (> 240) -> stale
  const at241 = computeSourceHealth({
    source,
    now: '2026-09-28T00:04:01Z',
    lastCheckedAt: '2026-09-28T00:04:01Z',
    lastSuccessAt: baseSuccess,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: baseSuccess,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(at241.state, 'stale');
});

test('cadence_seconds vs check_interval_seconds fallback and versioned datasets with null budget', async () => {
  const fixture = await loadFixture();
  const base = fixture.sources.pedestrian_minute;
  const now = '2026-09-28T01:00:00Z';
  const successAt = '2026-09-28T00:55:00Z'; // 300s age

  // Case A: cadence_seconds present (300s) -> budget is 600s
  const sourceWithCadence: DataSource = {
    ...base,
    cadence_seconds: 300,
    check_interval_seconds: 60,
  };
  const healthCadence = computeSourceHealth({
    source: sourceWithCadence,
    now,
    lastCheckedAt: now,
    lastSuccessAt: successAt,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: successAt,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthCadence.budgetSeconds, 600);
  assert.equal(healthCadence.state, 'current'); // 300s <= 600s budget

  // Case B: cadence_seconds is null, falls back to check_interval_seconds (180s) -> budget is 360s
  const sourceFallback: DataSource = {
    ...base,
    cadence_seconds: null,
    check_interval_seconds: 180,
  };
  const healthFallback = computeSourceHealth({
    source: sourceFallback,
    now,
    lastCheckedAt: now,
    lastSuccessAt: successAt,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: successAt,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthFallback.budgetSeconds, 360);
  assert.equal(healthFallback.state, 'current'); // 300s <= 360s budget

  // Case C: both cadence_seconds and check_interval_seconds are null (versioned static dataset)
  const versionedSource: DataSource = {
    ...base,
    cadence_seconds: null,
    check_interval_seconds: null,
  };
  const healthVersioned = computeSourceHealth({
    source: versionedSource,
    now,
    lastCheckedAt: now,
    lastSuccessAt: successAt,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: successAt,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  // In TS computeSourceHealth, null budget without cadence is unknown
  assert.equal(healthVersioned.budgetSeconds, null);
  assert.equal(healthVersioned.state, 'unknown');
  assert.match(healthVersioned.reason, /monitoring or check evidence is missing/);
});

test('unchanged upstream data remains current and is not misreported as fetch failure', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const { now, last_checked_at, last_success_at, latest_upstream_update_at } =
    fixture.scenarios.unchanged_upstream;

  // Upstream update was 7 days ago, but check succeeded 10 seconds ago
  const health = computeSourceHealth({
    source,
    now,
    lastCheckedAt: last_checked_at,
    lastSuccessAt: last_success_at,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: latest_upstream_update_at,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'current');
  assert.equal(health.latestUpstreamUpdateAt, latest_upstream_update_at);
  assert.match(health.reason, /latest check succeeded within the freshness budget/);
});

test('abnormal delay monitoring classifies late, stale, and failed sources while excluding current healthy sources', async () => {
  const fixture = await loadFixture();
  const now = '2026-09-28T00:10:00Z';

  // 1. Healthy source: checked 30s ago -> current
  const healthy = computeSourceHealth({
    source: fixture.sources.pedestrian_minute,
    now,
    lastCheckedAt: '2026-09-28T00:09:30Z',
    lastSuccessAt: '2026-09-28T00:09:30Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T00:09:30Z',
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthy.state, 'current');

  // 2. Late source: checked 150s ago (budget 120s) -> late
  const late = computeSourceHealth({
    source: fixture.sources.pedestrian_minute,
    now,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T00:07:30Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T00:07:30Z',
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(late.state, 'late');

  // 3. Stale source: checked 600s ago (budget 120s) -> stale
  const stale = computeSourceHealth({
    source: fixture.sources.road_unplanned,
    now,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T00:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T00:00:00Z',
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(stale.state, 'stale');

  // 4. Failed source: check failed -> unknown
  const failed = computeSourceHealth({
    source: fixture.sources.road_unplanned,
    now,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T00:08:00Z',
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: '2026-09-28T00:08:00Z',
    consecutiveFailures: 1,
    knownGapCount: 0,
  });
  assert.equal(failed.state, 'unknown');

  // Abnormal delay filter excludes 'current' and includes 'late', 'stale', 'unknown'
  const isAbnormal = (h: SourceHealth) => ['late', 'stale', 'unknown'].includes(h.state);
  assert.equal(isAbnormal(healthy), false);
  assert.equal(isAbnormal(late), true);
  assert.equal(isAbnormal(stale), true);
  assert.equal(isAbnormal(failed), true);
});

// ---------------------------------------------------------------------------
// 4. 健康来源无匹配 vs 地区未覆盖 vs 来源不可用 (Coverage distinctions)
// ---------------------------------------------------------------------------

test('healthy source with zero matching records certifies no_matching_records', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  const now = '2026-09-28T00:05:00Z';

  const health = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });

  const coverage = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'no_matching_records');
});

test('query for uncovered geographic area returns not_covered, never no_matching_records', async () => {
  // Queried area is not covered by any registered source: coveringSources is empty
  const coveringSources: readonly SourceHealth[] = [];

  const coverage = computeCoverageStatus({
    coveringSources,
    matchingRecords: 0,
    completeWindow: true,
  });

  assert.equal(coverage, 'not_covered');
  assert.notEqual(coverage, 'no_matching_records');
  assert.notEqual(coverage, 'covered');
});

test('distinction between not_covered, no_matching_records, and source_unavailable under all single and multi-source combinations', async () => {
  const now = '2026-09-28T01:00:00Z';

  const currentHealth: SourceHealth = {
    state: 'current',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
    reason: 'healthy',
  };

  const staleHealth: SourceHealth = {
    state: 'stale',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T00:00:00Z',
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 3,
    knownGapCount: 0,
    reason: 'stale',
  };

  const neverSucceededFailedHealth: SourceHealth = {
    state: 'unknown',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: null,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 2,
    knownGapCount: 0,
    reason: 'never succeeded',
  };

  const lateHealth: SourceHealth = {
    state: 'late',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T00:57:00Z',
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
    reason: 'late',
  };

  // 1. Empty sources -> not_covered
  assert.equal(
    computeCoverageStatus({ coveringSources: [], matchingRecords: 0, completeWindow: true }),
    'not_covered',
  );
  assert.equal(
    computeCoverageStatus({ coveringSources: [], matchingRecords: 10, completeWindow: false }),
    'not_covered',
  );

  // 2. All covering sources unavailable (all stale) -> source_unavailable
  assert.equal(
    computeCoverageStatus({ coveringSources: [staleHealth], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
  );
  assert.equal(
    computeCoverageStatus({ coveringSources: [staleHealth, staleHealth], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
  );

  // 3. All covering sources failed without prior success -> source_unavailable
  assert.equal(
    computeCoverageStatus({ coveringSources: [neverSucceededFailedHealth], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
  );

  // 4. Combined stale and never-succeeded failed -> source_unavailable
  assert.equal(
    computeCoverageStatus({ coveringSources: [staleHealth, neverSucceededFailedHealth], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
  );

  // 5. Mixed: 1 healthy, 1 stale -> unknown (NOT source_unavailable, NOT no_matching_records)
  const mixedHealthyStale = computeCoverageStatus({
    coveringSources: [currentHealth, staleHealth],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(mixedHealthyStale, 'unknown');
  assert.notEqual(mixedHealthyStale, 'no_matching_records');
  assert.notEqual(mixedHealthyStale, 'source_unavailable');

  // 6. Mixed: 1 healthy, 1 late -> unknown
  assert.equal(
    computeCoverageStatus({ coveringSources: [currentHealth, lateHealth], matchingRecords: 0, completeWindow: true }),
    'unknown',
  );

  // 7. Single healthy but incomplete window -> unknown (CANNOT certify no_matching_records)
  assert.equal(
    computeCoverageStatus({ coveringSources: [currentHealth], matchingRecords: 0, completeWindow: false }),
    'unknown',
  );

  // 8. Healthy sources, complete window: 0 records -> no_matching_records
  assert.equal(
    computeCoverageStatus({ coveringSources: [currentHealth, currentHealth], matchingRecords: 0, completeWindow: true }),
    'no_matching_records',
  );

  // 9. Healthy sources, complete window: >0 records -> covered
  assert.equal(
    computeCoverageStatus({ coveringSources: [currentHealth, currentHealth], matchingRecords: 7, completeWindow: true }),
    'covered',
  );
});

test('coverage calculation strictly validates matching record count integrity', async () => {
  const now = '2026-09-28T01:00:00Z';
  const healthy: SourceHealth = {
    state: 'current',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
    reason: 'healthy',
  };

  // Negative matching record count throws
  assert.throws(
    () => computeCoverageStatus({ coveringSources: [healthy], matchingRecords: -1, completeWindow: true }),
    /Invalid matching record count/,
  );

  // Fractional matching record count throws
  assert.throws(
    () => computeCoverageStatus({ coveringSources: [healthy], matchingRecords: 3.14, completeWindow: true }),
    /Invalid matching record count/,
  );

  // NaN matching record count throws
  assert.throws(
    () => computeCoverageStatus({ coveringSources: [healthy], matchingRecords: Number.NaN, completeWindow: true }),
    /Invalid matching record count/,
  );
});

test('exhaustive matrix: zero matching records NEVER signifies no_matching_records unless all conditions are verified', async () => {
  const now = '2026-09-28T00:02:00Z';

  const makeHealth = (overrides: Partial<SourceHealth>): SourceHealth => ({
    state: 'current',
    budgetSeconds: 120,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
    reason: 'test',
    ...overrides,
  });

  const matrixCases: Array<{
    scenario: string;
    coveringSources: readonly SourceHealth[];
    completeWindow: boolean;
    expectedStatus: 'covered' | 'no_matching_records' | 'not_covered' | 'source_unavailable' | 'unknown';
  }> = [
    {
      scenario: 'healthy source with complete window',
      coveringSources: [makeHealth({})],
      completeWindow: true,
      expectedStatus: 'no_matching_records',
    },
    {
      scenario: 'healthy source with incomplete window',
      coveringSources: [makeHealth({})],
      completeWindow: false,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'healthy source with known gap',
      coveringSources: [makeHealth({ knownGapCount: 1 })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'healthy source with consecutive failures',
      coveringSources: [makeHealth({ consecutiveFailures: 1 })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'late source',
      coveringSources: [makeHealth({ state: 'late' })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'stale source',
      coveringSources: [makeHealth({ state: 'stale' })],
      completeWindow: true,
      expectedStatus: 'source_unavailable',
    },
    {
      scenario: 'source with consecutive failures and no prior success',
      coveringSources: [makeHealth({ state: 'unknown', consecutiveFailures: 2, lastSuccessAt: null })],
      completeWindow: true,
      expectedStatus: 'source_unavailable',
    },
    {
      scenario: 'mixed sources: 1 healthy, 1 late',
      coveringSources: [makeHealth({}), makeHealth({ state: 'late' })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'mixed sources: 1 healthy, 1 stale',
      coveringSources: [makeHealth({}), makeHealth({ state: 'stale' })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'mixed sources: 1 healthy, 1 failed',
      coveringSources: [makeHealth({}), makeHealth({ state: 'unknown', consecutiveFailures: 1 })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'mixed sources: 1 healthy, 1 with known gap',
      coveringSources: [makeHealth({}), makeHealth({ knownGapCount: 1 })],
      completeWindow: true,
      expectedStatus: 'unknown',
    },
    {
      scenario: 'all sources stale: 2 stale sources',
      coveringSources: [makeHealth({ state: 'stale' }), makeHealth({ state: 'stale' })],
      completeWindow: true,
      expectedStatus: 'source_unavailable',
    },
    {
      scenario: 'all sources unavailable: 1 stale, 1 failed with null success',
      coveringSources: [
        makeHealth({ state: 'stale' }),
        makeHealth({ state: 'unknown', consecutiveFailures: 2, lastSuccessAt: null }),
      ],
      completeWindow: true,
      expectedStatus: 'source_unavailable',
    },
    {
      scenario: 'no covering sources (unmonitored area)',
      coveringSources: [],
      completeWindow: true,
      expectedStatus: 'not_covered',
    },
    {
      scenario: 'no covering sources with incomplete window',
      coveringSources: [],
      completeWindow: false,
      expectedStatus: 'not_covered',
    },
  ];

  for (const tc of matrixCases) {
    const status = computeCoverageStatus({
      coveringSources: tc.coveringSources,
      matchingRecords: 0,
      completeWindow: tc.completeWindow,
    });
    assert.equal(
      status,
      tc.expectedStatus,
      `Failed for scenario "${tc.scenario}": expected ${tc.expectedStatus}, got ${status}`,
    );
    if (tc.expectedStatus !== 'no_matching_records') {
      assert.notEqual(
        status,
        'no_matching_records',
        `Scenario "${tc.scenario}" must NEVER certify empty records as no_matching_records`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5.1 本地内存模拟：溯源排序与逻辑去重算法验证 (Local In-Memory Simulation Checks)
// NOTE: These tests verify the test-internal JavaScript helper algorithms (compareProvenance,
// resolveCurrentGeoRecords, deduplicatePhysicalGeoRecords). They evaluate simulated logic
// in memory, NOT live GoogleSQL views. In the absence of a live cloud BigQuery connection,
// these are strictly local checks.
// ---------------------------------------------------------------------------

test('local simulation: provenance sequencing: newer source_updated_at takes precedence over arbitrary version_id string order', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  // Older update timestamp with a lexicographically higher version_id string ('z_v1')
  const olderRow: GeoRecord = {
    ...base,
    geo_record_id: 'incident:geo_001',
    version_id: 'z_v1',
    source_updated_at: '2026-09-28T00:01:00Z',
    source_version_ordinal: null,
    fetched_at: '2026-09-28T00:01:30Z',
    title: 'Initial reading (older timestamp, higher version string)',
  };

  // Newer update timestamp with a lexicographically lower version_id string ('a_v2')
  const newerRow: GeoRecord = {
    ...base,
    geo_record_id: 'incident:geo_001',
    version_id: 'a_v2',
    source_updated_at: '2026-09-28T00:02:00Z',
    source_version_ordinal: null,
    fetched_at: '2026-09-28T00:02:00Z',
    title: 'Corrected reading (newer timestamp, lower version string)',
  };

  // Direct comparison asserts newer source_updated_at comes first (negative compare value)
  assert.ok(compareProvenance(newerRow, olderRow) < 0, 'Newer source_updated_at must win over older row');
  assert.ok(compareProvenance(olderRow, newerRow) > 0, 'Older row must lose to newer source_updated_at');

  // Regardless of row arrival order, newer timestamp always resolves as current
  const resolvedAsc = resolveCurrentGeoRecords([olderRow, newerRow]);
  assert.equal(resolvedAsc.length, 1);
  assert.equal(resolvedAsc[0]?.version_id, 'a_v2');
  assert.equal(resolvedAsc[0]?.title, 'Corrected reading (newer timestamp, lower version string)');

  const resolvedDesc = resolveCurrentGeoRecords([newerRow, olderRow]);
  assert.equal(resolvedDesc.length, 1);
  assert.equal(resolvedDesc[0]?.version_id, 'a_v2');
});

test('local simulation: late arrival: older source_updated_at arriving in subsequent batch does not displace current record', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  // Current published record
  const currentRecord: GeoRecord = {
    ...base,
    geo_record_id: 'ped:sensor_42:2026-09-28T00:00:00Z',
    version_id: 'rev_2',
    source_updated_at: '2026-09-28T00:05:00Z',
    source_version_ordinal: 2,
    fetched_at: '2026-09-28T00:05:10Z',
    title: 'Current reading',
  };

  // Late arriving older batch with earlier source_updated_at but higher version string ('rev_99')
  const lateArrivingOldRecord: GeoRecord = {
    ...base,
    geo_record_id: 'ped:sensor_42:2026-09-28T00:00:00Z',
    version_id: 'rev_99',
    source_updated_at: '2026-09-28T00:02:00Z',
    source_version_ordinal: 1,
    fetched_at: '2026-09-28T00:06:00Z',
    title: 'Old reading from replayed partition',
  };

  // Combining published current with late arriving row resolves to currentRecord
  const resolved = resolveCurrentGeoRecords([currentRecord, lateArrivingOldRecord]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.version_id, 'rev_2');
  assert.equal(resolved[0]?.title, 'Current reading');
});

test('local simulation: provenance sequencing: source_version_ordinal determines ordering when timestamps are absent or equal', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  // Ordinal 1 with higher version_id string
  const v1: GeoRecord = {
    ...base,
    geo_record_id: 'planning:scheme_101',
    version_id: 'version_999',
    source_updated_at: null,
    source_version_ordinal: 1,
    fetched_at: '2026-09-28T00:01:00Z',
    title: 'Scheme Amendment - First Draft',
  };

  // Ordinal 2 with lower version_id string
  const v2: GeoRecord = {
    ...base,
    geo_record_id: 'planning:scheme_101',
    version_id: 'version_002',
    source_updated_at: null,
    source_version_ordinal: 2,
    fetched_at: '2026-09-28T00:02:00Z',
    title: 'Scheme Amendment - Gazetted Version',
  };

  // Ordinal 2 wins over ordinal 1
  assert.ok(compareProvenance(v2, v1) < 0);
  const resolved = resolveCurrentGeoRecords([v1, v2]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.version_id, 'version_002');
  assert.equal(resolved[0]?.title, 'Scheme Amendment - Gazetted Version');
});

test('local simulation: provenance sequencing: source_updated_at takes precedence over source_version_ordinal', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  // Earlier timestamp with a higher ordinal
  const olderTimestampHigherOrdinal: GeoRecord = {
    ...base,
    geo_record_id: 'transport:route_5',
    version_id: 'v_stage1',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: 50,
    fetched_at: '2026-09-28T01:00:10Z',
  };

  // Later timestamp with a lower ordinal
  const newerTimestampLowerOrdinal: GeoRecord = {
    ...base,
    geo_record_id: 'transport:route_5',
    version_id: 'v_stage2',
    source_updated_at: '2026-09-28T02:00:00Z',
    source_version_ordinal: 1,
    fetched_at: '2026-09-28T02:00:10Z',
  };

  // Later timestamp wins regardless of ordinal
  assert.ok(compareProvenance(newerTimestampLowerOrdinal, olderTimestampHigherOrdinal) < 0);
  const resolved = resolveCurrentGeoRecords([olderTimestampHigherOrdinal, newerTimestampLowerOrdinal]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.version_id, 'v_stage2');
});

test('local simulation: provenance sequencing: NULLS LAST guarantees timestamp and ordinal precedence over nulls', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  const rowWithTime: GeoRecord = {
    ...base,
    geo_record_id: 'record:1',
    version_id: 'time_ver',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: null,
  };

  const rowNullTimeWithOrdinal: GeoRecord = {
    ...base,
    geo_record_id: 'record:1',
    version_id: 'ordinal_ver',
    source_updated_at: null,
    source_version_ordinal: 10,
  };

  const rowNullAll: GeoRecord = {
    ...base,
    geo_record_id: 'record:1',
    version_id: 'null_ver',
    source_updated_at: null,
    source_version_ordinal: null,
  };

  // Timestamp beats null timestamp (NULLS LAST)
  assert.ok(compareProvenance(rowWithTime, rowNullTimeWithOrdinal) < 0);
  // Non-null ordinal beats null ordinal
  assert.ok(compareProvenance(rowNullTimeWithOrdinal, rowNullAll) < 0);

  const resolved = resolveCurrentGeoRecords([rowNullAll, rowWithTime, rowNullTimeWithOrdinal]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.version_id, 'time_ver');
});

test('local simulation: at-least-once duplicate rows in physical table resolve to single distinct logical record', async () => {
  const fixture = await loadFixture();
  const rawDuplicates = fixture.scenarios.duplicate_records;

  // Physical table contains 2 identical records inserted by retrying jobs
  assert.equal(rawDuplicates.length, 2);
  assert.equal(rawDuplicates[0]?.geo_record_id, rawDuplicates[1]?.geo_record_id);

  // Apply canonical physical deduplication per (geo_record_id, version_id)
  const deduped = deduplicatePhysicalGeoRecords(rawDuplicates);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.geo_record_id, 'ped:sensor_1:2026-09-28T00:01:00Z');
  assert.equal(deduped[0]?.version_id, 'v1');
});

test('local simulation: multi-entity deduplication under at-least-once retries preserves newest version and latest fetch across distinct records', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  const rows: GeoRecord[] = [
    // Entity 1: initial fetch v1
    {
      ...base,
      geo_record_id: 'incident:101',
      version_id: 'v1',
      source_updated_at: '2026-09-28T00:01:00Z',
      fetched_at: '2026-09-28T00:01:00Z',
      title: 'Incident 101 - Open',
    },
    // Entity 1: retried job with same v1 but later fetched_at
    {
      ...base,
      geo_record_id: 'incident:101',
      version_id: 'v1',
      source_updated_at: '2026-09-28T00:01:00Z',
      fetched_at: '2026-09-28T00:01:30Z',
      title: 'Incident 101 - Open (Retry)',
    },
    // Entity 1: updated version v2 with later source_updated_at
    {
      ...base,
      geo_record_id: 'incident:101',
      version_id: 'v2',
      source_updated_at: '2026-09-28T00:02:00Z',
      fetched_at: '2026-09-28T00:02:00Z',
      title: 'Incident 101 - Resolved',
    },
    // Entity 2: initial fetch v1
    {
      ...base,
      geo_record_id: 'incident:102',
      version_id: 'v1',
      source_updated_at: '2026-09-28T00:01:00Z',
      fetched_at: '2026-09-28T00:01:00Z',
      title: 'Incident 102 - Hazard',
    },
    // Entity 2: retry v1 with later fetched_at
    {
      ...base,
      geo_record_id: 'incident:102',
      version_id: 'v1',
      source_updated_at: '2026-09-28T00:01:00Z',
      fetched_at: '2026-09-28T00:01:25Z',
      title: 'Incident 102 - Hazard (Retry)',
    },
    // Entity 3: single record v1
    {
      ...base,
      geo_record_id: 'incident:103',
      version_id: 'v1',
      source_updated_at: '2026-09-28T00:01:10Z',
      fetched_at: '2026-09-28T00:01:10Z',
      title: 'Incident 103 - Roadwork',
    },
  ];

  // Physical deduplication collapses identical versions while preserving latest fetch
  const physicalDeduped = deduplicatePhysicalGeoRecords(rows);
  assert.equal(physicalDeduped.length, 4); // entity 1 (v1 & v2), entity 2 (v1), entity 3 (v1)

  const entity2Physical = physicalDeduped.find(r => r.geo_record_id === 'incident:102');
  assert.equal(entity2Physical?.fetched_at, '2026-09-28T00:01:25Z');

  // Full current resolution selects latest version by provenance
  const current = resolveCurrentGeoRecords(rows);
  assert.equal(current.length, 3);

  const e1 = current.find(r => r.geo_record_id === 'incident:101');
  assert.ok(e1);
  assert.equal(e1.version_id, 'v2');
  assert.equal(e1.title, 'Incident 101 - Resolved');

  const e2 = current.find(r => r.geo_record_id === 'incident:102');
  assert.ok(e2);
  assert.equal(e2.version_id, 'v1');
  assert.equal(e2.fetched_at, '2026-09-28T00:01:25Z');

  const e3 = current.find(r => r.geo_record_id === 'incident:103');
  assert.ok(e3);
  assert.equal(e3.version_id, 'v1');
});

test('local simulation: lifecycle exclusion: cancelled, resolved, and withdrawn records are excluded from current views without resurrecting older versions', async () => {
  const fixture = await loadFixture();
  const [base] = fixture.scenarios.duplicate_records;
  assert.ok(base);

  for (const terminalStatus of ['cancelled', 'resolved', 'withdrawn'] as const) {
    const olderActive: GeoRecord = {
      ...base,
      geo_record_id: `event:${terminalStatus}`,
      version_id: 'v1',
      source_updated_at: '2026-09-28T01:00:00Z',
      record_status: 'active',
      title: 'Initial active event',
    };
    const newerTerminal: GeoRecord = {
      ...base,
      geo_record_id: `event:${terminalStatus}`,
      version_id: 'v2',
      source_updated_at: '2026-09-28T02:00:00Z',
      record_status: terminalStatus,
      title: `Event is now ${terminalStatus}`,
    };

    // The newer version is terminal: current view must NOT return older active version
    const resolved = resolveCurrentGeoRecords([olderActive, newerTerminal]);
    assert.equal(
      resolved.length,
      0,
      `Entity with latest status ${terminalStatus} must not be present in current view`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5.2 本地发布与消费视图模拟集成 (Local In-Memory Simulation: Publisher & View Projection Checks)
// NOTE: These integration tests run against the local test double (FakeBigQuery).
// In the absence of a live GCP BigQuery connection, queries matching v_geo_records_current
// evaluate in-memory simulated projections, NOT real warehouse SQL.
// ---------------------------------------------------------------------------

test('local simulation: publisher distinguishes published vs failed batch visibility and constrains empty-result coverage', async () => {
  const { publisher, bigquery } = await setupPublisher();
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;

  // 1. Publish batch 1 with an active record
  const geo1 = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'ped:sensor_1:2026-09-28T00:01:00Z',
    version_id: 'v1',
    source_updated_at: '2026-09-28T00:01:00Z',
    title: 'Sensor 1 reading v1',
  });
  const window1 = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T00:01:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T00:01:00Z', [geo1]),
  };
  await publisher.publish(window1);

  // Record is visible in published views
  const [currentRows1] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
  });
  assert.ok(currentRows1);
  assert.equal(currentRows1.length, 1);
  assert.equal(currentRows1[0]?.['geo_record_id'], 'ped:sensor_1:2026-09-28T00:01:00Z');

  // 2. Connector failure in window 2
  const failureTime = '2026-09-28T00:02:00Z';
  const failure: ConnectorFailure = {
    kind: 'failure',
    sourceId: source.source_id,
    runId: 'run-fail-1',
    checkedAt: failureTime,
    code: 'upstream_unavailable',
    message: 'Upstream HTTP 500',
    retryAfterSeconds: null,
    sourceLatestUpdateAt: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'failed_upstream',
    },
  };
  await publisher.recordConnectorFailure(source, failure, '2026-09-28T00:01:00Z', failureTime);

  // Batch state is recorded as 'failed'
  assert.equal(bigquery.states.at(-1)?.state, 'failed');

  // Health reflects the failure: transitions to unknown
  const healthAfterFailure = computeSourceHealth({
    source: { ...source, last_checked_at: failureTime, last_success_at: '2026-09-28T00:01:00Z' },
    now: failureTime,
    lastCheckedAt: failureTime,
    lastSuccessAt: '2026-09-28T00:01:00Z',
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 1,
    knownGapCount: 0,
  });
  assert.equal(healthAfterFailure.state, 'unknown');

  // Querying for an entity in the failed window yields 0 matching records:
  const [matching] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: 'ped:sensor_2:2026-09-28T00:02:00Z' },
  });
  assert.ok(matching);
  assert.equal(matching.length, 0);

  // Coverage evaluation MUST be 'unknown', NEVER 'no_matching_records'
  const coverageStatus = computeCoverageStatus({
    coveringSources: [healthAfterFailure],
    matchingRecords: matching.length,
    completeWindow: true,
  });
  assert.equal(coverageStatus, 'unknown');
  assert.notEqual(coverageStatus, 'no_matching_records');
});

test('local simulation: publisher at-least-once retry handles duplicate physical writes idempotently and deduplicates consumption view', async () => {
  const { publisher, bigquery, store } = await setupPublisher();
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;

  const geo = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'ped:sensor_1:2026-09-28T00:01:00Z',
    version_id: 'v1',
    source_updated_at: '2026-09-28T00:01:00Z',
    title: 'Reading 1',
  });
  const window = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T00:01:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T00:01:00Z', [geo]),
  };

  // First publication
  const pub1 = await publisher.publish(window);
  assert.equal(pub1.state, 'published');
  assert.equal(store.manifest.checkpoint, window.windowTo);

  const initialFactLoads = bigquery.loadedTables.filter(t => t === 'geo_records').length;

  // Replay of the exact same window (at-least-once retry)
  const pub2 = await publisher.publish(window);
  assert.equal(pub2.state, 'published');
  assert.equal(store.manifest.checkpoint, window.windowTo);

  // Publisher did not reload facts to BigQuery on replay
  assert.equal(bigquery.loadedTables.filter(t => t === 'geo_records').length, initialFactLoads);

  // View returns exactly 1 distinct logical record
  const [current] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
  });
  assert.ok(current);
  assert.equal(current.length, 1);
  assert.equal(current[0]?.['geo_record_id'], 'ped:sensor_1:2026-09-28T00:01:00Z');
  assert.equal(current[0]?.['version_id'], 'v1');
});

test('local simulation: publisher late-arriving batch with older source_updated_at does not displace current record in view', async () => {
  const { publisher, bigquery } = await setupPublisher();
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;

  // Batch 1: Published first with newer source_updated_at (02:00) but lower version string 'a_v2'
  const newerRecord = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'incident:geo_001',
    version_id: 'a_v2',
    source_updated_at: '2026-09-28T02:00:00Z',
    source_version_ordinal: null,
    title: 'Corrected road hazard (newer update)',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T01:00:00Z',
    windowFrom: '2026-09-28T01:00:00Z',
    windowTo: '2026-09-28T02:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', [newerRecord], 'rev-batch-1'),
  });

  // Verify v_geo_records_current shows newerRecord
  const [currentAfterBatch1] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
  });
  assert.ok(currentAfterBatch1);
  assert.equal(currentAfterBatch1.length, 1);
  assert.equal(currentAfterBatch1[0]?.['version_id'], 'a_v2');
  assert.equal(currentAfterBatch1[0]?.['title'], 'Corrected road hazard (newer update)');

  // Batch 2: Published later with older source_updated_at (01:00) but higher version string 'z_v1'
  const olderRecordLate = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'incident:geo_001',
    version_id: 'z_v1',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: null,
    title: 'Initial reading from delayed partition',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [olderRecordLate], 'rev-batch-2'),
  });

  // In v_geo_records_current: newerRecord ('a_v2') is STILL current! Older version did NOT displace it!
  const [currentAfterBatch2] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
  });
  assert.ok(currentAfterBatch2);
  assert.equal(currentAfterBatch2.length, 1);
  assert.equal(currentAfterBatch2[0]?.['version_id'], 'a_v2');
  assert.equal(currentAfterBatch2[0]?.['title'], 'Corrected road hazard (newer update)');

  // In v_geo_records_history: BOTH versions are retained!
  const [historyRows] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_history`',
  });
  assert.ok(historyRows);
  assert.equal(historyRows.length, 2);
  const versions = historyRows.map(r => String(r['version_id'])).sort();
  assert.deepEqual(versions, ['a_v2', 'z_v1']);
});

test('local simulation: publisher terminal status (resolved/cancelled/withdrawn) removes record from current view without resurrecting older version', async () => {
  const { publisher, bigquery } = await setupPublisher();
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;

  // Batch 1: Initial active version
  const activeRecord = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'incident:road_closure_99',
    version_id: 'v1',
    source_updated_at: '2026-09-28T01:00:00Z',
    record_status: 'active',
    title: 'Road closure active',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [activeRecord], 'rev-close-1'),
  });

  const [curr1] = await bigquery.query({ query: 'SELECT * FROM `melens_query.v_geo_records_current`' });
  assert.ok(curr1);
  assert.equal(curr1.length, 1);
  assert.equal(curr1[0]?.['geo_record_id'], 'incident:road_closure_99');

  // Batch 2: Resolution version with later source_updated_at
  const resolvedRecord = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'incident:road_closure_99',
    version_id: 'v2',
    source_updated_at: '2026-09-28T02:00:00Z',
    record_status: 'resolved',
    title: 'Road closure resolved',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T01:00:00Z',
    windowFrom: '2026-09-28T01:00:00Z',
    windowTo: '2026-09-28T02:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', [resolvedRecord], 'rev-close-2'),
  });

  // Current view now excludes the entity entirely; does NOT resurrect v1
  const [curr2] = await bigquery.query({ query: 'SELECT * FROM `melens_query.v_geo_records_current`' });
  assert.ok(curr2);
  assert.equal(curr2.length, 0);

  // History view retains both versions
  const [hist] = await bigquery.query({ query: 'SELECT * FROM `melens_query.v_geo_records_history`' });
  assert.ok(hist);
  assert.equal(hist.length, 2);
});

test('local simulation: publisher provenance sequencing respects source_version_ordinal and NULLS LAST over version_id strings', async () => {
  const { publisher, bigquery } = await setupPublisher();
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;

  // Batch 1: Ordinal 1 with higher string 'version_999'
  const v1 = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'scheme:planning_1',
    version_id: 'version_999',
    source_updated_at: null,
    source_version_ordinal: 1,
    title: 'Draft plan',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [v1], 'rev-ord-1'),
  });

  // Batch 2: Ordinal 2 with lower string 'version_002'
  const v2 = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'scheme:planning_1',
    version_id: 'version_002',
    source_updated_at: null,
    source_version_ordinal: 2,
    title: 'Gazetted plan',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T01:00:00Z',
    windowFrom: '2026-09-28T01:00:00Z',
    windowTo: '2026-09-28T02:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', [v2], 'rev-ord-2'),
  });

  // Ordinal 2 wins over ordinal 1
  const [currOrd] = await bigquery.query({ query: 'SELECT * FROM `melens_query.v_geo_records_current`' });
  assert.ok(currOrd);
  assert.equal(currOrd.length, 1);
  assert.equal(currOrd[0]?.['version_id'], 'version_002');
  assert.equal(currOrd[0]?.['title'], 'Gazetted plan');

  // Batch 3: Later timestamp (03:00) with null ordinal and lower version string
  const vTimestamp = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'scheme:planning_1',
    version_id: 'a_time_update',
    source_updated_at: '2026-09-28T03:00:00Z',
    source_version_ordinal: null,
    title: 'Live amendment update',
  });
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T02:00:00Z',
    windowFrom: '2026-09-28T02:00:00Z',
    windowTo: '2026-09-28T03:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T02:00:00Z', '2026-09-28T03:00:00Z', [vTimestamp], 'rev-ord-3'),
  });

  // Timestamp wins over null timestamp (NULLS LAST)
  const [currTime] = await bigquery.query({ query: 'SELECT * FROM `melens_query.v_geo_records_current`' });
  assert.ok(currTime);
  assert.equal(currTime.length, 1);
  assert.equal(currTime[0]?.['version_id'], 'a_time_update');
  assert.equal(currTime[0]?.['title'], 'Live amendment update');
});

test('local simulation: visibility gates, provenance ordering, and health/coverage views under finite test data', async () => {
  const { publisher, bigquery } = await setupPublisher();
  const fixture = await loadFixture();
  const admittedSource: DataSource = {
    ...fixture.sources.pedestrian_minute,
    source_id: 'test.sim.admitted',
    dataset_title: 'Admitted Simulation Source',
    license_status: 'verified_open',
    access_status: 'active',
  };
  const unadmittedSource: DataSource = {
    ...fixture.sources.pedestrian_minute,
    source_id: 'test.sim.unadmitted',
    dataset_title: 'Unadmitted Simulation Source',
    license_status: 'review_required',
    access_status: 'candidate',
    admission_evidence: {
      ...fixture.sources.pedestrian_minute.admission_evidence,
      missing_requirements: ['admission_review_needed'],
    },
  };

  // 1. Unadmitted source registered in warehouse
  await bigquery.query({
    query: 'INSERT INTO `melens_ingest.data_sources` (source_id) VALUES (@sourceId)',
    params: { sourceId: unadmittedSource.source_id },
  });

  // Verify unadmitted source state in health & coverage views
  const [unadmittedHealth] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_source_health`',
    params: { source_id: unadmittedSource.source_id },
  });
  assert.equal(unadmittedHealth.length, 1);
  assert.equal(unadmittedHealth[0]?.['health_state'], 'unknown');

  const [unadmittedCov] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_source_coverage`',
    params: { source_id: unadmittedSource.source_id },
  });
  assert.equal(unadmittedCov.length, 1);
  assert.equal(unadmittedCov[0]?.['coverage_evidence_state'], 'unknown');

  const [unadmittedDelay] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_source_abnormal_delay`',
    params: { source_id: unadmittedSource.source_id },
  });
  assert.equal(unadmittedDelay.length, 1);

  // 2. Entity versioning on admitted source: initial version (v1)
  const entityId = 'ped:sim:sensor_101:2026-09-28';
  const initialRecord = makeGeoRecord({
    source_id: admittedSource.source_id,
    geo_record_id: entityId,
    version_id: 'v1',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: 1,
    title: 'Initial reading v1',
  });
  const window1 = {
    source: admittedSource,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(admittedSource, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [initialRecord], 'rev-sim-1'),
  };
  const batch1 = await publisher.publish(window1);

  // Assertion: Valid row is visible in current view
  const [curr1] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: entityId },
  });
  assert.equal(curr1.length, 1);
  assert.equal(curr1[0]?.['version_id'], 'v1');
  assert.equal(curr1[0]?.['title'], 'Initial reading v1');

  // Admitted source is healthy and visible
  const [admittedHealth1] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_source_health`',
    params: { source_id: admittedSource.source_id },
  });
  assert.equal(admittedHealth1.length, 1);
  assert.equal(admittedHealth1[0]?.['latest_published_batch_id'], batch1.batch_id);

  // 3. Correction version (v2) supersedes initial version
  const correctionRecord = makeGeoRecord({
    source_id: admittedSource.source_id,
    geo_record_id: entityId,
    version_id: 'v2',
    source_updated_at: '2026-09-28T02:00:00Z',
    source_version_ordinal: 2,
    title: 'Correction reading v2',
  });
  const window2 = {
    source: admittedSource,
    initialCheckpoint: '2026-09-28T01:00:00Z',
    windowFrom: '2026-09-28T01:00:00Z',
    windowTo: '2026-09-28T02:00:00Z',
    result: makeSuccessFixture(admittedSource, '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', [correctionRecord], 'rev-sim-2'),
  };
  await publisher.publish(window2);

  // Assertion: Correction version supersedes the older version in current view
  const [curr2] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: entityId },
  });
  assert.equal(curr2.length, 1);
  assert.equal(curr2[0]?.['version_id'], 'v2');
  assert.equal(curr2[0]?.['title'], 'Correction reading v2');

  // 4. Late-arriving older version (v0) does NOT overwrite or revert correction version
  const lateArrivingOlderRecord = makeGeoRecord({
    source_id: admittedSource.source_id,
    geo_record_id: entityId,
    version_id: 'v0',
    source_updated_at: '2026-09-28T00:30:00Z',
    source_version_ordinal: 0,
    title: 'Late arriving older reading v0',
  });
  const window3 = {
    source: admittedSource,
    initialCheckpoint: '2026-09-28T02:00:00Z',
    windowFrom: '2026-09-28T02:00:00Z',
    windowTo: '2026-09-28T03:00:00Z',
    result: makeSuccessFixture(admittedSource, '2026-09-28T02:00:00Z', '2026-09-28T03:00:00Z', [lateArrivingOlderRecord], 'rev-sim-3'),
  };
  await publisher.publish(window3);

  // Assertion: Late-arriving older version does NOT overwrite or revert newer version
  const [curr3] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: entityId },
  });
  assert.equal(curr3.length, 1);
  assert.equal(curr3[0]?.['version_id'], 'v2');
  assert.equal(curr3[0]?.['title'], 'Correction reading v2');

  // In history view, all three versions are preserved
  const [hist] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_history`',
    params: { geo_record_id: entityId },
  });
  assert.equal(hist.length, 3);
  const histVersions = hist.map(r => String(r['version_id'])).sort();
  assert.deepEqual(histVersions, ['v0', 'v1', 'v2']);

  // 5. Misreferenced SourceRecords are NOT visible in published views
  const misreferencedRecord = makeGeoRecord({
    source_id: admittedSource.source_id,
    geo_record_id: 'ped:sim:misreferenced_record',
    version_id: 'v_bad',
  });
  const badFixture: ConnectorSuccess = {
    ...makeSuccessFixture(admittedSource, '2026-09-28T03:00:00Z', '2026-09-28T04:00:00Z', [misreferencedRecord]),
    geoRecordSources: [{
      batch_id: 'fixture-batch',
      source_id: admittedSource.source_id,
      schema_version: 1,
      fetched_at: '2026-09-28T04:00:00Z',
      geo_record_id: misreferencedRecord.geo_record_id,
      version_id: misreferencedRecord.version_id,
      source_record_id: 'sr:missing_nonexistent_reference',
      source_version_id: 'v_nonexistent',
      evidence_role: 'primary',
      original_url: null,
    }],
  };
  await assert.rejects(
    publisher.publish({
      source: admittedSource,
      initialCheckpoint: '2026-09-28T03:00:00Z',
      windowFrom: '2026-09-28T03:00:00Z',
      windowTo: '2026-09-28T04:00:00Z',
      result: badFixture,
    }),
    /validation failed/i,
  );

  // Assertion: Misreferenced records are NOT visible in published views
  const [misreferencedRows] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: 'ped:sim:misreferenced_record' },
  });
  assert.equal(misreferencedRows.length, 0);

  // 6. Failed batches are NOT visible in health/current views
  const failTime = '2026-09-28T05:00:00Z';
  await publisher.recordConnectorFailure(admittedSource, {
    kind: 'failure',
    sourceId: admittedSource.source_id,
    runId: 'run-fail-sim',
    checkedAt: failTime,
    code: 'upstream_unavailable',
    message: 'Simulated connection failure',
    retryAfterSeconds: 60,
    sourceLatestUpdateAt: null,
    completeness: { complete: false, expected_records: null, fetched_records: 0, expected_pages: null, fetched_pages: 0, evidence: 'failure' },
  }, '2026-09-28T04:00:00Z', failTime);

  // Assertion: Failed batch is NOT in latest_published_batch_id, and latest_batch_state is failed
  const [failedHealth] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_source_health`',
    params: { source_id: admittedSource.source_id },
  });
  assert.equal(failedHealth.length, 1);
  assert.equal(failedHealth[0]?.['latest_batch_state'], 'failed');
  assert.notEqual(failedHealth[0]?.['latest_published_batch_id'], failedHealth[0]?.['latest_batch_id']);

  // Failed batch records are NOT visible in current view
  const [failedBatchRecords] = await bigquery.query({
    query: 'SELECT * FROM `melens_query.v_geo_records_current`',
    params: { geo_record_id: 'nonexistent_failed_entity' },
  });
  assert.equal(failedBatchRecords.length, 0);
});

// ---------------------------------------------------------------------------
// 5.3 生产函数健全性与退化/变坏敏感性断言 (Production Function Integrity & Failure Sensitivity Tests)
// NOTE: These tests directly invoke the real production functions:
// - computeSourceHealth (from core/health.ts)
// - computeCoverageStatus (from core/health.ts)
// - addCompletedWindow (from core/gcs.ts)
// - BigQueryPublisher.publish, recordConnectorFailure, pauseSource (from core/publisher.ts)
//
// They explicitly assert recovery progression, failure batch isolation, and empty-result
// constraints such that ANY regression or degradation in these real production functions
// immediately causes these tests to fail. No view mocks or simulation queries are used here.
// In the absence of a live cloud BigQuery connection, these are verified strictly as local checks.
// ---------------------------------------------------------------------------

test('production health: recovery after failure closes gaps via real addCompletedWindow and restores current coverage', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;

  // Initial manifest at checkpoint 00:00:00Z
  let manifest: CheckpointManifest = {
    sourceId: source.source_id,
    checkpoint: '2026-09-28T00:00:00Z',
    completedWindows: [],
  };

  // Window 1: 00:00 -> 01:00 completes
  manifest = addCompletedWindow(manifest, {
    from: '2026-09-28T00:00:00Z',
    to: '2026-09-28T01:00:00Z',
    batchId: 'batch-window-1',
  });
  assert.equal(manifest.checkpoint, '2026-09-28T01:00:00Z');
  assert.equal(manifest.completedWindows.length, 0);

  // Failure occurs for Window 2: 01:00 -> 02:00.
  // Meanwhile Window 3: 02:00 -> 03:00 arrives out of order.
  manifest = addCompletedWindow(manifest, {
    from: '2026-09-28T02:00:00Z',
    to: '2026-09-28T03:00:00Z',
    batchId: 'batch-window-3',
  });
  // Checkpoint MUST NOT advance past 01:00 due to the missing Window 2 gap!
  assert.equal(manifest.checkpoint, '2026-09-28T01:00:00Z', 'Checkpoint must not advance over missing window gap');
  assert.equal(manifest.completedWindows.length, 1);
  assert.equal(manifest.completedWindows[0]?.batchId, 'batch-window-3');

  // Real computeSourceHealth while gap exists:
  // Even if the latest check succeeded, having knownGapCount > 0 forces health to 'unknown'
  const healthWithGap = computeSourceHealth({
    source,
    now: '2026-09-28T03:00:00Z',
    lastCheckedAt: '2026-09-28T03:00:00Z',
    lastSuccessAt: '2026-09-28T03:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T03:00:00Z',
    consecutiveFailures: 0,
    knownGapCount: 1, // Gap present!
  });
  assert.equal(healthWithGap.state, 'unknown');
  assert.match(healthWithGap.reason, /coverage gap is known/);

  // Real computeCoverageStatus while gap exists:
  // Zero matching records MUST NOT be certified as no_matching_records when gap is present!
  const coverageWithGap = computeCoverageStatus({
    coveringSources: [healthWithGap],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageWithGap, 'unknown');
  assert.notEqual(coverageWithGap, 'no_matching_records');

  // Recovery: Replaying the missing Window 2 (01:00 -> 02:00) closes the gap
  manifest = addCompletedWindow(manifest, {
    from: '2026-09-28T01:00:00Z',
    to: '2026-09-28T02:00:00Z',
    batchId: 'batch-window-2',
  });
  // Checkpoint must leap directly to 03:00, resolving both windows
  assert.equal(manifest.checkpoint, '2026-09-28T03:00:00Z', 'Checkpoint must leap forward once gap is closed');
  assert.equal(manifest.completedWindows.length, 0, 'No pending windows remain after gap resolution');

  // Real computeSourceHealth after gap is closed:
  const healthRecovered = computeSourceHealth({
    source,
    now: '2026-09-28T03:00:30Z',
    lastCheckedAt: '2026-09-28T03:00:00Z',
    lastSuccessAt: '2026-09-28T03:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: '2026-09-28T03:00:00Z',
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthRecovered.state, 'current');
  assert.match(healthRecovered.reason, /latest check succeeded within the freshness budget/);

  // Real computeCoverageStatus after recovery:
  // With 0 records and verified healthy current source, certifies no_matching_records
  const coverageRecoveredEmpty = computeCoverageStatus({
    coveringSources: [healthRecovered],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageRecoveredEmpty, 'no_matching_records');

  // With matching records > 0, certifies covered
  const coverageRecoveredFacts = computeCoverageStatus({
    coveringSources: [healthRecovered],
    matchingRecords: 42,
    completeWindow: true,
  });
  assert.equal(coverageRecoveredFacts, 'covered');
});

test('production health: failed connector run isolates failed batch, preserves checkpoint and last_success_at via real publisher', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const { publisher, bigquery, store } = await setupPublisher();

  const successTime1 = '2026-09-28T01:00:00Z';
  const initialWindow = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: successTime1,
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', successTime1),
  };
  await publisher.publish(initialWindow);
  assert.equal(store.manifest.checkpoint, successTime1);
  assert.equal(bigquery.sourceRows.at(-1)?.last_success_at, successTime1);

  // Failure occurs in window 2
  const failTime2 = '2026-09-28T01:01:00Z';
  const failure: ConnectorFailure = {
    kind: 'failure',
    sourceId: source.source_id,
    runId: 'run-fail-isolated-1',
    checkedAt: failTime2,
    code: 'upstream_unavailable',
    message: 'HTTP 503 from transport provider',
    retryAfterSeconds: 30,
    sourceLatestUpdateAt: null,
    completeness: {
      complete: false,
      expected_records: null,
      fetched_records: 0,
      expected_pages: null,
      fetched_pages: 0,
      evidence: 'failed_endpoint',
    },
  };
  await publisher.recordConnectorFailure(source, failure, successTime1, failTime2);

  // Check real publisher state outputs:
  const latestBatch = bigquery.states.at(-1);
  assert.ok(latestBatch);
  assert.equal(latestBatch.state, 'failed');
  assert.equal(latestBatch.error_code, 'upstream_unavailable');
  assert.equal(latestBatch.published_at, null);
  assert.equal(latestBatch.checkpoint_after, null);

  // Check that checkpoint manifest was NOT advanced
  assert.equal(store.manifest.checkpoint, successTime1);

  // Check that data_sources last_success_at was NOT advanced
  const latestSourceRow = bigquery.sourceRows.at(-1);
  assert.ok(latestSourceRow);
  assert.equal(latestSourceRow.last_success_at, successTime1);
  assert.equal(latestSourceRow.last_checked_at, failTime2);

  // Real computeSourceHealth: failure makes health unknown
  const healthFailed = computeSourceHealth({
    source: { ...source, last_checked_at: failTime2, last_success_at: successTime1 },
    now: failTime2,
    lastCheckedAt: failTime2,
    lastSuccessAt: successTime1,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 1,
    knownGapCount: 0,
  });
  assert.equal(healthFailed.state, 'unknown');
  assert.match(healthFailed.reason, /latest check failed/);

  // Real computeCoverageStatus: empty records in failed window CANNOT certify no events
  const coverageFailed = computeCoverageStatus({
    coveringSources: [healthFailed],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverageFailed, 'unknown');
  assert.notEqual(coverageFailed, 'no_matching_records');
});

test('production health: publisher validation rejection isolates failed batch and prevents checkpoint advance', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const { publisher, bigquery, store } = await setupPublisher();

  // Baseline healthy publication
  const baselineWindow = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z'),
  };
  await publisher.publish(baselineWindow);
  assert.equal(store.manifest.checkpoint, '2026-09-28T01:00:00Z');

  // Attempt publication with negative source_version_ordinal (violates validation constraint)
  const invalidGeo = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'incident:invalid_ord',
    version_id: 'v_bad_ord',
    source_version_ordinal: -1, // Negative ordinal violates table constraint
  });
  const invalidResult = makeSuccessFixture(
    source,
    '2026-09-28T01:00:00Z',
    '2026-09-28T02:00:00Z',
    [invalidGeo],
  );

  await assert.rejects(
    publisher.publish({
      source,
      initialCheckpoint: '2026-09-28T01:00:00Z',
      windowFrom: '2026-09-28T01:00:00Z',
      windowTo: '2026-09-28T02:00:00Z',
      result: invalidResult,
    }),
    /validation failed|Invalid/i,
  );

  // Verify that the failed batch is isolated:
  const latestBatch = bigquery.states.at(-1);
  assert.ok(latestBatch);
  assert.equal(latestBatch.state, 'failed');
  assert.equal(latestBatch.error_code, 'validation_failed');
  assert.equal(latestBatch.published_at, null);

  // Checkpoint was strictly NOT advanced
  assert.equal(store.manifest.checkpoint, '2026-09-28T01:00:00Z');
});

test('production coverage: empty result verification strictly requires complete window, current health, zero failures, and zero gaps', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute; // 60s cadence -> 120s budget
  const t0 = '2026-09-28T00:00:00Z';

  const healthyCurrent = computeSourceHealth({
    source,
    now: t0,
    lastCheckedAt: t0,
    lastSuccessAt: t0,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(healthyCurrent.state, 'current');

  // Condition 1: No covering sources -> 'not_covered'
  assert.equal(
    computeCoverageStatus({ coveringSources: [], matchingRecords: 0, completeWindow: true }),
    'not_covered',
    'Empty covering sources must yield not_covered',
  );

  // Condition 2: Incomplete window -> 'unknown'
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthyCurrent], matchingRecords: 0, completeWindow: false }),
    'unknown',
    'Incomplete window must yield unknown',
  );

  // Condition 3: Late source -> 'unknown'
  const lateSource = computeSourceHealth({
    source,
    now: '2026-09-28T00:02:30Z', // 150s > 120s budget
    lastCheckedAt: '2026-09-28T00:02:30Z',
    lastSuccessAt: t0,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(lateSource.state, 'late');
  assert.equal(
    computeCoverageStatus({ coveringSources: [lateSource], matchingRecords: 0, completeWindow: true }),
    'unknown',
    'Late source with 0 records must yield unknown, not no_matching_records',
  );

  // Condition 4: Stale source -> 'source_unavailable'
  const staleSource = computeSourceHealth({
    source,
    now: '2026-09-28T00:05:00Z', // 300s > 240s
    lastCheckedAt: '2026-09-28T00:05:00Z',
    lastSuccessAt: t0,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(staleSource.state, 'stale');
  assert.equal(
    computeCoverageStatus({ coveringSources: [staleSource], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
    'Stale source with 0 records must yield source_unavailable, not no_matching_records',
  );

  // Condition 5: Known gap -> 'unknown'
  const sourceWithGap = computeSourceHealth({
    source,
    now: t0,
    lastCheckedAt: t0,
    lastSuccessAt: t0,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 0,
    knownGapCount: 2, // 2 gaps
  });
  assert.equal(sourceWithGap.state, 'unknown');
  assert.equal(
    computeCoverageStatus({ coveringSources: [sourceWithGap], matchingRecords: 0, completeWindow: true }),
    'unknown',
    'Source with known gaps must yield unknown, not no_matching_records',
  );

  // Condition 6: Consecutive failures -> 'unknown'
  const sourceWithFailures = computeSourceHealth({
    source,
    now: t0,
    lastCheckedAt: t0,
    lastSuccessAt: t0,
    latestCheckSucceeded: false,
    latestUpstreamUpdateAt: t0,
    consecutiveFailures: 1,
    knownGapCount: 0,
  });
  assert.equal(sourceWithFailures.state, 'unknown');
  assert.equal(
    computeCoverageStatus({ coveringSources: [sourceWithFailures], matchingRecords: 0, completeWindow: true }),
    'unknown',
    'Source with consecutive failures must yield unknown, not no_matching_records',
  );

  // Condition 7: Multi-source combination: one current + one late -> 'unknown'
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthyCurrent, lateSource], matchingRecords: 0, completeWindow: true }),
    'unknown',
    'Mixed current and late sources must yield unknown',
  );

  // Condition 8: Multi-source combination: one current + one stale -> 'unknown'
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthyCurrent, staleSource], matchingRecords: 0, completeWindow: true }),
    'unknown',
    'Mixed current and stale sources must yield unknown, not source_unavailable',
  );

  // Condition 9: Multi-source combination: two stale sources -> 'source_unavailable'
  assert.equal(
    computeCoverageStatus({ coveringSources: [staleSource, staleSource], matchingRecords: 0, completeWindow: true }),
    'source_unavailable',
    'All stale sources must yield source_unavailable',
  );

  // Condition 10: Input validation bounds
  assert.throws(
    () => computeCoverageStatus({ coveringSources: [healthyCurrent], matchingRecords: -1, completeWindow: true }),
    /Invalid matching record count/,
    'Negative matching records must throw',
  );
  assert.throws(
    () => computeCoverageStatus({ coveringSources: [healthyCurrent], matchingRecords: 3.14, completeWindow: true }),
    /Invalid matching record count/,
    'Non-integer matching records must throw',
  );

  // Condition 11: All conditions satisfied: certifies 'no_matching_records'
  assert.equal(
    computeCoverageStatus({ coveringSources: [healthyCurrent], matchingRecords: 0, completeWindow: true }),
    'no_matching_records',
    'Only fully healthy, complete, current sources may certify no_matching_records',
  );
});

test('production publisher: pauseSource revokes permissions, purges storage copies, and degrades coverage to unknown', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.road_unplanned;
  const { publisher, bigquery } = await setupPublisher();

  // Initial publication
  await publisher.publish({
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z'),
  });

  // Pause source via publisher
  const purgeResult = await publisher.pauseSource(source);
  assert.ok(purgeResult);

  // Check that data_sources reflects paused and review_required
  const latestSource = bigquery.sourceRows.at(-1);
  assert.ok(latestSource);
  assert.equal(latestSource.access_status, 'paused');
  assert.equal(latestSource.license_status, 'review_required');

  // Real computeSourceHealth on paused source returns unknown
  const pausedHealth = computeSourceHealth({
    source: { ...source, access_status: 'paused', license_status: 'review_required' },
    now: '2026-09-28T01:30:00Z',
    lastCheckedAt: '2026-09-28T01:00:00Z',
    lastSuccessAt: '2026-09-28T01:00:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(pausedHealth.state, 'unknown');
  assert.equal(pausedHealth.reason, 'source admission or access is not active');

  // Real computeCoverageStatus returns unknown, NEVER no_matching_records
  const coverage = computeCoverageStatus({
    coveringSources: [pausedHealth],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'unknown');
  assert.notEqual(coverage, 'no_matching_records');
});

test('production publisher: at-least-once replay idempotency preserves manifest checkpoint and avoids duplicate fact loading', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  const { publisher, bigquery, store } = await setupPublisher();

  const geo = makeGeoRecord({
    source_id: source.source_id,
    geo_record_id: 'ped:replay:sensor_1',
    version_id: 'v1',
    source_updated_at: '2026-09-28T00:01:00Z',
  });
  const window = {
    source,
    initialCheckpoint: '2026-09-28T00:00:00Z',
    windowFrom: '2026-09-28T00:00:00Z',
    windowTo: '2026-09-28T01:00:00Z',
    result: makeSuccessFixture(source, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [geo]),
  };

  // First publication
  const firstBatch = await publisher.publish(window);
  assert.equal(firstBatch.state, 'published');
  assert.equal(store.manifest.checkpoint, '2026-09-28T01:00:00Z');
  const factCountAfterFirst = bigquery.facts.get('geo_records')?.length ?? 0;
  assert.ok(factCountAfterFirst > 0);

  // Exact same window published again (at-least-once retry)
  const replayBatch = await publisher.publish(window);
  assert.equal(replayBatch.state, 'published');
  assert.equal(store.manifest.checkpoint, '2026-09-28T01:00:00Z', 'Checkpoint must remain identical on replay');

  // Fact rows are NOT duplicated
  const factCountAfterReplay = bigquery.facts.get('geo_records')?.length ?? 0;
  assert.equal(factCountAfterReplay, factCountAfterFirst, 'Replay must not duplicate physical fact rows in BigQuery');
});

// ---------------------------------------------------------------------------
// 6. 许可 review_required 状态与输入边界门槛 (License, access & input guards)
// ---------------------------------------------------------------------------

test('source with review_required license status remains unknown and cannot certify coverage', async () => {
  const fixture = await loadFixture();
  const unreviewedSource = fixture.sources.police_news;
  const now = '2026-09-28T01:00:00Z';

  // Even with regular checks and success
  const health = computeSourceHealth({
    source: unreviewedSource,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'unknown');
  assert.equal(health.reason, 'source admission or access is not active');

  // Coverage evaluation cannot be certified
  const coverage = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'unknown');
  assert.notEqual(coverage, 'no_matching_records');
});

test('paused source remains unknown and cannot certify coverage', async () => {
  const fixture = await loadFixture();
  const pausedSource = fixture.sources.paused_parking;
  const now = '2026-09-28T01:00:00Z';

  const health = computeSourceHealth({
    source: pausedSource,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: now,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });

  assert.equal(health.state, 'unknown');
  assert.equal(health.reason, 'source admission or access is not active');

  const coverage = computeCoverageStatus({
    coveringSources: [health],
    matchingRecords: 0,
    completeWindow: true,
  });
  assert.equal(coverage, 'unknown');
  assert.notEqual(coverage, 'no_matching_records');
});

test('computeSourceHealth rejects future timestamps, invalid dates, and negative counters', async () => {
  const fixture = await loadFixture();
  const source = fixture.sources.pedestrian_minute;
  const now = '2026-09-28T01:00:00Z';

  // Future last_success_at
  const futureSuccess = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: '2026-09-28T01:05:00Z',
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(futureSuccess.state, 'unknown');
  assert.match(futureSuccess.reason, /invalid time or failure evidence/);

  // Future last_checked_at
  const futureChecked = computeSourceHealth({
    source,
    now,
    lastCheckedAt: '2026-09-28T01:05:00Z',
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(futureChecked.state, 'unknown');
  assert.match(futureChecked.reason, /invalid time or failure evidence/);

  // Unparseable timestamp
  const invalidDate = computeSourceHealth({
    source,
    now: 'invalid-date-string',
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(invalidDate.state, 'unknown');
  assert.match(invalidDate.reason, /invalid time or failure evidence/);

  // Negative consecutive failures
  const negativeFailures = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: -1,
    knownGapCount: 0,
  });
  assert.equal(negativeFailures.state, 'unknown');
  assert.match(negativeFailures.reason, /invalid time or failure evidence/);

  // Negative known gaps
  const negativeGaps = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: -1,
  });
  assert.equal(negativeGaps.state, 'unknown');
  assert.match(negativeGaps.reason, /invalid time or failure evidence/);

  // Missing last_success_at
  const missingSuccess = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: null,
    latestCheckSucceeded: true,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(missingSuccess.state, 'unknown');
  assert.match(missingSuccess.reason, /monitoring or check evidence is missing/);

  // Missing latestCheckSucceeded
  const missingCheckResult = computeSourceHealth({
    source,
    now,
    lastCheckedAt: now,
    lastSuccessAt: now,
    latestCheckSucceeded: null,
    latestUpstreamUpdateAt: null,
    consecutiveFailures: 0,
    knownGapCount: 0,
  });
  assert.equal(missingCheckResult.state, 'unknown');
  assert.match(missingCheckResult.reason, /monitoring or check evidence is missing/);
});

// ---------------------------------------------------------------------------
// 7. 真实 GoogleSQL 验收 (GCP Acceptance Test)
// Opt-in only: creates uniquely named, disposable Melbourne datasets and a bucket.
// Run with MELENS_PUBLISH_TEST_PROJECT=<dev-project> MELENS_PUBLISH_TEST_ALLOW_CREATE=1.
// ---------------------------------------------------------------------------

const devProject = process.env.MELENS_PUBLISH_TEST_PROJECT;
test('GCP acceptance: real GoogleSQL health and coverage views, provenance ordering, and delay reporting', {
  skip: !devProject || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1'
    ? 'Pending GCP verification: opt-in real GCP environment required (MELENS_PUBLISH_TEST_PROJECT and MELENS_PUBLISH_TEST_ALLOW_CREATE=1)'
    : false,
  timeout: 1_800_000,
}, async () => {
  assert.ok(devProject);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const cloudConfig: DataConfig = {
    ...config,
    projectId: devProject,
    ingestDataset: `health_test_${id}`,
    queryDataset: `health_views_${id}`,
    bucketName: `melens-health-test-${id}`,
  };
  const bq = new BigQuery({ projectId: devProject, location: config.region });
  const storage = new Storage({ projectId: devProject });
  const store = new GcsStore(storage, cloudConfig.bucketName);
  const publisher = new BigQueryPublisher(cloudConfig, bq, store);
  const createdDatasets: string[] = [];
  let createdBucket = false;

  const query = async (sql: string, params: Record<string, string> = {}) => {
    const [rows] = await bq.query({ query: sql, params, location: config.region, maximumBytesBilled: '100000000' });
    return z.array(z.record(z.string(), z.unknown())).parse(rows);
  };

  try {
    for (const name of [cloudConfig.ingestDataset, cloudConfig.queryDataset]) {
      await bq.createDataset(name, { location: config.region });
      createdDatasets.push(name);
    }
    await storage.createBucket(cloudConfig.bucketName, {
      location: config.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 },
    });
    createdBucket = true;

    const qualify = (sql: string) => sql
      .replaceAll('`melens_ingest.', `\`${devProject}.${cloudConfig.ingestDataset}.`)
      .replaceAll('`melens_query.', `\`${devProject}.${cloudConfig.queryDataset}.`);

    await query(qualify(await readSql('001_tables.sql')));
    await query(qualify(await readSql('002_core_views.sql')));
    await query(qualify(await readSql('008_health_views.sql')));

    // 1. Prepare finite test data: Admitted vs Unadmitted Sources
    const admittedSource: DataSource = {
      source_id: `melens.test.admitted.${id}`,
      legacy_ids: [],
      provider: 'City of Melbourne',
      dataset_title: 'Pedestrian Volume Admitted Test',
      landing_url: 'https://data.melbourne.vic.gov.au',
      topic: 'pedestrian',
      scope: 'city',
      coverage_area_refs: ['melbourne:cbd'],
      coverage_from: '2026-09-28T00:00:00Z',
      coverage_to: null,
      cadence_seconds: 60,
      check_interval_seconds: 60,
      record_granularity: 'observation',
      admission_evidence: {
        dataset_url: 'https://data.melbourne.vic.gov.au/api/explore/v2.1/catalog/datasets/pedestrian-test',
        native_record_key: 'sensor_id:reading_datetime',
        completeness_rule: 'all_active_sensors_per_minute',
        quota_requests_per_day: 5000,
        secret_names: [],
        allowed_fields: ['sensor_id', 'reading_datetime'],
        raw_retention_days: 7,
        staging_retention_days: 1,
        license_evidence_url: 'https://creativecommons.org/licenses/by/4.0/',
        reviewed_at: '2026-09-28T00:00:00Z',
        missing_requirements: [],
        declared_license_status: 'verified_open',
      },
      connector_owner: 'pedestrian-team',
      license_status: 'verified_open',
      access_status: 'active',
      last_checked_at: null,
      last_success_at: null,
      last_source_update_at: null,
    };

    const unadmittedSource: DataSource = {
      ...admittedSource,
      source_id: `melens.test.unadmitted.${id}`,
      dataset_title: 'Unadmitted Source Test',
      license_status: 'review_required',
      access_status: 'candidate',
      admission_evidence: {
        ...admittedSource.admission_evidence,
        missing_requirements: ['legal_review_pending'],
        declared_license_status: 'review_required',
      },
    };

    // Insert unadmitted source row directly into data_sources
    await query(`INSERT INTO \`${devProject}.${cloudConfig.ingestDataset}.data_sources\`
      (source_id, legacy_ids, provider, dataset_title, landing_url, topic, scope, coverage_area_refs,
       coverage_from, coverage_to, cadence_seconds, check_interval_seconds, record_granularity,
       admission_evidence, connector_owner, license_status, access_status, last_checked_at,
       last_success_at, last_source_update_at, updated_at)
      VALUES
      (@sourceId, [], 'City of Melbourne', 'Unadmitted Source Test', 'https://example.org', 'pedestrian', 'city',
       ['melbourne:cbd'], TIMESTAMP '2026-09-28T00:00:00Z', NULL, 60, 60, 'observation',
       PARSE_JSON('{"missing_requirements":["legal_review_pending"]}'), 'pedestrian-team', 'review_required', 'review_required',
       TIMESTAMP '2026-09-28T01:00:00Z', TIMESTAMP '2026-09-28T01:00:00Z', NULL, TIMESTAMP '2026-09-28T01:00:00Z')`,
      { sourceId: unadmittedSource.source_id });

    // 2. Entity versioning on admitted source: Initial (v1) -> Correction (v2) -> Late-Arriving Older (v0)
    const entityId = `geo:gcp:entity:${id}`;

    // Batch 1: Initial version
    const initialRecord = makeGeoRecord({
      source_id: admittedSource.source_id,
      geo_record_id: entityId,
      version_id: 'v1',
      source_updated_at: '2026-09-28T01:00:00Z',
      source_version_ordinal: 1,
      title: 'Initial reading v1',
    });
    await publisher.publish({
      source: admittedSource,
      initialCheckpoint: '2026-09-28T00:00:00Z',
      windowFrom: '2026-09-28T00:00:00Z',
      windowTo: '2026-09-28T01:00:00Z',
      result: makeSuccessFixture(admittedSource, '2026-09-28T00:00:00Z', '2026-09-28T01:00:00Z', [initialRecord], `rev-${id}-1`),
    });

    // Assert: Valid initial row is visible in current view
    const curr1 = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @geoId`,
      { geoId: entityId },
    );
    assert.equal(curr1.length, 1);
    assert.equal(curr1[0]?.['version_id'], 'v1');
    assert.equal(curr1[0]?.['title'], 'Initial reading v1');

    // Batch 2: Updated correction version
    const correctionRecord = makeGeoRecord({
      source_id: admittedSource.source_id,
      geo_record_id: entityId,
      version_id: 'v2',
      source_updated_at: '2026-09-28T02:00:00Z',
      source_version_ordinal: 2,
      title: 'Correction reading v2',
    });
    await publisher.publish({
      source: admittedSource,
      initialCheckpoint: '2026-09-28T01:00:00Z',
      windowFrom: '2026-09-28T01:00:00Z',
      windowTo: '2026-09-28T02:00:00Z',
      result: makeSuccessFixture(admittedSource, '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z', [correctionRecord], `rev-${id}-2`),
    });

    // Assert: Correction version supersedes older version in current view
    const curr2 = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @geoId`,
      { geoId: entityId },
    );
    assert.equal(curr2.length, 1);
    assert.equal(curr2[0]?.['version_id'], 'v2');
    assert.equal(curr2[0]?.['title'], 'Correction reading v2');

    // Batch 3: Late-arriving older version
    const lateArrivingOlderRecord = makeGeoRecord({
      source_id: admittedSource.source_id,
      geo_record_id: entityId,
      version_id: 'v0',
      source_updated_at: '2026-09-28T00:30:00Z',
      source_version_ordinal: 0,
      title: 'Late arriving older v0',
    });
    await publisher.publish({
      source: admittedSource,
      initialCheckpoint: '2026-09-28T02:00:00Z',
      windowFrom: '2026-09-28T02:00:00Z',
      windowTo: '2026-09-28T03:00:00Z',
      result: makeSuccessFixture(admittedSource, '2026-09-28T02:00:00Z', '2026-09-28T03:00:00Z', [lateArrivingOlderRecord], `rev-${id}-3`),
    });

    // Assert: Late-arriving older version does NOT overwrite or revert newer version
    const curr3 = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @geoId`,
      { geoId: entityId },
    );
    assert.equal(curr3.length, 1);
    assert.equal(curr3[0]?.['version_id'], 'v2');
    assert.equal(curr3[0]?.['title'], 'Correction reading v2');

    // Assert: History view retains all versions
    const hist = await query(
      `SELECT version_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_history\` WHERE geo_record_id = @geoId ORDER BY version_id`,
      { geoId: entityId },
    );
    assert.equal(hist.length, 3);
    assert.deepEqual(hist.map(r => r['version_id']), ['v0', 'v1', 'v2']);

    // 3. Misreferenced SourceRecords are NOT visible in published views
    const misreferencedGeoId = `geo:gcp:misreferenced:${id}`;
    const misreferencedRecord = makeGeoRecord({
      source_id: admittedSource.source_id,
      geo_record_id: misreferencedGeoId,
      version_id: 'v_bad',
      title: 'Misreferenced Source Record',
    });
    const badFixture: ConnectorSuccess = {
      ...makeSuccessFixture(admittedSource, '2026-09-28T03:00:00Z', '2026-09-28T04:00:00Z', [misreferencedRecord]),
      geoRecordSources: [{
        batch_id: 'fixture-batch',
        source_id: admittedSource.source_id,
        schema_version: 1,
        fetched_at: '2026-09-28T04:00:00Z',
        geo_record_id: misreferencedGeoId,
        version_id: 'v_bad',
        source_record_id: `sr:nonexistent:${id}`,
        source_version_id: 'v_nonexistent',
        evidence_role: 'primary',
        original_url: null,
      }],
    };
    await assert.rejects(
      publisher.publish({
        source: admittedSource,
        initialCheckpoint: '2026-09-28T03:00:00Z',
        windowFrom: '2026-09-28T03:00:00Z',
        windowTo: '2026-09-28T04:00:00Z',
        result: badFixture,
      }),
      /validation failed/i,
    );

    // Assert: Misreferenced records are NOT visible in published views
    const misreferencedRows = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\` WHERE geo_record_id = @geoId`,
      { geoId: misreferencedGeoId },
    );
    assert.equal(misreferencedRows.length, 0);

    // 4. Failed batches are NOT visible in health/current views
    const failTime = '2026-09-28T05:00:00Z';
    await publisher.recordConnectorFailure(admittedSource, {
      kind: 'failure',
      sourceId: admittedSource.source_id,
      runId: `run-fail-${id}`,
      checkedAt: failTime,
      code: 'upstream_unavailable',
      message: 'Service Unavailable',
      retryAfterSeconds: 60,
      sourceLatestUpdateAt: null,
      completeness: { complete: false, expected_records: null, fetched_records: 0, expected_pages: null, fetched_pages: 0, evidence: 'failure' },
    }, '2026-09-28T04:00:00Z', failTime);

    // Assert: Failed batch state in v_source_health
    const failedBatchHealth = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_source_health\` WHERE source_id = @sourceId`,
      { sourceId: admittedSource.source_id },
    );
    assert.equal(failedBatchHealth.length, 1);
    assert.equal(failedBatchHealth[0]?.['latest_batch_state'], 'failed');
    assert.notEqual(failedBatchHealth[0]?.['latest_published_batch_id'], failedBatchHealth[0]?.['latest_batch_id']);

    // 5. Admitted vs unadmitted sources in GoogleSQL health, coverage, and delay views
    const unadmittedHealth = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_source_health\` WHERE source_id = @sourceId`,
      { sourceId: unadmittedSource.source_id },
    );
    assert.equal(unadmittedHealth.length, 1);
    assert.equal(unadmittedHealth[0]?.['health_state'], 'unknown');

    const unadmittedCoverage = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_source_coverage\` WHERE source_id = @sourceId`,
      { sourceId: unadmittedSource.source_id },
    );
    assert.equal(unadmittedCoverage.length, 1);
    assert.equal(unadmittedCoverage[0]?.['coverage_evidence_state'], 'unknown');

    const delayRows = await query(
      `SELECT * FROM \`${devProject}.${cloudConfig.queryDataset}.v_source_abnormal_delay\` WHERE source_id = @sourceId`,
      { sourceId: unadmittedSource.source_id },
    );
    assert.equal(delayRows.length, 1);
  } finally {
    await Promise.allSettled([
      ...createdDatasets.map(name => bq.dataset(name).delete({ force: true })),
      ...(createdBucket ? [(async () => {
        const bucket = storage.bucket(cloudConfig.bucketName);
        await bucket.deleteFiles({ force: true });
        await bucket.delete();
      })()] : []),
    ]);
  }
});
