import { BaseLlm, type BaseLlmConnection, type LlmRequest, type LlmResponse } from '@google/adk';

/** Waits before the second and third attempt of a model call; Vertex's 429 and 503 usually clear within seconds. */
export const MODEL_RETRY_DELAYS_MS = [1_000, 3_000] as const;

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE = /\b(?:429|500|502|503|504)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up/i;

/** A failure that a second try of the same call may not repeat: quota, overload, a dropped connection. */
export function isTransientModelError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return TRANSIENT_STATUS.has(status);
  return error instanceof Error && TRANSIENT_MESSAGE.test(error.message);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) { resolve(); return; }
    const timer = setTimeout(done, ms);
    function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * A model that calls `inner` again when a call fails transiently before it yielded anything, so a passing 429 or 503
 * costs the user a few seconds instead of the turn. A call that already streamed text or a function call is never
 * repeated: the user has seen part of it.
 */
export class RetryingLlm extends BaseLlm {
  constructor(private readonly inner: BaseLlm, private readonly options: {
    readonly delaysMs?: readonly number[];
    readonly log?: (line: Record<string, unknown>) => void;
  } = {}) {
    super({ model: inner.model });
  }

  async *generateContentAsync(request: LlmRequest, stream?: boolean, abortSignal?: AbortSignal): AsyncGenerator<LlmResponse, void> {
    const delays = this.options.delaysMs ?? MODEL_RETRY_DELAYS_MS;
    const aborted = () => abortSignal?.aborted === true;
    for (let attempt = 0; ; attempt += 1) {
      let yielded = false;
      try {
        for await (const response of this.inner.generateContentAsync(request, stream, abortSignal)) {
          yielded = true;
          yield response;
        }
        return;
      } catch (error) {
        const delay = delays[attempt];
        if (yielded || delay === undefined || aborted() || !isTransientModelError(error)) throw error;
        this.options.log?.({ severity: 'WARNING', event: 'modelCallRetried', attempt: attempt + 1, delayMs: delay,
          reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
        await sleep(delay, abortSignal);
        if (aborted()) throw error;
      }
    }
  }

  connect(request: LlmRequest): Promise<BaseLlmConnection> {
    return this.inner.connect(request);
  }
}
