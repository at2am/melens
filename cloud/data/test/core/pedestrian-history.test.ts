import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BigQuery } from '@google-cloud/bigquery';

import { PedestrianHourlyConnector } from '../../src/connectors/com_pedestrian_hourly/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import type { DataConfig } from '../../src/core/config.js';
import { addCompletedWindow } from '../../src/core/gcs.js';
import { OpenDataSoftClient, type OdsRecords } from '../../src/core/opendatasoft.js';
import { withPublishedPedestrianHistory } from '../../src/core/pedestrian-history.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';

const config: DataConfig = { projectId: 'melens-fixture', region: 'australia-southeast2',
  bucketName: 'fixture', ingestDataset: 'melens_ingest', queryDataset: 'melens_query',
  secretNames: [], maxBytesBilled: '100000000' };
const input = parseConnectorInput({ sourceId: 'melbourne.pedestrian.hourly', runId: 'run-1',
  window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z' },
  checkpoint: '2026-09-28T00:00:00Z' });

test('default registry connector rejects an unorderable correction after reloading published history', async t => {
  const bigquery = new BigQuery({ projectId: config.projectId });
  let summaries: object[] = [];
  const query = t.mock.method(bigquery, 'query', async (options: {
    query: string; params: Record<string, string>; maximumBytesBilled: string;
  }) => {
    assert.equal(options.maximumBytesBilled, '100000000');
    assert.deepEqual(options.params, { sourceId: input.sourceId,
      from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z' });
    assert.match(options.query, /b\.state = 'published'/);
    assert.match(options.query, /r\.version_id = p\.version_id/);
    assert.match(options.query, /LIMIT 50001/);
    return [summaries.map(summary => ({ summary: JSON.stringify(summary) }))];
  });
  let count = 10;
  t.mock.method(OpenDataSoftClient.prototype, 'fetchRecords', async (): Promise<OdsRecords> => ({
    records: [{ id: 123, location_id: 1, sensing_date: '2026-09-28', hourday: 10,
      pedestriancount: count }], totalCount: 1, pageCount: 1,
    fetchedAt: '2026-09-28T01:01:00Z', lastModified: null,
  }));
  const registry = await loadSourceRegistry(join(dirname(fileURLToPath(import.meta.url)), '../../src/connectors'));
  const entry = registry.get(input.sourceId);
  assert.ok(entry);
  const hourlyConnector = await loadConnector(entry);
  assert.ok(hourlyConnector instanceof PedestrianHourlyConnector);
  hourlyConnector.clearHistory();
  t.after(() => hourlyConnector.clearHistory());
  const first = await hourlyConnector.collect(
    await withPublishedPedestrianHistory(input, config, bigquery));
  assert.equal(first.kind, 'success');
  if (first.kind !== 'success') throw new Error('First collection failed');
  const observation = first.pedestrianObservations[0];
  assert.ok(observation);
  // Simulate a fresh Cloud Run process; only published storage carries history forward.
  hourlyConnector.clearHistory();
  summaries = [{ sensorId: observation.sensor_id, observedAt: observation.observed_at,
    recordId: observation.source_record_id, versionId: observation.version_id,
    sourceUpdatedAt: null, count: observation.total_count }];
  // The coverage cursor remains a UTC value even though the connector returns summaries.
  const manifest = addCompletedWindow({ sourceId: input.sourceId,
    checkpoint: '2026-09-28T00:00:00Z', completedWindows: [] },
  { from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z', batchId: 'published-1' });
  count = 11;
  const nextInput = await withPublishedPedestrianHistory({ ...input,
    runId: 'run-2', checkpoint: manifest.checkpoint }, config, bigquery);
  const second = await (await loadConnector(entry)).collect(nextInput);
  assert.equal(second.kind, 'failure');
  if (second.kind !== 'failure') throw new Error('Unorderable correction was accepted');
  assert.equal(second.code, 'validation_failed');
  assert.match(second.message, /without revision order/);
  assert.equal(manifest.checkpoint, '2026-09-28T01:00:00Z');
  assert.equal(query.mock.callCount(), 2);
});

test('other connectors and snapshot inputs do not read hourly correction history', async t => {
  const bigquery = new BigQuery({ projectId: config.projectId });
  const query = t.mock.method(bigquery, 'query', async () => { throw new Error('Unexpected history read'); });
  const other = { ...input, sourceId: 'melbourne.pedestrian.minute' };
  assert.equal(await withPublishedPedestrianHistory(other, config, bigquery), other);
  const snapshot = parseConnectorInput({ ...input, window: { kind: 'snapshot', revision: '2026-09-28' } });
  assert.equal(await withPublishedPedestrianHistory(snapshot, config, bigquery), snapshot);
  assert.equal(query.mock.callCount(), 0);
});

test('malformed or oversized published history fails before source collection', async t => {
  const bigquery = new BigQuery({ projectId: config.projectId });
  await assert.rejects(withPublishedPedestrianHistory(input, { ...config, maxBytesBilled: null }, bigquery),
    /billed-byte ceiling/);
  const query = t.mock.method(bigquery, 'query', async () => [[{ summary: '{}' }]]);
  await assert.rejects(withPublishedPedestrianHistory(input, config, bigquery));
  query.mock.mockImplementation(async () => [Array.from({ length: 50_001 }, () => ({ summary: '{}' }))]);
  await assert.rejects(withPublishedPedestrianHistory(input, config, bigquery));
});
