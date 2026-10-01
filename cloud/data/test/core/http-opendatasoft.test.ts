import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, test } from 'node:test';
import { HttpClient, HttpFailure, type HttpRequest } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../src/core/opendatasoft.js';
import { withScheduledRequestGuard } from '../../src/jobs/scheduled-guard.js';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function localServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('local test server has no TCP address');
  return `http://127.0.0.1:${address.port}`;
}

test('HTTP client respects Retry-After and retries a rate limit', async () => {
  let calls = 0;
  const portalUrl = await localServer((_request, response) => {
    calls += 1;
    response.setHeader('content-type', 'application/json');
    if (calls === 1) {
      response.writeHead(429, { 'retry-after': '0' });
      response.end('{}');
      return;
    }
    response.end('{"ok":true}');
  });
  const response = await new HttpClient().getJson({ url: portalUrl, maxAttempts: 2 });
  assert.deepEqual(response.body, { ok: true });
  assert.equal(calls, 2);
});

test('HTTP client does not retry an authentication error or echo a URL secret', async () => {
  let calls = 0;
  const portalUrl = await localServer((_request, response) => {
    calls += 1;
    response.writeHead(403);
    response.end('denied');
  });
  await assert.rejects(
    new HttpClient().getJson({ url: `${portalUrl}/?apikey=private-value` }),
    (error: unknown) => {
      assert.ok(error instanceof HttpFailure);
      assert.equal(error.code, 'auth_failed');
      assert.equal(error.message.includes('private-value'), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('HTTP client blocks secret redirects before a second request or ledger bypass', async () => {
  let initialCalls = 0;
  let destinationCalls = 0;
  let forwardedKey = false;
  let ledgerCharges = 0;
  const destination = await localServer((request, response) => {
    destinationCalls += 1;
    forwardedKey = request.headers.keyid !== undefined;
    response.end('{}');
  });
  const origin = await localServer((_request, response) => {
    initialCalls += 1;
    response.writeHead(302, { location: destination });
    response.end();
  });
  const store = {
    async withSourceLease<T>(_id: string, work: () => Promise<T>): Promise<T> {
      return work();
    },
    async charge(): Promise<void> { ledgerCharges += 1; },
  };
  await assert.rejects(withScheduledRequestGuard(store,
    { sourceId: 'test.secret_redirect', dailyCap: 1, executionCap: 1 },
    () => new HttpClient().getJson({ url: origin,
      headers: { KeyID: 'test-only-key' }, redirect: 'error', maxAttempts: 1 })),
  (error: unknown) => {
    assert.ok(error instanceof HttpFailure);
    assert.equal(error.message.includes('test-only-key'), false);
    return true;
  });
  assert.equal(initialCalls, 1);
  assert.equal(ledgerCharges, 1);
  assert.equal(destinationCalls, 0);
  assert.equal(forwardedKey, false);
});

test('HTTP client retains default redirect handling for public requests', async () => {
  let destinationCalls = 0;
  const destination = await localServer((_request, response) => {
    destinationCalls += 1;
    response.setHeader('content-type', 'application/json');
    response.end('{"ok":true}');
  });
  const origin = await localServer((_request, response) => {
    response.writeHead(302, { location: destination });
    response.end();
  });
  const response = await new HttpClient().getJson({ url: origin, maxAttempts: 1 });
  assert.deepEqual(response.body, { ok: true });
  assert.equal(destinationCalls, 1);
});

const bodyReaders: ReadonlyArray<{
  name: string;
  read(client: HttpClient, request: HttpRequest): Promise<void>;
}> = [
  { name: 'JSON', async read(client, request) { await client.getJson(request); } },
  { name: 'text', async read(client, request) { await client.getText(request); } },
  { name: 'bytes', async read(client, request) { await client.getBytes(request); } },
  { name: 'stream', async read(client, request) {
    const response = await client.getStream(request);
    const reader = response.body.getReader();
    try {
      let next = await reader.read();
      while (!next.done) next = await reader.read();
    }
    finally { reader.releaseLock(); }
  } },
];

for (const { name, read } of bodyReaders) {
  test(`HTTP ${name} timeout includes a delayed body after headers`, async () => {
    let calls = 0;
    let bodyCompleted = false;
    const portalUrl = await localServer((_request, response) => {
      calls += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{');
      const timer = setTimeout(() => {
        bodyCompleted = true;
        response.end('"ok":true}');
      }, 1000);
      response.once('close', () => clearTimeout(timer));
    });
    await assert.rejects(read(new HttpClient(), { url: portalUrl,
      timeoutMs: 80, maxAttempts: 1 }), (error: unknown) => {
      assert.ok(error instanceof HttpFailure);
      assert.equal(error.code, 'upstream_unavailable');
      assert.equal(error.attempts, 1);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(bodyCompleted, false);
  });
}

test('HTTP buffered body timeout retries within the declared attempt and request limits', async () => {
  let calls = 0;
  let ledgerCharges = 0;
  const portalUrl = await localServer((_request, response) => {
    calls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    if (calls === 1) {
      response.write('{');
      const timer = setTimeout(() => response.end('"late":true}'), 1000);
      response.once('close', () => clearTimeout(timer));
    } else response.end('{"ok":true}');
  });
  const store = {
    async withSourceLease<T>(_id: string, work: () => Promise<T>): Promise<T> {
      return work();
    },
    async charge(): Promise<void> { ledgerCharges += 1; },
  };
  const result = await withScheduledRequestGuard(store,
    { sourceId: 'test.body_timeout', dailyCap: 2, executionCap: 2 },
    () => new HttpClient().getJson({ url: portalUrl, timeoutMs: 80,
      maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 }));
  assert.deepEqual(result.body, { ok: true });
  assert.equal(calls, 2);
  assert.equal(ledgerCharges, 2);
});

test('HTTP malformed JSON fails validation without retry', async () => {
  let calls = 0;
  const portalUrl = await localServer((_request, response) => {
    calls += 1;
    response.end('invalid JSON');
  });
  await assert.rejects(new HttpClient().getJson({ url: portalUrl, maxAttempts: 3 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpFailure);
      assert.equal(error.code, 'validation_failed');
      assert.equal(error.attempts, 1);
      return true;
    });
  assert.equal(calls, 1);
});

test('HTTP caller abort during a buffered body does not retry', async () => {
  let calls = 0;
  const controller = new AbortController();
  const portalUrl = await localServer((_request, response) => {
    calls += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{');
    const timer = setTimeout(() => controller.abort(), 20);
    response.once('close', () => clearTimeout(timer));
  });
  await assert.rejects(new HttpClient().getJson({ url: portalUrl,
    timeoutMs: 1000, maxAttempts: 3, signal: controller.signal }),
  (error: unknown) => {
    assert.ok(error instanceof HttpFailure);
    assert.equal(error.code, 'upstream_unavailable');
    return true;
  });
  assert.equal(calls, 1);
});

test('HTTP completed stream closes and clears its request timer', async () => {
  const portalUrl = await localServer((_request, response) => response.end('complete'));
  const response = await new HttpClient().getStream({ url: portalUrl,
    timeoutMs: 60_000, maxAttempts: 1 });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    let next = await reader.read();
    while (!next.done) {
      chunks.push(next.value);
      next = await reader.read();
    }
  } finally { reader.releaseLock(); }
  assert.equal(Buffer.concat(chunks).toString(), 'complete');
});

test('HTTP cancelling a stream closes its upstream body and clears the timer', async () => {
  let observeClose: () => void = () => undefined;
  const upstreamClosed = new Promise<void>(resolve => { observeClose = resolve; });
  const portalUrl = await localServer((_request, response) => {
    response.writeHead(200);
    response.write('first');
    response.once('close', observeClose);
  });
  const response = await new HttpClient().getStream({ url: portalUrl,
    timeoutMs: 60_000, maxAttempts: 1 });
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  reader.releaseLock();
  await upstreamClosed;
});

test('OpenDataSoft client pages a stable result window completely', async () => {
  const offsets: number[] = [];
  const portalUrl = await localServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const offset = Number(url.searchParams.get('offset'));
    offsets.push(offset);
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ total_count: rows.length, results: rows.slice(offset, offset + 2) }));
  });
  const result = await new OpenDataSoftClient().fetchRecords({
    portalUrl,
    datasetId: 'sample',
    orderBy: 'id ASC',
    pageSize: 2,
  });
  assert.equal(result.totalCount, 3);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(result.records, [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('OpenDataSoft client rejects a changed total during pagination', async () => {
  const portalUrl = await localServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const offset = Number(url.searchParams.get('offset'));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ total_count: offset === 0 ? 3 : 4, results: [{ id: offset }, { id: offset + 1 }] }));
  });
  await assert.rejects(
    new OpenDataSoftClient().fetchRecords({ portalUrl, datasetId: 'sample', orderBy: 'id', pageSize: 2 }),
    (error: unknown) => error instanceof OdsIncompleteWindow && error.code === 'incomplete_window',
  );
});
