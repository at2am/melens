import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  LANDING_URL,
  PedestrianMinuteConnector,
  SOURCE_ID,
  createConnector,
  parsePedestrianMinuteRow,
  rowSchema,
  validateMelbourneSensingDateTime,
} from '../../src/connectors/com_pedestrian_minute/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpResponse } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { parseSourceManifest } from '../../src/core/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '../../src/connectors/com_pedestrian_minute/source.json');
const fixturePath = join(__dirname, '../fixtures/com_pedestrian_minute.json');

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8')) as {
    total_count: number;
    results: unknown[];
  };
}

class FakeHttpClient extends HttpClient {
  constructor(
    private readonly handler: (url: URL) => Promise<HttpResponse<unknown>> | HttpResponse<unknown>,
  ) {
    super();
  }

  override async getJson<T>(request: { url: string | URL }): Promise<HttpResponse<T>> {
    const url = new URL(request.url.toString());
    const res = await this.handler(url);
    return res as HttpResponse<T>;
  }
}

class FakeOdsClient extends OpenDataSoftClient {
  constructor(
    private readonly recordsHandler: (query: OdsQuery) => Promise<OdsRecords> | OdsRecords,
  ) {
    super();
  }

  override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
    return this.recordsHandler(query);
  }
}

test('manifest registers the admitted source: CC BY 4.0 open data, active, with its reviewed quota', async () => {
  const manifest = await loadManifest();
  const dataSource = parseSourceManifest(manifest);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.topic, 'pedestrian');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'verified_open');
  assert.equal(dataSource.access_status, 'active');
  assert.equal(dataSource.admission_evidence.quota_requests_per_day, 10000);
  assert.equal(dataSource.record_granularity, 'sensor_minute');
  assert.equal(dataSource.admission_evidence.native_record_key, 'location_id + sensing_datetime');
  assert.ok(dataSource.admission_evidence.allowed_fields?.includes('location_id'));
  assert.ok(dataSource.admission_evidence.allowed_fields?.includes('sensing_datetime'));
  assert.ok(dataSource.admission_evidence.allowed_fields?.includes('direction_1'));
  assert.ok(dataSource.admission_evidence.allowed_fields?.includes('direction_2'));
  assert.ok(dataSource.admission_evidence.allowed_fields?.includes('total_of_directions'));
});

test('rowSchema validates correct sensing_datetime and rejects missing timezone offset', () => {
  const validUtc = {
    location_id: 3,
    sensing_datetime: '2026-09-30T12:04:00+00:00',
    direction_1: 4,
    direction_2: 6,
    total_of_directions: 10,
  };
  assert.doesNotThrow(() => parsePedestrianMinuteRow(validUtc));

  const validZ = {
    location_id: 3,
    sensing_datetime: '2026-09-30T12:04:00Z',
    direction_1: 0,
    direction_2: 1,
    total_of_directions: 1,
  };
  assert.doesNotThrow(() => parsePedestrianMinuteRow(validZ));

  const invalidNoOffset = {
    location_id: 3,
    sensing_datetime: '2026-09-30T12:04:00',
    direction_1: 1,
    direction_2: 1,
    total_of_directions: 2,
  };
  assert.throws(() => parsePedestrianMinuteRow(invalidNoOffset));
});

test('Melbourne DST validation checks local date/time agreement across AEST and AEDT', () => {
  // AEST (UTC+10): 2026-09-30 12:04 UTC is 2026-09-30 22:04 local
  assert.equal(validateMelbourneSensingDateTime({
    sensing_datetime: '2026-09-30T12:04:00+00:00',
    sensing_date: '2026-09-30',
    sensing_time: '22:04',
  }), true);

  // AEDT (UTC+11, after Oct 4 2026): 2026-10-10 12:04 UTC is 2026-10-10 23:04 local
  assert.equal(validateMelbourneSensingDateTime({
    sensing_datetime: '2026-10-10T12:04:00+00:00',
    sensing_date: '2026-10-10',
    sensing_time: '23:04',
  }), true);

  // Inconsistent date should fail validation
  assert.equal(validateMelbourneSensingDateTime({
    sensing_datetime: '2026-09-30T12:04:00+00:00',
    sensing_date: '2026-09-29',
    sensing_time: '22:04',
  }), false);

  // Inconsistent time should fail validation
  assert.equal(validateMelbourneSensingDateTime({
    sensing_datetime: '2026-09-30T12:04:00+00:00',
    sensing_date: '2026-09-30',
    sensing_time: '12:04',
  }), false);

  // Optional local fields omitted should pass
  assert.equal(validateMelbourneSensingDateTime({
    sensing_datetime: '2026-09-30T12:04:00+00:00',
  }), true);
});

test('connector successfully collects bounded minute window with 15-minute overlap', async () => {
  const fixture = await loadFixture();
  const latestObservedAt = '2026-09-28T14:00:00+00:00';

  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 0,
          direction_2: 2,
          total_of_directions: 2,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  let queriedWhere = '';
  const client = new FakeOdsClient(query => {
    queriedWhere = query.where ?? '';
    return {
      records: fixture.results,
      totalCount: fixture.results.length,
      pageCount: 1,
      fetchedAt: '2026-09-28T14:05:00.000Z',
      lastModified: null,
    };
  });

  const connector = createConnector({ http, client });
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T13:45:00.000Z',
      to: '2026-09-28T14:00:00.000Z',
    },
    checkpoint: null,
    runId: 'minute-test-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Verify overlap query: from 13:45 minus 15 min overlap = 13:30
  assert.match(queriedWhere, /sensing_datetime >= '2026-09-28T13:30:00\.000Z'/);
  assert.match(queriedWhere, /sensing_datetime < '2026-09-28T14:00:00\.000Z'/);

  assert.equal(result.pedestrianObservations.length, 2);
  assert.equal(result.sourceRecords.length, 2);
  assert.equal(result.sourceRecords[0]?.rights_status, 'review_required');
  assert.equal(result.sourceRecords[0]?.assertion_kind, 'observation');
  assert.equal(result.sourceRecords[0]?.record_status, 'active');
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.fetched_records, 2);
  assert.equal(result.checkpointAfter, '2026-09-28T14:00:00.000Z');
});

test('connector strictly preserves null counts and gaps for missing minutes without zero-filling', async () => {
  const latestObservedAt = '2026-09-28T14:05:00+00:00';
  const records = [
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T14:00:00+00:00',
      direction_1: 5,
      direction_2: 3,
      total_of_directions: 8,
    },
    // 14:01 is absent (sensor reported no counts / offline)
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T14:02:00+00:00',
      direction_1: null,
      direction_2: null,
      total_of_directions: null, // explicit null reading
    },
  ];

  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 1,
          direction_2: 1,
          total_of_directions: 2,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records,
    totalCount: records.length,
    pageCount: 1,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T14:00:00.000Z',
      to: '2026-09-28T14:03:00.000Z',
    },
    checkpoint: null,
    runId: 'zero-fill-preservation-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.pedestrianObservations.length, 2);
  // Missing minute 14:01 must NOT have a synthesized record
  assert.ok(!result.pedestrianObservations.some(o => o.observed_at === '2026-09-28T14:01:00.000Z'));
  // Null reading at 14:02 must remain null, NOT zero-filled
  const obs1402 = result.pedestrianObservations.find(o => o.observed_at === '2026-09-28T14:02:00.000Z');
  assert.ok(obs1402);
  assert.equal(obs1402.direction_a_count, null);
  assert.equal(obs1402.direction_b_count, null);
  assert.equal(obs1402.total_count, null);
});

test('connector deduplicates identical duplicate readings and fails on conflicting duplicates', async () => {
  const latestObservedAt = '2026-09-28T14:05:00+00:00';
  const identicalDuplicateRecords = [
    {
      location_id: 67,
      sensing_datetime: '2026-09-28T14:00:00+00:00',
      direction_1: 4,
      direction_2: 2,
      total_of_directions: 6,
    },
    {
      location_id: 67,
      sensing_datetime: '2026-09-28T14:00:00+00:00',
      direction_1: 4,
      direction_2: 2,
      total_of_directions: 6,
    },
  ];

  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 67,
          sensing_datetime: latestObservedAt,
          direction_1: 4,
          direction_2: 2,
          total_of_directions: 6,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const clientIdentical = new FakeOdsClient(() => ({
    records: identicalDuplicateRecords,
    totalCount: identicalDuplicateRecords.length,
    pageCount: 1,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    lastModified: null,
  }));

  const conn1 = createConnector({ http, client: clientIdentical });
  const res1 = await conn1.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'dedup-identical',
  }));
  assert.equal(res1.kind, 'success');
  if (res1.kind === 'success') {
    assert.equal(res1.pedestrianObservations.length, 1);
  }

  // Now test conflicting duplicates
  const conflictingDuplicateRecords = [
    {
      location_id: 67,
      sensing_datetime: '2026-09-28T14:00:00+00:00',
      direction_1: 4,
      direction_2: 2,
      total_of_directions: 6,
    },
    {
      location_id: 67,
      sensing_datetime: '2026-09-28T14:00:00+00:00',
      direction_1: 10,
      direction_2: 5,
      total_of_directions: 15,
    },
  ];

  const clientConflicting = new FakeOdsClient(() => ({
    records: conflictingDuplicateRecords,
    totalCount: conflictingDuplicateRecords.length,
    pageCount: 1,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    lastModified: null,
  }));

  const conn2 = createConnector({ http, client: clientConflicting });
  const res2 = await conn2.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'dedup-conflict',
  }));
  assert.equal(res2.kind, 'failure');
  if (res2.kind === 'failure') {
    assert.equal(res2.code, 'validation_failed');
    assert.match(res2.message, /Conflicting duplicate sensor-minute readings/);
  }
});

test('direction count mismatch fails closed with validation_failed', async () => {
  const mismatchedRecord = {
    location_id: 10,
    sensing_datetime: '2026-09-28T14:00:00+00:00',
    direction_1: 5,
    direction_2: 5,
    total_of_directions: 12, // 5 + 5 !== 12
  };

  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 10,
          sensing_datetime: '2026-09-28T14:05:00+00:00',
          direction_1: 5,
          direction_2: 5,
          total_of_directions: 10,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [mismatchedRecord],
    totalCount: 1,
    pageCount: 1,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'direction-mismatch-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.match(result.message, /Upstream direction counts conflict with total/);
  }
});

test('window older than the past-hour feed fails closed with incomplete_window', async () => {
  const latestObservedAt = '2026-09-28T14:00:00+00:00';
  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 1,
          direction_2: 1,
          total_of_directions: 2,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [],
    totalCount: 0,
    pageCount: 0,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  // Request window from 2 hours ago (12:00:00Z)
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T12:00:00.000Z',
      to: '2026-09-28T12:15:00.000Z',
    },
    checkpoint: null,
    runId: 'expired-window-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
    assert.match(result.message, /expired from the past-hour feed/);
  }
});

test('window starting in future relative to feed latest record fails closed with incomplete_window', async () => {
  const latestObservedAt = '2026-09-28T14:00:00+00:00';
  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 1,
          direction_2: 1,
          total_of_directions: 2,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [],
    totalCount: 0,
    pageCount: 0,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  // Request window starting after latest observed record
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T15:00:00.000Z',
      to: '2026-09-28T15:15:00.000Z',
    },
    checkpoint: null,
    runId: 'future-window-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
    assert.match(result.message, /in the future relative to upstream feed/);
  }
});

test('empty upstream feed fails closed with upstream_unavailable', async () => {
  const http = new FakeHttpClient(() => ({
    body: { results: [] },
    status: 200,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [],
    totalCount: 0,
    pageCount: 0,
    fetchedAt: '2026-09-28T14:05:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'empty-feed-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'upstream_unavailable');
    assert.match(result.message, /feed has no records/);
  }
});

test('pagination errors and schema changes fail closed with correct error codes', async () => {
  const latestObservedAt = '2026-09-28T14:05:00+00:00';
  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 1,
          direction_2: 1,
          total_of_directions: 2,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  // OdsIncompleteWindow
  const clientIncomplete = new FakeOdsClient(() => {
    throw new OdsIncompleteWindow('total_count changed during pagination', 100);
  });
  const connIncomplete = createConnector({ http, client: clientIncomplete });
  const resIncomplete = await connIncomplete.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'incomplete-run',
  }));
  assert.equal(resIncomplete.kind, 'failure');
  if (resIncomplete.kind === 'failure') {
    assert.equal(resIncomplete.code, 'incomplete_window');
  }

  // Schema changed (e.g. string instead of int for location_id)
  const clientBadSchema = new FakeOdsClient(() => ({
    records: [
      {
        location_id: 'not-a-number',
        sensing_datetime: '2026-09-28T14:00:00+00:00',
        direction_1: 1,
        direction_2: 1,
        total_of_directions: 2,
      },
    ],
    totalCount: 1,
    pageCount: 1,
    fetchedAt: '2026-09-28T14:06:00.000Z',
    lastModified: null,
  }));
  const connBadSchema = createConnector({ http, client: clientBadSchema });
  const resBadSchema = await connBadSchema.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T14:00:00.000Z', to: '2026-09-28T14:05:00.000Z' },
    checkpoint: null,
    runId: 'bad-schema-run',
  }));
  assert.equal(resBadSchema.kind, 'failure');
  if (resBadSchema.kind === 'failure') {
    assert.equal(resBadSchema.code, 'schema_changed');
  }
});

test('R04: window end exceeding latest upstream available minute (from <= latest < to) fails closed with incomplete_window', async () => {
  // Upstream latest observed minute is 12:30:00+00:00 (available up to 12:31:00.000Z)
  const latestObservedAt = '2026-09-28T12:30:00+00:00';
  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 4,
          direction_2: 6,
          total_of_directions: 10,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T12:32:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [
      {
        location_id: 3,
        sensing_datetime: '2026-09-28T12:20:00+00:00',
        direction_1: 1,
        direction_2: 1,
        total_of_directions: 2,
      },
    ],
    totalCount: 1,
    pageCount: 1,
    fetchedAt: '2026-09-28T12:32:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });
  // from (12:15) <= latest (12:30) < to (13:00)
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T12:15:00.000Z',
      to: '2026-09-28T13:00:00.000Z',
    },
    checkpoint: null,
    runId: 'r04-from-latest-to-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
    assert.match(result.message, /Requested window end exceeds latest upstream available minute/);
    assert.equal(result.completeness.complete, false);
  }
});

test('R04: upstream latency exceeding 15 minutes fails closed and does not advance checkpoint into uncollected period', async () => {
  // Upstream feed is lagged by 35 minutes: latest is 12:10:00+00:00
  const latestObservedAt = '2026-09-28T12:10:00+00:00';
  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: latestObservedAt,
          direction_1: 2,
          direction_2: 3,
          total_of_directions: 5,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T12:45:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(() => ({
    records: [],
    totalCount: 0,
    pageCount: 0,
    fetchedAt: '2026-09-28T12:45:00.000Z',
    lastModified: null,
  }));

  const connector = createConnector({ http, client });

  // Test A: Window start is in the future relative to lagged upstream [12:15, 12:30)
  const resA = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T12:15:00.000Z',
      to: '2026-09-28T12:30:00.000Z',
    },
    checkpoint: null,
    runId: 'lagged-future-start',
  }));
  assert.equal(resA.kind, 'failure');
  if (resA.kind === 'failure') {
    assert.equal(resA.code, 'incomplete_window');
    assert.match(resA.message, /in the future relative to upstream feed/);
  }

  // Test B: Window start is before latest, but window end is past latest [12:00, 12:30)
  const resB = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2026-09-28T12:00:00.000Z',
      to: '2026-09-28T12:30:00.000Z',
    },
    checkpoint: null,
    runId: 'lagged-window-tail',
  }));
  assert.equal(resB.kind, 'failure');
  if (resB.kind === 'failure') {
    assert.equal(resB.code, 'incomplete_window');
    assert.match(resB.message, /Requested window end exceeds latest upstream available minute/);
  }
});

test('R04: two consecutive collections across delayed upstream and catch-up safely collect without gap loss or zero-filling', async () => {
  // --- Flow 1: Default retry flow after upstream catches up ---
  let upstreamLatest = '2026-09-28T12:30:00+00:00';
  const allBatchRecords = [
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T12:15:00+00:00',
      direction_1: 5,
      direction_2: 3,
      total_of_directions: 8,
    },
    // 12:20 is missing (sensor gap)
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T12:30:00+00:00',
      direction_1: 1,
      direction_2: 2,
      total_of_directions: 3,
    },
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T12:45:00+00:00',
      direction_1: 10,
      direction_2: 12,
      total_of_directions: 22,
    },
    {
      location_id: 3,
      sensing_datetime: '2026-09-28T12:55:00+00:00',
      direction_1: null,
      direction_2: null,
      total_of_directions: null, // explicit null reading
    },
  ];

  const http = new FakeHttpClient(() => ({
    body: {
      results: [
        {
          location_id: 3,
          sensing_datetime: upstreamLatest,
          direction_1: 1,
          direction_2: 2,
          total_of_directions: 3,
        },
      ],
    },
    status: 200,
    fetchedAt: '2026-09-28T13:10:00.000Z',
    etag: null,
    lastModified: null,
    contentType: 'application/json',
  }));

  const client = new FakeOdsClient(query => {
    // Filter records matching the query where clause
    const records = allBatchRecords.filter(r => {
      const t = Date.parse(r.sensing_datetime);
      if (query.where?.includes("sensing_datetime < '2026-09-28T12:31:00.000Z'")) {
        return t >= Date.parse('2026-09-28T12:00:00.000Z') && t < Date.parse('2026-09-28T12:31:00.000Z');
      }
      if (query.where?.includes("sensing_datetime < '2026-09-28T13:00:00.000Z'")) {
        const from = query.where.includes(">= '2026-09-28T12:16:00.000Z'")
          ? Date.parse('2026-09-28T12:16:00.000Z')
          : Date.parse('2026-09-28T12:00:00.000Z');
        return t >= from && t < Date.parse('2026-09-28T13:00:00.000Z');
      }
      return true;
    });
    return {
      records,
      totalCount: records.length,
      pageCount: 1,
      fetchedAt: '2026-09-28T13:10:00.000Z',
      lastModified: null,
    };
  });

  const standardConnector = createConnector({ http, client });

  // Attempt 1: Upstream only at 12:30, caller asks for [12:15, 13:00)
  const attempt1 = await standardConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T12:15:00.000Z', to: '2026-09-28T13:00:00.000Z' },
    checkpoint: null,
    runId: 'consecutive-attempt-1',
  }));
  assert.equal(attempt1.kind, 'failure');
  assert.equal(attempt1.code, 'incomplete_window');

  // Upstream catches up to 13:00
  upstreamLatest = '2026-09-28T13:00:00+00:00';

  // Attempt 2: Caller retries [12:15, 13:00)
  const attempt2 = await standardConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T12:15:00.000Z', to: '2026-09-28T13:00:00.000Z' },
    checkpoint: null,
    runId: 'consecutive-attempt-2',
  }));
  assert.equal(attempt2.kind, 'success');
  if (attempt2.kind === 'success') {
    assert.equal(attempt2.checkpointAfter, '2026-09-28T13:00:00.000Z');
    assert.equal(attempt2.pedestrianObservations.length, 4);
    // Missing minute 12:20 has NO synthesized row (gap preserved, no zero fill)
    assert.ok(!attempt2.pedestrianObservations.some(o => o.observed_at === '2026-09-28T12:20:00.000Z'));
    // Explicit null at 12:55 remains null
    const nullObs = attempt2.pedestrianObservations.find(o => o.observed_at === '2026-09-28T12:55:00.000Z');
    assert.ok(nullObs);
    assert.equal(nullObs.total_count, null);
  }

  // --- Flow 2: Progressive collection with clampToAvailable = true ---
  upstreamLatest = '2026-09-28T12:30:00+00:00';
  const progressiveConnector = createConnector({ http, client, clampToAvailable: true });

  // Run 1: asks for [12:15, 13:00), clamps to 12:31:00.000Z
  const run1 = await progressiveConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T12:15:00.000Z', to: '2026-09-28T13:00:00.000Z' },
    checkpoint: null,
    runId: 'progressive-run-1',
  }));
  assert.equal(run1.kind, 'success');
  if (run1.kind === 'success') {
    assert.equal(run1.checkpointAfter, '2026-09-28T12:31:00.000Z');
    assert.equal(run1.pedestrianObservations.length, 2); // 12:15 and 12:30
  }

  // Upstream catches up to 13:05
  upstreamLatest = '2026-09-28T13:05:00+00:00';

  // Run 2: starts from previous checkpoint [12:31, 13:00)
  const run2 = await progressiveConnector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-28T12:31:00.000Z', to: '2026-09-28T13:00:00.000Z' },
    checkpoint: '2026-09-28T12:31:00.000Z',
    runId: 'progressive-run-2',
  }));
  assert.equal(run2.kind, 'success');
  if (run2.kind === 'success' && run1.kind === 'success') {
    assert.equal(run2.checkpointAfter, '2026-09-28T13:00:00.000Z');
    // 12:30 is re-fetched due to 15-minute overlap (12:16), plus 12:45 and 12:55
    assert.equal(run2.pedestrianObservations.length, 3);
    const combinedUnique = new Set([
      ...run1.pedestrianObservations.map(o => o.observed_at),
      ...run2.pedestrianObservations.map(o => o.observed_at),
    ]);
    assert.deepEqual([...combinedUnique].sort(), [
      '2026-09-28T12:15:00.000Z',
      '2026-09-28T12:30:00.000Z',
      '2026-09-28T12:45:00.000Z',
      '2026-09-28T12:55:00.000Z',
    ]);
  }
});
