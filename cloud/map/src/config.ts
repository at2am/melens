import { z } from 'zod';

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const configSchema = z.strictObject({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  location: z.string().regex(/^[a-z]+(?:-[a-z0-9]+)*$/),
  queryDataset: z.literal('melens_query'),
  dynamicScanBytes: positiveInteger,
  historicalScanBytes: positiveInteger,
  queryTimeoutMs: positiveInteger.max(30_000),
  dryRunTimeoutMs: positiveInteger.max(30_000),
  cancelTimeoutMs: positiveInteger.max(5_000),
  maxPageItems: positiveInteger.max(1_000),
  maxResponseBytes: positiveInteger.max(2 * 1024 * 1024),
  responseEnvelopeReserveBytes: positiveInteger,
}).refine((config) => config.responseEnvelopeReserveBytes + 2 < config.maxResponseBytes, {
  path: ['responseEnvelopeReserveBytes'], message: 'Envelope reserve must leave a result budget',
});

export type MapConfig = Readonly<z.infer<typeof configSchema>>;

export class MapConfigurationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid map query configuration: ${fields.join(', ')}`);
    this.name = 'MapConfigurationError';
  }
}

export function validateMapConfig(value: unknown): MapConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    throw new MapConfigurationError([...new Set(parsed.error.issues.map((issue) =>
      issue.path.join('.') || 'configuration'))]);
  }
  return Object.freeze(parsed.data);
}

function integerSetting(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Credentials come from ADC; this configuration never accepts credential contents. */
export function loadMapConfig(env: Readonly<Record<string, string | undefined>> = process.env): MapConfig {
  return validateMapConfig({
    projectId: env.MAP_PROJECT_ID,
    location: env.MAP_BQ_LOCATION ?? 'australia-southeast2',
    queryDataset: env.MAP_QUERY_DATASET ?? 'melens_query',
    dynamicScanBytes: integerSetting(env.MAP_DYNAMIC_SCAN_BYTES, 100_000_000),
    historicalScanBytes: integerSetting(env.MAP_HISTORICAL_SCAN_BYTES, 500_000_000),
    queryTimeoutMs: integerSetting(env.MAP_QUERY_TIMEOUT_MS, 10_000),
    dryRunTimeoutMs: integerSetting(env.MAP_DRY_RUN_TIMEOUT_MS, 5_000),
    cancelTimeoutMs: integerSetting(env.MAP_CANCEL_TIMEOUT_MS, 1_000),
    maxPageItems: integerSetting(env.MAP_MAX_PAGE_ITEMS, 1_000),
    maxResponseBytes: integerSetting(env.MAP_MAX_RESPONSE_BYTES, 2 * 1024 * 1024),
    responseEnvelopeReserveBytes: integerSetting(env.MAP_RESPONSE_ENVELOPE_RESERVE_BYTES, 64 * 1024),
  });
}
