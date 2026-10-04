import { createServer } from 'node:http';
import { z } from 'zod';

const parsedPort = z.coerce.number().int().min(0).max(65_535)
  .safeParse(process.env.PORT ?? '8081');
if (!parsedPort.success) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}

const host = '127.0.0.1';
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Connection', 'close');

  const pathname = request.url?.split('?')[0];
  if (pathname !== '/healthz') {
    response.writeHead(404);
    response.end(JSON.stringify({ error: 'Map API routes are not implemented by this development server.' }));
    return;
  }
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' });
    response.end(JSON.stringify({ error: 'Use GET for the development health endpoint.' }));
    return;
  }

  response.writeHead(200);
  response.end(JSON.stringify({
    service: 'melens-map-dev',
    status: 'ok',
    mapApiImplemented: false,
  }));
});

server.requestTimeout = 5_000;
server.headersTimeout = 5_000;
server.keepAliveTimeout = 1_000;

server.on('error', () => {
  process.stderr.write(`${JSON.stringify({ severity: 'ERROR', event: 'developmentServerFailed' })}\n`);
  process.exitCode = 1;
});

server.listen(parsedPort.data, host, () => {
  const address = server.address();
  if (address === null || typeof address === 'string') return;
  process.stdout.write(`${JSON.stringify({
    severity: 'INFO',
    event: 'developmentServerListening',
    host,
    port: address.port,
    mapApiImplemented: false,
  })}\n`);
});

function closeServer(): void {
  server.close();
  server.closeAllConnections();
}

process.once('SIGINT', closeServer);
process.once('SIGTERM', closeServer);
