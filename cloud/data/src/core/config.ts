import { z } from 'zod';

const projectIdSchema = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
const bucketSchema = z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/)
  .refine(value => !value.includes('..') && !value.includes('.-') && !value.includes('-.'),
    'Invalid bucket name');
const datasetSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,1023}$/);
const secretNameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);

const configSchema = z.object({
  GOOGLE_CLOUD_PROJECT: projectIdSchema,
  GCP_REGION: z.literal('australia-southeast2'),
  GCS_BUCKET: bucketSchema,
  BQ_INGEST_DATASET: datasetSchema,
  BQ_QUERY_DATASET: datasetSchema,
  BQ_MAXIMUM_BYTES_BILLED: z.string().refine(value =>
    /^[1-9][0-9]{0,18}$/.test(value)
      && BigInt(value) <= 9_223_372_036_854_775_807n).optional(),
  SECRET_NAMES: z.string().optional(),
});

export interface DataConfig {
  projectId: string;
  region: 'australia-southeast2';
  bucketName: string;
  ingestDataset: string;
  queryDataset: string;
  /** BigQuery query-job ceiling; load jobs are controlled separately. */
  maxBytesBilled?: string | null;
  /** Identifiers only. Secret values are never part of this configuration. */
  secretNames: readonly string[];
}

export class ConfigError extends Error {
  constructor(settingNames: readonly string[]) {
    super(`Missing or invalid configuration: ${settingNames.join(', ')}`);
    this.name = 'ConfigError';
  }
}

/** Parse only non-secret names. Errors mention setting names, never supplied values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DataConfig {
  const parsed = configSchema.safeParse({
    GOOGLE_CLOUD_PROJECT: env.GOOGLE_CLOUD_PROJECT,
    GCP_REGION: env.GCP_REGION,
    GCS_BUCKET: env.GCS_BUCKET,
    BQ_INGEST_DATASET: env.BQ_INGEST_DATASET,
    BQ_QUERY_DATASET: env.BQ_QUERY_DATASET,
    BQ_MAXIMUM_BYTES_BILLED: env.BQ_MAXIMUM_BYTES_BILLED,
    SECRET_NAMES: env.SECRET_NAMES,
  });
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map(issue => String(issue.path[0] ?? 'configuration')))];
    throw new ConfigError(names);
  }

  const secretNames = parsed.data.SECRET_NAMES
    ? parsed.data.SECRET_NAMES.split(',').map(value => value.trim()).filter(Boolean)
    : [];
  if (secretNames.some(name => !secretNameSchema.safeParse(name).success)) {
    throw new ConfigError(['SECRET_NAMES']);
  }
  if (new Set(secretNames).size !== secretNames.length) {
    throw new ConfigError(['SECRET_NAMES']);
  }

  return {
    projectId: parsed.data.GOOGLE_CLOUD_PROJECT,
    region: parsed.data.GCP_REGION,
    bucketName: parsed.data.GCS_BUCKET,
    ingestDataset: parsed.data.BQ_INGEST_DATASET,
    queryDataset: parsed.data.BQ_QUERY_DATASET,
    maxBytesBilled: parsed.data.BQ_MAXIMUM_BYTES_BILLED ?? null,
    secretNames,
  };
}
