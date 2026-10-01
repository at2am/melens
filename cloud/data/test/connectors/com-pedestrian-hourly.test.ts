import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DATASET_ID,
  LANDING_URL,
  MAX_HOURLY_SUMMARIES,
  PedestrianHourlyConnector,
  SOURCE_ID,
  createConnector,
  melbourneHourToUtc,
  parseHourlyCheckpoint,
  parsePedestrianHourlyRow,
} from '../../src/connectors/com_pedestrian_hourly/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpResponse } from '../../src/core/http.js';
import { OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { stableBatchId } from '../../src/core/publisher.js';
import { parseSourceManifest } from '../../src/core/registry.js';

const sourceId = SOURCE_ID;

test('manifest registers source with review_required status and candidate access', async () => {
  const manifestUrl = new URL('../../src/connectors/com_pedestrian_hourly/source.json', import.meta.url);
  const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), 'utf8'));
  const dataSource = parseSourceManifest(manifest);

  assert.equal(dataSource.source_id, sourceId);
  assert.equal(dataSource.topic, 'pedestrian');
  assert.equal(dataSource.scope, 'city');
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');
  assert.equal(dataSource.record_granularity, 'sensor_hour');
  assert.equal(dataSource.admission_evidence.native_record_key, 'id');
  assert.deepEqual(dataSource.admission_evidence.allowed_fields, [
    'id',
    'location_id',
    'sensing_date',
    'hourday',
    'direction_1',
    'direction_2',
    'pedestriancount',
    'sensor_name',
    'location',
  ]);
});

test('hourly source retains the hour and does not synthesize minute readings', async () => {
  const fixture = JSON.parse(await readFile(
    new URL('../fixtures/com_pedestrian_hourly.json', import.meta.url), 'utf8')) as {
      results: unknown[];
    };
  class FixtureClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.match(query.where ?? '', /sensing_date/);
      return {
        records: fixture.results,
        totalCount: fixture.results.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }
  const connector = createConnector({ client: new FixtureClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: {
      kind: 'time',
      from: '2024-10-29T23:00:00.000Z',
      to: '2024-10-30T00:00:00.000Z',
    },
    checkpoint: null,
    runId: 'hourly-fixture',
  }));
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.pedestrianObservations.length, 1);
  assert.equal(result.pedestrianObservations[0]?.sensor_id, '167');
  assert.equal(result.pedestrianObservations[0]?.observed_at, '2024-10-29T23:00:00.000Z');
  assert.equal(result.pedestrianObservations[0]?.total_count, 94);
  assert.equal(result.pedestrianObservations[0]?.direction_a_count, 17);
  assert.equal(result.pedestrianObservations[0]?.direction_b_count, 77);
  assert.equal(result.sourceRecords.length, 1);
  assert.equal(result.sourceRecords[0]?.rights_status, 'review_required');
  assert.equal(result.sourceRecords[0]?.observed_at, '2024-10-29T23:00:00.000Z');
  assert.equal(result.sourceRecords[0]?.source_updated_at, null);
  assert.equal(result.sourceLatestUpdateAt, null);
  assert.equal(result.geoRecords.length, 0);
});

test('Melbourne DST repeated and missing local hours cannot be silently converted', () => {
  assert.equal(melbourneHourToUtc('2024-10-30', 10), '2024-10-29T23:00:00.000Z');
  assert.equal(melbourneHourToUtc('2026-04-05', 1), '2026-04-04T14:00:00.000Z');
  assert.throws(() => melbourneHourToUtc('2026-04-05', 2), /ambiguous/);
  assert.throws(() => melbourneHourToUtc('2026-10-04', 2), /ambiguous or nonexistent/);
});

test('collect fails closed with validation_failed when upstream record has ambiguous Melbourne DST hour', async () => {
  class DstAmbiguousClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1670220260405,
            location_id: 167,
            sensing_date: '2026-04-05',
            hourday: 2,
            direction_1: 10,
            direction_2: 20,
            pedestriancount: 30,
            sensor_name: 'Lat526_T',
            location: { lon: 144.95155955, lat: -37.81304149 },
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianHourlyConnector({ client: new DstAmbiguousClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: {
      kind: 'snapshot',
      revision: '2026-04-05',
    },
    checkpoint: null,
    runId: 'dst-ambiguous-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /ambiguous/);
});

test('collect fails closed with validation_failed when upstream record has nonexistent Melbourne DST hour', async () => {
  class DstMissingClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1670220261004,
            location_id: 167,
            sensing_date: '2026-10-04',
            hourday: 2,
            direction_1: 10,
            direction_2: 20,
            pedestriancount: 30,
            sensor_name: 'Lat526_T',
            location: { lon: 144.95155955, lat: -37.81304149 },
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = new PedestrianHourlyConnector({ client: new DstMissingClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: {
      kind: 'snapshot',
      revision: '2026-10-04',
    },
    checkpoint: null,
    runId: 'dst-missing-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /ambiguous or nonexistent/);
});

test('invalid hourly snapshot revision cannot trigger an unbounded archive scan', async () => {
  class GuardClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new Error('Upstream must not be called');
    }
  }
  const result = await createConnector({ client: new GuardClient() }).collect(
    parseConnectorInput({
      sourceId,
      window: { kind: 'snapshot', revision: 'all' },
      checkpoint: null,
      runId: 'invalid-hourly-revision',
    }),
  );
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('snapshot revision by sensing date queries only that date', async () => {
  let capturedWhere: string | undefined;
  class SnapshotClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      capturedWhere = query.where;
      return {
        records: [
          {
            id: 1671020241030,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 17,
            direction_2: 77,
            pedestriancount: 94,
            sensor_name: 'Lat526_T',
            location: { lon: 144.95155955, lat: -37.81304149 },
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: '2024-10-30T12:00:00.000Z',
      };
    }
  }

  const connector = createConnector({ client: new SnapshotClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'snapshot-date-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(capturedWhere, "sensing_date = date'2024-10-30'");
  assert.match(result.sourceRevision ?? '', /^2024-10-30@[0-9a-f]{64}$/);
  assert.equal(parseHourlyCheckpoint(result.checkpointAfter)?.cursor, '2024-10-30');
  assert.equal(result.sourceLatestUpdateAt, '2024-10-30T12:00:00.000Z');
  assert.equal(result.sourceRecords[0]?.source_updated_at, '2024-10-30T12:00:00.000Z');
  assert.equal(result.sourceRecords[0]?.observed_at, '2024-10-29T23:00:00.000Z');
  assert.equal(result.pedestrianObservations.length, 1);
});

test('snapshot revision latest fetches latest date and queries that date', async () => {
  let capturedWhere: string | undefined;

  class MockHttpClient extends HttpClient {
    override async getJson<T>(): Promise<HttpResponse<T>> {
      return {
        body: {
          results: [
            {
              id: 712020260109,
              location_id: 71,
              sensing_date: '2026-01-09',
              hourday: 20,
              direction_1: 2,
              direction_2: 12,
              pedestriancount: 14,
              sensor_name: 'WestWP_T',
              location: { lon: 144.97136962, lat: -37.81235775 },
            },
          ],
        } as T,
        status: 200,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        etag: null,
        lastModified: '2026-01-09T22:00:00.000Z',
        contentType: 'application/json',
      };
    }
  }

  class MockOdsClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      capturedWhere = query.where;
      return {
        records: [
          {
            id: 712020260109,
            location_id: 71,
            sensing_date: '2026-01-09',
            hourday: 20,
            direction_1: 2,
            direction_2: 12,
            pedestriancount: 14,
            sensor_name: 'WestWP_T',
            location: { lon: 144.97136962, lat: -37.81235775 },
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: '2026-01-09T22:00:00.000Z',
      };
    }
  }

  const connector = createConnector({
    client: new MockOdsClient(),
    http: new MockHttpClient(),
  });

  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'snapshot-latest-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(capturedWhere, "sensing_date = date'2026-01-09'");
  assert.equal(result.pedestrianObservations.length, 1);
  assert.match(result.sourceRevision ?? '', /^2026-01-09T22:00:00.000Z@[0-9a-f]{64}$/);
  assert.equal(result.sourceLatestUpdateAt, '2026-01-09T22:00:00.000Z');
  assert.equal(result.sourceRecords[0]?.source_updated_at, '2026-01-09T22:00:00.000Z');
});

test('detects conflicting duplicate readings for same sensor-hour and fails closed', async () => {
  class DuplicateClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1671020241030,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 17,
            direction_2: 77,
            pedestriancount: 94,
            sensor_name: 'Lat526_T',
          },
          {
            id: 1671020241030,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 20,
            direction_2: 80,
            pedestriancount: 100,
            sensor_name: 'Lat526_T',
          },
        ],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new DuplicateClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'duplicate-conflict-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Conflicting duplicate sensor-hour readings/);
});

test('handles identical duplicate readings gracefully by deduplication', async () => {
  const row = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
    location: { lon: 144.95155955, lat: -37.81304149 },
  };

  class IdempotentClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row, { ...row }],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new IdempotentClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'identical-duplicate-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.inputCount, 2);
  assert.equal(result.outputCount, 1);
  assert.equal(result.pedestrianObservations.length, 1);
});

test('fails closed when direction_1 + direction_2 does not equal pedestriancount', async () => {
  class DirectionMismatchClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1671020241030,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 20,
            direction_2: 30,
            pedestriancount: 94, // 20 + 30 != 94
            sensor_name: 'Lat526_T',
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new DirectionMismatchClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'direction-mismatch-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Upstream direction counts conflict with total/);
});

test('handles records with null location and null sensor_name without errors', async () => {
  class NullLocationClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 282220241108,
            location_id: 28,
            sensing_date: '2024-11-08',
            hourday: 22,
            direction_1: 884,
            direction_2: 537,
            pedestriancount: 1421,
            sensor_name: null,
            location: null,
          },
        ],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new NullLocationClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-11-08' },
    checkpoint: null,
    runId: 'null-location-run',
  }));

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.pedestrianObservations.length, 1);
  assert.equal(result.pedestrianObservations[0]?.sensor_id, '28');
  assert.equal(result.pedestrianObservations[0]?.total_count, 1421);
});

test('handles rate limiting from upstream with retry-after propagation', async () => {
  class RateLimitedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      throw new HttpFailure('rate_limited', 429, 3, 30_000);
    }
  }

  const connector = createConnector({ client: new RateLimitedClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'rate-limited-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'rate_limited');
  assert.equal(result.retryAfterSeconds, 30);
});

test('wrong sourceId in input fails validation', async () => {
  const connector = createConnector();
  const result = await connector.collect(parseConnectorInput({
    sourceId: 'wrong.source.id',
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'wrong-source-id-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Expected source ID/);
});

test('parsePedestrianHourlyRow parses valid row and rejects negative counts', () => {
  const valid = parsePedestrianHourlyRow({
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
    location: { lon: 144.95155955, lat: -37.81304149 },
  });
  assert.equal(valid.location_id, 167);
  assert.equal(valid.pedestriancount, 94);

  assert.throws(() => parsePedestrianHourlyRow({
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    pedestriancount: -5,
  }), /Too small/);
});

test('corrected hourly reading produces updated revision and does not reuse identical batchId/versionId with old values', async () => {
  const initialRow = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 1,
    direction_2: 2,
    pedestriancount: 3,
    sensor_name: 'Lat526_T',
    location: { lon: 144.95155955, lat: -37.81304149 },
  };

  const correctedRow = {
    ...initialRow,
    direction_1: 1,
    direction_2: 3,
    pedestriancount: 4, // City of Melbourne corrected count from 3 to 4
  };

  class MutableOdsClient extends OpenDataSoftClient {
    currentRow = initialRow;
    currentLastModified: string | null = '2024-10-30T10:00:00.000Z';

    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.currentRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.currentLastModified,
      };
    }
  }

  const client = new MutableOdsClient();
  const connector = createConnector({ client });

  // 1. Initial collection with pedestriancount = 3
  const input1 = parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'run-initial',
  });
  const result1 = await connector.collect(input1);
  assert.equal(result1.kind, 'success');
  if (result1.kind !== 'success') return;

  const version1 = result1.sourceRecords[0]?.version_id;
  const revision1 = result1.sourceRevision;
  const batchId1 = stableBatchId(sourceId, null, null, revision1);
  const recordId1 = result1.sourceRecords[0]?.source_record_id;

  assert.ok(version1, 'Version ID must be generated');
  assert.ok(revision1, 'Source revision must be generated');
  assert.equal(result1.pedestrianObservations[0]?.total_count, 3);
  assert.equal(result1.sourceRecords[0]?.observed_at, '2024-10-29T23:00:00.000Z');
  assert.equal(result1.sourceRecords[0]?.source_updated_at, '2024-10-30T10:00:00.000Z');
  assert.equal(result1.sourceLatestUpdateAt, '2024-10-30T10:00:00.000Z');

  // 2. City of Melbourne corrects the count from 3 to 4 with an advancing Last-Modified revision timestamp
  client.currentRow = correctedRow;
  client.currentLastModified = '2024-10-30T12:00:00.000Z';
  const input2 = parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'run-corrected',
  });
  const result2 = await connector.collect(input2);
  assert.equal(result2.kind, 'success');
  if (result2.kind !== 'success') return;

  const version2 = result2.sourceRecords[0]?.version_id;
  const revision2 = result2.sourceRevision;
  const batchId2 = stableBatchId(sourceId, null, null, revision2);
  const recordId2 = result2.sourceRecords[0]?.source_record_id;

  // The record identity is unchanged (same logical sensor reading)
  assert.equal(recordId1, recordId2);

  // The observation hour remains unchanged and update time is separated
  assert.equal(result2.sourceRecords[0]?.observed_at, '2024-10-29T23:00:00.000Z');
  assert.equal(result2.sourceRecords[0]?.source_updated_at, '2024-10-30T12:00:00.000Z');

  // Version ID, source revision, and stableBatchId MUST all update!
  assert.notEqual(version1, version2, 'Corrected count must produce a distinct version_id');
  assert.notEqual(revision1, revision2, 'Corrected count must produce a distinct sourceRevision');
  assert.notEqual(batchId1, batchId2, 'Corrected count must produce a distinct stableBatchId so published batch is not reused');
  assert.equal(result2.pedestrianObservations[0]?.total_count, 4);

  // 3. Idempotent replay: running with identical corrected row retains the same version and batch ID
  const result3 = await connector.collect(input2);
  assert.equal(result3.kind, 'success');
  if (result3.kind !== 'success') return;
  assert.equal(result3.sourceRecords[0]?.version_id, version2);
  assert.equal(result3.sourceRevision, revision2);
  assert.equal(stableBatchId(sourceId, null, null, result3.sourceRevision), batchId2);
});

test('corrected hourly reading in time window produces updated revision and batchId', async () => {
  const initialRow = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 1,
    direction_2: 2,
    pedestriancount: 3,
  };
  const correctedRow = {
    ...initialRow,
    direction_2: 3,
    pedestriancount: 4,
  };

  class TimeClient extends OpenDataSoftClient {
    currentRow = initialRow;
    currentLastModified: string | null = '2024-10-30T10:00:00.000Z';
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.currentRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.currentLastModified,
      };
    }
  }

  const client = new TimeClient();
  const connector = createConnector({ client });
  const window = {
    kind: 'time' as const,
    from: '2024-10-29T23:00:00.000Z',
    to: '2024-10-30T00:00:00.000Z',
  };

  const res1 = await connector.collect(parseConnectorInput({
    sourceId,
    window,
    checkpoint: null,
    runId: 'time-run-1',
  }));
  assert.equal(res1.kind, 'success');
  if (res1.kind !== 'success') return;

  client.currentRow = correctedRow;
  client.currentLastModified = '2024-10-30T12:00:00.000Z';
  const res2 = await connector.collect(parseConnectorInput({
    sourceId,
    window,
    checkpoint: null,
    runId: 'time-run-2',
  }));
  assert.equal(res2.kind, 'success');
  if (res2.kind !== 'success') return;

  assert.notEqual(res1.sourceRecords[0]?.version_id, res2.sourceRecords[0]?.version_id);
  assert.notEqual(res1.sourceRevision, res2.sourceRevision);
  const b1 = stableBatchId(sourceId, window.from, window.to, res1.sourceRevision);
  const b2 = stableBatchId(sourceId, window.from, window.to, res2.sourceRevision);
  assert.notEqual(b1, b2);
});

test('detects conflicting duplicate readings for same sensor-hour even when native id differs', async () => {
  class DifferingNativeIdConflictClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1001,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 20,
            direction_2: 30,
            pedestriancount: 50,
            sensor_name: 'Lat526_T',
          },
          {
            id: 1002,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 30,
            direction_2: 50,
            pedestriancount: 80,
            sensor_name: 'Lat526_T',
          },
        ],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new DifferingNativeIdConflictClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'differing-native-id-conflict-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Conflicting duplicate sensor-hour readings/);
});

test('detects conflicting duplicate readings for same sensor-hour when one record has null id', async () => {
  class NullIdConflictClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [
          {
            id: 1671020241030,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 20,
            direction_2: 30,
            pedestriancount: 50,
            sensor_name: 'Lat526_T',
          },
          {
            id: null,
            location_id: 167,
            sensing_date: '2024-10-30',
            hourday: 10,
            direction_1: 40,
            direction_2: 50,
            pedestriancount: 90,
            sensor_name: 'Lat526_T',
          },
        ],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new NullIdConflictClient() });
  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'null-id-conflict-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Conflicting duplicate sensor-hour readings/);
});

test('fails closed when previousObservations contains conflicting version of same sensor-hour without revision ordering evidence', async () => {
  const row = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 20,
    direction_2: 40,
    pedestriancount: 60,
    sensor_name: 'Lat526_T',
  };

  class SimpleClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  // Previous observation had count = 50, resulting in a different version_id
  const connector = createConnector({
    client: new SimpleClient(),
    previousObservations: [
      {
        batch_id: 'prev-batch',
        source_id: sourceId,
        schema_version: 1,
        fetched_at: '2026-09-28T00:00:00.000Z',
        sensor_id: '167',
        observed_at: '2024-10-29T23:00:00.000Z',
        version_id: 'old-version-digest-xyz',
        total_count: 50,
        direction_a_count: 20,
        direction_b_count: 30,
        source_record_id: `${sourceId}:1671020241030`,
      },
    ],
  });

  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'prior-version-conflict-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Conflicting duplicate sensor-hour readings across versions without revision order/);
});

test('fails closed when JSON checkpoint contains conflicting version of same sensor-hour without revision ordering evidence', async () => {
  const row = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 20,
    direction_2: 40,
    pedestriancount: 60,
    sensor_name: 'Lat526_T',
  };

  class SimpleClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  const connector = createConnector({ client: new SimpleClient() });
  const checkpoint = JSON.stringify({
    cursor: '2024-10-30',
    previousObservations: [
      {
        source_record_id: 'hourly:167:2024-10-29T23:00:00.000Z',
        sensor_id: '167',
        observed_at: '2024-10-29T23:00:00.000Z',
        version_id: 'old-version-digest-abc',
        total_count: 3,
      },
    ],
  });

  const result = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint,
    runId: 'checkpoint-conflict-run',
  }));

  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'validation_failed');
  assert.match(result.message, /Conflicting duplicate sensor-hour readings across versions without revision order/);
});

test('succeeds idempotently when previousObservations contains identical version of same sensor-hour', async () => {
  const row = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
    location: { lon: 144.95155955, lat: -37.81304149 },
  };

  class SimpleClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: null,
      };
    }
  }

  // First run to get exact version_id
  const c1 = createConnector({ client: new SimpleClient() });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'idempotent-first-run',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;

  // Second run with previousObservations populated with the identical observation
  const c2 = createConnector({
    client: new SimpleClient(),
    previousObservations: r1.pedestrianObservations,
  });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'idempotent-second-run',
  }));
  assert.equal(r2.kind, 'success');
  if (r2.kind !== 'success') return;
  assert.equal(r2.pedestrianObservations.length, 1);
  assert.equal(r2.pedestrianObservations[0]?.version_id, r1.pedestrianObservations[0]?.version_id);
});

test('Melbourne DST transition edge cases verify valid hours before and after transition while rejecting ambiguous and nonexistent hours', () => {
  // 1. Fallback day (2026-04-05, AEDT -> AEST)
  // Hour 1: 01:00 AEDT (UTC+11) -> 14:00 UTC previous day
  assert.equal(melbourneHourToUtc('2026-04-05', 1), '2026-04-04T14:00:00.000Z');
  // Hour 2: ambiguous (repeated) -> must throw
  assert.throws(() => melbourneHourToUtc('2026-04-05', 2), /ambiguous/);
  // Hour 3: 03:00 AEST (UTC+10) -> 17:00 UTC previous day
  assert.equal(melbourneHourToUtc('2026-04-05', 3), '2026-04-04T17:00:00.000Z');

  // 2. Spring forward day (2026-10-04, AEST -> AEDT)
  // Hour 1: 01:00 AEST (UTC+10) -> 15:00 UTC previous day
  assert.equal(melbourneHourToUtc('2026-10-04', 1), '2026-10-03T15:00:00.000Z');
  // Hour 2: nonexistent (skipped) -> must throw
  assert.throws(() => melbourneHourToUtc('2026-10-04', 2), /ambiguous or nonexistent/);
  // Hour 3: 03:00 AEDT (UTC+11) -> 16:00 UTC previous day
  assert.equal(melbourneHourToUtc('2026-10-04', 3), '2026-10-03T16:00:00.000Z');

  // 3. Invalid hourday values
  assert.throws(() => melbourneHourToUtc('2026-10-04', -1), /Invalid Melbourne local sensor hour/);
  assert.throws(() => melbourneHourToUtc('2026-10-04', 24), /Invalid Melbourne local sensor hour/);
  assert.throws(() => melbourneHourToUtc('2026-10-04', 1.5), /Invalid Melbourne local sensor hour/);
});

test('default loading on same instance: count change without revision time fails closed', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class MutableClient extends OpenDataSoftClient {
    currentRow = row1;
    currentLastModified: string | null = null;
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.currentRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.currentLastModified,
      };
    }
  }

  const client = new MutableClient();
  const connector = createConnector({ client });

  const r1 = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'default-load-run-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.equal(r1.pedestrianObservations[0]?.total_count, 94);

  // Second run on same instance with modified count, without revision timestamp
  client.currentRow = row2;
  client.currentLastModified = null;

  const r2 = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'default-load-run-2',
  }));
  assert.equal(r2.kind, 'failure');
  if (r2.kind !== 'failure') return;
  assert.equal(r2.code, 'validation_failed');
  assert.match(r2.message, /Conflicting duplicate sensor-hour readings across versions without revision order/);
});

test('default loading on same instance: count change with identical revision time fails closed', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class MutableClient extends OpenDataSoftClient {
    currentRow = row1;
    currentLastModified: string | null = '2024-10-30T10:00:00.000Z';
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.currentRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.currentLastModified,
      };
    }
  }

  const client = new MutableClient();
  const connector = createConnector({ client });

  const r1 = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'identical-time-run-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.equal(r1.pedestrianObservations[0]?.total_count, 94);

  // Second run on same instance with modified count and identical revision timestamp
  client.currentRow = row2;
  client.currentLastModified = '2024-10-30T10:00:00.000Z';

  const r2 = await connector.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'identical-time-run-2',
  }));
  assert.equal(r2.kind, 'failure');
  if (r2.kind !== 'failure') return;
  assert.equal(r2.code, 'validation_failed');
  assert.match(r2.message, /Conflicting duplicate sensor-hour readings with identical revision timestamp/);
});

test('checkpoint saving and next load across instances: without revision time fails closed', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class TestClient extends OpenDataSoftClient {
    constructor(private row: unknown, private lastModified: string | null = null) {
      super();
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.lastModified,
      };
    }
  }

  const c1 = createConnector({ client: new TestClient(row1, null) });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'across-instance-no-time-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.ok(r1.checkpointAfter);

  const c2 = createConnector({ client: new TestClient(row2, null) });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: r1.checkpointAfter,
    runId: 'across-instance-no-time-2',
  }));
  assert.equal(r2.kind, 'failure');
  if (r2.kind !== 'failure') return;
  assert.equal(r2.code, 'validation_failed');
  assert.match(r2.message, /Conflicting duplicate sensor-hour readings across versions without revision order/);
});

test('checkpoint saving and next load across instances: identical revision time fails closed', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class TestClient extends OpenDataSoftClient {
    constructor(private row: unknown, private lastModified: string | null = null) {
      super();
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.lastModified,
      };
    }
  }

  const c1 = createConnector({ client: new TestClient(row1, '2024-10-30T10:00:00.000Z') });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'across-instance-same-time-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.ok(r1.checkpointAfter);

  const c2 = createConnector({ client: new TestClient(row2, '2024-10-30T10:00:00.000Z') });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: r1.checkpointAfter,
    runId: 'across-instance-same-time-2',
  }));
  assert.equal(r2.kind, 'failure');
  if (r2.kind !== 'failure') return;
  assert.equal(r2.code, 'validation_failed');
  assert.match(r2.message, /Conflicting duplicate sensor-hour readings with identical revision timestamp/);
});

test('checkpoint saving and next load across instances: older revision time arriving late fails closed', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class TestClient extends OpenDataSoftClient {
    constructor(private row: unknown, private lastModified: string | null = null) {
      super();
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.lastModified,
      };
    }
  }

  const c1 = createConnector({ client: new TestClient(row1, '2024-10-30T12:00:00.000Z') });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'across-instance-older-time-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.ok(r1.checkpointAfter);

  // Instance 2 loads checkpoint from run 1 (which had 12:00:00Z), but upstream returns 10:00:00Z (older)
  const c2 = createConnector({ client: new TestClient(row2, '2024-10-30T10:00:00.000Z') });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: r1.checkpointAfter,
    runId: 'across-instance-older-time-2',
  }));
  assert.equal(r2.kind, 'failure');
  if (r2.kind !== 'failure') return;
  assert.equal(r2.code, 'validation_failed');
  assert.match(r2.message, /Conflicting duplicate sensor-hour readings with older revision timestamp arriving late/);
});

test('checkpoint saving and next load across instances: strictly newer revision time succeeds', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };
  const row2 = {
    ...row1,
    direction_2: 83,
    pedestriancount: 100,
  };

  class TestClient extends OpenDataSoftClient {
    constructor(private row: unknown, private lastModified: string | null = null) {
      super();
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.lastModified,
      };
    }
  }

  const c1 = createConnector({ client: new TestClient(row1, '2024-10-30T10:00:00.000Z') });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'across-instance-newer-time-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.ok(r1.checkpointAfter);

  // Instance 2 loads checkpoint from run 1 (10:00:00Z), and upstream returns 12:00:00Z (strictly newer)
  const c2 = createConnector({ client: new TestClient(row2, '2024-10-30T12:00:00.000Z') });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: r1.checkpointAfter,
    runId: 'across-instance-newer-time-2',
  }));
  assert.equal(r2.kind, 'success');
  if (r2.kind !== 'success') return;
  assert.equal(r2.pedestrianObservations[0]?.total_count, 100);
  assert.notEqual(r1.sourceRevision, r2.sourceRevision);
  assert.equal(r2.sourceRecords[0]?.source_updated_at, '2024-10-30T12:00:00.000Z');

  const cp2 = parseHourlyCheckpoint(r2.checkpointAfter);
  assert.equal(cp2?.summaries[0]?.versionId, r2.pedestrianObservations[0]?.version_id);
  assert.equal(cp2?.summaries[0]?.sourceUpdatedAt, '2024-10-30T12:00:00.000Z');
  assert.equal(cp2?.summaries[0]?.count, 100);
});

test('checkpoint saving and next load across instances: identical replay succeeds idempotently', async () => {
  const row1 = {
    id: 1671020241030,
    location_id: 167,
    sensing_date: '2024-10-30',
    hourday: 10,
    direction_1: 17,
    direction_2: 77,
    pedestriancount: 94,
    sensor_name: 'Lat526_T',
  };

  class TestClient extends OpenDataSoftClient {
    constructor(private row: unknown, private lastModified: string | null = null) {
      super();
    }
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [this.row],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T00:00:00.000Z',
        lastModified: this.lastModified,
      };
    }
  }

  const c1 = createConnector({ client: new TestClient(row1, '2024-10-30T10:00:00.000Z') });
  const r1 = await c1.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: null,
    runId: 'across-instance-replay-1',
  }));
  assert.equal(r1.kind, 'success');
  if (r1.kind !== 'success') return;
  assert.ok(r1.checkpointAfter);

  const c2 = createConnector({ client: new TestClient(row1, '2024-10-30T10:00:00.000Z') });
  const r2 = await c2.collect(parseConnectorInput({
    sourceId,
    window: { kind: 'snapshot', revision: '2024-10-30' },
    checkpoint: r1.checkpointAfter,
    runId: 'across-instance-replay-2',
  }));
  assert.equal(r2.kind, 'success');
  if (r2.kind !== 'success') return;
  assert.equal(r2.pedestrianObservations[0]?.total_count, 94);
  assert.equal(r2.pedestrianObservations[0]?.version_id, r1.pedestrianObservations[0]?.version_id);
  assert.equal(r2.sourceRevision, r1.sourceRevision);
});





test('hourly checkpoint rejects corrupt JSON and unvalidated summary fields before requesting upstream', async () => {
  let calls = 0;
  class NeverRequestedClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      calls += 1;
      throw new Error('Invalid state must fail before the upstream request');
    }
  }
  const validSummary = {
    recordId: 'record-1', sensorHourKey: '167:2024-10-29T23:00:00.000Z',
    versionId: 'version-1', sourceUpdatedAt: null, count: 3,
  };
  for (const checkpoint of [
    '{invalid-json',
    JSON.stringify({ cursor: '2024-10-30', summaries: [{ ...validSummary, sourceUpdatedAt: 'yesterday' }] }),
    JSON.stringify({ cursor: '2024-10-30', summaries: [{ ...validSummary, count: -1 }] }),
    JSON.stringify({ cursor: '2024-10-30', summaries: [{ ...validSummary, sensorHourKey: '167:2024-99-99T23:00:00Z' }] }),
    JSON.stringify({ cursor: '2024-10-30', summaries: [validSummary, validSummary] }),
    JSON.stringify({ cursor: 'not-a-cursor', summaries: [] }),
  ]) {
    const result = await createConnector({ client: new NeverRequestedClient() }).collect(parseConnectorInput({
      sourceId, window: { kind: 'snapshot', revision: '2024-10-30' }, checkpoint, runId: 'invalid-checkpoint',
    }));
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') {
      assert.equal(result.code, 'validation_failed');
      assert.match(result.message, /Invalid hourly checkpoint state/);
    }
  }
  assert.equal(calls, 0);
});

test('hourly checkpoint enforces the shared 50000-summary bound', () => {
  const summary = {
    recordId: 'record-1', sensorHourKey: '167:2024-10-29T23:00:00.000Z',
    versionId: 'version-1', sourceUpdatedAt: null, count: 3,
  };
  assert.equal(MAX_HOURLY_SUMMARIES, 50_000);
  assert.throws(() => parseHourlyCheckpoint(JSON.stringify({
    cursor: '2024-10-30', summaries: Array(MAX_HOURLY_SUMMARIES + 1).fill(summary),
  })), /Invalid hourly checkpoint state/);
});

test('hourly output checkpoint contains only the collected window even when history includes older hours', async () => {
  class CurrentWindowClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [{ id: 'hour-11', location_id: 167, sensing_date: '2024-10-30', hourday: 11,
          direction_1: 1, direction_2: 2, pedestriancount: 3 }],
        totalCount: 1, pageCount: 1, fetchedAt: '2026-09-29T00:00:00Z', lastModified: null,
      };
    }
  }
  const previous = {
    cursor: '2024-10-30T00:00:00Z', summaries: [{ recordId: 'old-hour', sensorHourKey: '167:2024-10-29T23:00:00.000Z',
      versionId: 'old-version', sourceUpdatedAt: null, count: 2 }],
  };
  for (const isolated of [true, false]) {
    const connector = createConnector({ client: new CurrentWindowClient(), isolated });
    const result = await connector.collect(parseConnectorInput({ sourceId,
      window: { kind: 'time', from: '2024-10-30T00:00:00Z', to: '2024-10-30T01:00:00Z' },
      checkpoint: JSON.stringify(previous), runId: 'current-window-state',
    }));
    assert.equal(result.kind, 'success');
    if (result.kind !== 'success') continue;
    const checkpoint = parseHourlyCheckpoint(result.checkpointAfter);
    assert.equal(checkpoint?.summaries.length, 1);
    assert.equal(checkpoint?.summaries[0]?.sensorHourKey, '167:2024-10-30T00:00:00.000Z');
    assert.equal(checkpoint?.cursor, '2024-10-30T01:00:00Z');
  }
});
