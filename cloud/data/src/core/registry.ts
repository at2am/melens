import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

import { isConnector, type Connector } from './connector.js';
import type { AccessStatus, AdmissionEvidence, DataSource, LicenseStatus, SourceId } from './types.js';

const canonicalIdSchema = z.string().regex(/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/);
const nonEmpty = z.string().trim().min(1);
const utcTimestamp = z.iso.datetime({ offset: false });
const nullableUtcTimestamp = utcTimestamp.nullable();
const secretName = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);

const admissionSchema = z.object({
  dataset_url: z.url().optional(),
  native_record_key: nonEmpty.optional(),
  completeness_rule: nonEmpty.optional(),
  quota_requests_per_day: z.number().int().nonnegative().optional(),
  secret_names: z.array(secretName).optional(),
  allowed_fields: z.array(nonEmpty).optional(),
  raw_retention_days: z.number().int().nonnegative().optional(),
  staging_retention_days: z.number().int().nonnegative().optional(),
  license_evidence_url: z.url().optional(),
  reviewed_at: utcTimestamp.optional(),
}).optional();

const manifestSchema = z.object({
  source_id: canonicalIdSchema,
  legacy_ids: z.array(nonEmpty).default([]),
  provider: nonEmpty,
  dataset_title: nonEmpty,
  landing_url: z.url(),
  api_endpoint: z.url().optional(),
  topic: nonEmpty,
  scope: z.enum(['city', 'greater_melbourne', 'victoria', 'global']),
  coverage_area_refs: z.array(nonEmpty).optional(),
  coverage_from: nullableUtcTimestamp.optional(),
  coverage_to: nullableUtcTimestamp.optional(),
  cadence_seconds: z.number().int().positive().nullable(),
  check_interval_seconds: z.number().int().positive().nullable().optional(),
  requires_monitoring: z.boolean().optional(),
  admission_evidence: admissionSchema,
  connector_owner: nonEmpty.optional(),
  license_status: z.enum(['verified_open', 'restricted', 'review_required']),
  license_url: z.url().optional(),
  access_status: z.enum(['candidate', 'ready', 'active', 'paused']),
  record_granularity: nonEmpty,
  last_checked_at: nullableUtcTimestamp.optional(),
  last_success_at: nullableUtcTimestamp.optional(),
  last_source_update_at: nullableUtcTimestamp.optional(),
}).passthrough();

type Manifest = z.infer<typeof manifestSchema>;

export interface RegisteredSource {
  readonly dataSource: DataSource;
  readonly directory: string;
  readonly manifestPath: string;
  readonly entrypointPath: string;
}

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

function admissionFromManifest(manifest: Manifest): AdmissionEvidence {
  const admission = manifest.admission_evidence;
  const evidence: Omit<AdmissionEvidence, 'missing_requirements' | 'declared_license_status'> = {
    dataset_url: admission?.dataset_url ?? manifest.api_endpoint ?? null,
    native_record_key: admission?.native_record_key ?? null,
    completeness_rule: admission?.completeness_rule ?? null,
    quota_requests_per_day: admission?.quota_requests_per_day ?? null,
    secret_names: admission?.secret_names ?? [],
    allowed_fields: admission?.allowed_fields ?? null,
    raw_retention_days: admission?.raw_retention_days ?? null,
    staging_retention_days: admission?.staging_retention_days ?? null,
    license_evidence_url: admission?.license_evidence_url ?? manifest.license_url ?? null,
    reviewed_at: admission?.reviewed_at ?? null,
  };
  const missing = [
    ...(!evidence.dataset_url ? ['dataset_url'] : []),
    ...(!manifest.coverage_area_refs?.length ? ['coverage_area_refs'] : []),
    ...(!manifest.coverage_from ? ['coverage_from'] : []),
    ...(!evidence.native_record_key ? ['native_record_key'] : []),
    ...(!evidence.completeness_rule ? ['completeness_rule'] : []),
    ...(evidence.quota_requests_per_day === null ? ['quota_requests_per_day'] : []),
    ...(!evidence.allowed_fields?.length ? ['allowed_fields'] : []),
    ...(evidence.raw_retention_days === null ? ['raw_retention_days'] : []),
    ...(evidence.staging_retention_days === null ? ['staging_retention_days'] : []),
    ...(!evidence.license_evidence_url ? ['license_evidence_url'] : []),
    ...(!evidence.reviewed_at ? ['reviewed_at'] : []),
    ...(!manifest.connector_owner ? ['connector_owner'] : []),
    ...(manifest.requires_monitoring && manifest.cadence_seconds === null && manifest.check_interval_seconds == null
      ? ['check_interval_seconds'] : []),
  ];
  return {
    ...evidence,
    missing_requirements: missing,
    declared_license_status: manifest.license_status,
  };
}

export function parseSourceManifest(value: unknown): DataSource {
  const manifest = manifestSchema.parse(value);
  if (manifest.coverage_from && manifest.coverage_to
    && Date.parse(manifest.coverage_from) > Date.parse(manifest.coverage_to)) {
    throw new RegistryError('Invalid coverage time range');
  }
  const evidence = admissionFromManifest(manifest);
  const licenseStatus: LicenseStatus = evidence.missing_requirements.length > 0
    ? 'review_required' : manifest.license_status;
  const accessStatus: AccessStatus = licenseStatus === 'review_required'
    && (manifest.access_status === 'ready' || manifest.access_status === 'active')
    ? 'candidate' : manifest.access_status;

  return {
    source_id: manifest.source_id,
    legacy_ids: manifest.legacy_ids,
    provider: manifest.provider,
    dataset_title: manifest.dataset_title,
    landing_url: manifest.landing_url,
    topic: manifest.topic,
    scope: manifest.scope,
    coverage_area_refs: manifest.coverage_area_refs ?? [],
    coverage_from: manifest.coverage_from ?? null,
    coverage_to: manifest.coverage_to ?? null,
    cadence_seconds: manifest.cadence_seconds,
    check_interval_seconds: manifest.check_interval_seconds ?? null,
    admission_evidence: evidence,
    connector_owner: manifest.connector_owner ?? null,
    license_status: licenseStatus,
    access_status: accessStatus,
    last_checked_at: manifest.last_checked_at ?? null,
    last_success_at: manifest.last_success_at ?? null,
    last_source_update_at: manifest.last_source_update_at ?? null,
    record_granularity: manifest.record_granularity,
  };
}

async function entrypointFor(directory: string): Promise<string> {
  for (const filename of ['index.js', 'index.ts']) {
    const path = join(directory, filename);
    try {
      await access(path);
      return path;
    } catch {
      // The other build format may exist.
    }
  }
  throw new RegistryError(`Missing connector entrypoint in ${directory}`);
}

export class SourceRegistry {
  readonly #byCanonicalId: ReadonlyMap<string, RegisteredSource>;
  readonly #aliasToCanonicalId: ReadonlyMap<string, string>;

  constructor(entries: readonly RegisteredSource[]) {
    const byCanonicalId = new Map<string, RegisteredSource>();
    const aliasToCanonicalId = new Map<string, string>();
    for (const entry of entries) {
      const id = entry.dataSource.source_id;
      if (byCanonicalId.has(id)) throw new RegistryError(`Duplicate source_id: ${id}`);
      byCanonicalId.set(id, entry);
    }
    for (const entry of entries) {
      const id = entry.dataSource.source_id;
      for (const alias of entry.dataSource.legacy_ids) {
        if (alias === id || byCanonicalId.has(alias) || aliasToCanonicalId.has(alias)) {
          throw new RegistryError(`Legacy ID is duplicate or canonical: ${alias}`);
        }
        aliasToCanonicalId.set(alias, id);
      }
    }
    this.#byCanonicalId = byCanonicalId;
    this.#aliasToCanonicalId = aliasToCanonicalId;
  }

  list(): readonly RegisteredSource[] {
    return [...this.#byCanonicalId.values()];
  }

  resolveId(sourceIdOrAlias: string): SourceId | null {
    if (this.#byCanonicalId.has(sourceIdOrAlias)) return sourceIdOrAlias;
    return this.#aliasToCanonicalId.get(sourceIdOrAlias) ?? null;
  }

  get(sourceIdOrAlias: string): RegisteredSource | null {
    const canonical = this.resolveId(sourceIdOrAlias);
    return canonical ? this.#byCanonicalId.get(canonical) ?? null : null;
  }

  active(): readonly RegisteredSource[] {
    return this.list().filter(entry => entry.dataSource.access_status === 'active'
      && entry.dataSource.license_status !== 'review_required');
  }
}

/** Discover each source's own manifest and entrypoint; no central import list. */
export async function loadSourceRegistry(connectorsRoot: string): Promise<SourceRegistry> {
  const directories = await readdir(connectorsRoot, { withFileTypes: true });
  const entries: RegisteredSource[] = [];
  for (const item of directories.filter(item => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(connectorsRoot, item.name);
    const manifestPath = join(directory, 'source.json');
    let value: unknown;
    try {
      value = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch {
      throw new RegistryError(`Cannot read or parse source manifest: ${manifestPath}`);
    }
    let dataSource: DataSource;
    try {
      dataSource = parseSourceManifest(value);
    } catch (error) {
      const fields = error instanceof z.ZodError
        ? error.issues.map(issue => issue.path.join('.')).join(', ')
        : error instanceof RegistryError ? error.message : 'unknown';
      throw new RegistryError(`Invalid source manifest ${manifestPath}: ${fields}`);
    }
    entries.push({
      dataSource,
      directory,
      manifestPath,
      entrypointPath: await entrypointFor(directory),
    });
  }
  return new SourceRegistry(entries);
}

/** Load only modules exposing the frozen Connector interface. Legacy modules need an adapter. */
export async function loadConnector(entry: RegisteredSource): Promise<Connector> {
  const imported: unknown = await import(pathToFileURL(entry.entrypointPath).href);
  if (typeof imported !== 'object' || imported === null) {
    throw new RegistryError(`Connector module has no exports: ${entry.dataSource.source_id}`);
  }
  const candidate = 'connector' in imported ? imported.connector
    : 'default' in imported ? imported.default : null;
  if (!isConnector(candidate) || candidate.sourceId !== entry.dataSource.source_id) {
    throw new RegistryError(`Connector does not implement the shared interface: ${entry.dataSource.source_id}`);
  }
  return candidate;
}
