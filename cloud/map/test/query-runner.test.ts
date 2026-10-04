import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig, type MapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import type { AdapterQueryJob, AdapterQueryPage, BigQueryViewAdapter, PreparedViewQuery }
  from '../src/query/bigquery-adapter.js';
import { createViewQueryRunner, MapQueryError } from '../src/query/query-runner.js';

const baseRequest = {
  requestId: 'query-test', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 14,
  layers: ['planning'], mode: 'current',
  window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' },
};
const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });

function records(...rows: readonly object[]) {
  return rows.map((row) => ({ record: JSON.stringify(row) }));
}

function fakeAdapter(page: AdapterQueryPage, bytesProcessed = 1n) {
  const queries: PreparedViewQuery[] = [];
  const reads: { maxRows: number; timeoutMs: number }[] = [];
  let starts = 0;
  let cancellations = 0;
  const job: AdapterQueryJob = {
    async readPage(options) { reads.push(options); return page; },
    async cancel() { cancellations += 1; },
  };
  const adapter: BigQueryViewAdapter = {
    async dryRun(query) { queries.push(query); return { bytesProcessed }; },
    async startQuery(query) { starts += 1; queries.push(query); return job; },
  };
  return { adapter, queries, reads, get starts() { return starts; },
    get cancellations() { return cancellations; } };
}

function isQueryError(code: MapQueryError['code']) {
  return (error: unknown) => error instanceof MapQueryError && error.code === code;
}

function smallDeadlineConfig(): MapConfig {
  return loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_QUERY_TIMEOUT_MS: '20',
    MAP_DRY_RUN_TIMEOUT_MS: '10', MAP_CANCEL_TIMEOUT_MS: '5' });
}

test('complete bounded queries preserve measured zero/null, exact totals and fixed parameterized SQL', async () => {
  const fake = fakeAdapter({ rows: records({ id: 'one', count: 0, missing: null }), complete: true, hasMore: false });
  const result = await createViewQueryRunner({ config, adapter: fake.adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  assert.equal(result.kind, 'complete');
  assert.equal(result.totalMatching, 1);
  assert.deepEqual(result.rows, [{ id: 'one', count: 0, missing: null }]);
  assert.equal(result.resultBytes, Buffer.byteLength(JSON.stringify(result.rows), 'utf8'));
  assert.equal(fake.queries.length, 2);
  const executed = fake.queries.at(1);
  assert.ok(executed !== undefined);
  assert.match(executed.query, /`melens-testing\.melens_query\.v_geo_records_current`/);
  assert.doesNotMatch(executed.query, /melens_ingest|staging|raw\./);
  assert.equal(executed.params.west, baseRequest.bbox[0]);
  assert.equal(executed.params.resultLimit, 1_001);
  assert.equal(executed.types.west, 'FLOAT64');
  assert.doesNotMatch(executed.query, /@(?:from|to)\b/);
  assert.equal(executed.maximumBytesBilled, '100000000');
  assert.equal(executed.jobTimeoutMs, config.queryTimeoutMs);
  assert.deepEqual(fake.reads, [{ maxRows: 1_001, timeoutMs: config.queryTimeoutMs }]);
});

test('invalid requests, caller SQL, unregistered query names and unselected layers never reach BigQuery', async () => {
  const fake = fakeAdapter({ rows: [], complete: true, hasMore: false });
  const runner = createViewQueryRunner({ config, adapter: fake.adapter });
  for (const input of [
    { queryId: 'planning', request: baseRequest, query: 'SELECT * FROM raw.private' },
    { queryId: 'raw.private', request: baseRequest },
    { queryId: 'planning', request: { ...baseRequest, sql: 'SELECT secret' } },
    { queryId: 'event', request: baseRequest },
    { queryId: 'planning', request: { ...baseRequest, bbox: [145, -38, 144, -37] } },
    { queryId: 'planning', request: { ...baseRequest, zoom: Number.POSITIVE_INFINITY } },
    { queryId: 'planning', request: baseRequest, resultBudgetBytes: config.maxResponseBytes },
  ]) {
    await assert.rejects(runner.run(input), isQueryError('invalidRequest'));
  }
  assert.equal(fake.queries.length, 0);
  assert.equal(fake.starts, 0);
});

test('opaque continuation is never converted into a new mutable view query', async () => {
  const fake = fakeAdapter({ rows: [], complete: true, hasMore: false });
  const runner = createViewQueryRunner({ config, adapter: fake.adapter });
  await assert.rejects(runner.run({ queryId: 'planning', request: { ...baseRequest,
    cursor: 'opaque', snapshotId: 'snapshot' } }), isQueryError('cursorMismatch'));
  assert.equal(fake.starts, 0);
});

test('transport fixed queries cover both road and transit topics and keep unknown clocks out of historical matches', async () => {
  const fake = fakeAdapter({ rows: [], complete: true, hasMore: false });
  const runner = createViewQueryRunner({ config, adapter: fake.adapter });
  await runner.run({ queryId: 'disruption', request: { ...baseRequest, layers: ['disruption'] } });
  const current = fake.queries.at(1);
  assert.ok(current !== undefined);
  assert.match(current.query, /g\.topic IN \(@topic, @roadTopic\)/);
  assert.equal(current.params.topic, 'transport');
  assert.equal(current.params.roadTopic, 'road_disruption');
  assert.equal(current.params.from, baseRequest.window.from);
  assert.equal(current.types.from, 'TIMESTAMP');
  assert.match(current.query, /COALESCE\(g\.valid_from, g\.observed_at, g\.published_at\) IS NULL/);
  await runner.run({ queryId: 'disruption', request: { ...baseRequest, layers: ['disruption'], mode: 'historical' } });
  assert.doesNotMatch(fake.queries.at(3)?.query ?? '',
    /COALESCE\(g\.valid_from, g\.observed_at, g\.published_at\) IS NULL/);
});

test('dry-run ceiling blocks execution while equality is allowed and historical uses its own ceiling', async () => {
  const over = fakeAdapter({ rows: [], complete: true, hasMore: false }, 100_000_001n);
  await assert.rejects(createViewQueryRunner({ config, adapter: over.adapter }).run({
    queryId: 'planning', request: baseRequest,
  }), isQueryError('budgetExceeded'));
  assert.equal(over.starts, 0);
  const equal = fakeAdapter({ rows: [], complete: true, hasMore: false }, 100_000_000n);
  const complete = await createViewQueryRunner({ config, adapter: equal.adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  assert.equal(complete.kind, 'complete');
  assert.equal(complete.totalMatching, 0);
  const historical = fakeAdapter({ rows: [], complete: true, hasMore: false }, 400_000_000n);
  await createViewQueryRunner({ config, adapter: historical.adapter }).run({
    queryId: 'planning', request: { ...baseRequest, mode: 'historical' },
  });
  assert.equal(historical.queries.at(1)?.maximumBytesBilled, '500000000');
  assert.match(historical.queries.at(1)?.query ?? '', /v_geo_records_history/);
});

test('row lookahead, SDK pagination and UTF-8 byte limits stay partial with unknown full totals', async () => {
  const lookahead = fakeAdapter({ rows: records({ id: 'a' }, { id: 'b' }, { id: 'c' }),
    complete: true, hasMore: false });
  const result = await createViewQueryRunner({ config, adapter: lookahead.adapter }).run({
    queryId: 'planning', request: { ...baseRequest, pageSize: 2 },
  });
  assert.equal(result.kind, 'partial');
  assert.equal(result.totalMatching, null);
  assert.deepEqual(result.rows, [{ id: 'a' }, { id: 'b' }]);
  if (result.kind === 'partial') assert.equal(result.reason, 'rowLimit');
  const sdkPage = fakeAdapter({ rows: records({ id: 'a' }), complete: true, hasMore: true });
  const paged = await createViewQueryRunner({ config, adapter: sdkPage.adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  assert.equal(paged.kind, 'partial');
  assert.equal(paged.totalMatching, null);
  const utf8 = fakeAdapter({ rows: records({ label: '界界' }, { label: '界界' }), complete: true, hasMore: false });
  const bytes = await createViewQueryRunner({ config, adapter: utf8.adapter }).run({
    queryId: 'planning', request: baseRequest, resultBudgetBytes: 30,
  });
  assert.equal(bytes.kind, 'partial');
  assert.equal(bytes.rows.length, 1);
  assert.equal(bytes.totalMatching, null);
  assert.ok(Buffer.byteLength(JSON.stringify(bytes.rows), 'utf8') <= 30);
});

test('an oversized first geometry returns an empty partial result rather than an exact zero', async () => {
  const fake = fakeAdapter({ rows: records({ geometry: 'x'.repeat(500) }), complete: true, hasMore: false });
  const result = await createViewQueryRunner({ config, adapter: fake.adapter }).run({
    queryId: 'planning', request: baseRequest, resultBudgetBytes: 100,
  });
  assert.equal(result.kind, 'partial');
  assert.equal(result.totalMatching, null);
  assert.deepEqual(result.rows, []);
  assert.equal(result.resultBytes, 2);
});

test('statistical dates, definitions and property types require a trusted lookup, never a guessed filter', async () => {
  const selection = { indicatorId: 'rent.median.weekly', periodId: '2025Q3', periodStart: '2025-07-01',
    periodEnd: '2025-10-01', propertyType: 'flat', boundaryVintage: '2021' };
  const request = { ...baseRequest, layers: ['rent'], areaFilter: selection };
  const fake = fakeAdapter({ rows: [], complete: true, hasMore: false });
  await assert.rejects(createViewQueryRunner({ config, adapter: fake.adapter }).run({
    queryId: 'rent', request,
  }), isQueryError('notAvailable'));
  await assert.rejects(createViewQueryRunner({ config, adapter: fake.adapter,
    validateIndicatorSelection: async () => false }).run({ queryId: 'rent', request }), isQueryError('notAvailable'));
  assert.equal(fake.starts, 0);
  await createViewQueryRunner({ config, adapter: fake.adapter, validateIndicatorSelection: async (options) => {
    assert.deepEqual(options, { layerId: 'rent', filter: selection }); return true;
  } }).run({ queryId: 'rent', request });
  const query = fake.queries.at(1);
  assert.ok(query !== undefined);
  assert.equal(query.params.periodStart, '2025-07-01');
  assert.equal(query.params.periodEnd, '2025-10-01');
  assert.equal(query.types.periodStart, 'DATE');
  assert.equal(query.maximumBytesBilled, '500000000');
  assert.match(query.query, /DATE\(i\.period_start\) = @periodStart/);
  assert.doesNotMatch(query.query, /property_type/);
});

test('selected boundary level/vintage is parameterized and malicious selection text fails at the boundary', async () => {
  const vintage = '2026';
  const fake = fakeAdapter({ rows: [], complete: true, hasMore: false });
  await createViewQueryRunner({ config, adapter: fake.adapter }).run({ queryId: 'boundary', request: {
    ...baseRequest, layers: ['boundary'], boundaryFilter: { level: 'LGA', vintage },
  } });
  const query = fake.queries.at(1);
  assert.ok(query !== undefined);
  assert.equal(query.params.scheme, 'ASGS_LGA');
  assert.equal(query.params.vintage, vintage);
  assert.ok(!query.query.includes(vintage));
  assert.equal(query.maximumBytesBilled, '500000000');
  await assert.rejects(createViewQueryRunner({ config, adapter: fake.adapter }).run({ queryId: 'boundary', request: {
    ...baseRequest, layers: ['boundary'], boundaryFilter: { level: 'LGA',
      vintage: "2026'; SELECT secret FROM raw.private; --" },
  } }), isQueryError('invalidRequest'));
  assert.equal(fake.starts, 1);
});

test('unfinished jobs and malformed result rows fail safely and are cancelled', async () => {
  for (const page of [
    { rows: records({ id: 'a' }), complete: false, hasMore: true },
    { rows: [{ record: '{broken-secret' }], complete: true, hasMore: false },
    { rows: [{ record: 'null' }], complete: true, hasMore: false },
  ]) {
    const fake = fakeAdapter(page);
    await assert.rejects(createViewQueryRunner({ config, adapter: fake.adapter }).run({
      queryId: 'planning', request: baseRequest,
    }), isQueryError(page.complete ? 'serviceUnavailable' : 'queryTimeout'));
    assert.equal(fake.cancellations, 1);
  }
});

test('SDK failure details never escape and cancellation failures do not replace the original error', async () => {
  let cancellations = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { return {
      async readPage() { throw new Error('private credential SELECT secret FROM raw.private job private-id'); },
      async cancel() { cancellations += 1; throw new Error('secret cancellation details'); },
    }; },
  };
  await assert.rejects(createViewQueryRunner({ config, adapter }).run({ queryId: 'planning', request: baseRequest }),
    (error: unknown) => {
      assert.ok(error instanceof MapQueryError);
      assert.equal(error.code, 'serviceUnavailable');
      assert.ok(!JSON.stringify(error).includes('secret'));
      assert.ok(!error.stack?.includes('private credential'));
      return true;
    });
  assert.equal(cancellations, 1);
});

test('dry-run deadlines return without launching a billable query', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let starts = 0;
  const adapter: BigQueryViewAdapter = {
    dryRun() { return new Promise(() => {}); },
    async startQuery() { starts += 1; throw new Error('must not start'); },
  };
  const result = createViewQueryRunner({ config: smallDeadlineConfig(), adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  const rejected = assert.rejects(result, isQueryError('queryTimeout'));
  context.mock.timers.tick(10);
  await rejected;
  assert.equal(starts, 0);
});

test('query deadline cancels an already-started job', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let markRead = () => {};
  const reading = new Promise<void>((resolve) => { markRead = resolve; });
  let cancellations = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { return {
      readPage() { markRead(); return new Promise(() => {}); },
      async cancel() { cancellations += 1; },
    }; },
  };
  const result = createViewQueryRunner({ config: smallDeadlineConfig(), adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  const rejected = assert.rejects(result, isQueryError('queryTimeout'));
  await reading;
  context.mock.timers.tick(20);
  await rejected;
  assert.equal(cancellations, 1);
});

test('jobs created after an insert deadline are also cancelled rather than abandoned', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let release: ((job: AdapterQueryJob) => void) | undefined;
  let markStart = () => {};
  const starting = new Promise<void>((resolve) => { markStart = resolve; });
  let cancellations = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    startQuery() { markStart(); return new Promise((resolve) => { release = resolve; }); },
  };
  const result = createViewQueryRunner({ config: smallDeadlineConfig(), adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  const rejected = assert.rejects(result, isQueryError('queryTimeout'));
  await starting;
  context.mock.timers.tick(20);
  await rejected;
  assert.ok(release !== undefined);
  release({ async readPage() { throw new Error('expired job must not read'); },
    async cancel() { cancellations += 1; } });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancellations, 1);
});

test('caller abort cancels a running query while preserving the bounded safe timeout error', async () => {
  let markRead = () => {};
  const reading = new Promise<void>((resolve) => { markRead = resolve; });
  let cancellations = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { return {
      readPage() { markRead(); return new Promise(() => {}); },
      async cancel() { cancellations += 1; },
    }; },
  };
  const controller = new AbortController();
  const runner = createViewQueryRunner({ config, adapter });
  const result = runner.run({ queryId: 'planning', request: parseViewportQuery(baseRequest) },
    { signal: controller.signal });
  const rejected = assert.rejects(result, isQueryError('queryTimeout'));
  await reading;
  controller.abort();
  await rejected;
  assert.equal(cancellations, 1);
});

test('abort across the dry-run await never starts a billable job', async () => {
  const controller = new AbortController();
  let starts = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { controller.abort(); return { bytesProcessed: 1n }; },
    async startQuery() { starts += 1; throw new Error('must not start after abort'); },
  };
  await assert.rejects(createViewQueryRunner({ config, adapter }).run({ queryId: 'planning', request: baseRequest },
    { signal: controller.signal }), isQueryError('queryTimeout'));
  assert.equal(starts, 0);
});

test('a stalled cancellation is bounded rather than hanging the request', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let markRead = () => {};
  let markCancel = () => {};
  const reading = new Promise<void>((resolve) => { markRead = resolve; });
  const cancelling = new Promise<void>((resolve) => { markCancel = resolve; });
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { return {
      readPage() { markRead(); return new Promise(() => {}); },
      cancel() { markCancel(); return new Promise(() => {}); },
    }; },
  };
  const result = createViewQueryRunner({ config: smallDeadlineConfig(), adapter }).run({
    queryId: 'planning', request: baseRequest,
  });
  const rejected = assert.rejects(result, isQueryError('queryTimeout'));
  await reading;
  context.mock.timers.tick(20);
  await cancelling;
  context.mock.timers.tick(5);
  await rejected;
});

test('server maximumBytesBilled failures remain budget errors with sanitized metadata', async () => {
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { throw new Error('Query exceeded limit for bytes billed: 100000000. private job-id'); },
  };
  await assert.rejects(createViewQueryRunner({ config, adapter }).run({ queryId: 'planning', request: baseRequest }),
    (error: unknown) => {
      assert.ok(error instanceof MapQueryError);
      assert.equal(error.code, 'budgetExceeded');
      assert.equal(error.retryable, false);
      assert.ok(!JSON.stringify(error).includes('private'));
      return true;
    });
});
