import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { localTargets } from './local-targets.mjs';

const runFile = promisify(execFile);

const origins = new Set([localTargets.live, localTargets.sample, 'https://melens-510012.web.app']);
const staticPaths = new Set(['/build-provenance.json', '/release-provenance.json', '/main.dart.js']);
const connectionCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'ERR_TLS_HANDSHAKE_TIMEOUT', 'TimeoutError', 'AbortError',
]);

function classifyReadFailure(error) {
  const pending = [error];
  const seen = new Set();
  const codes = [];
  const messages = [];
  while (pending.length > 0 && seen.size < 12) {
    const value = pending.shift();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (typeof value.code === 'string') codes.push(value.code);
    if (typeof value.name === 'string') codes.push(value.name);
    if (typeof value.message === 'string') messages.push(value.message);
    if (Buffer.isBuffer(value.stderr)) messages.push(value.stderr.toString('utf8'));
    else if (typeof value.stderr === 'string') messages.push(value.stderr);
    if (value.cause !== undefined) pending.push(value.cause);
    if (Array.isArray(value.errors)) pending.push(...value.errors);
  }
  const detail = messages.join('\n');
  // Inspect the complete cause chain before accepting an outer network code.
  if (codes.some((code) => /CERT|UNABLE_TO_VERIFY|SELF_SIGNED|PERMISSION|UNAUTHENTICATED/i.test(code))
    || /certificate|self[- ]signed|permission.denied|forbidden|unauthenticated|ResponseError|HTTPError/i.test(detail)) {
    return { code: 'NON_RETRYABLE_TLS_AUTH_OR_API_FAILURE', retryable: false };
  }
  const code = codes.find((candidate) => connectionCodes.has(candidate));
  if (code !== undefined) return { code, retryable: true };
  if (/ConnectionError|ConnectionResetError|ProxyError|connection (?:reset|aborted|refused|timed out)|TLS connection.*(?:closed|disconnected)|other side closed|Read timed out|SSLEOFError|UNEXPECTED_EOF_WHILE_READING/i.test(detail)) {
    return { code: 'READ_CONNECTION_FAILURE', retryable: true };
  }
  return { code: 'NON_RETRYABLE_READ_FAILURE', retryable: false };
}

export async function retryReadOnly(operation, read, onFailure) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try { return await read(); }
    catch (error) {
      const classification = classifyReadFailure(error);
      const failure = { operation, attempt, capturedAt: new Date().toISOString(), code: classification.code, willRetry: classification.retryable && attempt < 3 };
      onFailure(failure);
      if (!classification.retryable) throw error;
      if (attempt === 3) throw new Error(`${operation} failed after three read-only connection attempts.`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw new Error('Read-only transport exhausted its attempt limit.');
}

export async function readStatic(url, onFailure) {
  const address = new URL(url);
  if (!origins.has(address.origin) || !staticPaths.has(address.pathname) || address.username || address.password) {
    throw new Error('Only the fixed Melens static artifact URLs can use this transport.');
  }
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS certificate verification must remain enabled.');
  return retryReadOnly(`GET ${address.origin}${address.pathname}`, async () => {
    const response = await fetch(address, {
      method: 'GET', redirect: 'error', cache: 'no-store', headers: { 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(30_000),
    });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  }, onFailure);
}

export async function readRunMetadata(args, onFailure) {
  if (args[0] !== 'run' || !['services', 'revisions'].includes(args[1]) || args[2] !== 'describe'
    || !args.includes('--project=melens-510012') || !args.includes('--region=australia-southeast2')) {
    throw new Error('Only Cloud Run describe operations can use the metadata read transport.');
  }
  return retryReadOnly(`Cloud Run ${args[1]} describe`, async () => {
    const result = await runFile('gcloud', args, { encoding: 'utf8', timeout: 30_000 });
    return result.stdout;
  }, onFailure);
}
