import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { SourceRecord } from '../core/types.js';

const utc = z.iso.datetime({ offset: false });
const optionalUtc = utc.nullable();
const nonEmpty = z.string().trim().min(1);

export const sourceRecordSchema: z.ZodType<SourceRecord> = z.object({
  batch_id: nonEmpty,
  source_id: nonEmpty,
  schema_version: z.number().int().positive(),
  fetched_at: utc,
  source_record_id: nonEmpty,
  version_id: nonEmpty,
  original_url: z.url().nullable(),
  raw_uri: z.string().regex(/^gs:\/\/[a-z0-9][a-z0-9._-]+\/.+/).nullable(),
  published_at: optionalUtc,
  observed_at: optionalUtc,
  first_accessible_at: optionalUtc,
  time_missing_reason: nonEmpty.nullable(),
  valid_from: optionalUtc,
  valid_to: optionalUtc,
  source_updated_at: optionalUtc,
  source_version_ordinal: z.number().int().nonnegative().nullable(),
  record_status: z.enum(['active', 'corrected', 'cancelled', 'withdrawn']),
  assertion_kind: z.enum(['observation', 'report', 'prediction', 'plan']),
  rights_status: z.enum(['verified_open', 'restricted', 'review_required']),
}).strict().superRefine((row, context) => {
  if (row.original_url === null && row.raw_uri === null) {
    context.addIssue({ code: 'custom', message: 'Original URL or retained raw URI is required', path: ['original_url'] });
  }
  if (row.published_at === null && row.observed_at === null && row.time_missing_reason === null) {
    context.addIssue({ code: 'custom', message: 'Missing source time needs a reason', path: ['time_missing_reason'] });
  }
  if (row.valid_from !== null && row.valid_to !== null && Date.parse(row.valid_to) < Date.parse(row.valid_from)) {
    context.addIssue({ code: 'custom', message: 'valid_to precedes valid_from', path: ['valid_to'] });
  }
  if (row.first_accessible_at !== null && Date.parse(row.first_accessible_at) > Date.parse(row.fetched_at)) {
    context.addIssue({ code: 'custom', message: 'First accessible time exceeds fetch time', path: ['first_accessible_at'] });
  }
});

export function parseSourceRecord(value: unknown): SourceRecord {
  return sourceRecordSchema.parse(value);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(object[key])}`).join(',')}}`;
}

/** Stable across repeated fetches and URL tracking parameters. */
export function sourceRecordId(input: {
  sourceId: string;
  nativeId: string | null;
  originalUrl: string | null;
  sourceTime: string | null;
}): string {
  const sourceId = nonEmpty.parse(input.sourceId);
  if (input.nativeId?.trim()) return `${sourceId}:${input.nativeId.trim()}`;
  if (!input.originalUrl || !input.sourceTime) {
    throw new Error('A native ID or original URL and source time is required');
  }
  const sourceTime = utc.parse(input.sourceTime);
  const url = new URL(input.originalUrl);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return `${sourceId}:${digest(`${url.href}\n${sourceTime}`).slice(0, 32)}`;
}

/** Upstream revision time and canonical content both contribute to a version. */
export function sourceVersionId(sourceUpdatedAt: string | null, content: unknown): string {
  if (sourceUpdatedAt !== null) utc.parse(sourceUpdatedAt);
  return digest(`${sourceUpdatedAt ?? 'no-upstream-time'}\n${canonicalValue(content)}`);
}
