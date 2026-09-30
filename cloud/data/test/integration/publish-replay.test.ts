import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Storage } from '@google-cloud/storage';
import { protos } from '@google-cloud/bigquery-storage';
import protobuf from 'protobufjs';

import { BigQuery, type JobMetadata } from '@google-cloud/bigquery';
import { z } from 'zod';
import { loadNdjson } from '../../src/core/bigquery-load.js';
import { writeHighFrequencyRows } from '../../src/core/bigquery-write.js';

import type { ConnectorFailure, ConnectorSuccess } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { addCompletedWindow, type CheckpointManifest, GcsStore,
  type StoredObject } from '../../src/core/gcs.js';
import { BigQueryPublisher } from '../../src/core/publisher.js';
import type { DataSource, GeoRecord, SourceRecord, SyncBatch } from '../../src/core/types.js';

const checkedAt = '2026-09-28T01:00:00Z';
const source: DataSource = {
  source_id: 'test.news', legacy_ids: [], provider: 'Fixture', dataset_title: 'News',
  landing_url: 'https://example.org', topic: 'news', scope: 'victoria',
  coverage_area_refs: ['ASGS_STE:2:2026'], coverage_from: '2026-09-28T00:00:00Z',
  coverage_to: null, cadence_seconds: null, check_interval_seconds: 900,
  record_granularity: 'article', connector_owner: 'test', license_status: 'verified_open',
  access_status: 'active', last_checked_at: null, last_success_at: null,
  last_source_update_at: null,
  admission_evidence: {
    dataset_url: 'https://example.org/data', native_record_key: 'id',
    completeness_rule: 'fixture', quota_requests_per_day: 100,
    secret_names: [], allowed_fields: ['id'], raw_retention_days: 1,
    staging_retention_days: 1, license_evidence_url: 'https://example.org/license',
    reviewed_at: checkedAt, missing_requirements: [], declared_license_status: 'verified_open',
  },
};

const record: SourceRecord = {
  batch_id: 'connector-run', source_id: source.source_id, schema_version: 1,
  fetched_at: checkedAt, source_record_id: 'test.news:1', version_id: 'v1',
  original_url: 'https://example.org/1', raw_uri: null,
  published_at: checkedAt, observed_at: null, first_accessible_at: null,
  time_missing_reason: null, valid_from: null, valid_to: null,
  source_updated_at: null, source_version_ordinal: null,
  record_status: 'active', assertion_kind: 'report', rights_status: 'verified_open',
};

const result: ConnectorSuccess = {
  kind: 'success', sourceId: source.source_id, runId: 'run1', fetchedAt: checkedAt,
  sourceRevision: 'revision-1', sourceLatestUpdateAt: checkedAt,
  checkpointAfter: '2026-09-28T01:00:00Z',
  completeness: { complete: true, method: 'feed_snapshot', expected_records: 1,
    fetched_records: 1, expected_pages: 1, fetched_pages: 1, evidence: 'fixture' },
  inputCount: 1, outputCount: 1, rejectedCount: 0,
  sourceRecords: [record], geoRecords: [], geoRecordSources: [], boundaries: [],
  areaIndicators: [], parkingBays: [], parkingObservations: [], parkingRules: [],
  sensorLocations: [], pedestrianObservations: [], retainableRawRecords: null,
};

const ddl = await readFile(new URL('../../../sql/001_tables.sql', import.meta.url), 'utf8');
const schemas = new Map([...ddl.matchAll(/CREATE TABLE IF NOT EXISTS `melens_ingest\.(\w+)` \(([\s\S]*?)\n\)/g)]
  .map(match => [match[1], [...(match[2] ?? '').matchAll(/^  (\w+) (ARRAY<\w+>|\w+)( NOT NULL)?/gm)]
    .map(field => ({ name: field[1], type: field[2]?.replace(/^ARRAY<|>$/g, ''),
      mode: field[2]?.startsWith('ARRAY') ? 'REPEATED' : field[3] ? 'REQUIRED' : 'NULLABLE' }))]));

const parseRows = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value);

class FakeStore {
  readonly objects = new Map<string, readonly unknown[]>();
  readonly deleted = new Set<string>();
  readonly locks = new Set<string>();
  manifest: CheckpointManifest = { sourceId: source.source_id,
    checkpoint: '2026-09-28T00:00:00Z', completedWindows: [] };
  failCheckpoint = false;
  failCleanup = false;

  async withBatchLease<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.locks.has(id)) throw new Error('Publication already in progress');
    this.locks.add(id);
    try { return await work(); } finally { this.locks.delete(id); }
  }
  async readCheckpoint() { return { manifest: this.manifest, generation: '1' }; }
  async markPublishedWindow(_id: string, _initial: string,
    window: { from: string; to: string; batchId: string }) {
    if (this.failCheckpoint) throw new Error('Simulated checkpoint failure');
    this.manifest = addCompletedWindow(this.manifest, window);
    return this.manifest;
  }
  async saveNdjson(input: { kind: string; sourceId: string; batchId: string;
    rows: readonly unknown[] }): Promise<StoredObject> {
    const hash = createHash('sha256').update(JSON.stringify(input.rows)).digest('hex');
    const uri = `gs://fixture/${input.kind}/${input.sourceId}/${input.batchId}/${hash}.ndjson`;
    this.objects.set(uri, input.rows);
    this.deleted.delete(uri);
    return { uri, sha256: hash, generation: '1', expiresAt: checkedAt };
  }
  async deleteObject(object: StoredObject) { this.deleted.add(object.uri); }
  async deleteStagingObjects(uris: readonly string[]) {
    if (this.failCleanup) throw new Error('Simulated cleanup failure');
    uris.forEach(uri => this.deleted.add(uri));
  }
  async purgeSourceCopies() {
    this.objects.forEach((_, uri) => this.deleted.add(uri));
    return this.objects.size;
  }
}

// This double models storage and injected quality reports. It does not execute GoogleSQL.
// The opt-in GCP test below exercises the actual publisher SQL and current/history views.
class FakeBigQuery {
  readonly states: SyncBatch[] = [];
  readonly queryByteLimits: (string | undefined)[] = [];
  readonly sourceRows: Record<string, unknown>[] = [];
  readonly facts = new Map<string, Record<string, unknown>[]>();
  readonly loadedTables: string[] = [];
  readonly jobs = new Map<string, JobMetadata>();
  readonly validationOverrides = new Map<string, Record<string, unknown>>();
  readonly validationQueries = new Map<string, string>();
  failTable: string | null = null;
  lostPublishResponse = false;
  lostLoadResponse = false;
  failedJobs = 0;
  onLoad: (() => Promise<void>) | null = null;

  constructor(private readonly store: FakeStore) {}

  async getProjectId() { return config.projectId; }
  latest(batchId: unknown) { return this.states.filter(row => row.batch_id === batchId)
    .sort((a, b) => Date.parse(b.state_updated_at) - Date.parse(a.state_updated_at))[0]; }
  visible(table: string) {
    return (this.facts.get(table) ?? []).filter(row => this.latest(row.batch_id)?.state === 'published');
  }
  async query(input: { query: string; params: Record<string, string>;
    maximumBytesBilled?: string }) {
    this.queryByteLimits.push(input.maximumBytesBilled);
    const sql = input.query;
    if (sql.includes('INSERT INTO') && sql.includes('sync_batches')) {
      const row = JSON.parse(input.params.payload ?? '{}') as SyncBatch;
      this.states.push(row);
      if (row.state === 'published' && this.lostPublishResponse) {
        this.lostPublishResponse = false;
        throw new Error('Simulated lost publication response');
      }
      return [[]];
    }
    if (sql.includes('TO_JSON_STRING(t) AS batch')) {
      const latest = this.latest(input.params.batchId);
      return [latest ? [{ batch: JSON.stringify(latest) }] : []];
    }
    if (sql.includes('CAST(last_success_at AS STRING)')) return [this.sourceRows.slice(-1)];
    const table = /\/\* validate:(\w+) \*\//.exec(sql)?.[1];
    if (table) {
      this.validationQueries.set(table, sql);
      const expected = parseRows(JSON.parse(input.params.expectedRows ?? '[]'));
      const actual = (this.facts.get(table) ?? []).filter(row => row.batch_id === input.params.batchId);
      const fields = (schemas.get(table) ?? []).map(field => field.name).filter(name => name !== undefined
        && !['batch_id', 'fetched_at', 'raw_uri', 'first_accessible_at', 'freshness_state'].includes(name));
      const content = (row: Record<string, unknown>) => JSON.stringify(fields.map(name => row[name ?? ''] ?? null));
      const contents = new Set(actual.map(content));
      return [[{ distinct_count: new Set(actual.map(content)).size,
        unexpected: expected.filter(row => !contents.has(content(row))).length,
        invalid: 0, conflicts: 0, ambiguous: 0, ...this.validationOverrides.get(table) }]];
    }
    const deletedTable = /DELETE FROM `[^`]+\.(\w+)`/.exec(sql)?.[1];
    if (deletedTable) { this.facts.delete(deletedTable); return [[]]; }
    if (sql.includes('UPDATE') && sql.includes('sync_batches')) return [[]];
    throw new Error(`Unexpected BigQuery query: ${sql.slice(0, 60)}`);
  }
  dataset() {
    return { table: (table: string) => ({ getMetadata: async () => [{ schema: { fields: schemas.get(table) } }] }) };
  }
  async createJob(input: { jobId: string; configuration: NonNullable<JobMetadata['configuration']> }) {
    if (this.jobs.has(input.jobId)) throw Object.assign(new Error('Duplicate job'), { code: 409 });
    const table = input.configuration.load?.destinationTable?.tableId;
    if (!table) throw new Error('Missing load destination');
    if (table === this.failTable) throw new Error('Simulated load failure');
    const uri = input.configuration.load?.sourceUris?.[0];
    const rows = parseRows(this.store.objects.get(uri ?? '') ?? []);
    const failed = this.failedJobs > 0;
    if (failed) this.failedJobs -= 1;
    this.jobs.set(input.jobId, { configuration: input.configuration,
      status: { state: 'DONE', ...(failed ? { errorResult: { reason: 'backendError' } } : {}) },
      statistics: { load: { outputRows: String(failed ? 0 : rows.length) } } });
    if (!failed) {
      this.loadedTables.push(table);
      if (table === 'data_sources') this.sourceRows.push(...rows);
      else this.facts.set(table, [...this.facts.get(table) ?? [], ...rows]);
    }
    if (this.onLoad) await this.onLoad();
    if (this.lostLoadResponse) {
      this.lostLoadResponse = false;
      throw Object.assign(new Error('Simulated lost load response'), { code: 503 });
    }
    return [];
  }
  job(id: string) { return { getMetadata: async () => [this.jobs.get(id)] }; }
}

const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  secretNames: [] };

function setup() {
  const store = new FakeStore();
  const bigquery = new FakeBigQuery(store);
  const publisher = new BigQueryPublisher(config, bigquery as unknown as BigQuery,
    store as unknown as GcsStore);
  return { store, bigquery, publisher };
}

const window = { source, result, windowFrom: '2026-09-28T00:00:00Z',
  windowTo: '2026-09-28T01:00:00Z', initialCheckpoint: '2026-09-28T00:00:00Z' };

test('boundary publication checks source version identity and revision order', async () => {
  const { publisher, bigquery } = setup();
  await publisher.publish(window);
  const sql = bigquery.validationQueries.get('boundaries');
  assert.ok(sql);
  assert.match(sql, /r\.source_record_id = t\.source_record_id AND r\.version_id = t\.version_id/);
  assert.match(sql, /COUNT\(DISTINCT TO_JSON_STRING\(STRUCT\(source_updated_at, source_version_ordinal\)\)\) AS positions/);
  assert.match(sql, /HAVING versions > 1 AND/);
});

test('failed load leaves the checkpoint and published state unchanged; retry publishes once', async () => {
  const { store, bigquery, publisher } = setup();
  bigquery.failTable = 'source_records';
  await assert.rejects(publisher.publish(window), /Simulated load failure/);
  assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
  assert.deepEqual(bigquery.states.map(row => row.state), ['running', 'failed']);
  assert.equal(bigquery.sourceRows.at(-1)?.last_success_at, null);

  bigquery.failTable = null;
  const published = await publisher.publish(window);
  assert.equal(published.state, 'published');
  assert.equal(store.manifest.checkpoint, window.windowTo);
  assert.deepEqual(bigquery.states.map(row => row.state),
    ['running', 'failed', 'running', 'validated', 'published', 'published']);
  assert.equal(bigquery.sourceRows.at(-1)?.last_success_at, checkedAt);

  const factLoads = bigquery.loadedTables.filter(table => table === 'source_records').length;
  await publisher.publish(window);
  assert.equal(bigquery.loadedTables.filter(table => table === 'source_records').length, factLoads);
});

test('publisher passes the configured billed-byte ceiling to every BigQuery query job', async () => {
  const store = new FakeStore();
  const bigquery = new FakeBigQuery(store);
  const publisher = new BigQueryPublisher({ ...config, maxBytesBilled: '100000000' },
    bigquery as unknown as BigQuery, store as unknown as GcsStore);
  await publisher.publish(window);
  assert.ok(bigquery.queryByteLimits.length > 0);
  assert.ok(bigquery.queryByteLimits.every(limit => limit === '100000000'));
});

test('publisher converts BigQuery FLOAT metadata to GoogleSQL FLOAT64 casts', async () => {
  const store = new FakeStore();
  class MetadataAliasBigQuery extends FakeBigQuery {
    override dataset() {
      return { table: (table: string) => ({ getMetadata: async () => [{ schema: {
        fields: (schemas.get(table) ?? []).map(field => ({ ...field,
          type: field.type === 'FLOAT64' ? 'FLOAT' : field.type })),
      } }] }) };
    }
    override async query(input: Parameters<FakeBigQuery['query']>[0]) {
      assert.doesNotMatch(input.query, /\bAS FLOAT\b/);
      return super.query(input);
    }
  }
  const bigquery = new MetadataAliasBigQuery(store);
  const publisher = new BigQueryPublisher(config, bigquery as unknown as BigQuery,
    store as unknown as GcsStore);
  await publisher.publish({ ...window, result: news('v1', checkedAt) });
  assert.ok(bigquery.queryByteLimits.length > 0);
});

test('connector failure records a failed check without advancing the last success', async () => {
  const { store, bigquery, publisher } = setup();
  await publisher.publish(window);
  const failure: ConnectorFailure = {
    kind: 'failure', sourceId: source.source_id, runId: 'run2',
    checkedAt: '2026-09-28T01:15:00Z', code: 'schema_changed',
    message: 'Fixture changed', retryAfterSeconds: null,
    sourceLatestUpdateAt: null,
    completeness: { complete: false, expected_records: 2, fetched_records: 1,
      expected_pages: 1, fetched_pages: 1, evidence: 'partial' },
  };
  await publisher.recordConnectorFailure(source, failure, '2026-09-28T01:00:00Z',
    '2026-09-28T01:15:00Z');
  assert.equal(bigquery.states.at(-1)?.state, 'failed');
  assert.equal(bigquery.states.at(-1)?.error_code, 'schema_changed');
  assert.equal(bigquery.sourceRows.at(-1)?.last_checked_at, failure.checkedAt);
  assert.equal(bigquery.sourceRows.at(-1)?.last_success_at, checkedAt);
  assert.equal(store.manifest.checkpoint, window.windowTo);
});

test('a later published batch remains pending until the missing earlier window is published', async () => {
  const { store, bigquery, publisher } = setup();
  const later = await publisher.publish({ ...window,
    windowFrom: '2026-09-28T01:00:00Z', windowTo: '2026-09-28T02:00:00Z',
    result: { ...result, checkpointAfter: '2026-09-28T02:00:00Z' } });
  assert.equal(later.state, 'published');
  assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
  assert.equal(store.manifest.completedWindows.length, 1);

  await publisher.publish(window);
  assert.equal(store.manifest.checkpoint, '2026-09-28T02:00:00Z');
  assert.deepEqual(store.manifest.completedWindows, []);
  assert.equal(new Set(bigquery.states.filter(row => row.state === 'published').map(row => row.batch_id)).size, 2);
});

for (const mismatch of [
  { expected_records: 2 },
  { expected_pages: 2 },
  { fetched_pages: -1 },
  { evidence: '' },
]) {
  test(`incomplete evidence cannot publish: ${JSON.stringify(mismatch)}`, async () => {
    const { publisher, store, bigquery } = setup();
    await assert.rejects(publisher.publish({ ...window, result: { ...result,
      completeness: { ...result.completeness, ...mismatch } } }));
    assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
    assert.equal(bigquery.states.filter(row => row.state === 'published').length, 0);
    assert.equal(bigquery.loadedTables.length, 0);
  });
}

test('invalid windows fail before any facts become visible', async () => {
  const { publisher, bigquery } = setup();
  await assert.rejects(publisher.publish({ ...window, windowFrom: window.windowTo }));
  assert.equal(bigquery.states.length, 0);
  assert.equal(bigquery.loadedTables.length, 0);
});

test('checkpoint compares instants across equivalent UTC timestamp spellings', () => {
  const before: CheckpointManifest = { sourceId: source.source_id,
    checkpoint: '2026-09-28T01:00:00.000Z', completedWindows: [] };
  const after = addCompletedWindow(before, { from: '2026-09-28T01:00:00Z',
    to: '2026-09-28T02:00:00Z', batchId: 'next' });
  assert.equal(Date.parse(after.checkpoint), Date.parse('2026-09-28T02:00:00Z'));
  assert.deepEqual(after.completedWindows, []);
});

function news(version: string, updatedAt: string, status: GeoRecord['record_status'] = 'active'): ConnectorSuccess {
  const sourceRecord = { ...record, version_id: version, source_updated_at: updatedAt };
  const geo: GeoRecord = {
    batch_id: record.batch_id, source_id: record.source_id, schema_version: 1, fetched_at: checkedAt,
    geo_record_id: 'test.news:event', version_id: version, topic: 'news', assertion_kind: 'report',
    title: `News ${version}`, summary: null, original_url: record.original_url,
    geometry_geojson: '{"type":"Point","coordinates":[144.96,-37.81]}',
    centroid_lat: -37.81, centroid_lon: 144.96, location_role: 'event_site',
    location_confidence: 'source_coordinate', area_refs: [], published_at: checkedAt, observed_at: null,
    valid_from: null, valid_to: null, source_updated_at: updatedAt, source_version_ordinal: null,
    freshness_state: 'current', record_status: status, rights_status: 'verified_open', public_query_allowed: true,
  };
  return { ...result, sourceRevision: version, sourceRecords: [sourceRecord], geoRecords: [geo],
    geoRecordSources: [{ batch_id: record.batch_id, source_id: record.source_id, schema_version: 1,
      fetched_at: checkedAt, geo_record_id: geo.geo_record_id, version_id: version,
      source_record_id: record.source_record_id, source_version_id: version,
      evidence_role: 'primary', original_url: record.original_url }] };
}

for (const failure of ['checkpoint', 'cleanup', 'publication response'] as const) {
  test(`published facts survive a lost ${failure}; retry repairs remaining work`, async () => {
    const { store, bigquery, publisher } = setup();
    store.failCheckpoint = failure === 'checkpoint';
    store.failCleanup = failure === 'cleanup';
    bigquery.lostPublishResponse = failure === 'publication response';
    await assert.rejects(publisher.publish(window), /Simulated/);
    assert.equal(bigquery.visible('source_records').length, 1);
    assert.equal(bigquery.states.at(-1)?.state, 'published');
    const publishedAt = bigquery.states.at(-1)?.published_at;
    const factLoads = bigquery.loadedTables.filter(table => table === 'source_records').length;
    store.failCheckpoint = false;
    store.failCleanup = false;
    const replay = await publisher.publish(window);
    assert.equal(replay.published_at, publishedAt);
    assert.equal(replay.checkpoint_after, window.windowTo);
    assert.equal(store.manifest.checkpoint, window.windowTo);
    assert.equal(bigquery.loadedTables.filter(table => table === 'source_records').length, factLoads);
    assert.ok(replay.staging_uris.every(uri => store.deleted.has(uri)));
  });
}

test('an acknowledged but unanswered load is reused without appending another copy', async () => {
  const { publisher, bigquery } = setup();
  bigquery.lostLoadResponse = true;
  await publisher.publish(window);
  assert.equal(bigquery.visible('source_records').length, 1);
});

test('a terminal transient load failure uses a new attempt and publishes once', async () => {
  const { publisher, bigquery } = setup();
  bigquery.failedJobs = 1;
  await publisher.publish(window);
  assert.equal(bigquery.visible('source_records').length, 1);
  await publisher.publish(window);
  assert.equal(bigquery.visible('source_records').length, 1);
});

test('partial physical writes stay invisible and an empty-table replay cannot expose them', async () => {
  const { publisher, bigquery, store } = setup();
  const input = { ...window, result: news('v1', checkedAt) };
  bigquery.failTable = 'geo_record_sources';
  await assert.rejects(publisher.publish(input), /Simulated/);
  assert.equal(bigquery.facts.get('geo_records')?.length, 1);
  assert.equal(bigquery.visible('geo_records').length, 0);
  assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
  bigquery.failTable = null;
  await assert.rejects(publisher.publish({ ...input, result: { ...input.result,
    geoRecords: [], geoRecordSources: [] } }), /validation failed for geo_records/);
  assert.equal(bigquery.visible('geo_records').length, 0);
  await publisher.publish(input);
  assert.equal(bigquery.visible('geo_records').length, 1);
  assert.equal(store.manifest.checkpoint, window.windowTo);
});

test('changed payload cannot be acknowledged as an already published batch', async () => {
  const { publisher, bigquery, store } = setup();
  const first = await publisher.publish(window);
  await assert.rejects(publisher.publish({ ...window, result: { ...result,
    sourceRecords: [{ ...record, original_url: 'https://example.org/different' }] } }), /validation failed/);
  assert.equal(bigquery.visible('source_records')[0]?.original_url, record.original_url);
  assert.equal(store.manifest.checkpoint, window.windowTo);
  assert.equal(bigquery.latest(first.batch_id)?.state, 'published');
});

test('simultaneous same-source batches cannot cross the validation/publication boundary', async () => {
  const { publisher, bigquery } = setup();
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let entered: () => void = () => {};
  const loading = new Promise<void>(resolve => { entered = resolve; });
  bigquery.onLoad = async () => { entered(); await blocked; };
  const first = publisher.publish(window);
  await loading;
  await assert.rejects(publisher.publish(window), /already in progress/);
  await assert.rejects(publisher.publish({ ...window, result: { ...result, sourceRevision: 'another' } }), /already in progress/);
  release();
  await first;
  bigquery.onLoad = null;
  await publisher.publish(window);
  assert.equal(bigquery.visible('source_records').length, 1);
});

for (const table of [...schemas.keys()].filter(name => name !== 'sync_batches' && name !== 'data_sources')) {
  test(`quality failures in ${table} block publication even when the plan is empty`, async () => {
    const { publisher, bigquery, store } = setup();
    bigquery.validationOverrides.set(table ?? '', { conflicts: 1 });
    await assert.rejects(publisher.publish(window), /validation failed/);
    assert.equal(bigquery.visible('source_records').length, 0);
    assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
  });
}
for (const report of [{ unexpected: 1 }, { invalid: 1 }, { ambiguous: 1 }, { conflicts: null }, { distinct_count: 'NaN' }]) {
  test(`nonzero or malformed quality report fails closed: ${JSON.stringify(report)}`, async () => {
    const { publisher, bigquery, store } = setup();
    bigquery.validationOverrides.set('source_records', report);
    await assert.rejects(publisher.publish(window));
    assert.equal(bigquery.visible('source_records').length, 0);
    assert.equal(store.manifest.checkpoint, window.initialCheckpoint);
  });
}

test('invalid geography quarantines its links while preserving the valid source fact', async () => {
  const { publisher, bigquery } = setup();
  const input = news('bad-geometry', checkedAt);
  const published = await publisher.publish({ ...window, result: { ...input,
    geoRecords: input.geoRecords.map(row => ({ ...row, geometry_geojson: '{"type":"Point","coordinates":[200,0]}' })) } });
  assert.equal(published.rejected_count, 1);
  assert.equal(bigquery.visible('source_records').length, 1);
  assert.equal(bigquery.visible('geo_records').length, 0);
  assert.equal(bigquery.visible('geo_record_sources').length, 0);
});

test('restricted sources cannot expand permission or retain unapproved title text', async () => {
  const { publisher, bigquery } = setup();
  const restricted: DataSource = { ...source, license_status: 'restricted' };
  await assert.rejects(publisher.publish({ ...window, source: restricted }), /permission/);
  const input = news('restricted', checkedAt);
  await assert.rejects(publisher.publish({ ...window, source: restricted, result: { ...input,
    sourceRecords: input.sourceRecords.map(row => ({ ...row, rights_status: 'restricted' })),
    geoRecords: input.geoRecords.map(row => ({ ...row, rights_status: 'restricted' })),
  } }), /Restricted field/);
  assert.equal(bigquery.loadedTables.length, 0);
});

test('revocation deletes copies; stale publication cannot reactivate the source', async () => {
  const { publisher, bigquery, store } = setup();
  await publisher.publish(window);
  await publisher.pauseSource(source);
  assert.equal(bigquery.sourceRows.at(-1)?.access_status, 'paused');
  assert.equal(bigquery.visible('source_records').length, 0);
  assert.ok([...store.objects.keys()].every(uri => store.deleted.has(uri)));
  await assert.rejects(publisher.publish(window), /withdrawn or narrowed/);
  assert.equal(bigquery.sourceRows.at(-1)?.access_status, 'paused');
});

test('default-stream retry duplicates physical rows but only publishes a complete batch', async () => {
  const store = new FakeStore();
  const bigquery = new FakeBigQuery(store);
  let fail = true;
  const writer: typeof writeHighFrequencyRows = async input => {
    const rows = parseRows(input.rows);
    bigquery.facts.set(input.table, [...bigquery.facts.get(input.table) ?? [], ...rows]);
    if (fail) { fail = false; throw new Error('Simulated lost append response'); }
    return { acknowledgedRows: rows.length, guarantee: 'at_least_once' };
  };
  const publisher = new BigQueryPublisher(config, bigquery as unknown as BigQuery,
    store as unknown as GcsStore, writer);
  const input = { ...window, source: { ...source, cadence_seconds: 60 } };
  await assert.rejects(publisher.publish(input), /lost append/);
  assert.equal(bigquery.visible('source_records').length, 0);
  await publisher.publish(input);
  assert.equal(bigquery.facts.get('source_records')?.length, 2);
  assert.equal(new Set(bigquery.visible('source_records').map(row => `${row.source_record_id}/${row.version_id}`)).size, 1);
  assert.equal(store.manifest.checkpoint, window.windowTo);
});

for (const response of [
  { appendResult: {} }, { error: { code: 3 } }, { rowErrors: [{ index: 0, message: 'invalid' }] }, {},
]) {
  test(`Write API validates its acknowledgement and encodes UTC microseconds: ${JSON.stringify(response)}`, async () => {
    type WriteInput = Parameters<typeof writeHighFrequencyRows>[0];
    const type = protos.google.cloud.bigquery.storage.v1.TableFieldSchema.Type;
    let closed = false;
    let sent: Uint8Array | undefined;
    const client: NonNullable<WriteInput['client']> = {
      enableWriteRetries() {}, close() {},
      async getWriteStream() { return { tableSchema: { fields: [
        { name: 'batch_id', type: type.STRING }, { name: 'source_id', type: type.STRING },
        { name: 'version_id', type: type.STRING }, { name: 'sensor_id', type: type.STRING },
        { name: 'fetched_at', type: 'TIMESTAMP' as unknown as typeof type.TIMESTAMP },
        { name: 'observed_at', type: 'TIMESTAMP' as unknown as typeof type.TIMESTAMP },
      ] } }; },
      async createStreamConnection() {
        const connection = {
          onSchemaUpdated: () => ({ off() {} }), getStreamId: () => '_default', reconnect() {},
          close() { closed = true; },
          write(request: protos.google.cloud.bigquery.storage.v1.IAppendRowsRequest) {
            const bytes = request.protoRows?.rows?.serializedRows?.[0];
            assert.ok(bytes instanceof Uint8Array);
            sent = bytes;
            return { async getResult() { return response; } };
          },
        };
        return connection as unknown as Awaited<ReturnType<NonNullable<WriteInput['client']>['createStreamConnection']>>;
      },
    };
    const write = writeHighFrequencyRows({ projectId: config.projectId, dataset: config.ingestDataset,
      table: 'pedestrian_observations', batchId: 'batch', rows: [{
        batch_id: 'batch', source_id: source.source_id, version_id: 'v1', sensor_id: '1',
        fetched_at: checkedAt, observed_at: '2026-09-28T01:00:00.123456Z',
      }], client });
    if ('appendResult' in response) assert.equal((await write).acknowledgedRows, 1);
    else await assert.rejects(write, /append rejected/);
    assert.ok(sent);
    const wire = protobuf.Reader.create(sent);
    let observedAt: string | undefined;
    while (wire.pos < wire.len) {
      const tag = wire.uint32();
      if (tag >>> 3 === 6) observedAt = wire.int64().toString();
      else wire.skipType(tag & 7);
    }
    assert.equal(observedAt, (BigInt(Date.parse(checkedAt)) * 1000n + 123456n).toString());
    assert.equal(closed, true);
  });
}

class MemoryStorage {
  readonly objects = new Map<string, { bytes: Buffer; generation: string; metadata: Record<string, unknown> }>();
  private sequence = 9007199254740993n;
  afterMetadata: (() => void) | null = null;
  beforeSave: (() => void) | null = null;
  bucket() { return {
    file: (name: string, options?: { generation?: string }) => this.file(name, options),
    getFiles: async ({ prefix }: { prefix: string }) => [[...this.objects.keys()]
      .filter(name => name.startsWith(prefix)).map(name => this.file(name))],
  }; }
  put(name: string, bytes: Buffer | string, metadata: Record<string, unknown> = {}) {
    this.sequence += 1n;
    this.objects.set(name, { bytes: Buffer.from(bytes), generation: this.sequence.toString(), metadata });
  }
  private file(name: string, options?: { generation?: string }) {
    const read = () => {
      const object = this.objects.get(name);
      if (!object || (options?.generation !== undefined && options.generation !== object.generation)) {
        throw Object.assign(new Error('Object generation not found'), { code: 404 });
      }
      return object;
    };
    return { name,
      getMetadata: async () => {
        const object = read();
        this.afterMetadata?.();
        return [{ generation: object.generation, metadata: object.metadata }];
      },
      download: async () => [read().bytes],
      save: async (bytes: Buffer | string, input: { preconditionOpts: { ifGenerationMatch: string | number };
        metadata?: { metadata?: Record<string, unknown> } }) => {
        this.beforeSave?.();
        const expected = String(input.preconditionOpts.ifGenerationMatch);
        const actual = this.objects.get(name)?.generation ?? '0';
        if (expected !== actual) throw Object.assign(new Error('Precondition failed'), { code: 412 });
        this.put(name, bytes, input.metadata?.metadata);
      },
      delete: async () => { try { read(); this.objects.delete(name); } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 404) throw error;
      } },
    };
  }
}

function memoryStore() {
  const storage = new MemoryStorage();
  return { storage, gcs: new GcsStore(storage as unknown as Storage, 'fixture') };
}

test('checkpoint reads pair bytes with their generation, even if replaced between requests', async () => {
  const { storage, gcs } = memoryStore();
  const name = `checkpoints/${source.source_id}.json`;
  const first: CheckpointManifest = { sourceId: source.source_id, checkpoint: window.initialCheckpoint, completedWindows: [] };
  const next = addCompletedWindow(first, { from: window.windowFrom, to: window.windowTo, batchId: 'first' });
  storage.put(name, JSON.stringify(first));
  storage.afterMetadata = () => { storage.afterMetadata = null; storage.put(name, JSON.stringify(next)); };
  const read = await gcs.readCheckpoint(source.source_id, window.initialCheckpoint);
  assert.equal(read.manifest.checkpoint, window.windowTo);
  assert.equal(read.generation, storage.objects.get(name)?.generation);
});

test('checkpoint generation conflict preserves another writer’s pending window and closes the gap', async () => {
  const { storage, gcs } = memoryStore();
  const name = `checkpoints/${source.source_id}.json`;
  storage.beforeSave = () => {
    storage.beforeSave = null;
    storage.put(name, JSON.stringify({ sourceId: source.source_id, checkpoint: window.initialCheckpoint,
      completedWindows: [{ from: window.windowTo, to: '2026-09-28T02:00:00Z', batchId: 'later' }] }));
  };
  const checkpoint = await gcs.markPublishedWindow(source.source_id, window.initialCheckpoint,
    { from: window.windowFrom, to: window.windowTo, batchId: 'early' });
  assert.equal(checkpoint.checkpoint, '2026-09-28T02:00:00Z');
  assert.deepEqual(checkpoint.completedWindows, []);
});

test('GCS lease rejects concurrent writers and releases the lock after a failed owner', async () => {
  const { gcs, storage } = memoryStore();
  await assert.rejects(gcs.withBatchLease('batch', async () => {
    await assert.rejects(gcs.withBatchLease('batch', async () => {}), /already in progress/);
    throw new Error('owner failed');
  }), /owner failed/);
  await gcs.withBatchLease('batch', async () => {});
  assert.equal(storage.objects.size, 0);
});

test('raw archive keeps approved fields only and immutable replay reuses identical bytes', async () => {
  const { gcs, storage } = memoryStore();
  const input = { kind: 'raw' as const, sourceId: source.source_id, batchId: 'batch',
    rows: [{ id: '1', body: 'unapproved' }], allowedFields: ['id'], retentionDays: 1 };
  const first = await gcs.saveNdjson(input);
  const second = await gcs.saveNdjson(input);
  assert.equal(first.generation, second.generation);
  assert.equal(storage.objects.size, 1);
  assert.equal([...storage.objects.values()][0]?.bytes.toString(), '{"id":"1"}\n');
  await gcs.purgeSourceCopies(source.source_id);
  assert.equal(storage.objects.size, 0);
});

function cloudFixture(owner: DataSource, version: string, updatedAt: string, fetchedAt = checkedAt): ConnectorSuccess {
  const base = news(version, updatedAt);
  const sourceRecordId = `${owner.source_id}:1`;
  const geoId = `${owner.source_id}:event`;
  const provenance = { batch_id: 'fixture', source_id: owner.source_id, schema_version: 1, fetched_at: fetchedAt };
  const reference = { ...provenance, version_id: version, source_record_id: sourceRecordId };
  const ordered = { source_updated_at: updatedAt, source_version_ordinal: null };
  const point = '{"type":"Point","coordinates":[144.96,-37.81]}';
  const polygon = '{"type":"Polygon","coordinates":[[[144.95,-37.82],[144.97,-37.82],[144.97,-37.80],[144.95,-37.80],[144.95,-37.82]]]}';
  return { ...base, sourceId: owner.source_id, fetchedAt, sourceLatestUpdateAt: updatedAt,
    sourceRecords: base.sourceRecords.map(row => ({ ...row, source_id: owner.source_id, fetched_at: fetchedAt, source_record_id: sourceRecordId })),
    geoRecords: base.geoRecords.map(row => ({ ...row, source_id: owner.source_id, fetched_at: fetchedAt, geo_record_id: geoId })),
    geoRecordSources: [...base.geoRecordSources.map(row => ({ ...row, source_id: owner.source_id,
      fetched_at: fetchedAt, geo_record_id: geoId, source_record_id: sourceRecordId })),
      { ...provenance, geo_record_id: geoId, version_id: version, source_record_id: 'test.evidence:1',
        source_version_id: 'evidence', evidence_role: 'official_join', original_url: record.original_url }],
    boundaries: [{ ...reference, boundary_id: `${owner.source_id}:boundary`, scheme: 'fixture', code: '1',
      name: 'Fixture', vintage: '2026', geometry_geojson: polygon, valid_from: null, valid_to: null }],
    areaIndicators: [{ ...reference, ...ordered, indicator_id: `${owner.source_id}:indicator`,
      boundary_id: `${owner.source_id}:boundary`, period_start: window.windowFrom, period_end: window.windowTo,
      status: 'observed', value: 1, unit: 'count', assertion_kind: 'observation', definition: 'fixture' }],
    parkingBays: [{ ...reference, ...ordered, bay_id: `${owner.source_id}:bay`, marker_id: '1',
      geometry_geojson: polygon, valid_from: null, valid_to: null, public_access: true }],
    parkingObservations: [{ ...reference, sensor_id: `${owner.source_id}:parking`, bay_id: `${owner.source_id}:bay`,
      marker_id: '1', observed_at: checkedAt, occupied: true }],
    parkingRules: [{ ...reference, ...ordered, rule_id: `${owner.source_id}:rule`, bay_id: `${owner.source_id}:bay`,
      days_of_week: [1, 2], start_minute_of_day: 0, end_minute_of_day: 60, holiday_applicability: null,
      vehicle_class: null, restriction_type: 'timed', max_stay_minutes: 30, exemption: null,
      valid_from: null, valid_to: null }],
    sensorLocations: [{ ...reference, ...ordered, sensor_id: `${owner.source_id}:pedestrian`,
      geometry_geojson: point, device_status: 'active', valid_from: window.windowFrom, valid_to: null }],
    pedestrianObservations: [{ ...reference, sensor_id: `${owner.source_id}:pedestrian`, observed_at: checkedAt,
      direction_a_count: 0, direction_b_count: 1, total_count: 1 }],
    retainableRawRecords: [{ id: '1', excluded: 'must not be retained' }],
  };
}

class FaultGcsStore extends GcsStore {
  failBeforeLinks = false;
  failCheckpoint = false;
  override async saveNdjson(input: Parameters<GcsStore['saveNdjson']>[0]) {
    if (this.failBeforeLinks && input.batchId.endsWith('.geo_record_sources')) {
      this.failBeforeLinks = false;
      throw new Error('Injected failure after fact writes');
    }
    return super.saveNdjson(input);
  }
  override async markPublishedWindow(...args: Parameters<GcsStore['markPublishedWindow']>) {
    if (this.failCheckpoint) { this.failCheckpoint = false; throw new Error('Injected checkpoint failure'); }
    return super.markPublishedWindow(...args);
  }
}

// Opt-in only: creates uniquely named, disposable Melbourne datasets and a bucket.
// Run with MELENS_PUBLISH_TEST_PROJECT=<dev-project> MELENS_PUBLISH_TEST_ALLOW_CREATE=1.
const devProject = process.env.MELENS_PUBLISH_TEST_PROJECT;
test('GCP acceptance: real GoogleSQL, both write paths, replay, ordering, references and revocation', {
  skip: !devProject || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1', timeout: 1_800_000,
}, async t => {
  assert.ok(devProject);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const cloudConfig: DataConfig = { ...config, projectId: devProject,
    ingestDataset: `publish_test_${id}`, queryDataset: `publish_views_${id}`, bucketName: `melens-publish-test-${id}` };
  const bq = new BigQuery({ projectId: devProject, location: config.region });
  const storage = new Storage({ projectId: devProject });
  const store = new FaultGcsStore(storage, cloudConfig.bucketName);
  const publisher = new BigQueryPublisher(cloudConfig, bq, store);
  const createdDatasets: string[] = [];
  let createdBucket = false;
  const query = async (sql: string, params: Record<string, string> = {}) => {
    const [rows] = await bq.query({ query: sql, params, location: config.region, maximumBytesBilled: '100000000' });
    return parseRows(rows);
  };
  try {
    for (const name of [cloudConfig.ingestDataset, cloudConfig.queryDataset]) {
      await bq.createDataset(name, { location: config.region });
      createdDatasets.push(name);
    }
    await storage.createBucket(cloudConfig.bucketName, { location: config.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 } });
    createdBucket = true;
    const qualify = (sql: string) => sql
      .replaceAll('`melens_ingest.', `\`${devProject}.${cloudConfig.ingestDataset}.`)
      .replaceAll('`melens_query.', `\`${devProject}.${cloudConfig.queryDataset}.`);
    await query(qualify(ddl));
    await query(qualify(await readFile(new URL('../../../sql/002_core_views.sql', import.meta.url), 'utf8')));
    // A static GTFS-style evidence record may belong to a different admitted source.
    const evidenceSource: DataSource = { ...source, source_id: 'test.evidence' };
    await publisher.publish({ source: evidenceSource, windowFrom: null, windowTo: null, initialCheckpoint: null,
      result: { ...result, sourceId: evidenceSource.source_id, checkpointAfter: null,
        sourceRecords: [{ ...record, source_id: evidenceSource.source_id,
          source_record_id: 'test.evidence:1', version_id: 'evidence' }] } });
    const modes = process.env.MELENS_PUBLISH_TEST_MODE === 'write'
      ? ['write'] as const : ['load', 'write'] as const;
    for (const mode of modes) {
      await t.test(`${mode}: failed/duplicate/late/overlapping publication and checkpoint recovery`, async () => {
        const owner: DataSource = { ...source, source_id: `test.replay.${mode}`, cadence_seconds: mode === 'write' ? 60 : null };
        const initial = window.initialCheckpoint;
        const hour = (n: number) => `2026-09-28T0${n}:00:00Z`;
        const input = (version: string, n: number, updated = hour(n + 1)) => ({
          source: owner, initialCheckpoint: initial, windowFrom: hour(n), windowTo: hour(n + 1),
          result: { ...cloudFixture(owner, version, updated, hour(n + 2)), checkpointAfter: hour(n + 1) },
        });
        const current = () => query(`SELECT version_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_current\`
          WHERE source_id = @sourceId`, { sourceId: owner.source_id });
        const history = () => query(`SELECT version_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_geo_records_history\`
          WHERE source_id = @sourceId ORDER BY version_id`, { sourceId: owner.source_id });
        const cursor = async () => (await store.readCheckpoint(owner.source_id, initial)).manifest.checkpoint;
        const later = input('v2', 1);
        const concurrent = await Promise.allSettled([publisher.publish(later), publisher.publish(later)]);
        assert.ok(concurrent.some(outcome => outcome.status === 'fulfilled'),
          concurrent.map(outcome => outcome.status === 'rejected'
            ? String(outcome.reason) : 'fulfilled').join('; '));
        for (const outcome of concurrent) if (outcome.status === 'rejected') {
          assert.match(String(outcome.reason), /already in progress/);
        }
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        assert.equal(Date.parse(await cursor()), Date.parse(initial));

        const early = input('v1', 0);
        await assert.rejects(publisher.publish({ ...early, result: { ...early.result,
          completeness: { ...early.result.completeness, expected_pages: 2 } } }), /incomplete/);
        store.failBeforeLinks = true;
        await assert.rejects(publisher.publish(early), /Injected failure/);
        assert.deepEqual(await history(), [{ version_id: 'v2' }]);
        assert.equal(Date.parse(await cursor()), Date.parse(initial));
        const first = await publisher.publish(early);
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        assert.equal(Date.parse(await cursor()), Date.parse(hour(2)));
        assert.equal(Date.parse(first.checkpoint_after ?? ''), Date.parse(hour(2)));
        const duplicate = await publisher.publish(early);
        assert.equal(duplicate.published_at, first.published_at);
        assert.deepEqual(await history(), [{ version_id: 'v1' }, { version_id: 'v2' }]);

        const old = input('v0', 2, hour(0));
        store.failCheckpoint = true;
        await assert.rejects(publisher.publish(old), /Injected checkpoint/);
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        assert.equal(Date.parse(await cursor()), Date.parse(hour(2)));
        await publisher.publish(old);
        assert.equal(Date.parse(await cursor()), Date.parse(hour(3)));
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        assert.equal((await history()).length, 3);

        const conflicting = input('v2', 3, hour(2));
        await assert.rejects(publisher.publish({ ...conflicting, result: { ...conflicting.result,
          sourceRevision: 'conflict', geoRecords: conflicting.result.geoRecords.map(row => ({ ...row, title: 'changed without version' })) } }), /validation failed/);
        await assert.rejects(publisher.publish(input('ambiguous', 3, hour(2))), /validation failed/);
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        assert.equal(Date.parse(await cursor()), Date.parse(hour(3)));

        const dangling = input('dangling', 3);
        await assert.rejects(publisher.publish({ ...dangling, result: { ...dangling.result,
          geoRecordSources: dangling.result.geoRecordSources.map(row => ({ ...row, source_version_id: 'missing' })) } }), /validation failed/);
        assert.deepEqual(await current(), [{ version_id: 'v2' }]);
        const cancelled = input('v4', 3);
        await publisher.publish({ ...cancelled, result: { ...cancelled.result,
          geoRecords: cancelled.result.geoRecords.map(row => ({ ...row, record_status: 'cancelled' })) } });
        assert.deepEqual(await current(), []);
        assert.equal((await history()).length, 4);
        await publisher.pauseSource(owner);
        assert.deepEqual(await history(), []);
        const remaining = await query(`SELECT COUNT(*) AS n FROM \`${devProject}.${cloudConfig.ingestDataset}.geo_records\`
          WHERE source_id = @sourceId`, { sourceId: owner.source_id });
        assert.equal(Number(remaining[0]?.n), 0);
        const [raw] = await storage.bucket(cloudConfig.bucketName).getFiles({ prefix: `raw/${owner.source_id}/` });
        assert.equal(raw.length, 0);
        await assert.rejects(publisher.publish(later), /withdrawn or narrowed/);
      });
    }
  } finally {
    const cleanup = await Promise.allSettled([
      ...createdDatasets.map(name => bq.dataset(name).delete({ force: true })),
      ...(createdBucket ? [(async () => {
        const bucket = storage.bucket(cloudConfig.bucketName);
        await bucket.deleteFiles({ force: true });
        await bucket.delete();
      })()] : []),
    ]);
    const failures = cleanup.filter(outcome => outcome.status === 'rejected');
    if (failures.length) throw new Error(`GCP fixture cleanup failed; inspect datasets ${createdDatasets.join(', ')} and bucket ${cloudConfig.bucketName}`);
  }
});

test('a later invocation can recover after exhausting transient failed load attempts', async () => {
  const { bigquery, store } = setup();
  const staged = await store.saveNdjson({ kind: 'staging', sourceId: source.source_id, batchId: 'batch', rows: [record] });
  const load = () => loadNdjson({ bigquery: bigquery as unknown as BigQuery, dataset: config.ingestDataset,
    table: 'source_records', batchId: 'batch', uri: staged.uri, location: config.region });
  bigquery.failedJobs = 4;
  await assert.rejects(load(), /backendError/);
  assert.equal(bigquery.facts.get('source_records'), undefined);
  const recovered = await load();
  assert.equal(recovered.outputRows, 1);
  await load();
  assert.equal(bigquery.facts.get('source_records')?.length, 1);
});

test('load rejects an existing job with different configuration or a permanent failure', async () => {
  const { bigquery, store } = setup();
  const staged = await store.saveNdjson({ kind: 'staging', sourceId: source.source_id, batchId: 'batch', rows: [record] });
  const load = () => loadNdjson({ bigquery: bigquery as unknown as BigQuery, dataset: config.ingestDataset,
    table: 'source_records', batchId: 'batch', uri: staged.uri, location: config.region });
  const loaded = await load();
  const job = bigquery.jobs.get(loaded.jobId);
  assert.ok(job?.configuration?.load);
  job.configuration.load.writeDisposition = 'WRITE_TRUNCATE';
  await assert.rejects(load(), /configuration differs/);
  job.configuration.load.writeDisposition = 'WRITE_APPEND';
  job.status = { state: 'DONE', errorResult: { reason: 'invalid' } };
  await assert.rejects(load(), /Load job failed: invalid/);
  assert.equal(bigquery.jobs.size, 1);
});

test('large expected batches are validated without losing rows across request chunks', async () => {
  const { publisher, bigquery } = setup();
  const rows = Array.from({ length: 1200 }, (_, index) => ({ ...record,
    source_record_id: `${source.source_id}:${index}`, original_url: `https://example.org/${index}` }));
  await publisher.publish({ ...window, result: { ...result, sourceRecords: rows,
    inputCount: rows.length, outputCount: rows.length,
    completeness: { ...result.completeness, expected_records: rows.length, fetched_records: rows.length } } });
  assert.equal(bigquery.visible('source_records').length, rows.length);
});
