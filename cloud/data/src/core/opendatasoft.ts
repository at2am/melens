import { z } from 'zod';
import { HttpClient, type HttpResponse } from './http.js';

const pageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  results: z.array(z.unknown()),
});

const datasetMetadataSchema = z.object({
  metas: z.object({
    default: z.object({ data_processed: z.string() }),
  }),
});

export class OdsIncompleteWindow extends Error {
  readonly code = 'incomplete_window';

  constructor(readonly reason: string, readonly expectedCount: number | null = null) {
    super(`OpenDataSoft window incomplete: ${reason}`);
    this.name = 'OdsIncompleteWindow';
  }
}

export interface OdsQuery {
  portalUrl: string;
  datasetId: string;
  where?: string;
  select?: string;
  orderBy?: string;
  pageSize?: number;
  timeoutMs?: number;
  headers?: HeadersInit;
}

export interface OdsRecords {
  records: unknown[];
  totalCount: number;
  pageCount: number;
  fetchedAt: string;
  lastModified: string | null;
}

export interface OdsExportQuery extends Omit<OdsQuery, 'orderBy' | 'pageSize'> {
  format: 'csv' | 'parquet';
}

export type OdsExport = HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>;

function endpoint(query: Pick<OdsQuery, 'portalUrl' | 'datasetId'>, suffix: string): URL {
  const portal = new URL(query.portalUrl);
  if (portal.protocol !== 'https:' && portal.hostname !== 'localhost' && portal.hostname !== '127.0.0.1') {
    throw new TypeError('OpenDataSoft portal must use HTTPS');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(query.datasetId)) {
    throw new TypeError('OpenDataSoft datasetId contains unsupported characters');
  }
  return new URL(`/api/explore/v2.1/catalog/datasets/${query.datasetId}/${suffix}`, portal);
}

function withQueryParams(url: URL, query: Pick<OdsQuery, 'where' | 'select' | 'orderBy'>): URL {
  if (query.where) url.searchParams.set('where', query.where);
  if (query.select) url.searchParams.set('select', query.select);
  if (query.orderBy) url.searchParams.set('order_by', query.orderBy);
  return url;
}

export class OpenDataSoftClient {
  constructor(private readonly http = new HttpClient()) {}

  async fetchDatasetDataProcessed(query: Pick<OdsQuery, 'portalUrl' | 'datasetId'>): Promise<string> {
    const response = await this.http.getJson({ url: endpoint(query, '') });
    const metadata = datasetMetadataSchema.safeParse(response.body);
    if (!metadata.success) {
      throw new OdsIncompleteWindow('dataset metadata lacks data_processed');
    }
    const timestamp = new Date(metadata.data.metas.default.data_processed);
    if (!Number.isFinite(timestamp.getTime())) {
      throw new OdsIncompleteWindow('dataset metadata has invalid data_processed');
    }
    return timestamp.toISOString();
  }

  async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
    const pageSize = query.pageSize ?? 100;
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new TypeError('OpenDataSoft pageSize must be between 1 and 100');
    }

    const records: unknown[] = [];
    let expectedCount: number | null = null;
    let pageCount = 0;
    let fetchedAt = '';
    let lastModified: string | null = null;

    do {
      const offset = records.length;
      if (offset >= 9_999) {
        throw new OdsIncompleteWindow('records endpoint 10,000-row window limit; use export', expectedCount);
      }
      const limit = Math.min(pageSize, 9_999 - offset, expectedCount === null ? pageSize : expectedCount - offset);
      const url = withQueryParams(endpoint(query, 'records'), query);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      const response = await this.http.getJson({
        url,
        ...(query.headers === undefined ? {} : { headers: query.headers }),
        ...(query.timeoutMs === undefined ? {} : { timeoutMs: query.timeoutMs }),
      });
      const page = pageSchema.safeParse(response.body);
      if (!page.success) {
        throw new OdsIncompleteWindow('records response lacks a valid total_count/results envelope', expectedCount);
      }
      pageCount += 1;
      fetchedAt = response.fetchedAt;
      lastModified = response.lastModified ?? lastModified;
      if (expectedCount === null) {
        expectedCount = page.data.total_count;
        if (expectedCount > 9_999) {
          throw new OdsIncompleteWindow('records endpoint 10,000-row window limit; use export', expectedCount);
        }
        if (expectedCount > pageSize && !query.orderBy) {
          throw new OdsIncompleteWindow('stable orderBy is required for multi-page windows', expectedCount);
        }
      } else if (page.data.total_count !== expectedCount) {
        throw new OdsIncompleteWindow('total_count changed during pagination', expectedCount);
      }
      if (page.data.results.length > limit) {
        throw new OdsIncompleteWindow('page returned more results than requested', expectedCount);
      }
      if (page.data.results.length === 0 && records.length < expectedCount) {
        throw new OdsIncompleteWindow('upstream returned an empty page before total_count', expectedCount);
      }
      records.push(...page.data.results);
    } while (expectedCount !== null && records.length < expectedCount);

    if (expectedCount === null || records.length !== expectedCount) {
      throw new OdsIncompleteWindow('collected record count differs from total_count', expectedCount);
    }
    return { records, totalCount: expectedCount, pageCount, fetchedAt, lastModified };
  }

  async exportDataset(query: OdsExportQuery): Promise<OdsExport> {
    const url = withQueryParams(endpoint(query, `exports/${query.format}`), query);
    return this.http.getStream({
      url,
      ...(query.headers === undefined ? {} : { headers: query.headers }),
      timeoutMs: query.timeoutMs ?? 120_000,
    });
  }
}
