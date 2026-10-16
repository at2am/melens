import { createHash } from 'node:crypto';

import type {
  CensusPayload,
  NormalizedCensusResult,
} from '../connectors/abs_census/index.js';
import { normalizeCensusPayload } from '../connectors/abs_census/index.js';
import type {
  ClueEmploymentRawRow,
} from '../connectors/com_clue_employment/index.js';
import { normalizeClueEmploymentRow } from '../connectors/com_clue_employment/index.js';
import type { CsaOffenceStat, CsaSuccess } from '../connectors/csa_recorded_offences/index.js';
import type {
  HomesVictoriaPayload,
  HomesVictoriaRentRawRecord,
} from '../connectors/homes_victoria_rents/index.js';
import { normalizeRentalPayload } from '../connectors/homes_victoria_rents/index.js';
import type { ConnectorSuccess } from '../core/connector.js';
import type { AreaIndicator, Boundary, SourceRecord } from '../core/types.js';
import { validateCrosswalkTarget } from './areas.js';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** A normalization key, not a claim that two administrative vintages coincide. */
export function areaNameKey(name: string): string {
  const normalized = name.normalize('NFKC').toLowerCase()
    .replace(/\s*\(vic\.\)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  if (!normalized) throw new Error('Area name is empty after normalization');
  return normalized;
}

export interface AreaBoundaryEvidence {
  /** An independently attested source geography vintage. A target boundary name/code index alone is insufficient. */
  sourceAreaVintage: string;
  boundaries: readonly (Pick<Boundary, 'boundary_id' | 'scheme' | 'name' | 'vintage'> & Partial<Pick<Boundary, 'code'>>)[];
  /** Reviewed explicit crosswalk. Every target must also be present in boundaries at its actual scheme/code/vintage. */
  crosswalk?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
}

export interface NormalizedAreaIndicatorsResult {
  indicators: AreaIndicator[];
  mapped: number;
  unresolved: number;
}

function getCrosswalkTarget(
  crosswalk: ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined,
  ...keys: (string | null | undefined)[]
): string | null {
  if (!crosswalk) return null;
  for (const key of keys) {
    if (!key) continue;
    if (crosswalk instanceof Map) {
      const val = crosswalk.get(key);
      if (val) return val;
    } else if (typeof crosswalk === 'object') {
      const val = (crosswalk as Record<string, string>)[key];
      if (val) return val;
    }
  }
  return null;
}

/**
 * Enforce T058 Invariants:
 *  - assertion_kind: strictly 'observation'
 *  - status: strictly 'observed' | 'suppressed' | 'missing'
 *  - ONLY 'observed' status may have a numeric value
 *  - 'suppressed' and 'missing' status MUST have value: null (never zero-filled)
 */
export function enforceAreaIndicatorInvariants(indicator: AreaIndicator): AreaIndicator {
  const raw = indicator as unknown as { assertion_kind?: unknown; status?: unknown; value?: unknown };
  if (raw.assertion_kind !== 'observation') {
    throw new Error(`Invalid assertion_kind: "${String(raw.assertion_kind)}". Must be strictly "observation"`);
  }
  if (raw.status !== 'observed' && raw.status !== 'suppressed' && raw.status !== 'missing') {
    throw new Error(`Invalid status: "${String(raw.status)}". Must be "observed", "suppressed", or "missing"`);
  }
  if (raw.status === 'observed') {
    if (raw.value === null || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) {
      throw new Error(`Observed indicator must have a finite numeric value, got: ${String(raw.value)}`);
    }
  } else {
    if (raw.value !== null) {
      throw new Error(
        `Suppressed and missing indicators MUST have value: null, never zero-filled. Got: ${String(raw.value)} with status: ${String(raw.status)}`
      );
    }
  }
  return indicator;
}

/**
 * Validates cross-vintage / cross-scheme comparability.
 * Cross-year / cross-vintage comparisons require explicit boundary vintage mapping;
 * unresolved boundaries must not be silently joined across vintages.
 */
export function assertComparableIndicators(
  from: AreaIndicator,
  to: AreaIndicator,
  explicitMapping?: ReadonlyMap<string, string> | Readonly<Record<string, string>> | null,
): void {
  const isUnresolved = (id: string) => !id || id.toLowerCase().includes('unresolved');
  if (
    from.boundary_id === to.boundary_id &&
    !isUnresolved(from.boundary_id) &&
    from.source_area_vintage !== null &&
    from.source_area_vintage !== undefined &&
    from.source_area_vintage === to.source_area_vintage
  ) {
    return;
  }
  const mappingTarget = getCrosswalkTarget(explicitMapping ?? undefined, from.boundary_id);
  if (mappingTarget === to.boundary_id && !isUnresolved(to.boundary_id)) {
    return;
  }
  throw new Error(
    `Cross-vintage or unresolved boundary comparison between "${from.boundary_id}" and "${to.boundary_id}" requires an explicit boundary mapping`
  );
}

function boundaryFor(name: string, evidence: AreaBoundaryEvidence | null): string | null {
  if (!evidence) return null;
  const matches = evidence.boundaries.filter(boundary => boundary.scheme === 'ASGS_LGA'
    && boundary.vintage === evidence.sourceAreaVintage
    && boundary.name.trim() === name.trim());
  if (matches.length > 1) throw new Error(`Ambiguous official LGA name: ${name}`);
  const boundary = matches[0];
  return boundary ? validateCrosswalkTarget({ boundaryId: boundary.boundary_id,
    boundaries: evidence.boundaries, allowedSchemes: ['ASGS_LGA'] }) : null;
}

function metric(stat: CsaOffenceStat, kind: 'count' | 'rate', boundaryId: string,
  evidence: AreaBoundaryEvidence | null, base: AreaIndicator): AreaIndicator {
  const observed = kind === 'count' ? stat.status === 'observed' : stat.ratePer100k !== null;
  const status = observed ? 'observed' : kind === 'count' ? stat.status :
    stat.status === 'suppressed' ? 'suppressed' : 'missing';
  const value = observed ? kind === 'count' ? stat.count : stat.ratePer100k : null;
  const common = {
    ...base,
    indicator_id: digest(`csa:${kind}:${stat.sourceRecordId}`),
    version_id: digest(`${stat.versionId}\0${kind}\0${boundaryId}\0${status}\0${value}`),
    boundary_id: boundaryId,
    unit: kind === 'count' ? 'recorded_offences' : 'per_100000_population',
    definition: kind === 'count'
      ? 'CSA Table 01 recorded offences over the rolling 12 months ending in the stated quarter'
      : 'CSA Table 01 recorded offences per 100,000 population over the rolling 12 months ending in the stated quarter',
    source_area_name: stat.lgaName,
    source_area_code: stat.lgaCode,
    source_area_vintage: boundaryId.endsWith(':unresolved') ? null : (evidence?.sourceAreaVintage ?? null),
  };
  return enforceAreaIndicatorInvariants(status === 'observed'
    ? { ...common, status, value: value as number }
    : { ...common, status, value: null });
}

/** Preserve all CSA values even when the workbook omits official LGA code/vintage. */
export function normalizeCsaStatistics(result: CsaSuccess,
  evidence: AreaBoundaryEvidence | null = null): NormalizedAreaIndicatorsResult {
  if (result.kind !== 'success') throw new Error('Only complete CSA results may be normalized');
  const records = new Map(result.sourceRecords.map(record => [record.source_record_id, record]));
  const indicators: AreaIndicator[] = [];
  let mapped = 0;
  let unresolved = 0;
  for (const stat of result.statistics) {
    const source = records.get(stat.sourceRecordId);
    if (!source || source.version_id !== stat.versionId) {
      throw new Error('CSA statistic lacks its matching source record');
    }
    const crosswalkTarget = getCrosswalkTarget(evidence?.crosswalk, stat.lgaName, stat.sourceRecordId);
    const officialBoundaryId = crosswalkTarget && evidence
      ? validateCrosswalkTarget({ boundaryId: crosswalkTarget, boundaries: evidence.boundaries,
        allowedSchemes: ['ASGS_LGA'] })
      : boundaryFor(stat.lgaName, evidence);
    if (officialBoundaryId) mapped += 1;
    else unresolved += 1;
    const boundaryId = officialBoundaryId
      ?? `CSA_LGA_NAME:${areaNameKey(stat.lgaName).replace(/ /g, '_')}:unresolved`;
    const base: AreaIndicator = {
      batch_id: source.batch_id, source_id: source.source_id,
      schema_version: source.schema_version, fetched_at: source.fetched_at,
      indicator_id: '', version_id: '', boundary_id: boundaryId,
      period_start: stat.periodStart, period_end: stat.periodEndExclusive,
      status: 'missing', value: null, unit: '', assertion_kind: 'observation',
      source_record_id: stat.sourceRecordId, definition: '',
      source_updated_at: source.source_updated_at,
      source_version_ordinal: source.source_version_ordinal,
    };
    indicators.push(metric(stat, 'count', boundaryId, evidence, base));
    indicators.push(metric(stat, 'rate', boundaryId, evidence, base));
  }
  return { indicators, mapped, unresolved };
}

/**
 * Normalizes ABS Census DataPacks into AreaIndicators.
 * Enforces:
 *  - suppression preservation (status: 'suppressed' | 'missing', value: null, NEVER zero-filled)
 *  - unit preservation ('persons', 'years', 'aud_weekly', etc.)
 *  - boundary mapping against official ASGS geography when matching vintage evidence is provided
 *  - vintage mismatch rejection (cross-vintage joining forbidden without explicit crosswalk)
 */
export function normalizeAbsCensusStatistics(
  input:
    | ConnectorSuccess
    | NormalizedCensusResult
    | CensusPayload
    | { readonly areaIndicators: readonly AreaIndicator[]; readonly sourceRecords?: readonly SourceRecord[] }
    | readonly AreaIndicator[],
  evidence: AreaBoundaryEvidence | null = null,
): NormalizedAreaIndicatorsResult {
  let baseIndicators: readonly AreaIndicator[];
  if (Array.isArray(input)) {
    baseIndicators = input;
  } else if ('tables' in input || 'csv_files' in input) {
    const normalized = normalizeCensusPayload(input as CensusPayload, 'census-norm', new Date().toISOString());
    baseIndicators = normalized.areaIndicators;
  } else if ('areaIndicators' in input && Array.isArray(input.areaIndicators)) {
    baseIndicators = input.areaIndicators;
  } else {
    throw new Error('Unsupported ABS Census input format');
  }

  const indicators: AreaIndicator[] = [];
  const areaMappingResults = new Map<string, { boundaryId: string; sourceVintage: string | null; mapped: boolean }>();

  for (const base of baseIndicators) {
    const parts = base.boundary_id.split(':');
    const scheme = parts[0] ?? 'ASGS_SA2';
    const cleanCode = base.source_area_code ?? parts[1] ?? '';
    const sourceVintage = base.source_area_vintage ?? (parts[2] && parts[2] !== 'unresolved' ? parts[2] : null) ?? '2021';
    const areaKey = `${scheme}:${cleanCode}:${sourceVintage}`;

    let resolution = areaMappingResults.get(areaKey);
    if (!resolution) {
      const crosswalkTarget = getCrosswalkTarget(evidence?.crosswalk, base.boundary_id, cleanCode, areaKey);
      if (crosswalkTarget) {
        resolution = {
          boundaryId: crosswalkTarget,
          sourceVintage,
          mapped: true,
        };
      } else if (!evidence) {
        resolution = {
          boundaryId: `${scheme}:${cleanCode}:unresolved`,
          sourceVintage,
          mapped: false,
        };
      } else if (evidence.sourceAreaVintage !== sourceVintage) {
        // Vintage mismatch: cross-vintage comparison requires explicit mapping
        resolution = {
          boundaryId: `${scheme}:${cleanCode}:unresolved`,
          sourceVintage,
          mapped: false,
        };
      } else {
        const matches = evidence.boundaries.filter(b => {
          if (b.scheme !== scheme || b.vintage !== evidence.sourceAreaVintage) {
            return false;
          }
          if (b.code !== undefined && b.code !== null && String(b.code) === cleanCode) {
            return true;
          }
          if (b.boundary_id === `${scheme}:${cleanCode}:${evidence.sourceAreaVintage}`) {
            return true;
          }
          // Name match ONLY if b does not have a conflicting code
          if (b.code === undefined || b.code === null || String(b.code) === cleanCode) {
            if (b.name && base.source_area_name && areaNameKey(b.name) === areaNameKey(base.source_area_name)) {
              return true;
            }
          }
          return false;
        });

        if (matches.length === 1) {
          resolution = {
            boundaryId: matches[0]!.boundary_id,
            sourceVintage,
            mapped: true,
          };
        } else {
          resolution = {
            boundaryId: `${scheme}:${cleanCode}:unresolved`,
            sourceVintage,
            mapped: false,
          };
        }
      }
      areaMappingResults.set(areaKey, resolution);
    }

    const status = base.status;
    const value = status === 'observed' ? base.value : null;
    const boundaryId = resolution.boundaryId;
    const versionId = digest(`${base.indicator_id}\0${boundaryId}\0${status}\0${value}\0${base.period_start}\0${base.period_end}`);

    const common = {
      ...base,
      boundary_id: boundaryId,
      version_id: versionId,
      source_area_code: cleanCode,
      source_area_vintage: resolution.sourceVintage,
      assertion_kind: 'observation' as const,
    };
    const normalizedIndicator: AreaIndicator = enforceAreaIndicatorInvariants(
      status === 'observed'
        ? { ...common, status: 'observed', value: value as number }
        : { ...common, status, value: null },
    );
    indicators.push(normalizedIndicator);
  }

  let mapped = 0;
  let unresolved = 0;
  for (const res of areaMappingResults.values()) {
    if (res.mapped) mapped += 1;
    else unresolved += 1;
  }

  return { indicators, mapped, unresolved };
}
export const normalizeAbsCensus = normalizeAbsCensusStatistics;
export const normalizeCensusStatistics = normalizeAbsCensusStatistics;

/**
 * Normalizes CLUE Employment records into AreaIndicators.
 * Enforces:
 *  - industry employment unit 'jobs'
 *  - sample suppression (suppressed industry jobs -> null, missing total -> null, genuine 0 -> 0)
 *  - boundary mapping against official CLUE block geography of matching vintage
 *  - historic employment (2002-2024) prohibited from silently joining 2025 realigned block boundaries without crosswalk
 */
export function normalizeClueEmploymentStatistics(
  input:
    | ConnectorSuccess
    | readonly ClueEmploymentRawRow[]
    | { readonly areaIndicators: readonly AreaIndicator[]; readonly sourceRecords?: readonly SourceRecord[] }
    | readonly AreaIndicator[],
  evidence: AreaBoundaryEvidence | null = null,
): NormalizedAreaIndicatorsResult {
  let baseIndicators: readonly AreaIndicator[];
  if (Array.isArray(input)) {
    if (input.length > 0 && typeof input[0] === 'object' && input[0] !== null && 'census_year' in input[0] && 'block_id' in input[0]) {
      const indicatorsList: AreaIndicator[] = [];
      const now = new Date().toISOString();
      for (const row of input as readonly ClueEmploymentRawRow[]) {
        const normalized = normalizeClueEmploymentRow(row, 'clue-norm', now, null);
        indicatorsList.push(...normalized.indicators);
      }
      baseIndicators = indicatorsList;
    } else {
      baseIndicators = input as readonly AreaIndicator[];
    }
  } else if ('areaIndicators' in input && Array.isArray(input.areaIndicators)) {
    baseIndicators = input.areaIndicators;
  } else {
    throw new Error('Unsupported CLUE employment input format');
  }

  const indicators: AreaIndicator[] = [];
  const blockMappingResults = new Map<string, { boundaryId: string; sourceVintage: string | null; mapped: boolean }>();

  for (const base of baseIndicators) {
    const blockId = base.source_area_code ?? (/CLUE_BLOCK_UNRESOLVED:(\d+)/.exec(base.boundary_id)?.[1]) ?? (/com_clue_block:(\d+)/.exec(base.boundary_id)?.[1]) ?? '';
    const censusYear = base.period_start.slice(0, 4);
    const inputVintage: string | null = base.source_area_vintage ?? null;
    const blockKey = `${blockId}:${censusYear}:${inputVintage ?? 'unknown'}`;

    let resolution = blockMappingResults.get(blockKey);
    if (!resolution) {
      const crosswalkTarget = getCrosswalkTarget(
        evidence?.crosswalk,
        base.boundary_id,
        String(blockId),
        blockKey,
        `${blockId}:${censusYear}`,
        `CLUE_BLOCK_UNRESOLVED:${blockId}:${censusYear}`,
      );
      if (crosswalkTarget) {
        resolution = {
          boundaryId: crosswalkTarget,
          sourceVintage: inputVintage ?? (evidence?.sourceAreaVintage ?? null),
          mapped: true,
        };
      } else if (!evidence) {
        resolution = {
          boundaryId: `CLUE_BLOCK_UNRESOLVED:${blockId}:${censusYear}`,
          sourceVintage: inputVintage,
          mapped: false,
        };
      } else if (
        (inputVintage !== null && evidence.sourceAreaVintage !== inputVintage) ||
        (inputVintage === null && evidence.sourceAreaVintage !== censusYear)
      ) {
        // Vintage mismatch: e.g. 2024 employment cannot join 2025 boundary polygons without explicit crosswalk
        resolution = {
          boundaryId: `CLUE_BLOCK_UNRESOLVED:${blockId}:${censusYear}`,
          sourceVintage: inputVintage,
          mapped: false,
        };
      } else {
        const expectedCode = String(blockId);
        const matches = evidence.boundaries.filter(b => {
          if (b.scheme !== 'com_clue_block' && b.scheme !== 'CLUE_BLOCK') {
            return false;
          }
          if (b.vintage !== evidence.sourceAreaVintage) {
            return false;
          }
          const isCodeMatch = b.code !== undefined && b.code !== null && String(b.code) === expectedCode;
          const isBoundaryIdMatch =
            b.boundary_id === `com_clue_block:${expectedCode}:${evidence.sourceAreaVintage}` ||
            b.boundary_id === `CLUE_BLOCK:${expectedCode}:${evidence.sourceAreaVintage}`;
          return isCodeMatch || isBoundaryIdMatch;
        });

        if (matches.length === 1) {
          resolution = {
            boundaryId: matches[0]!.boundary_id,
            sourceVintage: inputVintage ?? evidence.sourceAreaVintage,
            mapped: true,
          };
        } else {
          // If 0 matches or multiple ambiguous candidates, retain unresolved
          resolution = {
            boundaryId: `CLUE_BLOCK_UNRESOLVED:${blockId}:${censusYear}`,
            sourceVintage: inputVintage,
            mapped: false,
          };
        }
      }
      blockMappingResults.set(blockKey, resolution);
    }

    const status = base.status;
    const value = status === 'observed' ? base.value : null;
    const boundaryId = resolution.boundaryId;
    const versionId = digest(`${base.indicator_id}\0${boundaryId}\0${status}\0${value}\0${base.period_start}\0${base.period_end}`);

    const common = {
      ...base,
      boundary_id: boundaryId,
      version_id: versionId,
      source_area_code: String(blockId),
      source_area_vintage: resolution.sourceVintage,
      assertion_kind: 'observation' as const,
      unit: 'jobs',
    };
    const normalizedIndicator: AreaIndicator = enforceAreaIndicatorInvariants(
      status === 'observed'
        ? { ...common, status: 'observed', value: value as number }
        : { ...common, status, value: null },
    );
    indicators.push(normalizedIndicator);
  }

  let mapped = 0;
  let unresolved = 0;
  for (const res of blockMappingResults.values()) {
    if (res.mapped) mapped += 1;
    else unresolved += 1;
  }

  return { indicators, mapped, unresolved };
}
export const normalizeClueEmployment = normalizeClueEmploymentStatistics;

/**
 * Normalizes Homes Victoria Quarterly Rents into AreaIndicators.
 * Enforces:
 *  - strictly observation assertion_kind (historical bond lodgements, not active listings)
 *  - median rent unit 'AUD/week'
 *  - suppression preservation (<4 sample suppression -> null, never 0)
 *  - boundary mapping against official LGA / suburb boundaries of matching vintage
 *  - unresolved boundaries marked as unresolved without fabricated centroids or guessing
 */
export function normalizeHomesVictoriaStatistics(
  input:
    | ConnectorSuccess
    | HomesVictoriaPayload
    | readonly HomesVictoriaRentRawRecord[]
    | { readonly areaIndicators: readonly AreaIndicator[]; readonly sourceRecords?: readonly SourceRecord[] }
    | readonly AreaIndicator[],
  evidence: AreaBoundaryEvidence | null = null,
): NormalizedAreaIndicatorsResult {
  let baseIndicators: readonly AreaIndicator[];
  if (Array.isArray(input)) {
    if (input.length > 0 && typeof input[0] === 'object' && input[0] !== null && ('quarter' in input[0] || 'lga_name' in input[0])) {
      const now = new Date().toISOString();
      const normalized = normalizeRentalPayload(
        { results: input as HomesVictoriaRentRawRecord[] },
        'rent-norm',
        now,
      );
      baseIndicators = normalized.areaIndicators;
    } else {
      baseIndicators = input as readonly AreaIndicator[];
    }
  } else if ('results' in input && Array.isArray((input as HomesVictoriaPayload).results)) {
    const now = new Date().toISOString();
    const normalized = normalizeRentalPayload(input as HomesVictoriaPayload, 'rent-norm', now);
    baseIndicators = normalized.areaIndicators;
  } else if ('areaIndicators' in input && Array.isArray(input.areaIndicators)) {
    baseIndicators = input.areaIndicators;
  } else {
    throw new Error('Unsupported Homes Victoria rents input format');
  }

  const indicators: AreaIndicator[] = [];
  const areaMappingResults = new Map<string, { boundaryId: string; sourceVintage: string | null; mapped: boolean }>();

  for (const base of baseIndicators) {
    const isSuburb =
      base.boundary_id.startsWith('VIC_SUBURB_NAME:') ||
      base.boundary_id.startsWith('VIC_SUBURB:') ||
      base.boundary_id.startsWith('ASGS_SAL:') ||
      base.boundary_id.startsWith('SAL:') ||
      (base.source_area_name?.includes(' - ') ?? false);

    let suburbName: string | null = null;
    let lgaName = base.source_area_name ?? '';
    if (base.source_area_name && base.source_area_name.includes(' - ')) {
      const parts = base.source_area_name.split(' - ');
      lgaName = parts[0]!.trim();
      suburbName = parts[1]!.trim();
    } else if (isSuburb) {
      const match = /VIC_SUBURB_NAME:([^:]+)/.exec(base.boundary_id);
      suburbName = match ? match[1]! : (base.source_area_name ?? '');
    }

    const boundaryParts = base.boundary_id.split(':');
    const inputVintage: string | null =
      base.source_area_vintage ??
      (boundaryParts.length >= 3 && boundaryParts[2] !== 'unresolved' ? boundaryParts[2] : null) ??
      null;

    const schemeToken = isSuburb ? 'suburb' : 'lga';
    const areaKey = JSON.stringify([schemeToken, lgaName.trim(), suburbName?.trim() ?? null,
      base.source_area_code ?? null, inputVintage]);

    let resolution = areaMappingResults.get(areaKey);
    if (!resolution) {
      let crosswalkTarget: string | null = null;
      if (isSuburb) {
        crosswalkTarget = getCrosswalkTarget(
          evidence?.crosswalk,
          base.boundary_id,
          suburbName && inputVintage ? `suburb:${slugify(suburbName)}:${inputVintage}` : null,
          suburbName ? `suburb:${slugify(suburbName)}` : null,
          suburbName && inputVintage ? `suburb:${areaNameKey(suburbName)}:${inputVintage}` : null,
          suburbName ? `suburb:${areaNameKey(suburbName)}` : null,
          suburbName && inputVintage ? `suburb:${suburbName}:${inputVintage}` : null,
          suburbName ? `suburb:${suburbName}` : null,
          suburbName && inputVintage ? `${slugify(suburbName)}:${inputVintage}` : null,
          suburbName ? slugify(suburbName) : null,
          suburbName ?? null,
        );
      } else {
        crosswalkTarget = getCrosswalkTarget(
          evidence?.crosswalk,
          base.boundary_id,
          base.source_area_code && inputVintage ? `lga:${base.source_area_code}:${inputVintage}` : null,
          base.source_area_code ? `lga:${base.source_area_code}` : null,
          inputVintage ? `lga:${slugify(lgaName)}:${inputVintage}` : null,
          `lga:${slugify(lgaName)}`,
          inputVintage ? `lga:${areaNameKey(lgaName)}:${inputVintage}` : null,
          `lga:${areaNameKey(lgaName)}`,
          inputVintage ? `lga:${lgaName}:${inputVintage}` : null,
          `lga:${lgaName}`,
          base.source_area_code ?? null,
          lgaName,
        );
      }

      if (crosswalkTarget) {
        validateCrosswalkTarget({ boundaryId: crosswalkTarget, boundaries: evidence?.boundaries ?? [],
          allowedSchemes: isSuburb ? ['VIC_SUBURB', 'ASGS_SAL', 'SAL'] : ['ASGS_LGA'] });
        resolution = {
          boundaryId: crosswalkTarget,
          sourceVintage: inputVintage ?? (evidence?.sourceAreaVintage ?? null),
          mapped: true,
        };
      } else if (!evidence) {
        resolution = {
          boundaryId: isSuburb
            ? `VIC_SUBURB_NAME:${slugify(suburbName ?? 'unresolved')}:unresolved`
            : (base.boundary_id.toLowerCase().includes('unresolved')
                ? base.boundary_id
                : `VIC_LGA_NAME:${slugify(lgaName)}:unresolved`),
          sourceVintage: inputVintage,
          mapped: false,
        };
      } else if (inputVintage !== null && evidence.sourceAreaVintage !== inputVintage) {
        // G18: Cross-vintage mapping without explicit crosswalk retains unresolved or original vintage boundary
        resolution = {
          boundaryId: isSuburb
            ? (base.boundary_id.toLowerCase().includes('unresolved')
                ? base.boundary_id
                : `VIC_SUBURB_NAME:${slugify(suburbName ?? 'unresolved')}:unresolved`)
            : base.boundary_id,
          sourceVintage: inputVintage,
          mapped: false,
        };
      } else {
        let matches: (Pick<Boundary, 'boundary_id' | 'scheme' | 'name' | 'vintage'> & Partial<Pick<Boundary, 'code'>>)[] = [];
        if (isSuburb && suburbName) {
          const exactSuburbName = suburbName.trim();
          matches = evidence.boundaries.filter(b =>
            (b.scheme === 'VIC_SUBURB' || b.scheme === 'ASGS_SAL' || b.scheme === 'SAL') &&
            b.vintage === evidence.sourceAreaVintage &&
            b.name.trim() === exactSuburbName
          );
        } else if (!isSuburb) {
          matches = evidence.boundaries.filter(b =>
            b.scheme === 'ASGS_LGA' &&
            b.vintage === evidence.sourceAreaVintage &&
            (base.source_area_code
              ? b.code === base.source_area_code
              : b.name.trim() === lgaName.trim())
          );
        }

        if (matches.length === 1) {
          validateCrosswalkTarget({ boundaryId: matches[0]!.boundary_id, boundaries: evidence.boundaries,
            allowedSchemes: isSuburb ? ['VIC_SUBURB', 'ASGS_SAL', 'SAL'] : ['ASGS_LGA'] });
          resolution = {
            boundaryId: matches[0]!.boundary_id,
            sourceVintage: inputVintage ?? evidence.sourceAreaVintage,
            mapped: true,
          };
        } else {
          resolution = {
            boundaryId: isSuburb
              ? `VIC_SUBURB_NAME:${slugify(suburbName ?? 'unresolved')}:unresolved`
              : (base.boundary_id.toLowerCase().includes('unresolved')
                  ? base.boundary_id
                  : `VIC_LGA_NAME:${slugify(lgaName)}:unresolved`),
            sourceVintage: inputVintage,
            mapped: false,
          };
        }
      }
      areaMappingResults.set(areaKey, resolution);
    }

    const activeResolution = resolution!;
    const status = base.status;
    const value = status === 'observed' ? base.value : null;
    const boundaryId = activeResolution.boundaryId;
    const versionId = digest(`${base.indicator_id}\0${boundaryId}\0${status}\0${value}\0${base.period_start}\0${base.period_end}`);

    const common = {
      ...base,
      boundary_id: boundaryId,
      version_id: versionId,
      source_area_vintage: activeResolution.sourceVintage,
      assertion_kind: 'observation' as const,
      unit: base.unit || 'AUD/week',
    };
    const normalizedIndicator: AreaIndicator = enforceAreaIndicatorInvariants(
      status === 'observed'
        ? { ...common, status: 'observed', value: value as number }
        : { ...common, status, value: null },
    );
    indicators.push(normalizedIndicator);
  }

  let mapped = 0;
  let unresolved = 0;
  for (const res of areaMappingResults.values()) {
    if (res.mapped) mapped += 1;
    else unresolved += 1;
  }

  return { indicators, mapped, unresolved };
}
export const normalizeHomesVictoriaRents = normalizeHomesVictoriaStatistics;

/**
 * Universal dispatcher for AreaIndicator normalization by source_id.
 */
export function normalizeAreaIndicators(
  sourceId: string,
  result: unknown,
  evidence: AreaBoundaryEvidence | null = null,
): NormalizedAreaIndicatorsResult {
  switch (sourceId) {
    case 'victoria.csa.recorded_offences':
      return normalizeCsaStatistics(result as CsaSuccess, evidence);
    case 'abs.census':
      return normalizeAbsCensusStatistics(result as any, evidence);
    case 'melbourne.clue.employment':
      return normalizeClueEmploymentStatistics(result as any, evidence);
    case 'homes_victoria.rents':
      return normalizeHomesVictoriaStatistics(result as any, evidence);
    default:
      throw new Error(`Unsupported statistical source for AreaIndicator normalization: ${sourceId}`);
  }
}

