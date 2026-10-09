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

/**
 * The client serialises a parameter with an explicit TIMESTAMP or DATE type through its own
 * value wrapper (`BigQuery.timestamp`, `BigQuery.date`): given a plain string it reads
 * `value.value`, which is undefined, and the job runs with that parameter bound to NULL.
 * Every prepared query binds instants as ISO strings, so they are wrapped here, once, before
 * the job is created. Other types pass through unchanged.
 */
export function clientQueryParameters(query: Pick<PreparedViewQuery, 'params' | 'types'>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query.params).map(([name, value]) => {
    switch (query.types[name]) {
      case 'TIMESTAMP': return [name, BigQuery.timestamp(String(value))];
      case 'DATE': return [name, BigQuery.date(String(value))];
      default: return [name, value];
    }
  }));
}

export function createBigQueryViewAdapter(config: MapConfig): BigQueryViewAdapter {
  const client = new BigQuery({ projectId: config.projectId, location: config.location });
  return {
    async dryRun(query) {
      const [job] = await client.createQueryJob({ ...query, params: clientQueryParameters(query),
        useLegacySql: false, dryRun: true, useQueryCache: false });
      const metadata = dryRunStatistics.parse(job.metadata);
      return { bytesProcessed: BigInt(metadata.statistics.totalBytesProcessed) };
    },
    async startQuery(query) {
      const [job] = await client.createQueryJob({ ...query, params: clientQueryParameters(query),
        useLegacySql: false, useQueryCache: false });
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
