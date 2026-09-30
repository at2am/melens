export type HttpFailureCode =
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'schema_changed'
  | 'auth_failed'
  | 'validation_failed';

export class HttpFailure extends Error {
  constructor(
    readonly code: HttpFailureCode,
    readonly status: number | null,
    readonly attempts: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP request failed: ${code}${status === null ? '' : ` (${status})`}`);
    this.name = 'HttpFailure';
  }
}

export interface HttpRequest {
  url: string | URL;
  headers?: HeadersInit;
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse<T> {
  body: T;
  status: number;
  fetchedAt: string;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentRange?: string | null;
}

function failureCode(status: number): HttpFailureCode {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failed';
  if (status === 404 || status === 410) return 'schema_changed';
  if (status >= 500) return 'upstream_unavailable';
  return 'validation_failed';
}

function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return result;
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new HttpFailure('upstream_unavailable', null, 0);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      reject(new HttpFailure('upstream_unavailable', null, 0));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class HttpClient {
  async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const response = await this.get(request);
    try {
      return { ...response.meta, body: await response.raw.json() };
    } catch {
      throw new HttpFailure('validation_failed', response.meta.status, response.attempts);
    }
  }

  async getText(request: HttpRequest): Promise<HttpResponse<string>> {
    const response = await this.get(request);
    return { ...response.meta, body: await response.raw.text() };
  }

  async getBytes(request: HttpRequest): Promise<HttpResponse<Uint8Array<ArrayBuffer>>> {
    const response = await this.get(request);
    const buffer = await response.raw.arrayBuffer();
    return { ...response.meta, body: new Uint8Array(buffer) };
  }

  async getStream(request: HttpRequest): Promise<HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>> {
    const response = await this.get(request);
    if (response.raw.body === null) {
      throw new HttpFailure('validation_failed', response.meta.status, response.attempts);
    }
    return { ...response.meta, body: response.raw.body };
  }

  private async get(request: HttpRequest): Promise<{
    raw: Response;
    attempts: number;
    meta: Omit<HttpResponse<never>, 'body'>;
  }> {
    const timeoutMs = positiveInteger(request.timeoutMs, 15_000, 'timeoutMs');
    const maxAttempts = positiveInteger(request.maxAttempts, 4, 'maxAttempts');
    const baseDelayMs = positiveInteger(request.baseDelayMs, 250, 'baseDelayMs');
    const maxDelayMs = positiveInteger(request.maxDelayMs, 30_000, 'maxDelayMs');
    if (maxDelayMs < baseDelayMs) throw new TypeError('maxDelayMs must be >= baseDelayMs');

    const url = new URL(request.url);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new TypeError('HTTP client requires HTTPS for remote requests');
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, controller.signal])
        : controller.signal;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          ...(request.headers === undefined ? {} : { headers: request.headers }),
          signal,
        });
      } catch {
        clearTimeout(timeout);
        if (request.signal?.aborted || attempt === maxAttempts) {
          throw new HttpFailure('upstream_unavailable', null, attempt);
        }
        await wait(Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)), request.signal);
        continue;
      }
      clearTimeout(timeout);
      const fetchedAt = new Date().toISOString();
      if (response.ok) {
        return {
          raw: response,
          attempts: attempt,
          meta: {
            status: response.status,
            fetchedAt,
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified'),
            contentType: response.headers.get('content-type'),
            contentRange: response.headers.get('content-range'),
          },
        };
      }

      const code = failureCode(response.status);
      const retryAfter = retryAfterMs(response.headers.get('retry-after'), Date.now());
      await response.body?.cancel();
      const retryable = code === 'rate_limited' || code === 'upstream_unavailable';
      if (!retryable || attempt === maxAttempts) {
        throw new HttpFailure(code, response.status, attempt, retryAfter);
      }
      const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
      await wait(Math.min(maxDelayMs, retryAfter ?? exponentialDelay), request.signal);
    }
    throw new HttpFailure('upstream_unavailable', null, maxAttempts);
  }
}
