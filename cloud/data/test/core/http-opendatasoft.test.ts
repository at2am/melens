import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, test } from 'node:test';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient } from '../../src/core/opendatasoft.js';

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
