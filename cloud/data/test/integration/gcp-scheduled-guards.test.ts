import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import { GcsScheduledRequestStore, RequestCapReached,
  withScheduledRequestGuard } from '../../src/jobs/scheduled-guard.js';

const project = process.env.MELENS_GUARD_TEST_PROJECT;
const enabled = project === 'melens-510012'
  && process.env.MELENS_GUARD_TEST_CONFIRM === project;

test('development GCS quota, concurrent lease and BigQuery billed-byte guards', {
  skip: !enabled, timeout: 300_000,
}, async () => {
  assert.equal(project, 'melens-510012');
  // This probe uses the configured local ADC identity. Each deployed source
  // still needs its separate runtime identity and permissions checked.
  const storage = new Storage({ projectId: project });
  const bigquery = new BigQuery({ projectId: project });
  const bucketName = `${project}-dev-ingest`;
  const bucket = storage.bucket(bucketName);
  const store = new GcsScheduledRequestStore(storage, bucketName);
  const competitor = new GcsScheduledRequestStore(storage, bucketName);
  const run = `audit${randomUUID().replaceAll('-', '')}`;
  const prefix = `verification.scheduled.${run}`;
  const day = new Date().toISOString().slice(0, 10);
  const ledgerIds = [`${prefix}.concurrent`, `${prefix}.daily`, `${prefix}.execution`];
  const ledgerSchema = z.object({ sourceId: z.string(), day: z.string(), requests: z.number().int() });
  let sent = 0;
  const server = createServer((_request, response) => { sent += 1; response.writeHead(204).end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/quota-check`;
  const request = () => fetch(url, { signal: AbortSignal.timeout(10_000) });
  async function ledger(id: string): Promise<number> {
    const [bytes] = await bucket.file(`request-limits/${id}/${day}.json`).download();
    const row = ledgerSchema.parse(JSON.parse(bytes.toString('utf8')));
    assert.equal(row.sourceId, id);
    assert.equal(row.day, day);
    return row.requests;
  }
  try {
    let signalHeld: (() => void) | undefined;
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => { signalHeld = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const lockId = `${prefix}.lease`;
    const owner = store.withSourceLease(lockId, async () => { signalHeld?.(); await pending; });
    await Promise.race([held, owner]);
    let competitorRan = false;
    try {
      await assert.rejects(competitor.withSourceLease(lockId, async () => {
        competitorRan = true;
      }), /Scheduled source is already running/);
      assert.equal(competitorRan, false);
    } finally {
      release?.();
      await owner;
    }
    await competitor.withSourceLease(lockId, async () => { competitorRan = true; });
    assert.equal(competitorRan, true);
    assert.equal((await bucket.file(`locks/scheduled/${lockId}.json`).exists())[0], false);

    const concurrentId = ledgerIds[0]!;
    const charges = await Promise.allSettled(Array.from({ length: 6 }, () =>
      store.charge(concurrentId, day, 2)));
    assert.equal(charges.filter(result => result.status === 'fulfilled').length, 2);
    for (const result of charges) {
      if (result.status === 'rejected') assert.ok(result.reason instanceof RequestCapReached);
    }
    assert.equal(await ledger(concurrentId), 2);

    const dailyId = ledgerIds[1]!;
    await withScheduledRequestGuard(store, { sourceId: dailyId, dailyCap: 1, executionCap: 1 }, request);
    assert.equal(sent, 1);
    await assert.rejects(withScheduledRequestGuard(competitor,
      { sourceId: dailyId, dailyCap: 1, executionCap: 1 }, request), RequestCapReached);
    assert.equal(sent, 1);
    assert.equal(await ledger(dailyId), 1);

    const executionId = ledgerIds[2]!;
    await assert.rejects(withScheduledRequestGuard(store,
      { sourceId: executionId, dailyCap: 10, executionCap: 1 }, async () => {
        await request();
        await request();
      }), RequestCapReached);
    assert.equal(sent, 2);
    assert.equal(await ledger(executionId), 1);

    const query = `SELECT COUNT(DISTINCT source_record_id) AS records
      FROM \`${project}.melens_ingest.source_records\``;
    const [dryRun] = await bigquery.createQueryJob({ query, location: 'australia-southeast2',
      dryRun: true, useQueryCache: false });
    const metadata = z.object({ statistics: z.object({
      totalBytesProcessed: z.string().optional(),
      query: z.object({ totalBytesProcessed: z.string().optional() }).optional(),
    }) }).parse(dryRun.metadata);
    const estimatedBytes = Number(metadata.statistics.totalBytesProcessed
      ?? metadata.statistics.query?.totalBytesProcessed);
    assert.ok(Number.isFinite(estimatedBytes) && estimatedBytes > 1);
    await assert.rejects(bigquery.query({ query, location: 'australia-southeast2',
      maximumBytesBilled: '1', useQueryCache: false }), /bytes.*limit|limit.*bytes|bytes.*billed|maximum.*bytes/i);
  } finally {
    server.close();
    await once(server, 'close');
    for (const id of ledgerIds) {
      const file = bucket.file(`request-limits/${id}/${day}.json`);
      const [exists] = await file.exists();
      if (exists) {
        const [metadata] = await file.getMetadata();
        assert.ok(metadata.generation);
        await bucket.file(file.name, { generation: String(metadata.generation) }).delete();
      }
    }
  }
});
