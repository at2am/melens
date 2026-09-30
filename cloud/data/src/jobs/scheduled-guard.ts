import { AsyncLocalStorage } from 'node:async_hooks';

import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

const sourceId = z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);
const utcDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveCount = z.number().int().positive();
const ledgerSchema = z.object({
  sourceId,
  day: utcDay,
  requests: z.number().int().nonnegative(),
});

function httpCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = error.code;
  return typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : null;
}

export class RequestCapReached extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestCapReached';
  }
}

export interface ScheduledRequestStore {
  withSourceLease<T>(id: string, work: () => Promise<T>): Promise<T>;
  charge(id: string, day: string, dailyCap: number): Promise<void>;
}

/** GCS preconditions serialize both execution and each daily quota increment. */
export class GcsScheduledRequestStore implements ScheduledRequestStore {
  constructor(private readonly storage: Storage, private readonly bucketName: string) {}

  private get bucket() {
    return this.storage.bucket(this.bucketName);
  }

  async withSourceLease<T>(id: string, work: () => Promise<T>): Promise<T> {
    const canonicalId = sourceId.parse(id);
    const file = this.bucket.file(`locks/scheduled/${canonicalId}.json`);
    try {
      await file.save(JSON.stringify({ startedAt: new Date().toISOString() }), {
        resumable: false,
        contentType: 'application/json',
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if (httpCode(error) !== 412) throw error;
      throw new Error(`Scheduled source is already running: ${canonicalId}`);
    }
    const [metadata] = await file.getMetadata();
    if (!metadata.generation) throw new Error('Missing scheduled lease generation');
    try {
      return await work();
    } finally {
      await this.bucket.file(file.name, { generation: String(metadata.generation) })
        .delete({ ignoreNotFound: false });
    }
  }

  async charge(id: string, day: string, dailyCap: number): Promise<void> {
    const canonicalId = sourceId.parse(id);
    const canonicalDay = utcDay.parse(day);
    positiveCount.parse(dailyCap);
    const file = this.bucket.file(`request-limits/${canonicalId}/${canonicalDay}.json`);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      let requests = 0;
      let generation = '0';
      try {
        const [metadata] = await file.getMetadata();
        if (!metadata.generation) throw new Error('Missing request ledger generation');
        generation = String(metadata.generation);
        const [bytes] = await this.bucket.file(file.name, { generation }).download();
        const ledger = ledgerSchema.parse(JSON.parse(bytes.toString('utf8')));
        if (ledger.sourceId !== canonicalId || ledger.day !== canonicalDay) {
          throw new Error('Request ledger identity mismatch');
        }
        requests = ledger.requests;
      } catch (error) {
        if (httpCode(error) === 404 && generation === '0') {
          // First request on this UTC day; the create precondition resolves races.
        } else if ([404, 412].includes(httpCode(error) ?? -1)) {
          continue;
        } else {
          throw error;
        }
      }
      if (requests >= dailyCap) {
        throw new RequestCapReached(`Daily request cap reached: ${canonicalId}`);
      }
      try {
        await file.save(JSON.stringify({ sourceId: canonicalId, day: canonicalDay,
          requests: requests + 1 }), {
          resumable: false,
          contentType: 'application/json',
          preconditionOpts: { ifGenerationMatch: generation },
        });
        return;
      } catch (error) {
        if (httpCode(error) !== 412) throw error;
      }
    }
    throw new Error(`Request ledger contention exceeded retry limit: ${canonicalId}`);
  }
}

export interface RequestGuardConfig {
  sourceId: string;
  dailyCap: number;
  executionCap: number;
}

let activeInProcess = false;
const ledgerTraffic = new AsyncLocalStorage<boolean>();

/** Charge before every outbound fetch attempt, including retries and failed calls. */
export async function withScheduledRequestGuard<T>(
  store: ScheduledRequestStore,
  config: RequestGuardConfig,
  work: () => Promise<T>,
  clock: () => Date = () => new Date(),
): Promise<T> {
  sourceId.parse(config.sourceId);
  positiveCount.parse(config.dailyCap);
  positiveCount.parse(config.executionCap);
  if (config.executionCap > config.dailyCap) throw new Error('Execution request cap exceeds daily cap');
  if (activeInProcess) throw new Error('A scheduled ingestion is already running in this process');
  activeInProcess = true;
  try {
    return await store.withSourceLease(config.sourceId, async () => {
      const originalFetch = globalThis.fetch;
      let requests = 0;
      let guardFailure: Error | null = null;
      globalThis.fetch = async (input, init) => {
        if (ledgerTraffic.getStore()) return originalFetch(input, init);
        if (guardFailure) throw guardFailure;
        if (requests >= config.executionCap) {
          guardFailure = new RequestCapReached(`Execution request cap reached: ${config.sourceId}`);
          throw guardFailure;
        }
        requests += 1;
        const date = clock();
        if (!Number.isFinite(date.getTime())) {
          guardFailure = new Error('Invalid request clock');
          throw guardFailure;
        }
        try {
          await ledgerTraffic.run(true, () => store.charge(config.sourceId,
            date.toISOString().slice(0, 10), config.dailyCap));
        } catch (error) {
          guardFailure = error instanceof Error ? error : new Error('Request ledger unavailable');
          throw guardFailure;
        }
        return originalFetch(input, init);
      };
      try {
        const result = await work().catch(error => { throw guardFailure ?? error; });
        if (guardFailure) throw guardFailure;
        return result;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  } finally {
    activeInProcess = false;
  }
}
