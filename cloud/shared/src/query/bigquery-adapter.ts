import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';

import type { MapConfig } from '../config.js';

export interface PreparedViewQuery {
  readonly query: string;
  readonly params: Readonly<Record<string, string | number>>;
  readonly types: Readonly<Record<string, 'STRING' | 'FLOAT64' | 'INT64' | 'TIMESTAMP' | 'DATE'>>;
  readonly location: string;
  readonly maximumBytesBilled: string;
  readonly jobTimeoutMs: number;
}

export interface AdapterQueryPage {
  readonly rows: unknown;
  readonly complete: boolean;
  readonly hasMore: boolean;
}

export interface AdapterQueryJob {
  readPage(options: { readonly maxRows: number; readonly timeoutMs: number }): Promise<AdapterQueryPage>;
  cancel(): Promise<void>;
}

/** Narrow injection boundary: production uses ADC, deterministic tests never call GCP. */
export interface BigQueryViewAdapter {
  dryRun(query: PreparedViewQuery): Promise<{ readonly bytesProcessed: bigint }>;
  startQuery(query: PreparedViewQuery): Promise<AdapterQueryJob>;
}

const dryRunStatistics = z.object({ statistics: z.object({
  totalBytesProcessed: z.string().regex(/^\d+$/),
}) });

export function createBigQueryViewAdapter(config: MapConfig): BigQueryViewAdapter {
  const client = new BigQuery({ projectId: config.projectId, location: config.location });
  return {
    async dryRun(query) {
      const [job] = await client.createQueryJob({ ...query, useLegacySql: false,
        dryRun: true, useQueryCache: false });
      const metadata = dryRunStatistics.parse(job.metadata);
      return { bytesProcessed: BigInt(metadata.statistics.totalBytesProcessed) };
    },
    async startQuery(query) {
      const [job] = await client.createQueryJob({ ...query, useLegacySql: false,
        useQueryCache: false });
      return {
        async readPage(options) {
          const [rows, nextQuery, response] = await job.getQueryResults({
            autoPaginate: false, maxResults: options.maxRows, timeoutMs: options.timeoutMs,
          });
          return { rows, complete: response?.jobComplete === true,
            hasMore: nextQuery !== null && nextQuery !== undefined || Boolean(response?.pageToken) };
        },
        async cancel() { await job.cancel(); },
      };
    },
  };
}
