import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { BigQuery } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { z } from 'zod';

import {
  type CensusPayload,
  normalizeCensusPayload,
} from '../../src/connectors/abs_census/index.js';
import {
  type ClueEmploymentRawRow,
  normalizeClueEmploymentRow,
} from '../../src/connectors/com_clue_employment/index.js';
import {
  normalizeDevelopmentRecord,
  normalizeDevelopmentStatus,
  type ComDevelopmentMonitorRawRecord,
  type DevelopmentStatus,
} from '../../src/connectors/com_development_monitor/index.js';
import type { CsaSuccess } from '../../src/connectors/csa_recorded_offences/index.js';
import {
  type HomesVictoriaPayload,
  type HomesVictoriaRentRawRecord,
  normalizeRentalPayload,
} from '../../src/connectors/homes_victoria_rents/index.js';
import {
  layers as vicmapLayers,
  normalizePlanningControl,
  type Layer as VicmapLayer,
} from '../../src/connectors/vicmap_planning/index.js';
import type { DataConfig } from '../../src/core/config.js';
import type { ConnectorSuccess } from '../../src/core/connector.js';
import { GcsStore } from '../../src/core/gcs.js';
import { BigQueryPublisher } from '../../src/core/publisher.js';
import type {
  AdmissionEvidence,
  AreaIndicator,
  AssertionKind,
  Boundary,
  DataSource,
  GeoRecord,
  SourceRecord,
  SyncBatch,
  SyncBatchState,
  UtcTimestamp,
} from '../../src/core/types.js';
import {
  areaNameKey,
  assertComparableIndicators,
  enforceAreaIndicatorInvariants,
  normalizeAbsCensusStatistics,
  normalizeAreaIndicators,
  normalizeClueEmploymentStatistics,
  normalizeCsaStatistics,
  normalizeHomesVictoriaRents,
  normalizeHomesVictoriaStatistics,
  type AreaBoundaryEvidence,
} from '../../src/normalization/area-indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ----------------------------------------------------------------------------
// Fixture loaders
// ----------------------------------------------------------------------------
async function loadAbsFixture(): Promise<CensusPayload> {
  const content = await readFile(join(__dirname, '../fixtures/abs_census.json'), 'utf8');
  return JSON.parse(content) as CensusPayload;
}

async function loadClueFixture(): Promise<ClueEmploymentRawRow[]> {
  const content = await readFile(join(__dirname, '../fixtures/com_clue_employment.json'), 'utf8');
  return JSON.parse(content) as ClueEmploymentRawRow[];
}

async function loadRentsFixture(): Promise<HomesVictoriaPayload> {
  const content = await readFile(join(__dirname, '../fixtures/homes_victoria_rents.json'), 'utf8');
  return JSON.parse(content) as HomesVictoriaPayload;
}

async function loadVicmapFixture(): Promise<{
  overlay: { collection: { features: unknown[] } };
  zone: { collection: { features: unknown[] } };
}> {
  const content = await readFile(join(__dirname, '../fixtures/vicmap_planning.json'), 'utf8');
  return JSON.parse(content);
}

async function loadDevMonitorFixture(): Promise<{
  total_count: number;
  results: ComDevelopmentMonitorRawRecord[];
}> {
  const content = await readFile(join(__dirname, '../fixtures/com_development_monitor.json'), 'utf8');
  return JSON.parse(content);
}

async function readSql(name: string): Promise<string> {
  try {
    return await readFile(new URL(`../../../sql/${name}`, import.meta.url), 'utf8');
  } catch {
    return await readFile(new URL(`../../sql/${name}`, import.meta.url), 'utf8');
  }
}

function makeCsaFixture(stats: {
  lgaName: string;
  lgaCode: string | null;
  count: number | null;
  ratePer100k: number | null;
  status: 'observed' | 'suppressed' | 'missing';
  periodStart: string;
  periodEnd: string;
  yearEnding: number;
}[]): CsaSuccess {
  return {
    kind: 'success',
    sourceId: 'victoria.csa.recorded_offences',
    runId: 'csa-test-run',
    fetchedAt: '2026-09-28T00:00:00Z',
    sourceRevision: '2026-Q2',
    sourceLatestUpdateAt: null,
    checkpointAfter: '2026-Q2',
    completeness: {
      complete: true,
      method: 'export_count',
      expected_records: stats.length,
      fetched_records: stats.length,
      expected_pages: 1,
      fetched_pages: 1,
      evidence: 'fixture',
    },
    inputCount: stats.length,
    outputCount: stats.length,
    rejectedCount: 0,
    sourceRecords: stats.map((s, idx) => ({
      batch_id: 'csa-test-run',
      source_id: 'victoria.csa.recorded_offences',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
      source_record_id: `csa:rec:${idx + 1}`,
      version_id: `v${idx + 1}`,
      original_url: 'https://www.crimestatistics.vic.gov.au',
      raw_uri: null,
      published_at: '2026-09-15T00:00:00Z',
      observed_at: s.periodEnd,
      first_accessible_at: null,
      time_missing_reason: null,
      valid_from: s.periodStart,
      valid_to: s.periodEnd,
      source_updated_at: '2026-09-15T00:00:00Z',
      source_version_ordinal: null,
      record_status: 'active',
      assertion_kind: 'observation',
      rights_status: 'verified_open',
    })),
    geoRecords: [],
    geoRecordSources: [],
    boundaries: [],
    areaIndicators: [],
    parkingBays: [],
    parkingObservations: [],
    parkingRules: [],
    sensorLocations: [],
    pedestrianObservations: [],
    retainableRawRecords: null,
    statistics: stats.map((s, idx) => ({
      status: s.status,
      count: s.status === 'observed' ? s.count : null,
      sourceMarker: s.status === 'suppressed' ? '*' : null,
      sourceRecordId: `csa:rec:${idx + 1}`,
      versionId: `v${idx + 1}`,
      lgaName: s.lgaName,
      lgaCode: s.lgaCode,
      periodStart: s.periodStart,
      periodEndExclusive: s.periodEnd,
      yearEnding: s.yearEnding,
      monthEnding: 'June',
      ratePer100k: s.status === 'observed' ? s.ratePer100k : null,
      statisticalDefinition: 'rolling_12_month_offence_count',
      releaseDate: '2026-09-15',
    })),
  } as CsaSuccess;
}

// ----------------------------------------------------------------------------
// Official Boundary Evidence Catalog
// ----------------------------------------------------------------------------
const boundaryEvidence2016: AreaBoundaryEvidence = {
  sourceAreaVintage: '2016',
  boundaries: [
    {
      boundary_id: 'ASGS_SA2:206041122:2016',
      scheme: 'ASGS_SA2',
      code: '206041122',
      name: 'Melbourne',
      vintage: '2016',
    },
  ],
};

const boundaryEvidence2021: AreaBoundaryEvidence = {
  sourceAreaVintage: '2021',
  boundaries: [
    {
      boundary_id: 'ASGS_SA2:206041122:2021',
      scheme: 'ASGS_SA2',
      code: '206041122',
      name: 'Melbourne',
      vintage: '2021',
    },
    {
      boundary_id: 'ASGS_SA2:206041125:2021',
      scheme: 'ASGS_SA2',
      code: '206041125',
      name: 'Southbank',
      vintage: '2021',
    },
    {
      boundary_id: 'ASGS_SA2:206041117:2021',
      scheme: 'ASGS_SA2',
      code: '206041117',
      name: 'Carlton',
      vintage: '2021',
    },
    {
      boundary_id: 'ASGS_LGA:24600:2021',
      scheme: 'ASGS_LGA',
      code: '24600',
      name: 'Melbourne',
      vintage: '2021',
    },
    {
      boundary_id: 'ASGS_LGA:27350:2021',
      scheme: 'ASGS_LGA',
      code: '27350',
      name: 'Yarra',
      vintage: '2021',
    },
  ],
};

const boundaryEvidence2024: AreaBoundaryEvidence = {
  sourceAreaVintage: '2024',
  boundaries: [
    {
      boundary_id: 'com_clue_block:17:2024',
      scheme: 'com_clue_block',
      code: '17',
      name: 'Block 17 (CBD)',
      vintage: '2024',
    },
    {
      boundary_id: 'com_clue_block:21:2024',
      scheme: 'com_clue_block',
      code: '21',
      name: 'Block 21 (CBD)',
      vintage: '2024',
    },
  ],
};

const boundaryEvidence2025: AreaBoundaryEvidence = {
  sourceAreaVintage: '2025',
  boundaries: [
    {
      boundary_id: 'ASGS_LGA:24600:2025',
      scheme: 'ASGS_LGA',
      code: '24600',
      name: 'Melbourne',
      vintage: '2025',
    },
    {
      boundary_id: 'ASGS_LGA:27350:2025',
      scheme: 'ASGS_LGA',
      code: '27350',
      name: 'Yarra',
      vintage: '2025',
    },
    {
      boundary_id: 'VIC_SUBURB:carlton:2025',
      scheme: 'VIC_SUBURB',
      code: 'carlton',
      name: 'Carlton',
      vintage: '2025',
    },
    {
      boundary_id: 'VIC_SUBURB:southbank:2025',
      scheme: 'VIC_SUBURB',
      code: 'southbank',
      name: 'Southbank',
      vintage: '2025',
    },
  ],
};

// ----------------------------------------------------------------------------
// Canonical BigQuery View Query & Consumption Gate (matches sql/006_area_views.sql)
// ----------------------------------------------------------------------------
export interface ViewAreaIndicatorRow {
  indicator_id: string;
  version_id: string;
  boundary_id: string;
  boundary_scheme?: string | null;
  boundary_code?: string | null;
  boundary_name?: string | null;
  boundary_vintage?: string | null;
  boundary_mapping_status: 'matched' | 'missing';
  period_start: UtcTimestamp;
  period_end: UtcTimestamp;
  value: number | null;
  unit: string;
  status: 'observed' | 'suppressed' | 'missing';
  assertion_kind: AssertionKind;
  is_prediction: boolean;
  definition: string;
  source_area_name?: string | null;
  source_area_code?: string | null;
  source_area_vintage?: string | null;
  source_record_id: string;
  source_id: string;
  batch_id: string;
  fetched_at: UtcTimestamp;
}

export interface AreaIndicatorQueryContext {
  batches: readonly SyncBatch[];
  sources: readonly DataSource[];
  sourceRecords: readonly SourceRecord[];
  knownBoundaries?: readonly (Pick<Boundary, 'boundary_id'> & Partial<Pick<Boundary, 'scheme' | 'code' | 'name' | 'vintage'>>)[];
}

/**
 * In-memory simulation double for offline unit test projections.
 * Exercises local helper projection logic simulating `melens_query.v_area_indicators` (sql/006_area_views.sql).
 * Real SQL consumption gate verification is executed via in-memory SQLite (Section 6b)
 * and GoogleSQL BigQuery in GCP (Section 7).
 */
export function queryViewAreaIndicators(
  indicators: readonly AreaIndicator[],
  context: AreaIndicatorQueryContext,
): ViewAreaIndicatorRow[] {
  // 1. batches CTE: QUALIFY ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC) = 1
  const batchMap = new Map<string, SyncBatch>();
  for (const b of context.batches) {
    const existing = batchMap.get(b.batch_id);
    if (!existing) {
      batchMap.set(b.batch_id, b);
    } else {
      const cmp = Date.parse(b.state_updated_at) - Date.parse(existing.state_updated_at)
        || Date.parse(b.started_at) - Date.parse(existing.started_at);
      if (cmp > 0) batchMap.set(b.batch_id, b);
    }
  }

  // 2. sources CTE: QUALIFY ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) = 1
  const sourceMap = new Map<string, DataSource>();
  for (const s of context.sources) {
    const existing = sourceMap.get(s.source_id);
    const timeS = ((s as unknown as Record<string, unknown>).updated_at as string | undefined) ?? s.last_checked_at ?? s.last_success_at ?? '';
    const timeExisting = existing ? (((existing as unknown as Record<string, unknown>).updated_at as string | undefined) ?? existing.last_checked_at ?? existing.last_success_at ?? '') : '';
    if (!existing || Date.parse(timeS) > Date.parse(timeExisting)) {
      sourceMap.set(s.source_id, s);
    }
  }

  // 3. source_records filter: sr.batch_id = i.batch_id AND sr.source_id = i.source_id AND sr.source_record_id = i.source_record_id AND sr.rights_status IN ('verified_open', 'restricted')
  const validSourceRecordKeys = new Set<string>();
  for (const sr of context.sourceRecords) {
    if (['verified_open', 'restricted'].includes(sr.rights_status)) {
      validSourceRecordKeys.add(`${sr.batch_id}::${sr.source_id}::${sr.source_record_id}`);
    }
  }

  // 4. eligible CTE
  const eligible: AreaIndicator[] = [];
  for (const ind of indicators) {
    if (!ind.source_record_id || ind.source_record_id.trim() === '') continue;

    const batch = batchMap.get(ind.batch_id);
    if (!batch || batch.source_id !== ind.source_id) continue;
    if (batch.state !== 'published' || !batch.published_at) continue;

    const source = sourceMap.get(ind.source_id);
    if (!source) continue;
    if (source.access_status !== 'active') continue;
    if (!['verified_open', 'restricted'].includes(source.license_status)) continue;

    const srKey = `${ind.batch_id}::${ind.source_id}::${ind.source_record_id}`;
    if (!validSourceRecordKeys.has(srKey)) continue;

    eligible.push(ind);
  }

  // 5. QUALIFY ROW_NUMBER() OVER (PARTITION BY indicator_id, boundary_id, period_start, period_end ORDER BY source_updated_at DESC NULLS LAST, source_version_ordinal DESC NULLS LAST, version_id DESC) = 1
  const partitionMap = new Map<string, AreaIndicator[]>();
  for (const ind of eligible) {
    const partKey = `${ind.indicator_id}::${ind.boundary_id}::${ind.period_start}::${ind.period_end}`;
    const list = partitionMap.get(partKey) ?? [];
    list.push(ind);
    partitionMap.set(partKey, list);
  }

  const deduped: AreaIndicator[] = [];
  for (const list of partitionMap.values()) {
    list.sort((a, b) => {
      // source_updated_at DESC NULLS LAST
      const timeA = a.source_updated_at ? Date.parse(a.source_updated_at) : null;
      const timeB = b.source_updated_at ? Date.parse(b.source_updated_at) : null;
      const validA = timeA !== null && !isNaN(timeA);
      const validB = timeB !== null && !isNaN(timeB);
      if (validA && validB) {
        if (timeA !== timeB) return timeB - timeA;
      } else if (validA && !validB) {
        return -1;
      } else if (!validA && validB) {
        return 1;
      }

      // source_version_ordinal DESC NULLS LAST
      const ordA = a.source_version_ordinal;
      const ordB = b.source_version_ordinal;
      const validOrdA = typeof ordA === 'number' && !isNaN(ordA);
      const validOrdB = typeof ordB === 'number' && !isNaN(ordB);
      if (validOrdA && validOrdB) {
        if (ordA !== ordB) return ordB - ordA;
      } else if (validOrdA && !validOrdB) {
        return -1;
      } else if (!validOrdA && validOrdB) {
        return 1;
      }

      // version_id DESC
      return (b.version_id ?? '').localeCompare(a.version_id ?? '');
    });

    if (list[0]) deduped.push(list[0]);
  }

  // 6. LEFT JOIN v_boundaries
  const boundaryMap = new Map(
    (context.knownBoundaries ?? []).map((b) => [b.boundary_id, b]),
  );

  return deduped.map((ind): ViewAreaIndicatorRow => {
    const boundary = boundaryMap.get(ind.boundary_id);
    return {
      indicator_id: ind.indicator_id,
      version_id: ind.version_id,
      boundary_id: ind.boundary_id,
      boundary_scheme: boundary?.scheme ?? null,
      boundary_code: boundary?.code ?? null,
      boundary_name: boundary?.name ?? null,
      boundary_vintage: boundary?.vintage ?? null,
      boundary_mapping_status: boundary ? 'matched' : 'missing',
      period_start: ind.period_start,
      period_end: ind.period_end,
      value: ind.status === 'observed' ? ind.value : null,
      unit: ind.unit,
      status: ind.status,
      assertion_kind: ind.assertion_kind,
      is_prediction: ind.assertion_kind === 'prediction',
      definition: ind.definition,
      source_area_name: ind.source_area_name ?? null,
      source_area_code: ind.source_area_code ?? null,
      source_area_vintage: ind.source_area_vintage ?? null,
      source_record_id: ind.source_record_id,
      source_id: ind.source_id,
      batch_id: ind.batch_id,
      fetched_at: ind.fetched_at,
    };
  });
}

const defaultAdmissionEvidence: AdmissionEvidence = {
  dataset_url: 'https://example.vic.gov.au',
  native_record_key: 'id',
  completeness_rule: 'export_count',
  quota_requests_per_day: null,
  secret_names: [],
  allowed_fields: null,
  raw_retention_days: null,
  staging_retention_days: null,
  license_evidence_url: 'https://example.vic.gov.au/license',
  reviewed_at: '2026-09-28T00:00:00Z',
  missing_requirements: [],
  declared_license_status: 'verified_open',
};

function makeAdmittedSource(sourceId: string, overrides: Partial<DataSource> = {}): DataSource {
  return {
    source_id: sourceId,
    legacy_ids: [],
    provider: 'Official Publisher',
    dataset_title: `Dataset for ${sourceId}`,
    landing_url: 'https://example.vic.gov.au',
    topic: 'census',
    scope: 'greater_melbourne',
    coverage_area_refs: [],
    coverage_from: null,
    coverage_to: null,
    cadence_seconds: null,
    check_interval_seconds: 3600,
    record_granularity: 'observation',
    admission_evidence: defaultAdmissionEvidence,
    connector_owner: 'integrator',
    license_status: 'verified_open',
    access_status: 'active',
    last_checked_at: '2026-09-28T00:00:00Z',
    last_success_at: '2026-09-28T00:00:00Z',
    last_source_update_at: '2026-09-28T00:00:00Z',
    ...overrides,
  };
}

function makePublishedBatch(batchId: string, sourceId: string, overrides: Partial<SyncBatch> = {}): SyncBatch {
  return {
    batch_id: batchId,
    source_id: sourceId,
    window_from: '2026-01-01T00:00:00Z',
    window_to: '2026-09-28T00:00:00Z',
    source_revision: 'rev-1',
    started_at: '2026-09-28T00:00:00Z',
    finished_at: '2026-09-28T00:01:00Z',
    state: 'published',
    state_updated_at: '2026-09-28T00:01:00Z',
    raw_uri: null,
    staging_uris: [],
    published_at: '2026-09-28T00:01:00Z',
    input_count: 10,
    output_count: 10,
    rejected_count: 0,
    checkpoint_before: null,
    checkpoint_after: '2026-09-28T00:00:00Z',
    error_code: null,
    schema_version: 1,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Local In-Memory SQLite Database & Real SQL Consumption Gate Setup
// ----------------------------------------------------------------------------
function createSqliteAreaDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sync_batches (
      batch_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      window_from TEXT,
      window_to TEXT,
      source_revision TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      state TEXT NOT NULL,
      state_updated_at TEXT NOT NULL,
      published_at TEXT
    );

    CREATE TABLE data_sources (
      source_id TEXT NOT NULL,
      license_status TEXT NOT NULL,
      access_status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE source_records (
      source_record_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      source_updated_at TEXT,
      source_version_ordinal INTEGER,
      rights_status TEXT NOT NULL
    );

    CREATE TABLE boundaries (
      boundary_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      scheme TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      vintage TEXT NOT NULL,
      geometry_geojson TEXT,
      valid_from TEXT,
      valid_to TEXT,
      source_record_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      fetched_at TEXT NOT NULL
    );

    CREATE TABLE area_indicators (
      indicator_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      boundary_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      value REAL,
      unit TEXT NOT NULL,
      status TEXT NOT NULL,
      assertion_kind TEXT NOT NULL,
      definition TEXT,
      source_area_name TEXT,
      source_area_code TEXT,
      source_area_vintage TEXT,
      source_record_id TEXT NOT NULL,
      batch_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      fetched_at TEXT NOT NULL,
      source_updated_at TEXT,
      source_version_ordinal INTEGER
    );

    CREATE VIEW v_boundaries AS
    WITH ranked_batches AS (
      SELECT batch_id, source_id, state, published_at,
             ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC) AS rn
      FROM sync_batches
    ),
    batches AS (
      SELECT batch_id, source_id, state, published_at FROM ranked_batches WHERE rn = 1
    ),
    ranked_sources AS (
      SELECT source_id, license_status, access_status,
             ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) AS rn
      FROM data_sources
    ),
    sources AS (
      SELECT source_id, license_status, access_status FROM ranked_sources WHERE rn = 1
    ),
    boundary_versions AS (
      SELECT b.boundary_id, b.version_id, b.scheme, b.code, b.name,
             b.vintage, b.geometry_geojson,
             b.valid_from, b.valid_to, b.source_record_id,
             b.source_id, b.batch_id, b.fetched_at,
             sr.source_updated_at, sr.source_version_ordinal,
             ROW_NUMBER() OVER (PARTITION BY b.boundary_id, b.version_id
               ORDER BY batch.published_at DESC, b.fetched_at DESC, b.batch_id DESC) AS rn
      FROM boundaries AS b
      JOIN batches AS batch ON b.batch_id = batch.batch_id AND b.source_id = batch.source_id
      JOIN sources AS s ON b.source_id = s.source_id
      JOIN source_records AS sr ON sr.batch_id = b.batch_id AND sr.source_id = b.source_id
        AND sr.source_record_id = b.source_record_id AND sr.version_id = b.version_id
      WHERE batch.state = 'published' AND batch.published_at IS NOT NULL
        AND s.license_status IN ('verified_open', 'restricted')
        AND s.access_status = 'active'
        AND sr.rights_status IN ('verified_open', 'restricted')
    ),
    eligible AS (SELECT * FROM boundary_versions WHERE rn = 1),
    orderable AS (
      SELECT boundary_id FROM eligible GROUP BY boundary_id
      HAVING COUNT(*) = 1
        OR (SUM(source_updated_at IS NULL) = 0
          AND COUNT(DISTINCT COALESCE(source_updated_at, 'null') || ':' || COALESCE(source_version_ordinal, 'null')) = COUNT(*))
        OR (SUM(source_updated_at IS NOT NULL) = 0
          AND SUM(source_version_ordinal IS NULL) = 0
          AND COUNT(DISTINCT source_version_ordinal) = COUNT(*))
    ),
    ranked_boundaries AS (
      SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.boundary_id
        ORDER BY e.source_updated_at DESC NULLS LAST,
          e.source_version_ordinal DESC NULLS LAST) AS version_rank
      FROM eligible AS e JOIN orderable USING (boundary_id)
    )
    SELECT boundary_id, version_id, scheme, code, name, vintage, geometry_geojson,
           valid_from, valid_to, source_record_id, source_id, batch_id, fetched_at
    FROM ranked_boundaries WHERE version_rank = 1;

    CREATE VIEW v_area_indicators AS
    WITH ranked_batches AS (
      SELECT batch_id, source_id, state, published_at,
             ROW_NUMBER() OVER (PARTITION BY batch_id ORDER BY state_updated_at DESC, started_at DESC) AS rn
      FROM sync_batches
    ),
    batches AS (
      SELECT batch_id, source_id, state, published_at FROM ranked_batches WHERE rn = 1
    ),
    ranked_sources AS (
      SELECT source_id, license_status, access_status,
             ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY updated_at DESC) AS rn
      FROM data_sources
    ),
    sources AS (
      SELECT source_id, license_status, access_status FROM ranked_sources WHERE rn = 1
    ),
    ranked_eligible AS (
      SELECT i.*,
             ROW_NUMBER() OVER (
               PARTITION BY i.indicator_id, i.boundary_id, i.period_start, i.period_end
               ORDER BY i.source_updated_at DESC NULLS LAST,
                        i.source_version_ordinal DESC NULLS LAST,
                        i.version_id DESC
             ) AS rn
      FROM area_indicators AS i
      JOIN batches AS b ON i.batch_id = b.batch_id AND i.source_id = b.source_id
      JOIN sources AS s ON i.source_id = s.source_id
      WHERE b.state = 'published' AND b.published_at IS NOT NULL
        AND s.license_status IN ('verified_open', 'restricted')
        AND s.access_status = 'active'
        AND EXISTS (
          SELECT 1
          FROM source_records AS sr
          WHERE sr.batch_id = i.batch_id
            AND sr.source_id = i.source_id
            AND sr.source_record_id = i.source_record_id
            AND sr.rights_status IN ('verified_open', 'restricted')
        )
    ),
    eligible AS (
      SELECT * FROM ranked_eligible WHERE rn = 1
    )
    SELECT i.indicator_id, i.version_id, i.boundary_id,
           b.scheme AS boundary_scheme, b.code AS boundary_code,
           b.name AS boundary_name, b.vintage AS boundary_vintage,
           CASE WHEN b.boundary_id IS NULL THEN 'missing' ELSE 'matched' END AS boundary_mapping_status,
           i.period_start, i.period_end,
           CASE WHEN i.status = 'observed' THEN i.value ELSE NULL END AS value,
           i.unit, i.status, i.assertion_kind,
           CASE WHEN i.assertion_kind = 'prediction' THEN 1 ELSE 0 END AS is_prediction,
           i.definition, i.source_area_name, i.source_area_code,
           i.source_area_vintage, i.source_record_id, i.source_id,
           i.batch_id, i.fetched_at
    FROM eligible AS i
    LEFT JOIN v_boundaries AS b
      ON i.boundary_id = b.boundary_id;
  `);
  return db;
}

function insertBatchSqlite(db: DatabaseSync, batch: SyncBatch) {
  const stmt = db.prepare(`
    INSERT INTO sync_batches (batch_id, source_id, window_from, window_to, source_revision, started_at, finished_at, state, state_updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    batch.batch_id, batch.source_id, batch.window_from ?? null, batch.window_to ?? null,
    batch.source_revision ?? null, batch.started_at, batch.finished_at ?? null,
    batch.state, batch.state_updated_at, batch.published_at ?? null,
  );
}

function insertSourceSqlite(db: DatabaseSync, source: DataSource) {
  const stmt = db.prepare(`
    INSERT INTO data_sources (source_id, license_status, access_status, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(
    source.source_id, source.license_status, source.access_status,
    (source as unknown as { updated_at?: string }).updated_at ?? source.last_checked_at ?? '2026-09-28T00:00:00Z',
  );
}

function insertSourceRecordSqlite(db: DatabaseSync, sr: SourceRecord) {
  const stmt = db.prepare(`
    INSERT INTO source_records (source_record_id, version_id, batch_id, source_id, fetched_at, source_updated_at, source_version_ordinal, rights_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    sr.source_record_id, sr.version_id, sr.batch_id, sr.source_id, sr.fetched_at,
    sr.source_updated_at ?? null, sr.source_version_ordinal ?? null, sr.rights_status,
  );
}

function insertBoundarySqlite(db: DatabaseSync, b: Boundary) {
  const stmt = db.prepare(`
    INSERT INTO boundaries (boundary_id, version_id, scheme, code, name, vintage, geometry_geojson, valid_from, valid_to, source_record_id, batch_id, source_id, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    b.boundary_id, b.version_id, b.scheme, b.code, b.name, b.vintage,
    b.geometry_geojson, b.valid_from ?? null, b.valid_to ?? null,
    b.source_record_id, b.batch_id, b.source_id, b.fetched_at,
  );
}

function insertIndicatorSqlite(db: DatabaseSync, ind: AreaIndicator) {
  const stmt = db.prepare(`
    INSERT INTO area_indicators (indicator_id, version_id, boundary_id, period_start, period_end, value, unit, status, assertion_kind, definition, source_area_name, source_area_code, source_area_vintage, source_record_id, batch_id, source_id, schema_version, fetched_at, source_updated_at, source_version_ordinal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    ind.indicator_id, ind.version_id, ind.boundary_id, ind.period_start, ind.period_end,
    ind.value ?? null, ind.unit, ind.status, ind.assertion_kind, ind.definition ?? null,
    ind.source_area_name ?? null, ind.source_area_code ?? null, ind.source_area_vintage ?? null,
    ind.source_record_id, ind.batch_id, ind.source_id, ind.schema_version, ind.fetched_at,
    ind.source_updated_at ?? null, ind.source_version_ordinal ?? null,
  );
}

test('boundary view uses source revision order and hides corrections without an order', async () => {
  const sql = await readSql('006_area_views.sql');
  assert.match(sql, /JOIN `melens_ingest\.source_records` AS sr/);
  assert.match(sql, /ORDER BY b\.source_updated_at DESC NULLS LAST,\s*b\.source_version_ordinal DESC NULLS LAST/);

  const db = createSqliteAreaDatabase();
  const sourceId = 'test.boundaries';
  const boundaryId = 'ASGS_LGA:24600:2025';
  insertSourceSqlite(db, makeAdmittedSource(sourceId));
  const addVersion = (batchId: string, versionId: string, fetchedAt: string,
    sourceUpdatedAt: string | null, ordinal: number | null, targetId = boundaryId) => {
    const code = targetId.split(':')[1]!;
    const sourceRecordId = `${sourceId}:${code}`;
    insertBatchSqlite(db, makePublishedBatch(batchId, sourceId));
    const sourceRecord: SourceRecord = {
      batch_id: batchId, source_id: sourceId, schema_version: 1,
      fetched_at: fetchedAt, source_record_id: sourceRecordId, version_id: versionId,
      original_url: 'https://example.vic.gov.au/boundary', raw_uri: null,
      published_at: null, observed_at: null, first_accessible_at: null,
      time_missing_reason: 'No feature publication time', valid_from: null, valid_to: null,
      source_updated_at: sourceUpdatedAt, source_version_ordinal: ordinal,
      record_status: 'active', assertion_kind: 'observation', rights_status: 'verified_open',
    };
    insertSourceRecordSqlite(db, sourceRecord);
    insertBoundarySqlite(db, {
      batch_id: batchId, source_id: sourceId, schema_version: 1, fetched_at: fetchedAt,
      boundary_id: targetId, version_id: versionId, scheme: 'ASGS_LGA',
      code, name: `LGA ${versionId}`, vintage: '2025',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}',
      valid_from: null, valid_to: null, source_record_id: sourceRecordId,
    });
  };
  const selected = (targetId = boundaryId) => db.prepare('SELECT version_id FROM v_boundaries WHERE boundary_id = ?')
    .get(targetId) as { version_id: string } | undefined;

  addVersion('older', 'z-older', '2026-09-29T00:00:00Z', '2026-01-01T00:00:00Z', null);
  assert.equal(selected()?.version_id, 'z-older');
  addVersion('corrected', 'a-corrected', '2026-09-30T00:00:00Z', '2026-02-01T00:00:00Z', null);
  assert.equal(selected()?.version_id, 'a-corrected');
  addVersion('replay', 'z-older', '2026-10-01T00:00:00Z', '2026-01-01T00:00:00Z', null);
  assert.equal(selected()?.version_id, 'a-corrected');
  addVersion('ambiguous', 'm-unknown', '2026-10-02T00:00:00Z', null, null);
  assert.equal(selected(), undefined);

  const ordinalBoundaryId = 'ASGS_LGA:27350:2025';
  addVersion('ordinal-old', 'z-ordinal-old', '2026-09-29T00:00:00Z', null, 1, ordinalBoundaryId);
  addVersion('ordinal-new', 'a-ordinal-new', '2026-09-30T00:00:00Z', null, 2, ordinalBoundaryId);
  assert.equal(selected(ordinalBoundaryId)?.version_id, 'a-ordinal-new');
  db.close();
});

// ============================================================================
// Test Suite 1: Comparing Two Regions Across Multiple Statistical Domains
// ============================================================================
test('US3 Section 1: Querying two regions returns comparable indicators and provenance while respecting source bounds', async () => {
  // Region 1: Melbourne (LGA 24600 / SA2 206041122)
  // Region 2: Yarra (LGA 27350 / SA2 206041125 - Southbank / Yarra)

  // 1. Demographics from ABS Census via actual normalizer
  const absBatchId = 'batch-census-2021';
  const absFetchedAt = '2026-09-28T00:00:00Z' as UtcTimestamp;
  const rawCensusPayload = await loadAbsFixture();
  const normCensus = normalizeCensusPayload(rawCensusPayload, absBatchId, absFetchedAt);
  const censusResult = normalizeAbsCensusStatistics(
    { areaIndicators: normCensus.areaIndicators, sourceRecords: normCensus.sourceRecords },
    boundaryEvidence2021,
  );

  const melbCensus = censusResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_SA2:206041122:2021');
  const southbankCensus = censusResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_SA2:206041125:2021');

  assert.ok(melbCensus.length > 0, 'Melbourne SA2 must have demographic indicators');
  assert.ok(southbankCensus.length > 0, 'Southbank SA2 must have demographic indicators');

  const melbPop = melbCensus.find((ind) => ind.definition.includes('Total Persons'));
  const southbankPop = southbankCensus.find((ind) => ind.definition.includes('Total Persons'));
  assert.ok(melbPop && melbPop.status === 'observed');
  assert.ok(southbankPop && southbankPop.status === 'observed');
  assert.equal(melbPop.value, 22639);
  assert.equal(southbankPop.value, 12400);
  assert.equal(melbPop.unit, 'persons');
  assert.equal(southbankPop.unit, 'persons');

  // Verify real SourceRecord linkage
  assert.ok(normCensus.sourceRecords.some((sr) => sr.source_record_id === melbPop.source_record_id));
  assert.ok(normCensus.sourceRecords.some((sr) => sr.source_record_id === southbankPop.source_record_id));

  // 2. Crime Statistics from CSA via actual normalizer
  const csaData = makeCsaFixture([
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 28450,
      ratePer100k: 18250.5,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
    {
      lgaName: 'Yarra',
      lgaCode: '27350',
      count: 11200,
      ratePer100k: 11150.2,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
  ]);
  const csaResult = normalizeCsaStatistics(csaData, boundaryEvidence2025);
  const melbCrime = csaResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_LGA:24600:2025');
  const yarraCrime = csaResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_LGA:27350:2025');

  assert.equal(melbCrime.length, 2, 'Melbourne LGA must have crime count and crime rate');
  assert.equal(yarraCrime.length, 2, 'Yarra LGA must have crime count and crime rate');

  const melbOffences = melbCrime.find((ind) => ind.unit === 'recorded_offences');
  const yarraOffences = yarraCrime.find((ind) => ind.unit === 'recorded_offences');
  assert.equal(melbOffences?.value, 28450);
  assert.equal(yarraOffences?.value, 11200);

  // Verify real SourceRecord linkage
  assert.ok(csaData.sourceRecords.some((sr) => sr.source_record_id === melbOffences?.source_record_id));
  assert.ok(csaData.sourceRecords.some((sr) => sr.source_record_id === yarraOffences?.source_record_id));

  // 3. Rental Statistics from Homes Victoria via actual normalizer (normalizeHomesVictoriaRents)
  const rentsBatchId = 'batch-rents-2025';
  const rentsFetchedAt = '2026-09-28T00:00:00Z' as UtcTimestamp;
  const rawRentsPayload = await loadRentsFixture();
  const normRents = normalizeRentalPayload(rawRentsPayload, rentsBatchId, rentsFetchedAt);
  const rentsResult = normalizeHomesVictoriaRents(
    { areaIndicators: normRents.areaIndicators, sourceRecords: normRents.sourceRecords },
    boundaryEvidence2025,
  );
  const melbRents = rentsResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_LGA:24600:2025');
  const yarraRents = rentsResult.indicators.filter((ind) => ind.boundary_id === 'ASGS_LGA:27350:2025');

  assert.ok(melbRents.length > 0, 'Melbourne LGA must have rental indicators');
  assert.ok(yarraRents.length > 0, 'Yarra LGA must have rental indicators');
  assert.equal(melbRents[0]?.unit, 'AUD/week');
  assert.equal(yarraRents[0]?.unit, 'AUD/week');
  assert.ok(normRents.sourceRecords.some((sr) => sr.source_record_id === melbRents[0]?.source_record_id));
  assert.ok(normRents.sourceRecords.some((sr) => sr.source_record_id === yarraRents[0]?.source_record_id));

  // Verify two regions have comparable indicator structures for the same property type and period
  const melbAllProp = melbRents.find((i) => i.definition.includes('All Properties') && i.period_start === '2025-07-01T00:00:00Z');
  const yarraAllProp = yarraRents.find((i) => i.definition.includes('All Properties') && i.period_start === '2025-07-01T00:00:00Z');
  assert.ok(melbAllProp && yarraAllProp, 'Both Melbourne and Yarra must have All Properties rent indicator for 2025-Q3');
  assert.equal(melbAllProp.value, 670);
  assert.equal(yarraAllProp.value, 650);
  assert.equal(melbAllProp.unit, 'AUD/week');
  assert.equal(yarraAllProp.unit, 'AUD/week');
  assert.equal(melbAllProp.source_area_vintage, '2025');
  assert.equal(yarraAllProp.source_area_vintage, '2025');

  // Verify unmatched rents from fixture do not silently join and fail closed in comparability
  const unmatchedRents = rentsResult.indicators.filter((ind) => ind.boundary_id.includes(':unresolved'));
  assert.ok(unmatchedRents.length > 0, 'Unmatched rent records must be marked as unresolved');
  assert.throws(
    () => assertComparableIndicators(melbAllProp, unmatchedRents[0]!),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'Unmatched rent cannot be compared with a matched boundary without crosswalk',
  );

  // Verify suppressed and missing rents strictly have value: null, never 0
  const suppressedRents = rentsResult.indicators.filter((ind) => ind.status === 'suppressed');
  const missingRents = rentsResult.indicators.filter((ind) => ind.status === 'missing');
  assert.ok(suppressedRents.length > 0, 'Must have suppressed rent indicators in fixture');
  assert.ok(missingRents.length > 0, 'Must have missing rent indicators in fixture');
  for (const ind of [...suppressedRents, ...missingRents]) {
    assert.equal(ind.value, null, 'Suppressed and missing rent indicators must have value null, never 0');
    assert.doesNotThrow(() => enforceAreaIndicatorInvariants(ind));
  }

  // 4. Employment from CLUE (City of Melbourne only) via actual normalizer
  const clueBatchId = 'batch-clue-2024';
  const clueFetchedAt = '2026-09-28T00:00:00Z' as UtcTimestamp;
  const clueRows = await loadClueFixture();
  const clueNormBlocks = clueRows.map((r) => normalizeClueEmploymentRow(r, clueBatchId, clueFetchedAt, null));
  const clueSourceRecords = clueNormBlocks.map((b) => b.sourceRecord);
  const clueIndicators = clueNormBlocks.flatMap((b) => b.indicators);
  const clueResult = normalizeClueEmploymentStatistics(
    { areaIndicators: clueIndicators, sourceRecords: clueSourceRecords },
    boundaryEvidence2024,
  );
  const block17Jobs = clueResult.indicators.filter((ind) => ind.boundary_id === 'com_clue_block:17:2024');
  assert.ok(block17Jobs.length > 0, 'Melbourne CBD block 17 has CLUE employment');
  assert.ok(clueSourceRecords.some((sr) => sr.source_record_id === block17Jobs[0]?.source_record_id));

  // Verify that an indicator query for Yarra LGA yields NO CLUE jobs and is never synthesized
  const yarraClueJobs = clueResult.indicators.filter((ind) => ind.source_area_name === 'Yarra');
  assert.equal(yarraClueJobs.length, 0, 'Yarra LGA must have 0 CLUE indicators (not surveyed by City of Melbourne)');

  // 5. Invariant & Assertion Kind Validation
  const allIndicators = [
    ...censusResult.indicators,
    ...csaResult.indicators,
    ...rentsResult.indicators,
    ...clueResult.indicators,
  ];
  for (const ind of allIndicators) {
    assert.equal(ind.assertion_kind, 'observation', 'All US3 statistical indicators must have assertion_kind: observation');
    enforceAreaIndicatorInvariants(ind);
  }

  // 6. Verify consumption gate eligibility when linked to admitted sources and published batches
  const batches: SyncBatch[] = [
    makePublishedBatch(absBatchId, 'abs.census'),
    makePublishedBatch('csa-test-run', 'victoria.csa.recorded_offences'),
    makePublishedBatch(rentsBatchId, 'homes_victoria.rents'),
    makePublishedBatch(clueBatchId, 'melbourne.clue.employment'),
  ];
  const sources: DataSource[] = [
    makeAdmittedSource('abs.census'),
    makeAdmittedSource('victoria.csa.recorded_offences'),
    makeAdmittedSource('homes_victoria.rents'),
    makeAdmittedSource('melbourne.clue.employment'),
  ];
  const admittedSourceRecords: SourceRecord[] = [
    ...normCensus.sourceRecords,
    ...csaData.sourceRecords,
    ...normRents.sourceRecords,
    ...clueSourceRecords,
  ].map((sr) => ({ ...sr, rights_status: 'verified_open' }));
  const knownBoundaries = [
    ...boundaryEvidence2021.boundaries,
    ...boundaryEvidence2024.boundaries,
    ...boundaryEvidence2025.boundaries,
  ];

  const viewRows = queryViewAreaIndicators(allIndicators, {
    batches,
    sources,
    sourceRecords: admittedSourceRecords,
    knownBoundaries,
  });

  assert.ok(viewRows.length > 0, 'Eligible indicators must pass the consumption gate');
  const viewMelbPop = viewRows.find((r) => r.indicator_id === melbPop.indicator_id);
  const viewYarraCrime = viewRows.find((r) => r.indicator_id === yarraOffences?.indicator_id);
  const viewMelbRent = viewRows.find((r) => r.indicator_id === melbAllProp.indicator_id);
  const viewYarraRent = viewRows.find((r) => r.indicator_id === yarraAllProp.indicator_id);
  const viewUnmatchedRent = viewRows.find((r) => r.indicator_id === unmatchedRents[0]!.indicator_id);
  const viewSuppressedRent = viewRows.find((r) => r.indicator_id === suppressedRents[0]!.indicator_id);

  assert.ok(viewMelbPop && viewMelbPop.value === 22639);
  assert.ok(viewYarraCrime && viewYarraCrime.value === 11200);
  assert.ok(viewMelbRent && viewMelbRent.boundary_mapping_status === 'matched');
  assert.equal(viewMelbRent?.boundary_name, 'Melbourne');
  assert.ok(viewYarraRent && viewYarraRent.boundary_mapping_status === 'matched');
  assert.equal(viewYarraRent?.boundary_name, 'Yarra');

  assert.ok(viewUnmatchedRent && viewUnmatchedRent.boundary_mapping_status === 'missing');
  assert.equal(viewUnmatchedRent?.boundary_name, null);
  assert.ok(viewSuppressedRent && viewSuppressedRent.status === 'suppressed');
  assert.equal(viewSuppressedRent?.value, null);
});

// ============================================================================
// Test Suite 2: Temporal Comparability Across Two Distinct Years / Periods
// ============================================================================
test('US3 Section 2: Temporal intervals are strictly bound, and cross-vintage comparisons require explicit crosswalks', async () => {
  // Scenario 1: Comparing Census 2016 vs Census 2021 through actual normalizers (normalizeAbsCensusStatistics)
  const payload2016: CensusPayload = {
    census_year: 2016,
    asgs_vintage: '2016',
    landing_url: 'https://www.abs.gov.au/census/find-census-data/datapacks',
    published_at: '2017-06-27T00:00:00Z',
    observed_at: '2016-08-09T00:00:00Z',
    tables: [
      {
        table_id: 'G01',
        name: 'Selected Person Characteristics',
        scheme: 'ASGS_SA2',
        headers: ['SA2_CODE_2016', 'Tot_P_M', 'Tot_P_F', 'Tot_P_P'],
        rows: [['206041122', 9500, 9000, 18500]],
      },
    ],
  };

  const norm2016 = normalizeCensusPayload(payload2016, 'census-2016-batch', '2026-09-29T00:00:00Z');
  const result2016 = normalizeAbsCensusStatistics(
    { areaIndicators: norm2016.areaIndicators, sourceRecords: norm2016.sourceRecords },
    boundaryEvidence2016,
  );
  const ind2016 = result2016.indicators.find(
    (i) => i.definition.includes('Total Persons') && i.boundary_id === 'ASGS_SA2:206041122:2016',
  );
  assert.ok(ind2016, 'Census 2016 Total Persons must be normalized');
  assert.equal(ind2016.value, 18500);

  const rawPayload2021 = await loadAbsFixture();
  const norm2021 = normalizeCensusPayload(rawPayload2021, 'census-2021-batch', '2026-09-29T00:00:00Z');
  const result2021 = normalizeAbsCensusStatistics(
    { areaIndicators: norm2021.areaIndicators, sourceRecords: norm2021.sourceRecords },
    boundaryEvidence2021,
  );
  const ind2021 = result2021.indicators.find(
    (i) => i.definition.includes('Total Persons') && i.boundary_id === 'ASGS_SA2:206041122:2021',
  );
  assert.ok(ind2021, 'Census 2021 Total Persons must be normalized');
  assert.equal(ind2021.value, 22639);

  // Link to real SourceRecords
  assert.ok(norm2016.sourceRecords.some((sr) => sr.source_record_id === ind2016.source_record_id));
  assert.ok(norm2021.sourceRecords.some((sr) => sr.source_record_id === ind2021.source_record_id));

  // 1. Direct comparison across vintages WITHOUT crosswalk mapping MUST throw
  assert.throws(
    () => assertComparableIndicators(ind2016, ind2021),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'Comparing 2016 ASGS SA2 with 2021 ASGS SA2 without crosswalk must fail closed',
  );

  // 2. Comparison WITH explicit official ASGS 2016-to-2021 correspondence crosswalk passes
  const crosswalk2016To2021 = new Map([
    ['ASGS_SA2:206041122:2016', 'ASGS_SA2:206041122:2021'],
  ]);
  assert.doesNotThrow(
    () => assertComparableIndicators(ind2016, ind2021, crosswalk2016To2021),
    'Comparing with explicit correspondence crosswalk succeeds',
  );

  // Scenario 2: Two different quarters of the same boundary vintage across two regions through normalizeHomesVictoriaRents
  const rentPayloadQ4: HomesVictoriaPayload = {
    results: [
      {
        quarter: 'Dec 2024',
        quarter_code: '2024-Q4',
        period_start: '2024-10-01T00:00:00Z',
        period_end: '2025-01-01T00:00:00Z',
        lga_name: 'Melbourne',
        property_type: 'All properties',
        median_rent: 615,
        count: 1500,
        status: 'observed',
      },
      {
        quarter: 'Dec 2024',
        quarter_code: '2024-Q4',
        period_start: '2024-10-01T00:00:00Z',
        period_end: '2025-01-01T00:00:00Z',
        lga_name: 'Yarra',
        property_type: 'All properties',
        median_rent: 675,
        count: 1592,
        status: 'observed',
      },
    ],
  };
  const rentPayloadQ1: HomesVictoriaPayload = {
    results: [
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Melbourne',
        property_type: 'All properties',
        median_rent: 680,
        count: 1420,
        status: 'observed',
      },
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Yarra',
        property_type: 'All properties',
        median_rent: 700,
        count: 1628,
        status: 'observed',
      },
    ],
  };

  const normRentQ4 = normalizeRentalPayload(rentPayloadQ4, 'rent-q4-batch', '2026-09-29T00:00:00Z');
  const normRentQ1 = normalizeRentalPayload(rentPayloadQ1, 'rent-q1-batch', '2026-09-29T00:00:00Z');
  const rentResultQ4 = normalizeHomesVictoriaRents(
    { areaIndicators: normRentQ4.areaIndicators, sourceRecords: normRentQ4.sourceRecords },
    boundaryEvidence2025,
  );
  const rentResultQ1 = normalizeHomesVictoriaRents(
    { areaIndicators: normRentQ1.areaIndicators, sourceRecords: normRentQ1.sourceRecords },
    boundaryEvidence2025,
  );
  const melbRentQ4 = rentResultQ4.indicators.find((i) => i.boundary_id === 'ASGS_LGA:24600:2025')!;
  const melbRentQ1 = rentResultQ1.indicators.find((i) => i.boundary_id === 'ASGS_LGA:24600:2025')!;
  const yarraRentQ4 = rentResultQ4.indicators.find((i) => i.boundary_id === 'ASGS_LGA:27350:2025')!;
  const yarraRentQ1 = rentResultQ1.indicators.find((i) => i.boundary_id === 'ASGS_LGA:27350:2025')!;

  assert.ok(melbRentQ4 && melbRentQ1 && yarraRentQ4 && yarraRentQ1);
  assert.equal(melbRentQ4.value, 615);
  assert.equal(melbRentQ1.value, 680);
  assert.equal(yarraRentQ4.value, 675);
  assert.equal(yarraRentQ1.value, 700);
  assert.equal(melbRentQ4.boundary_id, 'ASGS_LGA:24600:2025');
  assert.equal(melbRentQ1.boundary_id, 'ASGS_LGA:24600:2025');
  assert.equal(yarraRentQ4.boundary_id, 'ASGS_LGA:27350:2025');
  assert.equal(yarraRentQ1.boundary_id, 'ASGS_LGA:27350:2025');

  assert.doesNotThrow(
    () => assertComparableIndicators(melbRentQ4, melbRentQ1),
    'Sequential quarters of same Melbourne LGA boundary vintage are directly comparable',
  );
  assert.doesNotThrow(
    () => assertComparableIndicators(yarraRentQ4, yarraRentQ1),
    'Sequential quarters of same Yarra LGA boundary vintage are directly comparable',
  );
  assert.notEqual(melbRentQ4.period_start, melbRentQ1.period_start);
  assert.notEqual(melbRentQ4.period_end, melbRentQ1.period_end);

  // Scenario 3: Cross-year CLUE employment comparison through normalizeClueEmploymentStatistics
  const clue2023Row: ClueEmploymentRawRow = {
    census_year: '2023',
    block_id: 17,
    clue_small_area: 'Melbourne (CBD)',
    total_jobs_in_block: 5200,
  };
  const clue2024Row: ClueEmploymentRawRow = {
    census_year: '2024',
    block_id: 17,
    clue_small_area: 'Melbourne (CBD)',
    total_jobs_in_block: 5500,
  };
  const normClue2023 = normalizeClueEmploymentRow(clue2023Row, 'clue-2023-batch', '2026-09-29T00:00:00Z', null);
  const normClue2024 = normalizeClueEmploymentRow(clue2024Row, 'clue-2024-batch', '2026-09-29T00:00:00Z', null);
  const clueEvidence2023: AreaBoundaryEvidence = {
    sourceAreaVintage: '2023',
    boundaries: [{ boundary_id: 'com_clue_block:17:2023', scheme: 'com_clue_block', code: '17', name: 'Block 17', vintage: '2023' }],
  };
  const clueResult2023 = normalizeClueEmploymentStatistics(
    { areaIndicators: normClue2023.indicators, sourceRecords: [normClue2023.sourceRecord] },
    clueEvidence2023,
  );
  const clueResult2024 = normalizeClueEmploymentStatistics(
    { areaIndicators: normClue2024.indicators, sourceRecords: [normClue2024.sourceRecord] },
    boundaryEvidence2024,
  );
  const clueInd2023 = clueResult2023.indicators.find((i) => i.definition.includes('total employment'))!;
  const clueInd2024 = clueResult2024.indicators.find((i) => i.definition.includes('total employment'))!;
  assert.ok(clueInd2023 && clueInd2024);

  // Differing boundary vintages without crosswalk fails closed
  assert.throws(
    () => assertComparableIndicators(clueInd2023, clueInd2024),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
  );
  // Crosswalk allows comparison
  const clueCrosswalk = new Map([['com_clue_block:17:2023', 'com_clue_block:17:2024']]);
  assert.doesNotThrow(() => assertComparableIndicators(clueInd2023, clueInd2024, clueCrosswalk));

  // Scenario 4: Cross-year CSA offences comparison through normalizeCsaStatistics
  const csaMultiYear = makeCsaFixture([
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 26000,
      ratePer100k: 17000,
      status: 'observed',
      periodStart: '2024-07-01T00:00:00Z',
      periodEnd: '2025-07-01T00:00:00Z',
      yearEnding: 2025,
    },
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 28450,
      ratePer100k: 18250.5,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
  ]);
  const csaMultiResult = normalizeCsaStatistics(csaMultiYear, boundaryEvidence2025);
  const csa2025Count = csaMultiResult.indicators.find((i) => i.period_end === '2025-07-01T00:00:00Z' && i.unit === 'recorded_offences')!;
  const csa2026Count = csaMultiResult.indicators.find((i) => i.period_end === '2026-07-01T00:00:00Z' && i.unit === 'recorded_offences')!;
  assert.ok(csa2025Count && csa2026Count);
  assert.doesNotThrow(() => assertComparableIndicators(csa2025Count, csa2026Count));
  assert.equal(csa2025Count.value, 26000);
  assert.equal(csa2026Count.value, 28450);
});

// ============================================================================
// Test Suite 3: Geographic Granularities & Hierarchy Integrity
// ============================================================================
test('US3 Section 3: Geographic schemes (SA2, LGA, Suburb, CLUE Block) retain distinct identity without conflation', async () => {
  const sa2BoundaryId = 'ASGS_SA2:206041122:2021';
  const lgaBoundaryId = 'ASGS_LGA:24600:2025';
  const suburbBoundaryId = 'VIC_SUBURB:carlton:2025';
  const blockBoundaryId = 'com_clue_block:17:2024';

  const baseInd = {
    batch_id: 'b1',
    schema_version: 1,
    fetched_at: '2026-09-29T00:00:00Z' as UtcTimestamp,
    source_record_id: 'rec1',
    source_updated_at: null,
    source_version_ordinal: null,
    indicator_id: 'ind1',
    version_id: 'v1',
    period_start: '2025-01-01T00:00:00Z' as UtcTimestamp,
    period_end: '2025-04-01T00:00:00Z' as UtcTimestamp,
    unit: 'persons',
    definition: 'Population count',
    assertion_kind: 'observation' as const,
    status: 'observed' as const,
    value: 500,
  };

  const sa2Ind: AreaIndicator = {
    ...baseInd,
    source_id: 'abs.census',
    boundary_id: sa2BoundaryId,
    source_area_code: '206041122',
    source_area_vintage: '2021',
  };

  const lgaInd: AreaIndicator = {
    ...baseInd,
    source_id: 'abs.census',
    boundary_id: lgaBoundaryId,
    source_area_code: '24600',
    source_area_vintage: '2025',
  };

  const suburbInd: AreaIndicator = {
    ...baseInd,
    source_id: 'homes_victoria.rents',
    boundary_id: suburbBoundaryId,
    source_area_name: 'Carlton',
    source_area_vintage: '2025',
    unit: 'AUD/week',
  };

  const blockInd: AreaIndicator = {
    ...baseInd,
    source_id: 'melbourne.clue.employment',
    boundary_id: blockBoundaryId,
    source_area_code: '17',
    source_area_vintage: '2024',
    unit: 'jobs',
  };

  // Cross-scheme comparison without crosswalk must fail
  assert.throws(
    () => assertComparableIndicators(sa2Ind, lgaInd),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'SA2 and LGA cannot be compared directly without geographic crosswalk',
  );
  assert.throws(
    () => assertComparableIndicators(lgaInd, suburbInd),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'LGA and Suburb cannot be compared directly without geographic crosswalk',
  );
  assert.throws(
    () => assertComparableIndicators(blockInd, lgaInd),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'CLUE Block and LGA cannot be compared directly without geographic crosswalk',
  );

  // Unresolved boundaries remain tagged with :unresolved without guessing
  const unresolvedResult = normalizeCsaStatistics(
    makeCsaFixture([
      {
        lgaName: 'NonExistentLGA',
        lgaCode: null,
        count: 5,
        ratePer100k: 10,
        status: 'observed',
        periodStart: '2025-07-01T00:00:00Z',
        periodEnd: '2026-07-01T00:00:00Z',
        yearEnding: 2026,
      },
    ]),
    boundaryEvidence2025,
  );
  assert.equal(unresolvedResult.unresolved, 1);
  assert.ok(unresolvedResult.indicators[0]?.boundary_id.includes(':unresolved'));
  assert.equal(unresolvedResult.indicators[0]?.source_area_vintage, null);
});

// ============================================================================
// Test Suite 4: Suppression and Missing Value Integrity Gate
// ============================================================================
test('US3 Section 4: Suppressed and missing observations strictly remain null and never zero-fill, while genuine zeros survive', async () => {
  // 1. CSA Suppression (low frequency crime cell with '*' marker)
  const csaSuppressed = makeCsaFixture([
    {
      lgaName: 'Queenscliffe',
      lgaCode: '25810',
      count: null,
      ratePer100k: null,
      status: 'suppressed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
  ]);
  const csaNorm = normalizeCsaStatistics(csaSuppressed);
  for (const ind of csaNorm.indicators) {
    assert.equal(ind.status, 'suppressed');
    assert.equal(ind.value, null, 'CSA suppressed count/rate must be null');
    assert.doesNotThrow(() => enforceAreaIndicatorInvariants(ind));
  }

  // 2. Homes Victoria Suppression (<4 bond count -> '-' median rent)
  const rentsPayload = await loadRentsFixture();
  const suppressedRentRecord: HomesVictoriaPayload = {
    ...rentsPayload,
    results: [
      {
        quarter: 'Sep 2025',
        quarter_code: '2025-Q3',
        period_start: '2025-07-01T00:00:00Z',
        period_end: '2025-10-01T00:00:00Z',
        lga_name: 'Banyule',
        region_group: 'Metropolitan',
        suburb: 'Heidelberg',
        property_type: '4 bedroom flat',
        raw_count: '<4',
        raw_median: '-',
        count: null,
        median_rent: null,
        measure: 'median_weekly_rent',
        currency: 'AUD',
        status: 'suppressed',
      },
    ],
  };
  const rentsNorm = normalizeHomesVictoriaStatistics(suppressedRentRecord);
  assert.equal(rentsNorm.indicators.length, 1);
  assert.equal(rentsNorm.indicators[0]?.status, 'suppressed');
  assert.equal(rentsNorm.indicators[0]?.value, null, 'Suppressed median rent must be null, never 0');

  // 3. ABS Census missing ('..') and suppressed ('-')
  const censusPayload = await loadAbsFixture();
  const censusNorm = normalizeAbsCensusStatistics(censusPayload);
  const row4 = censusNorm.indicators.filter((ind) => ind.source_area_code === '206041199');
  assert.ok(row4.length > 0);

  const missingCell = row4.find((ind) => ind.status === 'missing');
  const suppressedCell = row4.find((ind) => ind.status === 'suppressed');
  assert.ok(missingCell);
  assert.ok(suppressedCell);
  assert.equal(missingCell.value, null, 'Missing ABS cell must have value null');
  assert.equal(suppressedCell.value, null, 'Suppressed ABS cell must have value null');

  // 4. CLUE Employment: genuine 0 vs suppressed industry count
  const clueRows = await loadClueFixture();
  const clueNorm = normalizeClueEmploymentStatistics(clueRows);
  const block17 = clueNorm.indicators.filter((ind) => ind.source_area_code === '17');

  // agriculture_and_mining is genuine 0 in block 17
  const zeroJobs = block17.find((ind) => ind.status === 'observed' && ind.value === 0);
  assert.ok(zeroJobs, 'Genuine 0 jobs must be preserved as observed 0');

  // accommodation is suppressed (null) in block 17
  const suppressedJobs = block17.find((ind) => ind.status === 'suppressed');
  assert.ok(suppressedJobs, 'Suppressed industry count must have status suppressed');
  assert.equal(suppressedJobs.value, null, 'Suppressed industry count must have value null');

  // 5. Zero-Fill Guard: Artificially attempting to store value: 0 for suppressed or missing must fail
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...suppressedCell, value: 0 } as any),
    /Suppressed and missing indicators MUST have value: null, never zero-filled/,
    'Zero-filling suppressed indicators violates SC-002 and T058 invariant',
  );
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...missingCell, value: 0 } as any),
    /Suppressed and missing indicators MUST have value: null, never zero-filled/,
    'Zero-filling missing indicators violates SC-002 and T058 invariant',
  );
});

// ============================================================================
// Test Suite 5: Planning Zones & Overlays vs Development Projects
// ============================================================================
test('US3 Section 5: Planning controls (zones/overlays) are distinct statutory plans, not confused with development projects', async () => {
  const fetchedAt = '2026-09-29T00:00:00Z' as UtcTimestamp;
  const layerEditedAt = '2026-03-31T00:00:00Z' as UtcTimestamp;

  // 1. Vicmap Planning (Source #22)
  const vicmapFixture = await loadVicmapFixture();
  const overlayLayer = vicmapLayers.find((l) => l.kind === 'overlay')!;
  const zoneLayer = vicmapLayers.find((l) => l.kind === 'zone')!;

  const overlayFeature = vicmapFixture.overlay.collection.features[0]!;
  const zoneFeature = vicmapFixture.zone.collection.features[0]!;

  const overlayControl = normalizePlanningControl(overlayFeature, overlayLayer, 'run-vicmap', fetchedAt, layerEditedAt);
  const zoneControl = normalizePlanningControl(zoneFeature, zoneLayer, 'run-vicmap', fetchedAt, layerEditedAt);

  assert.equal(overlayControl.sourceRecord.assertion_kind, 'plan');
  assert.equal(overlayControl.geoRecords[0]?.assertion_kind, 'plan');
  assert.equal(overlayControl.geoRecords[0]?.location_role, 'area_only');
  assert.ok(overlayControl.geoRecords[0]?.title?.includes('Planning overlay DDO1'));

  assert.equal(zoneControl.sourceRecord.assertion_kind, 'plan');
  assert.equal(zoneControl.geoRecords[0]?.assertion_kind, 'plan');
  assert.equal(zoneControl.geoRecords[0]?.location_role, 'area_only');
  assert.ok(zoneControl.geoRecords[0]?.title?.includes('Planning zone CCZ1'));

  // 2. City of Melbourne Development Activity Monitor (Source #23)
  const devMonitorFixture = await loadDevMonitorFixture();
  assert.ok(devMonitorFixture.results.length >= 4);

  const mootedRow = devMonitorFixture.results.find((r) => r.status === 'APPLIED')!;
  const approvedRow = devMonitorFixture.results.find((r) => r.status === 'APPROVED')!;
  const underConstructionRow = devMonitorFixture.results.find((r) => r.status === 'UNDER CONSTRUCTION')!;
  const completedRow = devMonitorFixture.results.find((r) => r.status === 'COMPLETED')!;

  assert.ok(mootedRow, 'Fixture must contain APPLIED project');
  assert.ok(approvedRow, 'Fixture must contain APPROVED project');
  assert.ok(underConstructionRow, 'Fixture must contain UNDER CONSTRUCTION project');
  assert.ok(completedRow, 'Fixture must contain COMPLETED project');

  const mootedNorm = normalizeDevelopmentRecord(mootedRow, 'dev-run', fetchedAt, null);
  const approvedNorm = normalizeDevelopmentRecord(approvedRow, 'dev-run', fetchedAt, null);
  const underConstructionNorm = normalizeDevelopmentRecord(underConstructionRow, 'dev-run', fetchedAt, null);
  const completedNorm = normalizeDevelopmentRecord(completedRow, 'dev-run', fetchedAt, null);

  assert.equal(mootedNorm.project.development_status, 'mooted');
  assert.equal(mootedNorm.geoRecord.record_status, 'planned');
  assert.equal(mootedNorm.geoRecord.assertion_kind, 'plan');

  assert.equal(approvedNorm.project.development_status, 'approved');
  assert.equal(approvedNorm.geoRecord.record_status, 'planned');
  assert.equal(approvedNorm.geoRecord.assertion_kind, 'plan');

  assert.equal(underConstructionNorm.project.development_status, 'under_construction');
  assert.equal(underConstructionNorm.geoRecord.record_status, 'active');
  assert.equal(underConstructionNorm.geoRecord.assertion_kind, 'plan');

  assert.equal(completedNorm.project.development_status, 'completed');
  assert.equal(completedNorm.geoRecord.record_status, 'resolved');
  assert.equal(completedNorm.geoRecord.assertion_kind, 'observation');

  assert.ok(typeof mootedNorm.geoRecord.centroid_lon === 'number');
  assert.ok(typeof mootedNorm.geoRecord.centroid_lat === 'number');
  assert.ok(mootedNorm.project.resi_dwellings !== null && mootedNorm.project.resi_dwellings > 0);
  assert.notEqual(mootedNorm.geoRecord.location_role, 'area_only');
});

// ============================================================================
// Test Suite 6a: Local In-Memory Projection Helper Unit Assertions
// ============================================================================
test('US3 Section 6a: Local projection helper logic enforces in-memory simulation rules', async () => {
  // Normalize all 4 sources through their full connector/normalizer pipelines
  const absBatchId = 'batch-census-published';
  const csaBatchId = 'csa-test-run';
  const rentsBatchId = 'batch-rents-published';
  const clueBatchId = 'batch-clue-published';
  const fetchedAt = '2026-09-28T00:00:00Z' as UtcTimestamp;

  const rawCensus = await loadAbsFixture();
  const normCensus = normalizeCensusPayload(rawCensus, absBatchId, fetchedAt);
  const censusResult = normalizeAbsCensusStatistics(
    { areaIndicators: normCensus.areaIndicators, sourceRecords: normCensus.sourceRecords },
    boundaryEvidence2021,
  );

  const csaData = makeCsaFixture([
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 28450,
      ratePer100k: 18250.5,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
    {
      lgaName: 'UnmappedRegion',
      lgaCode: null,
      count: 10,
      ratePer100k: 20,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
  ]);
  const csaResult = normalizeCsaStatistics(csaData, boundaryEvidence2025);

  const rawClue = await loadClueFixture();
  const normClueRows = rawClue.map((r) => normalizeClueEmploymentRow(r, clueBatchId, fetchedAt, null));
  const clueSourceRecords = normClueRows.map((b) => b.sourceRecord);
  const clueIndicators = normClueRows.flatMap((b) => b.indicators);
  const clueResult = normalizeClueEmploymentStatistics(
    { areaIndicators: clueIndicators, sourceRecords: clueSourceRecords },
    boundaryEvidence2024,
  );

  const rawRents = await loadRentsFixture();
  const normRents = normalizeRentalPayload(rawRents, rentsBatchId, fetchedAt);
  const rentsResult = normalizeHomesVictoriaRents(
    { areaIndicators: normRents.areaIndicators, sourceRecords: normRents.sourceRecords },
    boundaryEvidence2025,
  );

  const allIndicators = [
    ...censusResult.indicators,
    ...csaResult.indicators,
    ...clueResult.indicators,
    ...rentsResult.indicators,
  ];

  const batches: SyncBatch[] = [
    makePublishedBatch(absBatchId, 'abs.census'),
    makePublishedBatch(csaBatchId, 'victoria.csa.recorded_offences'),
    makePublishedBatch(rentsBatchId, 'homes_victoria.rents'),
    makePublishedBatch(clueBatchId, 'melbourne.clue.employment'),
  ];
  const sources: DataSource[] = [
    makeAdmittedSource('abs.census'),
    makeAdmittedSource('victoria.csa.recorded_offences'),
    makeAdmittedSource('homes_victoria.rents'),
    makeAdmittedSource('melbourne.clue.employment'),
  ];
  const admittedSourceRecords: SourceRecord[] = [
    ...normCensus.sourceRecords,
    ...csaData.sourceRecords,
    ...normRents.sourceRecords,
    ...clueSourceRecords,
  ].map((sr) => ({ ...sr, rights_status: 'verified_open' }));

  const knownBoundaries = [
    ...boundaryEvidence2021.boundaries,
    ...boundaryEvidence2024.boundaries,
    ...boundaryEvidence2025.boundaries,
  ];

  const baseContext: AreaIndicatorQueryContext = {
    batches,
    sources,
    sourceRecords: admittedSourceRecords,
    knownBoundaries,
  };

  // 1. Positive Gate: All valid indicators pass and populate view fields correctly
  const viewRows = queryViewAreaIndicators(allIndicators, baseContext);
  assert.ok(viewRows.length > 0, 'Valid indicators must pass the consumption gate');

  const matchedRows = viewRows.filter((r) => r.boundary_mapping_status === 'matched');
  const missingRows = viewRows.filter((r) => r.boundary_mapping_status === 'missing');
  assert.ok(matchedRows.length > 0, 'Must have matched boundaries');
  assert.ok(missingRows.length > 0, 'Unmapped regions must remain visible with boundary_mapping_status: missing');

  for (const row of viewRows) {
    assert.equal(row.is_prediction, false, 'Statistical observations must not be predictions');
    assert.equal(row.assertion_kind, 'observation');
    if (row.status === 'observed') {
      assert.ok(typeof row.value === 'number' && Number.isFinite(row.value));
    } else {
      assert.equal(row.value, null, 'Suppressed or missing value must be NULL in view');
    }
    // Verify genuine upstream linkage
    assert.ok(
      admittedSourceRecords.some(
        (sr) =>
          sr.batch_id === row.batch_id &&
          sr.source_id === row.source_id &&
          sr.source_record_id === row.source_record_id,
      ),
      `View row ${row.indicator_id} must link to a real SourceRecord in its batch`,
    );
  }

  // 2. Negative Gate: Missing or invalid source_record_id fails eligibility
  const validInd = allIndicators.find((i) => i.status === 'observed')!;
  const missingRecInd: AreaIndicator = {
    ...validInd,
    source_record_id: '',
  };
  assert.equal(
    queryViewAreaIndicators([missingRecInd], baseContext).length,
    0,
    'Empty source_record_id must fail view eligibility criteria',
  );

  const invalidRecInd: AreaIndicator = {
    ...validInd,
    source_record_id: 'does-not-exist',
  };
  assert.equal(
    queryViewAreaIndicators([invalidRecInd], baseContext).length,
    0,
    'Non-existent source_record_id must fail view eligibility criteria (EXISTS source_records fails)',
  );

  // 3. Negative Gate: Mismatched batch fails eligibility
  const mismatchedBatchInd: AreaIndicator = {
    ...validInd,
    batch_id: 'batch-mismatched-other',
  };
  assert.equal(
    queryViewAreaIndicators([mismatchedBatchInd], baseContext).length,
    0,
    'Mismatched batch_id between indicator and source_record must fail eligibility',
  );

  // 4. Negative Gate: Failed or incomplete batch fails eligibility
  const failedBatchContext: AreaIndicatorQueryContext = {
    ...baseContext,
    batches: batches.map((b) =>
      b.batch_id === validInd.batch_id
        ? { ...b, state: 'failed', error_code: 'upstream_unavailable' as any, published_at: null }
        : b,
    ),
  };
  assert.equal(
    queryViewAreaIndicators([validInd], failedBatchContext).length,
    0,
    'Failed batch must fail view eligibility criteria',
  );

  const pendingBatchContext: AreaIndicatorQueryContext = {
    ...baseContext,
    batches: batches.map((b) =>
      b.batch_id === validInd.batch_id
        ? { ...b, state: 'running' as SyncBatchState, published_at: null }
        : b,
    ),
  };
  assert.equal(
    queryViewAreaIndicators([validInd], pendingBatchContext).length,
    0,
    'Unpublished running batch must fail view eligibility criteria',
  );

  // 5. Negative Gate: Unadmitted source fails eligibility
  const candidateSourceContext: AreaIndicatorQueryContext = {
    ...baseContext,
    sources: sources.map((s) =>
      s.source_id === validInd.source_id
        ? { ...s, access_status: 'candidate' }
        : s,
    ),
  };
  assert.equal(
    queryViewAreaIndicators([validInd], candidateSourceContext).length,
    0,
    'Source with access_status candidate must fail view eligibility criteria',
  );

  const reviewLicenseSourceContext: AreaIndicatorQueryContext = {
    ...baseContext,
    sources: sources.map((s) =>
      s.source_id === validInd.source_id
        ? { ...s, license_status: 'review_required' }
        : s,
    ),
  };
  assert.equal(
    queryViewAreaIndicators([validInd], reviewLicenseSourceContext).length,
    0,
    'Source with license_status review_required must fail view eligibility criteria',
  );

  // 6. Negative Gate: Source record rights_status not open/restricted fails eligibility
  const restrictedRecordContext: AreaIndicatorQueryContext = {
    ...baseContext,
    sourceRecords: admittedSourceRecords.map((sr) =>
      sr.source_record_id === validInd.source_record_id
        ? { ...sr, rights_status: 'review_required' }
        : sr,
    ),
  };
  assert.equal(
    queryViewAreaIndicators([validInd], restrictedRecordContext).length,
    0,
    'SourceRecord with rights_status review_required must fail view eligibility criteria',
  );

  // 7. Version ordering & Replay: QUALIFY ROW_NUMBER() selects latest version
  const baseVersion: AreaIndicator = {
    ...validInd,
    status: 'observed',
    version_id: 'v1_original',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: 1,
    value: 500,
  };
  const updatedVersion: AreaIndicator = {
    ...validInd,
    status: 'observed',
    version_id: 'v2_corrected',
    source_updated_at: '2026-09-28T02:00:00Z',
    source_version_ordinal: 2,
    value: 550,
  };

  // Both versions present in table: latest version wins
  const versionedRows = queryViewAreaIndicators([baseVersion, updatedVersion], baseContext);
  assert.equal(versionedRows.length, 1);
  assert.equal(versionedRows[0]?.version_id, 'v2_corrected');
  assert.equal(versionedRows[0]?.value, 550);

  // Replay of older version does not overwrite newer version
  const replayedRows = queryViewAreaIndicators([updatedVersion, baseVersion], baseContext);
  assert.equal(replayedRows.length, 1);
  assert.equal(replayedRows[0]?.version_id, 'v2_corrected');
  assert.equal(replayedRows[0]?.value, 550);
});

// ============================================================================
// Test Suite 6b: Real SQL Consumption Gate (SQLite in-memory)
// ============================================================================
test('US3 Section 6b: Real SQL consumption gate (SQLite in-memory) enforces batch publication, source admission, and version supersession', async () => {
  const db = createSqliteAreaDatabase();

  // 1. Setup admitted sources
  const rentsSource = makeAdmittedSource('homes_victoria.rents');
  const csaSource = makeAdmittedSource('victoria.csa.recorded_offences');
  insertSourceSqlite(db, rentsSource);
  insertSourceSqlite(db, csaSource);

  // 2. Prepare real normalizer output across two statistical periods and two regions, plus suppressed/unmatched records
  // Period 1: Homes Victoria rents Q4 2024
  const rentPayloadQ4: HomesVictoriaPayload = {
    results: [
      {
        quarter: 'Dec 2024',
        quarter_code: '2024-Q4',
        period_start: '2024-10-01T00:00:00Z',
        period_end: '2025-01-01T00:00:00Z',
        lga_name: 'Melbourne',
        property_type: 'All properties',
        median_rent: 615,
        count: 1500,
        status: 'observed',
      },
      {
        quarter: 'Dec 2024',
        quarter_code: '2024-Q4',
        period_start: '2024-10-01T00:00:00Z',
        period_end: '2025-01-01T00:00:00Z',
        lga_name: 'Yarra',
        property_type: 'All properties',
        median_rent: 675,
        count: 1592,
        status: 'observed',
      },
      {
        quarter: 'Dec 2024',
        quarter_code: '2024-Q4',
        period_start: '2024-10-01T00:00:00Z',
        period_end: '2025-01-01T00:00:00Z',
        lga_name: 'Buloke',
        property_type: 'All properties',
        median_rent: 310,
        count: 7,
        status: 'observed',
      },
    ],
  };

  // Period 2: Homes Victoria rents Q1 2025 (includes two regions, suppressed, missing, and unmatched records)
  const rentPayloadQ1: HomesVictoriaPayload = {
    results: [
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Melbourne',
        property_type: 'All properties',
        median_rent: 680,
        count: 1420,
        status: 'observed',
      },
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Yarra',
        property_type: 'All properties',
        median_rent: 700,
        count: 1628,
        status: 'observed',
      },
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Buloke',
        property_type: 'All properties',
        raw_count: '<4',
        raw_median: '-',
        count: null,
        median_rent: null,
        status: 'suppressed',
      },
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'French Island',
        property_type: 'All properties',
        raw_count: null,
        raw_median: null,
        count: null,
        median_rent: null,
        status: 'missing',
      },
      {
        quarter: 'Mar 2025',
        quarter_code: '2025-Q1',
        period_start: '2025-01-01T00:00:00Z',
        period_end: '2025-04-01T00:00:00Z',
        lga_name: 'Unknown Region',
        property_type: 'All properties',
        median_rent: 550,
        count: 30,
        status: 'observed',
      },
    ],
  };

  const normRentQ4 = normalizeRentalPayload(rentPayloadQ4, 'batch-rent-q4', '2026-09-28T00:00:00Z');
  const normRentQ1 = normalizeRentalPayload(rentPayloadQ1, 'batch-rent-q1', '2026-09-28T00:00:00Z');
  const rentResultQ4 = normalizeHomesVictoriaRents(
    { areaIndicators: normRentQ4.areaIndicators, sourceRecords: normRentQ4.sourceRecords },
    boundaryEvidence2025,
  );
  const rentResultQ1 = normalizeHomesVictoriaRents(
    { areaIndicators: normRentQ1.areaIndicators, sourceRecords: normRentQ1.sourceRecords },
    boundaryEvidence2025,
  );

  // Published batches
  const batchQ4 = makePublishedBatch('batch-rent-q4', 'homes_victoria.rents');
  const batchQ1 = makePublishedBatch('batch-rent-q1', 'homes_victoria.rents');
  insertBatchSqlite(db, batchQ4);
  insertBatchSqlite(db, batchQ1);

  // Source records
  for (const sr of [...normRentQ4.sourceRecords, ...normRentQ1.sourceRecords]) {
    insertSourceRecordSqlite(db, { ...sr, rights_status: 'verified_open' });
  }

  // Boundaries: Melbourne LGA 2025, Yarra LGA 2025, and historical vintage 2021 boundary
  const boundaryMelb2025 = boundaryEvidence2025.boundaries.find((b) => b.boundary_id === 'ASGS_LGA:24600:2025')!;
  const boundaryYarra2025 = boundaryEvidence2025.boundaries.find((b) => b.boundary_id === 'ASGS_LGA:27350:2025')!;
  const boundaryEvidenceHist2021 = boundaryEvidence2021.boundaries.find((b) => b.boundary_id === 'ASGS_LGA:24600:2021')!;

  const boundaryRecords: Boundary[] = [
    {
      boundary_id: boundaryMelb2025.boundary_id,
      version_id: normRentQ4.sourceRecords[0]!.version_id,
      scheme: boundaryMelb2025.scheme ?? 'ASGS_LGA',
      code: boundaryMelb2025.code ?? '24600',
      name: boundaryMelb2025.name ?? 'Melbourne',
      vintage: boundaryMelb2025.vintage ?? '2025',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[144.9,-37.8],[145.0,-37.8],[145.0,-37.7],[144.9,-37.7],[144.9,-37.8]]]}',
      valid_from: '2025-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: normRentQ4.sourceRecords[0]!.source_record_id,
      batch_id: 'batch-rent-q4',
      source_id: 'homes_victoria.rents',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
    },
    {
      boundary_id: boundaryYarra2025.boundary_id,
      version_id: normRentQ4.sourceRecords[1]!.version_id,
      scheme: boundaryYarra2025.scheme ?? 'ASGS_LGA',
      code: boundaryYarra2025.code ?? '27350',
      name: boundaryYarra2025.name ?? 'Yarra',
      vintage: boundaryYarra2025.vintage ?? '2025',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[144.98,-37.8],[145.02,-37.8],[145.02,-37.78],[144.98,-37.78],[144.98,-37.8]]]}',
      valid_from: '2025-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: normRentQ4.sourceRecords[1]!.source_record_id,
      batch_id: 'batch-rent-q4',
      source_id: 'homes_victoria.rents',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
    },
    {
      boundary_id: boundaryEvidenceHist2021.boundary_id,
      version_id: 'b-v2021',
      scheme: boundaryEvidenceHist2021.scheme ?? 'ASGS_LGA',
      code: boundaryEvidenceHist2021.code ?? '24600',
      name: boundaryEvidenceHist2021.name ?? 'Melbourne',
      vintage: boundaryEvidenceHist2021.vintage ?? '2021',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[144.9,-37.8],[145.0,-37.8],[145.0,-37.7],[144.9,-37.7],[144.9,-37.8]]]}',
      valid_from: '2021-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: normRentQ4.sourceRecords[0]!.source_record_id,
      batch_id: 'batch-rent-q4',
      source_id: 'homes_victoria.rents',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
    },
  ];

  for (const b of boundaryRecords) {
    insertBoundarySqlite(db, b);
  }

  // Insert all normalized rent indicators
  for (const ind of [...rentResultQ4.indicators, ...rentResultQ1.indicators]) {
    insertIndicatorSqlite(db, ind);
  }

  // Define indQ4 and indQ1 for subsequent negative gate tests
  const indQ4 = rentResultQ4.indicators.find((i) => i.boundary_id === 'ASGS_LGA:24600:2025')!;
  const indQ1 = rentResultQ1.indicators.find((i) => i.boundary_id === 'ASGS_LGA:24600:2025')!;

  // --------------------------------------------------------------------------
  // Assertion 1: Real SQL queries for two regions across two statistical periods
  // --------------------------------------------------------------------------
  // Region 1: Melbourne LGA across Q4 2024 and Q1 2025
  const melbRentRows = db.prepare(`
    SELECT * FROM v_area_indicators
    WHERE source_id = 'homes_victoria.rents' AND boundary_id = 'ASGS_LGA:24600:2025'
    ORDER BY period_start
  `).all() as Record<string, unknown>[];

  assert.equal(melbRentRows.length, 2, 'Melbourne must return both statistical periods from real normalizer output');
  assert.equal(melbRentRows[0]?.period_start, '2024-10-01T00:00:00Z');
  assert.equal(melbRentRows[0]?.value, 615);
  assert.equal(melbRentRows[0]?.boundary_mapping_status, 'matched');
  assert.equal(melbRentRows[0]?.boundary_name, 'Melbourne');
  assert.equal(melbRentRows[0]?.boundary_code, '24600');
  assert.equal(melbRentRows[0]?.unit, 'AUD/week');
  assert.ok(melbRentRows[0]?.source_record_id);
  assert.equal(melbRentRows[0]?.batch_id, 'batch-rent-q4');

  assert.equal(melbRentRows[1]?.period_start, '2025-01-01T00:00:00Z');
  assert.equal(melbRentRows[1]?.value, 680);
  assert.equal(melbRentRows[1]?.boundary_mapping_status, 'matched');
  assert.equal(melbRentRows[1]?.boundary_name, 'Melbourne');
  assert.equal(melbRentRows[1]?.boundary_code, '24600');
  assert.ok(melbRentRows[1]?.source_record_id);
  assert.equal(melbRentRows[1]?.batch_id, 'batch-rent-q1');

  // Region 2: Yarra LGA across Q4 2024 and Q1 2025
  const yarraRentRows = db.prepare(`
    SELECT * FROM v_area_indicators
    WHERE source_id = 'homes_victoria.rents' AND boundary_id = 'ASGS_LGA:27350:2025'
    ORDER BY period_start
  `).all() as Record<string, unknown>[];

  assert.equal(yarraRentRows.length, 2, 'Yarra must return both statistical periods from real normalizer output');
  assert.equal(yarraRentRows[0]?.period_start, '2024-10-01T00:00:00Z');
  assert.equal(yarraRentRows[0]?.value, 675);
  assert.equal(yarraRentRows[0]?.boundary_mapping_status, 'matched');
  assert.equal(yarraRentRows[0]?.boundary_name, 'Yarra');
  assert.equal(yarraRentRows[0]?.boundary_code, '27350');
  assert.equal(yarraRentRows[0]?.unit, 'AUD/week');
  assert.ok(yarraRentRows[0]?.source_record_id);
  assert.equal(yarraRentRows[0]?.batch_id, 'batch-rent-q4');

  assert.equal(yarraRentRows[1]?.period_start, '2025-01-01T00:00:00Z');
  assert.equal(yarraRentRows[1]?.value, 700);
  assert.equal(yarraRentRows[1]?.boundary_mapping_status, 'matched');
  assert.equal(yarraRentRows[1]?.boundary_name, 'Yarra');
  assert.equal(yarraRentRows[1]?.boundary_code, '27350');
  assert.ok(yarraRentRows[1]?.source_record_id);
  assert.equal(yarraRentRows[1]?.batch_id, 'batch-rent-q1');

  // Second source: CSA Crime Statistics across two regions and two annual periods
  const csaMultiYear = makeCsaFixture([
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 26000,
      ratePer100k: 17000,
      status: 'observed',
      periodStart: '2024-07-01T00:00:00Z',
      periodEnd: '2025-07-01T00:00:00Z',
      yearEnding: 2025,
    },
    {
      lgaName: 'Melbourne',
      lgaCode: '24600',
      count: 28450,
      ratePer100k: 18250.5,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
    {
      lgaName: 'Yarra',
      lgaCode: '27350',
      count: 10500,
      ratePer100k: 10400,
      status: 'observed',
      periodStart: '2024-07-01T00:00:00Z',
      periodEnd: '2025-07-01T00:00:00Z',
      yearEnding: 2025,
    },
    {
      lgaName: 'Yarra',
      lgaCode: '27350',
      count: 11200,
      ratePer100k: 11150.2,
      status: 'observed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
    {
      lgaName: 'Queenscliffe',
      lgaCode: '25810',
      count: null,
      ratePer100k: null,
      status: 'suppressed',
      periodStart: '2025-07-01T00:00:00Z',
      periodEnd: '2026-07-01T00:00:00Z',
      yearEnding: 2026,
    },
  ]);
  const csaMultiResult = normalizeCsaStatistics(csaMultiYear, boundaryEvidence2025);
  const csaBatch = makePublishedBatch('csa-test-run', 'victoria.csa.recorded_offences');
  insertBatchSqlite(db, csaBatch);
  for (const sr of csaMultiYear.sourceRecords) {
    insertSourceRecordSqlite(db, { ...sr, rights_status: 'verified_open' });
  }
  for (const ind of csaMultiResult.indicators) {
    insertIndicatorSqlite(db, ind);
  }

  const melbCsaSqlRows = db.prepare(`
    SELECT period_start, period_end, value, unit, boundary_mapping_status, boundary_name, source_record_id, batch_id
    FROM v_area_indicators
    WHERE source_id = 'victoria.csa.recorded_offences' AND boundary_id = 'ASGS_LGA:24600:2025' AND unit = 'recorded_offences'
    ORDER BY period_start
  `).all() as Record<string, unknown>[];
  assert.equal(melbCsaSqlRows.length, 2);
  assert.equal(melbCsaSqlRows[0]?.value, 26000);
  assert.equal(melbCsaSqlRows[1]?.value, 28450);
  assert.equal(melbCsaSqlRows[0]?.boundary_mapping_status, 'matched');
  assert.equal(melbCsaSqlRows[0]?.boundary_name, 'Melbourne');

  const yarraCsaSqlRows = db.prepare(`
    SELECT period_start, period_end, value, unit, boundary_mapping_status, boundary_name, source_record_id, batch_id
    FROM v_area_indicators
    WHERE source_id = 'victoria.csa.recorded_offences' AND boundary_id = 'ASGS_LGA:27350:2025' AND unit = 'recorded_offences'
    ORDER BY period_start
  `).all() as Record<string, unknown>[];
  assert.equal(yarraCsaSqlRows.length, 2);
  assert.equal(yarraCsaSqlRows[0]?.value, 10500);
  assert.equal(yarraCsaSqlRows[1]?.value, 11200);
  assert.equal(yarraCsaSqlRows[0]?.boundary_mapping_status, 'matched');
  assert.equal(yarraCsaSqlRows[0]?.boundary_name, 'Yarra');

  // --------------------------------------------------------------------------
  // Assertion 2: Suppressed and missing observations strictly remain NULL and never zero-fill in real SQL view
  // --------------------------------------------------------------------------
  const suppressedRentRows = db.prepare(`
    SELECT indicator_id, boundary_id, status, value, source_area_name
    FROM v_area_indicators
    WHERE source_id = 'homes_victoria.rents' AND status IN ('suppressed', 'missing')
  `).all() as Record<string, unknown>[];

  assert.equal(suppressedRentRows.length, 2, 'Must have suppressed and missing rent rows in SQL view');
  for (const row of suppressedRentRows) {
    assert.equal(row.value, null, 'Suppressed or missing rent value MUST be NULL in view, never zero-filled');
    assert.notEqual(row.value, 0, 'Zero-fill is strictly prohibited for suppressed/missing observations');
  }

  const suppressedCsaRows = db.prepare(`
    SELECT indicator_id, boundary_id, status, value, source_area_name
    FROM v_area_indicators
    WHERE source_id = 'victoria.csa.recorded_offences' AND status = 'suppressed'
  `).all() as Record<string, unknown>[];
  assert.ok(suppressedCsaRows.length > 0, 'Must have suppressed CSA rows in SQL view');
  for (const row of suppressedCsaRows) {
    assert.equal(row.value, null, 'Suppressed CSA count/rate MUST be NULL in view, never zero-filled');
    assert.notEqual(row.value, 0);
  }

  // --------------------------------------------------------------------------
  // Assertion 3: Unmatched rents cannot silently join in real SQL consumption view
  // --------------------------------------------------------------------------
  const unmatchedSqlRows = db.prepare(`
    SELECT indicator_id, boundary_id, boundary_scheme, boundary_code, boundary_name, boundary_vintage,
           boundary_mapping_status, source_area_name
    FROM v_area_indicators
    WHERE source_id = 'homes_victoria.rents' AND boundary_mapping_status = 'missing'
  `).all() as Record<string, unknown>[];

  assert.ok(unmatchedSqlRows.length >= 3, 'Buloke, French Island, and Unknown Region must be present with mapping status missing');
  for (const row of unmatchedSqlRows) {
    assert.equal(row.boundary_mapping_status, 'missing');
    assert.equal(row.boundary_scheme, null, 'Unmatched boundary must not have joined boundary_scheme');
    assert.equal(row.boundary_code, null, 'Unmatched boundary must not have joined boundary_code');
    assert.equal(row.boundary_name, null, 'Unmatched boundary must not have joined boundary_name');
    assert.equal(row.boundary_vintage, null, 'Unmatched boundary must not have joined boundary_vintage');
    assert.match(String(row.boundary_id), /:unresolved$/, 'Unmatched boundary ID must preserve unresolved tag');
  }

  // Boundary Vintage Isolation Barrier:
  // An indicator targeting 2026 cannot join to an existing 2021 or 2025 boundary even with identical area code/name
  const vintageMismatchIndicator: AreaIndicator = {
    ...indQ1,
    indicator_id: 'ind-cross-vintage-barrier-test',
    boundary_id: 'ASGS_LGA:24600:2026', // vintage 2026 does not exist in v_boundaries
    source_area_vintage: '2026',
    source_record_id: normRentQ1.sourceRecords[0]!.source_record_id,
  };
  insertIndicatorSqlite(db, vintageMismatchIndicator);

  const crossVintageRow = db.prepare(`
    SELECT boundary_id, boundary_mapping_status, boundary_name
    FROM v_area_indicators
    WHERE indicator_id = 'ind-cross-vintage-barrier-test'
  `).get() as Record<string, unknown>;

  assert.equal(crossVintageRow.boundary_mapping_status, 'missing', 'Cross-vintage boundary must not silently join');
  assert.equal(crossVintageRow.boundary_name, null);

  // Domain comparability fail-closed gate:
  const unmatchedBulokeInd = rentResultQ1.indicators.find((i) => i.source_area_name === 'Buloke')!;
  const matchedMelbInd = rentResultQ1.indicators.find((i) => i.source_area_name === 'Melbourne')!;
  assert.throws(
    () => assertComparableIndicators(matchedMelbInd, unmatchedBulokeInd),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'Unmatched rent indicator must fail closed when asserted comparable with a matched region',
  );

  // --------------------------------------------------------------------------
  // Assertion 2: Missing or invalid source records cannot be queried through consumption view
  // --------------------------------------------------------------------------
  // Non-existent source_record_id
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-nonexistent-sr',
    source_record_id: 'does-not-exist-sr',
  });
  const missingSrResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-nonexistent-sr'`).all();
  assert.equal(missingSrResult.length, 0, 'Indicator with non-existent source_record_id must be excluded by EXISTS check');

  // Source record exists, but rights_status is 'review_required' (not verified_open or restricted)
  insertSourceRecordSqlite(db, {
    ...normRentQ4.sourceRecords[0]!,
    source_record_id: 'sr-review-required',
    rights_status: 'review_required',
  });
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-unreviewed-sr',
    source_record_id: 'sr-review-required',
  });
  const unreviewedSrResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-unreviewed-sr'`).all();
  assert.equal(unreviewedSrResult.length, 0, 'Indicator with review_required SourceRecord must be excluded from view');

  // --------------------------------------------------------------------------
  // Assertion 3: Records from failed batches or unadmitted sources are excluded
  // --------------------------------------------------------------------------
  // Failed batch
  insertBatchSqlite(db, {
    ...batchQ4,
    batch_id: 'batch-failed-rent',
    state: 'failed',
    published_at: null,
  });
  insertSourceRecordSqlite(db, {
    ...normRentQ4.sourceRecords[0]!,
    batch_id: 'batch-failed-rent',
    source_record_id: 'sr-failed-batch',
  });
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-failed-batch',
    batch_id: 'batch-failed-rent',
    source_record_id: 'sr-failed-batch',
  });
  const failedBatchResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-failed-batch'`).all();
  assert.equal(failedBatchResult.length, 0, 'Indicator from failed batch must be excluded');

  // Running batch (published_at is null)
  insertBatchSqlite(db, {
    ...batchQ4,
    batch_id: 'batch-running-rent',
    state: 'running',
    published_at: null,
  });
  insertSourceRecordSqlite(db, {
    ...normRentQ4.sourceRecords[0]!,
    batch_id: 'batch-running-rent',
    source_record_id: 'sr-running-batch',
  });
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-running-batch',
    batch_id: 'batch-running-rent',
    source_record_id: 'sr-running-batch',
  });
  const runningBatchResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-running-batch'`).all();
  assert.equal(runningBatchResult.length, 0, 'Indicator from running/unpublished batch must be excluded');

  // Unadmitted source access_status: 'candidate'
  insertSourceSqlite(db, {
    ...rentsSource,
    source_id: 'source.candidate.unadmitted',
    access_status: 'candidate',
  });
  insertBatchSqlite(db, {
    ...batchQ4,
    batch_id: 'batch-candidate-source',
    source_id: 'source.candidate.unadmitted',
  });
  insertSourceRecordSqlite(db, {
    ...normRentQ4.sourceRecords[0]!,
    batch_id: 'batch-candidate-source',
    source_id: 'source.candidate.unadmitted',
    source_record_id: 'sr-candidate-source',
  });
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-candidate-source',
    source_id: 'source.candidate.unadmitted',
    batch_id: 'batch-candidate-source',
    source_record_id: 'sr-candidate-source',
  });
  const candidateSourceResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-candidate-source'`).all();
  assert.equal(candidateSourceResult.length, 0, 'Indicator from candidate source must be excluded');

  // Unadmitted source license_status: 'review_required'
  insertSourceSqlite(db, {
    ...rentsSource,
    source_id: 'source.review.license',
    license_status: 'review_required',
  });
  insertBatchSqlite(db, {
    ...batchQ4,
    batch_id: 'batch-review-license',
    source_id: 'source.review.license',
  });
  insertSourceRecordSqlite(db, {
    ...normRentQ4.sourceRecords[0]!,
    batch_id: 'batch-review-license',
    source_id: 'source.review.license',
    source_record_id: 'sr-review-license',
  });
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-review-license',
    source_id: 'source.review.license',
    batch_id: 'batch-review-license',
    source_record_id: 'sr-review-license',
  });
  const reviewLicenseResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-review-license'`).all();
  assert.equal(reviewLicenseResult.length, 0, 'Indicator from review_required license source must be excluded');

  // Mismatched batch_id between indicator and batch's source_id
  insertIndicatorSqlite(db, {
    ...indQ4,
    indicator_id: 'ind-mismatched-batch',
    batch_id: 'csa-test-run', // CSA batch belongs to CSA source, not rents
  });
  const mismatchedBatchResult = db.prepare(`SELECT * FROM v_area_indicators WHERE indicator_id = 'ind-mismatched-batch'`).all();
  assert.equal(mismatchedBatchResult.length, 0, 'Indicator with batch_id belonging to different source must be excluded');

  // --------------------------------------------------------------------------
  // Assertion 4: Correction version supersedes previous version; late-arriving old version does not revert
  // --------------------------------------------------------------------------
  const baseVersion: AreaIndicator = {
    ...indQ1,
    status: 'observed',
    indicator_id: 'ind-version-ordering-test',
    version_id: 'v1_original',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: 1,
    value: 680,
  };
  insertIndicatorSqlite(db, baseVersion);

  let versionQuery = db.prepare(`SELECT version_id, value FROM v_area_indicators WHERE indicator_id = 'ind-version-ordering-test'`).all() as Record<string, unknown>[];
  assert.equal(versionQuery.length, 1);
  assert.equal(versionQuery[0]?.version_id, 'v1_original');
  assert.equal(versionQuery[0]?.value, 680);

  // Newer corrected version arrives
  const correctedVersion: AreaIndicator = {
    ...indQ1,
    status: 'observed',
    indicator_id: 'ind-version-ordering-test',
    version_id: 'v2_corrected',
    source_updated_at: '2026-09-28T02:00:00Z',
    source_version_ordinal: 2,
    value: 710,
  };
  insertIndicatorSqlite(db, correctedVersion);

  versionQuery = db.prepare(`SELECT version_id, value FROM v_area_indicators WHERE indicator_id = 'ind-version-ordering-test'`).all() as Record<string, unknown>[];
  assert.equal(versionQuery.length, 1, 'View must deduplicate to single latest version');
  assert.equal(versionQuery[0]?.version_id, 'v2_corrected', 'Corrected version must supersede original version');
  assert.equal(versionQuery[0]?.value, 710);

  // Late-arriving old version arrives / replays
  const lateOldVersion: AreaIndicator = {
    ...baseVersion,
    version_id: 'v1_replayed_late',
    source_updated_at: '2026-09-28T01:00:00Z',
    source_version_ordinal: 1,
  };
  insertIndicatorSqlite(db, lateOldVersion);

  versionQuery = db.prepare(`SELECT version_id, value FROM v_area_indicators WHERE indicator_id = 'ind-version-ordering-test'`).all() as Record<string, unknown>[];
  assert.equal(versionQuery.length, 1);
  assert.equal(versionQuery[0]?.version_id, 'v2_corrected', 'Late arriving old version must NOT revert corrected version');
  assert.equal(versionQuery[0]?.value, 710);
});

// ============================================================================
// Test Suite 7: GCP Acceptance (Real GoogleSQL v_area_indicators / v_boundaries)
// Opt-in only: creates disposable Melbourne datasets and bucket.
// Run with MELENS_PUBLISH_TEST_PROJECT=<dev-project> MELENS_PUBLISH_TEST_ALLOW_CREATE=1.
// ============================================================================
const devProject = process.env.MELENS_PUBLISH_TEST_PROJECT;
test('US3 Section 7: GCP acceptance: real GoogleSQL v_area_indicators and v_boundaries consumption gate', {
  skip: !devProject || process.env.MELENS_PUBLISH_TEST_ALLOW_CREATE !== '1'
    ? 'pending GCP verification (requires MELENS_PUBLISH_TEST_PROJECT and MELENS_PUBLISH_TEST_ALLOW_CREATE=1)'
    : false,
  timeout: 1_800_000,
}, async () => {
  assert.ok(devProject);
  const id = randomUUID().replaceAll('-', '').slice(0, 16);
  const cloudConfig: DataConfig = {
    projectId: devProject,
    region: 'australia-southeast2',
    bucketName: `melens-area-test-${id}`,
    ingestDataset: `area_test_${id}`,
    queryDataset: `area_views_${id}`,
    secretNames: [],
  };
  const bq = new BigQuery({ projectId: devProject, location: cloudConfig.region });
  const storage = new Storage({ projectId: devProject });
  const store = new GcsStore(storage, cloudConfig.bucketName);
  const publisher = new BigQueryPublisher(cloudConfig, bq, store);
  const createdDatasets: string[] = [];
  let createdBucket = false;

  const query = async (sql: string, params: Record<string, unknown> = {}) => {
    const [rows] = await bq.query({ query: sql, params, location: cloudConfig.region, maximumBytesBilled: '100000000' });
    return z.array(z.record(z.string(), z.unknown())).parse(rows);
  };

  try {
    for (const name of [cloudConfig.ingestDataset, cloudConfig.queryDataset]) {
      await bq.createDataset(name, { location: cloudConfig.region });
      createdDatasets.push(name);
    }
    await storage.createBucket(cloudConfig.bucketName, {
      location: cloudConfig.region,
      iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
      softDeletePolicy: { retentionDurationSeconds: 0 },
    });
    createdBucket = true;

    const qualify = (sql: string) => sql
      .replaceAll('`melens_ingest.', `\`${devProject}.${cloudConfig.ingestDataset}.`)
      .replaceAll('`melens_query.', `\`${devProject}.${cloudConfig.queryDataset}.`);

    await query(qualify(await readSql('001_tables.sql')));
    await query(qualify(await readSql('006_area_views.sql')));

    // 1. Prepare real normalizer output across two statistical periods
    const rentSource: DataSource = {
      source_id: 'homes_victoria.rents',
      legacy_ids: [],
      provider: 'Homes Victoria',
      dataset_title: 'Quarterly Rental Report',
      landing_url: 'https://example.vic.gov.au/rents',
      topic: 'housing',
      scope: 'greater_melbourne',
      coverage_area_refs: ['ASGS_LGA:24600:2025'],
      coverage_from: '2024-10-01T00:00:00Z',
      coverage_to: '2025-04-01T00:00:00Z',
      cadence_seconds: null,
      check_interval_seconds: 3600,
      record_granularity: 'observation',
      admission_evidence: defaultAdmissionEvidence,
      connector_owner: 'integrator',
      license_status: 'verified_open',
      access_status: 'active',
      last_checked_at: null,
      last_success_at: null,
      last_source_update_at: null,
    };

    const rentPayloadQ4: HomesVictoriaPayload = {
      results: [
        {
          quarter: 'Dec 2024',
          quarter_code: '2024-Q4',
          period_start: '2024-10-01T00:00:00Z',
          period_end: '2025-01-01T00:00:00Z',
          lga_name: 'Melbourne',
          property_type: 'All properties',
          median_rent: 615,
          count: 1500,
          status: 'observed',
        },
        {
          quarter: 'Dec 2024',
          quarter_code: '2024-Q4',
          period_start: '2024-10-01T00:00:00Z',
          period_end: '2025-01-01T00:00:00Z',
          lga_name: 'Yarra',
          property_type: 'All properties',
          median_rent: 675,
          count: 1592,
          status: 'observed',
        },
      ],
    };
    const rentPayloadQ1: HomesVictoriaPayload = {
      results: [
        {
          quarter: 'Mar 2025',
          quarter_code: '2025-Q1',
          period_start: '2025-01-01T00:00:00Z',
          period_end: '2025-04-01T00:00:00Z',
          lga_name: 'Melbourne',
          property_type: 'All properties',
          median_rent: 680,
          count: 1420,
          status: 'observed',
        },
        {
          quarter: 'Mar 2025',
          quarter_code: '2025-Q1',
          period_start: '2025-01-01T00:00:00Z',
          period_end: '2025-04-01T00:00:00Z',
          lga_name: 'Yarra',
          property_type: 'All properties',
          median_rent: 700,
          count: 1628,
          status: 'observed',
        },
        {
          quarter: 'Mar 2025',
          quarter_code: '2025-Q1',
          period_start: '2025-01-01T00:00:00Z',
          period_end: '2025-04-01T00:00:00Z',
          lga_name: 'Buloke',
          property_type: 'All properties',
          raw_count: '<4',
          raw_median: '-',
          count: null,
          median_rent: null,
          status: 'suppressed',
        },
      ],
    };

    const normRentQ4 = normalizeRentalPayload(rentPayloadQ4, 'gcp-rent-q4', '2026-09-28T00:00:00Z');
    const normRentQ1 = normalizeRentalPayload(rentPayloadQ1, 'gcp-rent-q1', '2026-09-28T00:00:00Z');
    const rentResultQ4 = normalizeHomesVictoriaRents(
      { areaIndicators: normRentQ4.areaIndicators, sourceRecords: normRentQ4.sourceRecords },
      boundaryEvidence2025,
    );
    const rentResultQ1 = normalizeHomesVictoriaRents(
      { areaIndicators: normRentQ1.areaIndicators, sourceRecords: normRentQ1.sourceRecords },
      boundaryEvidence2025,
    );

    const boundaryLga = boundaryEvidence2025.boundaries.find((b) => b.boundary_id === 'ASGS_LGA:24600:2025')!;
    const boundaryYarraLga = boundaryEvidence2025.boundaries.find((b) => b.boundary_id === 'ASGS_LGA:27350:2025')!;

    const boundaryQ4: Boundary = {
      boundary_id: boundaryLga.boundary_id,
      version_id: normRentQ4.sourceRecords[0]!.version_id,
      scheme: boundaryLga.scheme ?? 'ASGS_LGA',
      code: boundaryLga.code ?? '24600',
      name: boundaryLga.name ?? 'Melbourne',
      vintage: boundaryLga.vintage ?? '2025',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[144.9,-37.8],[145.0,-37.8],[145.0,-37.7],[144.9,-37.7],[144.9,-37.8]]]}',
      valid_from: '2025-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: normRentQ4.sourceRecords[0]!.source_record_id,
      batch_id: 'gcp-rent-q4',
      source_id: 'homes_victoria.rents',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
    };

    const boundaryYarraQ4: Boundary = {
      boundary_id: boundaryYarraLga.boundary_id,
      version_id: normRentQ4.sourceRecords[1]!.version_id,
      scheme: boundaryYarraLga.scheme ?? 'ASGS_LGA',
      code: boundaryYarraLga.code ?? '27350',
      name: boundaryYarraLga.name ?? 'Yarra',
      vintage: boundaryYarraLga.vintage ?? '2025',
      geometry_geojson: '{"type":"Polygon","coordinates":[[[144.98,-37.8],[145.02,-37.8],[145.02,-37.78],[144.98,-37.78],[144.98,-37.8]]]}',
      valid_from: '2025-01-01T00:00:00Z',
      valid_to: null,
      source_record_id: normRentQ4.sourceRecords[1]!.source_record_id,
      batch_id: 'gcp-rent-q4',
      source_id: 'homes_victoria.rents',
      schema_version: 1,
      fetched_at: '2026-09-28T00:00:00Z',
    };

    // Publish Period 1 (Q4 2024)
    const successQ4: ConnectorSuccess = {
      kind: 'success',
      sourceId: 'homes_victoria.rents',
      runId: 'gcp-rent-q4',
      fetchedAt: '2026-09-28T00:00:00Z',
      sourceRevision: 'rents-2024-q4',
      sourceLatestUpdateAt: '2026-09-28T00:00:00Z',
      checkpointAfter: '2025-01-01T00:00:00Z',
      completeness: {
        complete: true,
        method: 'feed_snapshot',
        expected_records: 2,
        fetched_records: 2,
        expected_pages: 1,
        fetched_pages: 1,
        evidence: 'fixture',
      },
      inputCount: 2,
      outputCount: 2,
      rejectedCount: 0,
      sourceRecords: normRentQ4.sourceRecords.map(sr => ({
        ...sr, source_updated_at: '2025-01-01T00:00:00Z',
      })),
      geoRecords: [],
      geoRecordSources: [],
      boundaries: [boundaryQ4, boundaryYarraQ4],
      areaIndicators: rentResultQ4.indicators,
      parkingBays: [],
      parkingObservations: [],
      parkingRules: [],
      sensorLocations: [],
      pedestrianObservations: [],
      retainableRawRecords: null,
    };
    const publishedQ4 = await publisher.publish({
      source: rentSource,
      initialCheckpoint: '2024-10-01T00:00:00Z',
      windowFrom: '2024-10-01T00:00:00Z',
      windowTo: '2025-01-01T00:00:00Z',
      result: successQ4,
    });
    assert.equal(publishedQ4.state, 'published');

    // Publish Period 2 (Q1 2025)
    const boundaryQ1: Boundary = {
      ...boundaryQ4,
      version_id: normRentQ1.sourceRecords[0]!.version_id,
      source_record_id: normRentQ1.sourceRecords[0]!.source_record_id,
    };
    const boundaryYarraQ1: Boundary = {
      ...boundaryYarraQ4,
      version_id: normRentQ1.sourceRecords[1]!.version_id,
      source_record_id: normRentQ1.sourceRecords[1]!.source_record_id,
    };
    const successQ1: ConnectorSuccess = {
      kind: 'success',
      sourceId: 'homes_victoria.rents',
      runId: 'gcp-rent-q1',
      fetchedAt: '2026-09-28T00:00:00Z',
      sourceRevision: 'rents-2025-q1',
      sourceLatestUpdateAt: '2026-09-28T00:00:00Z',
      checkpointAfter: '2025-04-01T00:00:00Z',
      completeness: {
        complete: true,
        method: 'feed_snapshot',
        expected_records: 3,
        fetched_records: 3,
        expected_pages: 1,
        fetched_pages: 1,
        evidence: 'fixture',
      },
      inputCount: 3,
      outputCount: 3,
      rejectedCount: 0,
      sourceRecords: normRentQ1.sourceRecords.map(sr => ({
        ...sr, source_updated_at: '2025-04-01T00:00:00Z',
      })),
      geoRecords: [],
      geoRecordSources: [],
      boundaries: [boundaryQ1, boundaryYarraQ1],
      areaIndicators: rentResultQ1.indicators,
      parkingBays: [],
      parkingObservations: [],
      parkingRules: [],
      sensorLocations: [],
      pedestrianObservations: [],
      retainableRawRecords: null,
    };
    const publishedQ1 = await publisher.publish({
      source: rentSource,
      initialCheckpoint: '2025-01-01T00:00:00Z',
      windowFrom: '2025-01-01T00:00:00Z',
      windowTo: '2025-04-01T00:00:00Z',
      result: successQ1,
    });
    assert.equal(publishedQ1.state, 'published');

    // 2. Real GoogleSQL Query & Assertions on v_boundaries
    const boundaryRows = await query(`
      SELECT boundary_id, scheme, code, name, vintage
      FROM \`${devProject}.${cloudConfig.queryDataset}.v_boundaries\`
      WHERE boundary_id IN ('ASGS_LGA:24600:2025', 'ASGS_LGA:27350:2025')
      ORDER BY code
    `);
    assert.equal(boundaryRows.length, 2);
    assert.equal(boundaryRows[0]?.boundary_id, 'ASGS_LGA:24600:2025');
    assert.equal(boundaryRows[0]?.name, 'Melbourne');
    assert.equal(boundaryRows[1]?.boundary_id, 'ASGS_LGA:27350:2025');
    assert.equal(boundaryRows[1]?.name, 'Yarra');

    // 3. Real GoogleSQL Query & Assertions on v_area_indicators across 2 periods and 2 regions
    const indicatorRows = await query(`
      SELECT indicator_id, boundary_id, boundary_mapping_status, boundary_name,
             period_start, period_end, value, unit, status, assertion_kind,
             source_record_id, source_id, batch_id
      FROM \`${devProject}.${cloudConfig.queryDataset}.v_area_indicators\`
      WHERE source_id = 'homes_victoria.rents'
      ORDER BY boundary_name, period_start
    `);
    const melbRows = indicatorRows.filter((r) => r.boundary_name === 'Melbourne');
    const yarraRows = indicatorRows.filter((r) => r.boundary_name === 'Yarra');
    const suppressedGcpRows = indicatorRows.filter((r) => r.status === 'suppressed');
    const unmatchedGcpRows = indicatorRows.filter((r) => r.boundary_mapping_status === 'missing');

    assert.equal(melbRows.length, 2, 'Melbourne must return two periods');
    assert.equal(melbRows[0]?.value, 615);
    assert.equal(melbRows[1]?.value, 680);
    assert.equal(yarraRows.length, 2, 'Yarra must return two periods');
    assert.equal(yarraRows[0]?.value, 675);
    assert.equal(yarraRows[1]?.value, 700);

    assert.ok(suppressedGcpRows.length > 0, 'Must have suppressed rent row');
    assert.equal(suppressedGcpRows[0]?.value, null, 'Suppressed rent must have NULL value in GoogleSQL');
    assert.ok(unmatchedGcpRows.length > 0, 'Must have unmatched rent row');
    assert.equal(unmatchedGcpRows[0]?.boundary_mapping_status, 'missing');
    assert.equal(unmatchedGcpRows[0]?.boundary_name, null, 'Unmatched rent cannot silently join in GoogleSQL');

    // 4. Gate: Missing or invalid source record cannot be queried
    await query(`
      INSERT INTO \`${devProject}.${cloudConfig.ingestDataset}.area_indicators\`
        (indicator_id, version_id, boundary_id, period_start, period_end, value, unit,
         status, assertion_kind, source_record_id, batch_id, source_id, schema_version, fetched_at)
      VALUES
        ('gcp-ind-missing-sr', 'v1', 'ASGS_LGA:24600:2025', TIMESTAMP('2024-10-01T00:00:00Z'),
         TIMESTAMP('2025-01-01T00:00:00Z'), 999, 'AUD/week', 'observed', 'observation',
         'does-not-exist-sr', @batchId, 'homes_victoria.rents', 1, TIMESTAMP('2026-09-28T00:00:00Z'))
    `, { batchId: String(indicatorRows[0]?.batch_id) });
    const missingSrQuery = await query(`
      SELECT indicator_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_area_indicators\`
      WHERE indicator_id = 'gcp-ind-missing-sr'
    `);
    assert.equal(missingSrQuery.length, 0, 'Missing source record must fail GoogleSQL consumption gate');

    // 5. Gate: Excluded failed batch
    await query(`
      INSERT INTO \`${devProject}.${cloudConfig.ingestDataset}.sync_batches\`
        (batch_id, source_id, schema_version, started_at, state, state_updated_at, published_at)
      VALUES
        ('gcp-batch-failed', 'homes_victoria.rents', 1, TIMESTAMP('2026-09-28T00:00:00Z'),
         'failed', TIMESTAMP('2026-09-28T00:01:00Z'), NULL)
    `);
    await query(`
      INSERT INTO \`${devProject}.${cloudConfig.ingestDataset}.source_records\`
        (source_record_id, version_id, batch_id, source_id, schema_version, fetched_at, rights_status, record_status, assertion_kind)
      VALUES
        ('sr-failed-gcp', 'v1', 'gcp-batch-failed', 'homes_victoria.rents', 1, TIMESTAMP('2026-09-28T00:00:00Z'), 'verified_open', 'active', 'observation')
    `);
    await query(`
      INSERT INTO \`${devProject}.${cloudConfig.ingestDataset}.area_indicators\`
        (indicator_id, version_id, boundary_id, period_start, period_end, value, unit,
         status, assertion_kind, source_record_id, batch_id, source_id, schema_version, fetched_at)
      VALUES
        ('gcp-ind-failed-batch', 'v1', 'ASGS_LGA:24600:2025', TIMESTAMP('2024-10-01T00:00:00Z'),
         TIMESTAMP('2025-01-01T00:00:00Z'), 999, 'AUD/week', 'observed', 'observation',
         'sr-failed-gcp', 'gcp-batch-failed', 'homes_victoria.rents', 1, TIMESTAMP('2026-09-28T00:00:00Z'))
    `);
    const failedBatchQuery = await query(`
      SELECT indicator_id FROM \`${devProject}.${cloudConfig.queryDataset}.v_area_indicators\`
      WHERE indicator_id = 'gcp-ind-failed-batch'
    `);
    assert.equal(failedBatchQuery.length, 0, 'Failed batch indicators must be excluded from GoogleSQL consumption view');

    // 6. Gate: Correction version supersedes previous version; late-arriving old version does not revert
    const correctionSuccess: ConnectorSuccess = {
      ...successQ1,
      runId: 'gcp-rent-q1-correction',
      sourceRevision: 'rents-2025-q1-corr',
      sourceLatestUpdateAt: '2026-09-28T02:00:00Z',
      sourceRecords: [{
        ...normRentQ1.sourceRecords[0]!,
        version_id: 'sr_q1_v2',
        source_updated_at: '2026-09-28T02:00:00Z',
        source_version_ordinal: 2,
      }],
      boundaries: [],
      areaIndicators: [{
        ...rentResultQ1.indicators[0]!,
        status: 'observed',
        version_id: 'ind_q1_v2',
        source_updated_at: '2026-09-28T02:00:00Z',
        source_version_ordinal: 2,
        value: 700,
        source_record_id: 'sr_q1_v2',
      }],
    };
    await publisher.publish({
      source: rentSource,
      initialCheckpoint: '2025-01-01T00:00:00Z',
      windowFrom: '2025-01-01T00:00:00Z',
      windowTo: '2025-04-01T00:00:00Z',
      result: correctionSuccess,
    });

    const correctedQuery = await query(`
      SELECT version_id, value
      FROM \`${devProject}.${cloudConfig.queryDataset}.v_area_indicators\`
      WHERE source_id = 'homes_victoria.rents' AND period_start = TIMESTAMP('2025-01-01T00:00:00Z')
    `);
    assert.equal(correctedQuery.length, 1);
    assert.equal(correctedQuery[0]?.version_id, 'ind_q1_v2', 'Correction version supersedes previous version');
    assert.equal(correctedQuery[0]?.value, 700);

    // Replay/insert older version: late arriving old version does not revert
    const lateOldSuccess: ConnectorSuccess = {
      ...successQ1,
      runId: 'gcp-rent-q1-late-old',
      sourceRevision: 'rents-2025-q1-late-old',
      sourceLatestUpdateAt: '2026-09-28T00:30:00Z',
      sourceRecords: [{
        ...normRentQ1.sourceRecords[0]!,
        version_id: 'sr_q1_late_old',
        source_updated_at: '2026-09-28T00:30:00Z',
        source_version_ordinal: 1,
      }],
      boundaries: [],
      areaIndicators: [{
        ...rentResultQ1.indicators[0]!,
        status: 'observed',
        version_id: 'ind_q1_late_old',
        source_updated_at: '2026-09-28T00:30:00Z',
        source_version_ordinal: 1,
        value: 650,
        source_record_id: 'sr_q1_late_old',
      }],
    };
    await publisher.publish({
      source: rentSource,
      initialCheckpoint: '2025-01-01T00:00:00Z',
      windowFrom: '2025-01-01T00:00:00Z',
      windowTo: '2025-04-01T00:00:00Z',
      result: lateOldSuccess,
    });

    const afterLateQuery = await query(`
      SELECT version_id, value
      FROM \`${devProject}.${cloudConfig.queryDataset}.v_area_indicators\`
      WHERE source_id = 'homes_victoria.rents' AND period_start = TIMESTAMP('2025-01-01T00:00:00Z')
    `);
    assert.equal(afterLateQuery.length, 1);
    assert.equal(afterLateQuery[0]?.version_id, 'ind_q1_v2', 'Late arriving old version must not revert current corrected version');
    assert.equal(afterLateQuery[0]?.value, 700);
  } finally {
    await Promise.allSettled([
      ...createdDatasets.map((name) => bq.dataset(name).delete({ force: true })),
      ...(createdBucket
        ? [
            (async () => {
              const bucket = storage.bucket(cloudConfig.bucketName);
              await bucket.deleteFiles({ force: true });
              await bucket.delete();
            })(),
          ]
        : []),
    ]);
  }
});
