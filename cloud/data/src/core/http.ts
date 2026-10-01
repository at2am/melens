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
  redirect?: RequestRedirect;
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

interface ResponseReadContext {
  attempts: number;
  signal: AbortSignal;
  finish(): void;
}

function responseStream(response: Response, context: ResponseReadContext):
  ReadableStream<Uint8Array<ArrayBuffer>> {
  if (response.body === null) {
    throw new HttpFailure('validation_failed', response.status, context.attempts);
  }
  const reader = response.body.getReader();
  let finished = false;
  let onAbort: () => void;
  const finish = () => {
    finished = true;
    context.signal.removeEventListener('abort', onAbort);
    context.finish();
  };
  const failure = () => new HttpFailure('upstream_unavailable', response.status,
    context.attempts);
  return new ReadableStream({
    start(controller) {
      onAbort = () => {
        if (finished) return;
        finish();
        controller.error(failure());
        void reader.cancel().catch(() => undefined).finally(() => reader.releaseLock());
      };
      if (context.signal.aborted) onAbort();
      else context.signal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      if (finished) return;
      try {
        const next = await reader.read();
        if (finished) return;
        if (next.done) {
          finish();
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(next.value);
      } catch {
        if (finished) return;
        finish();
        reader.releaseLock();
        controller.error(failure());
      }
    },
    async cancel(reason: unknown) {
      if (finished) return;
      finish();
      try { await reader.cancel(reason); }
      finally { reader.releaseLock(); }
    },
  });
}

export class HttpClient {
  async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    return this.get(request, async (response, context): Promise<unknown> => {
      try { return await response.json(); }
      catch (error) {
        const code = !context.signal.aborted && error instanceof SyntaxError
          ? 'validation_failed' : 'upstream_unavailable';
        throw new HttpFailure(code, response.status, context.attempts);
      }
    });
  }

  async getText(request: HttpRequest): Promise<HttpResponse<string>> {
    return this.get(request, response => response.text());
  }

  async getBytes(request: HttpRequest): Promise<HttpResponse<Uint8Array<ArrayBuffer>>> {
    return this.get(request, async response => new Uint8Array(await response.arrayBuffer()));
  }

  async getStream(request: HttpRequest): Promise<HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>> {
    return this.get(request, async (response, context) => responseStream(response, context),
      'stream');
  }

  private async get<T>(request: HttpRequest,
    readBody: (response: Response, context: ResponseReadContext) => Promise<T>,
    mode: 'buffered' | 'stream' = 'buffered'): Promise<HttpResponse<T>> {
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
      let response: Response | undefined;
      try {
        response = await fetch(url, {
          method: 'GET',
          ...(request.headers === undefined ? {} : { headers: request.headers }),
          ...(request.redirect === undefined ? {} : { redirect: request.redirect }),
          signal,
        });
        const fetchedAt = new Date().toISOString();
        if (!response.ok) {
          const code = failureCode(response.status);
          const retryAfter = retryAfterMs(response.headers.get('retry-after'), Date.now());
          await response.body?.cancel().catch(() => undefined);
          throw new HttpFailure(code, response.status, attempt, retryAfter);
        }
        const body = await readBody(response, { attempts: attempt, signal,
          finish: () => clearTimeout(timeout) });
        if (mode === 'buffered') clearTimeout(timeout);
        return {
          body,
          status: response.status,
          fetchedAt,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
          contentType: response.headers.get('content-type'),
          contentRange: response.headers.get('content-range'),
        };
      } catch (error) {
        clearTimeout(timeout);
        const failure = error instanceof HttpFailure ? error
          : new HttpFailure('upstream_unavailable', response?.status ?? null, attempt);
        const retryable = failure.code === 'rate_limited' || failure.code === 'upstream_unavailable';
        if (!retryable || request.signal?.aborted || attempt === maxAttempts) throw failure;
        const exponentialDelay = baseDelayMs * 2 ** (attempt - 1);
        await wait(Math.min(maxDelayMs, failure.retryAfterMs ?? exponentialDelay), request.signal);
      }
    }
    throw new HttpFailure('upstream_unavailable', null, maxAttempts);
  }
}
