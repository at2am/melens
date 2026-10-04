import { z } from 'zod';

import { validateMapConfig, type MapConfig } from '../config.js';
import { parseUnlocatedQuery, parseViewportQuery } from '../contracts/map-contract.js';
import type { AdapterQueryJob, BigQueryViewAdapter } from './bigquery-adapter.js';
import { publicRecordKeysSchema, preparePublicRecordQuery } from './public-record-queries.js';
import { approvedUnlocatedScopeSchema, prepareUnlocatedQuery } from './unlocated-queries.js';
import { prepareViewQuery, viewQueryIdSchema, type IndicatorFilter } from './view-queries.js';

const queryInputSchema = z.strictObject({
  queryId: viewQueryIdSchema,
  request: z.unknown(),
  family: z.enum(['viewport', 'unlocated', 'publicRecords']).optional(),
  recordKeys: publicRecordKeysSchema.optional(),
  approvedScope: approvedUnlocatedScopeSchema.optional(),
  publicSourceIds: z.array(z.string().min(1).max(256).regex(/^\S+$/)).max(1_000).optional(),
  resultBudgetBytes: z.number().int().min(2).optional(),
});
const jsonRecordSchema = z.record(z.string(), z.json());
const queryRowSchema = z.object({ record: z.string() });
export type ViewRow = z.infer<typeof jsonRecordSchema>;

export type ViewQueryResult = {
  readonly kind: 'complete';
  readonly rows: readonly ViewRow[];
  readonly totalMatching: number;
  readonly resultBytes: number;
} | {
  readonly kind: 'partial';
  readonly rows: readonly ViewRow[];
  readonly totalMatching: null;
  readonly resultBytes: number;
  readonly reason: 'rowLimit' | 'byteLimit' | 'pageLimit';
};

const errors = {
  invalidRequest: { status: 400, retryable: false },
  cursorMismatch: { status: 400, retryable: false },
  notAvailable: { status: 410, retryable: false },
  budgetExceeded: { status: 503, retryable: false },
  queryTimeout: { status: 504, retryable: true },
  serviceUnavailable: { status: 503, retryable: true },
};
export type MapQueryErrorCode = keyof typeof errors;

/** Never attach SDK messages, SQL, project paths, job IDs, or row contents. */
export class MapQueryError extends Error {
  readonly messageKey: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(readonly code: MapQueryErrorCode) {
    super(`Map query failed: ${code}`);
    this.name = 'MapQueryError';
    this.messageKey = `map.error.${code}`;
    this.status = errors[code].status;
    this.retryable = errors[code].retryable;
  }
}

function safeQueryError(error: unknown): MapQueryError {
  if (error instanceof MapQueryError) return error;
  const sdkError = z.object({ message: z.string() }).safeParse(error);
  if (sdkError.success && /Query exceeded limit for bytes billed:/i.test(sdkError.data.message)) {
    return new MapQueryError('budgetExceeded');
  }
  return new MapQueryError('serviceUnavailable');
}

async function withinDeadline<T>(operation: Promise<T>, milliseconds: number,
  signal: AbortSignal | undefined): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(new MapQueryError('queryTimeout'));
    timer = setTimeout(fail, milliseconds);
    abort = fail;
    if (signal?.aborted) fail();
    else signal?.addEventListener('abort', fail, { once: true });
  });
  try { return await Promise.race([operation, deadline]); }
  finally {
    if (timer !== undefined) clearTimeout(timer);
    if (abort !== undefined) signal?.removeEventListener('abort', abort);
  }
}

async function boundedCancel(job: AdapterQueryJob, timeoutMs: number): Promise<void> {
  try { await withinDeadline(job.cancel(), timeoutMs, undefined); }
  catch { /* Cancellation is best effort; the server job also has jobTimeoutMs. */ }
}

function boundedRows(value: unknown, options: {
  readonly pageSize: number; readonly byteBudget: number; readonly hasMore: boolean;
}): ViewQueryResult {
  const sourceRows = z.array(queryRowSchema).max(options.pageSize + 1).parse(value);
  const rows: ViewRow[] = [];
  let resultBytes = 2;
  let reason: Extract<ViewQueryResult, { kind: 'partial' }>['reason'] | null = null;
  for (const sourceRow of sourceRows) {
    if (rows.length === options.pageSize) { reason = 'rowLimit'; break; }
    // Reject oversized records before parsing. JSON can compact whitespace, so
    // this conservative bound may omit a row that could fit after parsing.
    const encodedBytes = Buffer.byteLength(sourceRow.record, 'utf8');
    if (resultBytes + encodedBytes + (rows.length === 0 ? 0 : 1) > options.byteBudget) {
      reason = 'byteLimit'; break;
    }
    const decoded: unknown = JSON.parse(sourceRow.record);
    const row = jsonRecordSchema.parse(decoded);
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (resultBytes + rowBytes + (rows.length === 0 ? 0 : 1) > options.byteBudget) {
      reason = 'byteLimit'; break;
    }
    resultBytes += rowBytes + (rows.length === 0 ? 0 : 1);
    rows.push(row);
  }
  if (reason !== null || options.hasMore) return {
    kind: 'partial', rows, totalMatching: null, resultBytes, reason: reason ?? 'pageLimit',
  };
  return { kind: 'complete', rows, totalMatching: rows.length, resultBytes };
}

export type IndicatorSelectionValidator = (options: {
  readonly layerId: 'rent' | 'census'; readonly filter: IndicatorFilter;
}) => Promise<boolean>;

export function createViewQueryRunner(options: {
  readonly config: MapConfig;
  readonly adapter: BigQueryViewAdapter;
  readonly validateIndicatorSelection?: IndicatorSelectionValidator;
}) {
  const config = validateMapConfig(options.config);
  const maximumResultBudget = config.maxResponseBytes - config.responseEnvelopeReserveBytes;

  return {
    async run(input: unknown, execution: { readonly signal?: AbortSignal } = {}): Promise<ViewQueryResult> {
      let parsed: z.infer<typeof queryInputSchema>;
      let request: ReturnType<typeof parseViewportQuery> | ReturnType<typeof parseUnlocatedQuery>;
      try {
        parsed = queryInputSchema.parse(input);
        request = parsed.family === 'unlocated' ? parseUnlocatedQuery(parsed.request) : parseViewportQuery(parsed.request);
        if (parsed.family === 'unlocated' ? parsed.approvedScope === undefined || parsed.queryId === 'sourceCoverage' : parsed.approvedScope !== undefined) throw new Error();
        if (parsed.family === 'publicRecords' ? parsed.recordKeys === undefined || parsed.queryId === 'sourceCoverage' : parsed.recordKeys !== undefined) throw new Error();
      } catch { throw new MapQueryError('invalidRequest'); }
      if (parsed.queryId !== 'sourceCoverage' && !request.layers.includes(parsed.queryId)) {
        throw new MapQueryError('invalidRequest');
      }
      // T014 resolves public snapshot tokens into stored immutable result pages.
      // Re-running a mutable view with an old cursor would mix source revisions.
      if (request.cursor !== undefined || request.snapshotId !== undefined) {
        throw new MapQueryError('cursorMismatch');
      }
      const pageSize = Math.min(request.pageSize ?? config.maxPageItems, config.maxPageItems);
      const byteBudget = parsed.resultBudgetBytes ?? maximumResultBudget;
      if (byteBudget > maximumResultBudget) throw new MapQueryError('invalidRequest');
      if (execution.signal?.aborted) throw new MapQueryError('queryTimeout');

      if (parsed.queryId === 'rent' || parsed.queryId === 'census') {
        const filter = request.areaFilter;
        if (filter == null || options.validateIndicatorSelection === undefined) {
          throw new MapQueryError('notAvailable');
        }
        try {
          const valid = await withinDeadline(options.validateIndicatorSelection({
            layerId: parsed.queryId, filter,
          }), config.dryRunTimeoutMs, execution.signal);
          if (!valid) throw new MapQueryError('notAvailable');
        } catch (error) { throw safeQueryError(error); }
      }

      let query: ReturnType<typeof prepareViewQuery>;
      try { query = parsed.family === 'publicRecords'
        ? preparePublicRecordQuery({ queryId: parsed.queryId, request: request as ReturnType<typeof parseViewportQuery>,
          config, pageSize, recordKeys: parsed.recordKeys! })
        : parsed.family === 'unlocated'
        ? prepareUnlocatedQuery({ queryId: parsed.queryId, request: request as ReturnType<typeof parseUnlocatedQuery>,
          config, pageSize, approvedScope: parsed.approvedScope! })
        : prepareViewQuery({ queryId: parsed.queryId, request: request as ReturnType<typeof parseViewportQuery>, config, pageSize,
          ...(parsed.publicSourceIds === undefined ? {} : { publicSourceIds: parsed.publicSourceIds }) }); }
      catch { throw new MapQueryError('invalidRequest'); }
      if (execution.signal?.aborted) throw new MapQueryError('queryTimeout');
      try {
        const estimate = await withinDeadline(options.adapter.dryRun(query), config.dryRunTimeoutMs,
          execution.signal);
        if (typeof estimate.bytesProcessed !== 'bigint' || estimate.bytesProcessed < 0n) {
          throw new MapQueryError('serviceUnavailable');
        }
        if (estimate.bytesProcessed > BigInt(query.maximumBytesBilled)) {
          throw new MapQueryError('budgetExceeded');
        }
      } catch (error) { throw safeQueryError(error); }

      if (execution.signal?.aborted) throw new MapQueryError('queryTimeout');
      let job: AdapterQueryJob | null = null;
      let abandoned = false;
      try {
        const started = options.adapter.startQuery(query).then((created) => {
          if (abandoned) {
            void boundedCancel(created, config.cancelTimeoutMs);
            throw new MapQueryError('queryTimeout');
          }
          job = created;
          return created;
        });
        const page = await withinDeadline(started.then((created) => created.readPage({
          maxRows: pageSize + 1, timeoutMs: config.queryTimeoutMs,
        })), config.queryTimeoutMs, execution.signal);
        if (!page.complete) throw new MapQueryError('queryTimeout');
        return boundedRows(page.rows, { pageSize, byteBudget, hasMore: page.hasMore });
      } catch (error) {
        abandoned = true;
        if (job !== null) await boundedCancel(job, config.cancelTimeoutMs);
        throw safeQueryError(error);
      }
    },
  };
}
