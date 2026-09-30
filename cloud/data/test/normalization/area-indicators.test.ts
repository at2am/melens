import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { CensusPayload } from '../../src/connectors/abs_census/index.js';
import type { ClueEmploymentRawRow } from '../../src/connectors/com_clue_employment/index.js';
import type { CsaSuccess } from '../../src/connectors/csa_recorded_offences/index.js';
import type {
  HomesVictoriaPayload,
  HomesVictoriaRentRawRecord,
} from '../../src/connectors/homes_victoria_rents/index.js';
import type { AreaIndicator } from '../../src/core/types.js';
import {
  areaNameKey,
  assertComparableIndicators,
  enforceAreaIndicatorInvariants,
  normalizeAbsCensusStatistics,
  normalizeAreaIndicators,
  normalizeClueEmploymentStatistics,
  normalizeCsaStatistics,
  normalizeHomesVictoriaStatistics,
  type AreaBoundaryEvidence,
} from '../../src/normalization/area-indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function makeValidIndicator(overrides: Record<string, unknown> = {}): AreaIndicator {
  return {
    batch_id: 'b1',
    source_id: 'src1',
    schema_version: 1,
    fetched_at: '2026-09-29T00:00:00Z',
    source_record_id: 'rec1',
    source_updated_at: null,
    source_version_ordinal: null,
    indicator_id: 'ind1',
    version_id: 'v1',
    boundary_id: 'bnd1',
    period_start: '2025-01-01T00:00:00Z',
    period_end: '2025-04-01T00:00:00Z',
    unit: 'persons',
    definition: 'def1',
    assertion_kind: 'observation',
    status: 'observed',
    value: 42,
    ...overrides,
  } as AreaIndicator;
}

function csaFixture(status: 'observed' | 'suppressed' | 'missing'): CsaSuccess {
  return {
    kind: 'success',
    sourceId: 'victoria.csa.recorded_offences',
    runId: 'run',
    fetchedAt: '2026-09-28T00:00:00Z',
    sourceRevision: 'quarter',
    sourceLatestUpdateAt: null,
    checkpointAfter: 'quarter',
    completeness: {
      complete: true,
      method: 'export_count',
      expected_records: 1,
      fetched_records: 1,
      expected_pages: 1,
      fetched_pages: 1,
      evidence: 'fixture',
    },
    inputCount: 1,
    outputCount: 1,
    rejectedCount: 0,
    sourceRecords: [
      {
        batch_id: 'run',
        source_id: 'victoria.csa.recorded_offences',
        schema_version: 1,
        fetched_at: '2026-09-28T00:00:00Z',
        source_record_id: 'csa:1',
        version_id: 'v1',
        original_url: 'https://example.org/csa',
        raw_uri: null,
        published_at: null,
        observed_at: null,
        first_accessible_at: null,
        time_missing_reason: 'quarterly source',
        valid_from: '2025-07-01T00:00:00Z',
        valid_to: '2026-07-01T00:00:00Z',
        source_updated_at: '2026-07-01T00:00:00Z',
        source_version_ordinal: null,
        record_status: 'active',
        assertion_kind: 'observation',
        rights_status: 'review_required',
      },
    ],
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
    statistics: [
      {
        status,
        count: status === 'observed' ? 12 : null,
        ...(status === 'observed' ? {} : { sourceMarker: status === 'suppressed' ? '*' : null }),
        sourceRecordId: 'csa:1',
        versionId: 'v1',
        lgaName: 'Colac-Otway',
        lgaCode: null,
        periodStart: '2025-07-01T00:00:00Z',
        periodEndExclusive: '2026-07-01T00:00:00Z',
        yearEnding: 2026,
        monthEnding: 'June',
        ratePer100k: status === 'observed' ? 50 : null,
        statisticalDefinition: 'rolling_12_month_offence_count',
        releaseDate: null,
      },
    ],
  } as CsaSuccess;
}

// ---------------------------------------------------------------------------
// 1. CSA Offences Normalization
// ---------------------------------------------------------------------------
test('unversioned CSA names remain unlocated while counts and rates survive', () => {
  const normalized = normalizeCsaStatistics(csaFixture('observed'));
  assert.equal(normalized.mapped, 0);
  assert.equal(normalized.unresolved, 1);
  assert.deepEqual(
    normalized.indicators.map((row) => [row.status, row.value]),
    [
      ['observed', 12],
      ['observed', 50],
    ],
  );
  assert.equal(normalized.indicators[0]?.boundary_id, 'CSA_LGA_NAME:colac_otway:unresolved');
  assert.equal(normalized.indicators[0]?.source_area_name, 'Colac-Otway');
  assert.equal(normalized.indicators[0]?.source_area_vintage, null);
  assert.equal(normalized.indicators[0]?.assertion_kind, 'observation');
});

test('suppressed and missing source values remain null, never zero', () => {
  for (const status of ['suppressed', 'missing'] as const) {
    const normalized = normalizeCsaStatistics(csaFixture(status));
    assert.equal(normalized.indicators[0]?.status, status);
    assert.equal(normalized.indicators[0]?.value, null);
    assert.equal(normalized.indicators[1]?.value, null);
  }
});

test('an explicitly attested LGA vintage permits a unique official name mapping', () => {
  assert.equal(areaNameKey('Colac-Otway'), areaNameKey('Colac Otway'));
  const normalized = normalizeCsaStatistics(csaFixture('observed'), {
    sourceAreaVintage: '2025',
    boundaries: [
      {
        boundary_id: 'ASGS_LGA:21750:2025',
        scheme: 'ASGS_LGA',
        name: 'Colac Otway',
        vintage: '2025',
      },
    ],
  });
  assert.equal(normalized.mapped, 1);
  assert.equal(normalized.indicators[0]?.boundary_id, 'ASGS_LGA:21750:2025');
  assert.equal(normalized.indicators[0]?.source_area_vintage, '2025');
});

// ---------------------------------------------------------------------------
// 2. Invariant Enforcement (T058 contract)
// ---------------------------------------------------------------------------
test('enforceAreaIndicatorInvariants strictly enforces observation kind and null for suppressed/missing', () => {
  const validObserved = makeValidIndicator({ status: 'observed', value: 42 });

  // Valid observed passes
  assert.doesNotThrow(() => enforceAreaIndicatorInvariants(validObserved));

  // Valid suppressed passes
  const validSuppressed = makeValidIndicator({ status: 'suppressed', value: null });
  assert.doesNotThrow(() => enforceAreaIndicatorInvariants(validSuppressed));

  // Valid missing passes
  const validMissing = makeValidIndicator({ status: 'missing', value: null });
  assert.doesNotThrow(() => enforceAreaIndicatorInvariants(validMissing));

  // Must reject non-observation assertion_kind (e.g. prediction or plan)
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...validObserved, assertion_kind: 'prediction' } as any),
    /Invalid assertion_kind: "prediction"/,
  );

  // Must reject invalid status
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...validObserved, status: 'unknown' } as any),
    /Invalid status: "unknown"/,
  );

  // Must reject observed with null value
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...validObserved, value: null } as any),
    /Observed indicator must have a finite numeric value/,
  );

  // CRITICAL: Suppressed or missing with zero-fill must throw
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...validObserved, status: 'suppressed', value: 0 } as any),
    /Suppressed and missing indicators MUST have value: null, never zero-filled/,
  );
  assert.throws(
    () => enforceAreaIndicatorInvariants({ ...validObserved, status: 'missing', value: 0 } as any),
    /Suppressed and missing indicators MUST have value: null, never zero-filled/,
  );
});

// ---------------------------------------------------------------------------
// 3. Comparability & Cross-Vintage Boundary Rules
// ---------------------------------------------------------------------------
test('assertComparableIndicators prevents silent joins across vintages and unresolved boundaries', () => {
  const base = makeValidIndicator({
    boundary_id: 'ASGS_SA2:206041122:2021',
    period_start: '2021-01-01T00:00:00Z',
    period_end: '2021-12-31T23:59:59Z',
    status: 'observed',
    value: 100,
    source_area_vintage: '2021',
  });

  const sameBoundarySameVintage = makeValidIndicator({
    boundary_id: 'ASGS_SA2:206041122:2021',
    period_start: '2022-01-01T00:00:00Z',
    period_end: '2022-12-31T23:59:59Z',
    status: 'observed',
    value: 110,
    source_area_vintage: '2021',
  });

  // Same boundary and vintage is comparable
  assert.doesNotThrow(() => assertComparableIndicators(base, sameBoundarySameVintage));

  // Different vintage without crosswalk throws
  const diffVintage = makeValidIndicator({
    ...base,
    boundary_id: 'ASGS_SA2:206041122:2016',
    source_area_vintage: '2016',
  });
  assert.throws(
    () => assertComparableIndicators(base, diffVintage),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
  );

  // Different vintage with explicit crosswalk succeeds
  const crosswalk = new Map([['ASGS_SA2:206041122:2021', 'ASGS_SA2:206041122:2016']]);
  assert.doesNotThrow(() => assertComparableIndicators(base, diffVintage, crosswalk));

  // Unresolved boundary comparison throws without crosswalk
  const unresolved = makeValidIndicator({
    ...base,
    boundary_id: 'ASGS_SA2:206041122:unresolved',
    source_area_vintage: null,
  });
  assert.throws(
    () => assertComparableIndicators(base, unresolved),
    /requires an explicit boundary mapping/,
  );
});

// ---------------------------------------------------------------------------
// 4. ABS Census Normalization
// ---------------------------------------------------------------------------
test('normalizeAbsCensusStatistics maps indicators, preserves suppression, units, and rejects cross-vintage joins', async () => {
  const fixture = await loadAbsFixture();

  // Without boundary evidence: remains unresolved
  const unresolvedRes = normalizeAbsCensusStatistics(fixture);
  assert.ok(unresolvedRes.indicators.length > 0);
  assert.ok(unresolvedRes.unresolved > 0);
  for (const ind of unresolvedRes.indicators) {
    assert.equal(ind.assertion_kind, 'observation');
    assert.ok(ind.boundary_id.includes(':unresolved'));
    assert.equal(ind.source_area_vintage, '2021');
  }

  // Row 4 in G01 fixture has: ["206041199", "..", "..", "..", 0, "-", null]
  // '..' -> missing with null value
  // '-' -> suppressed with null value
  // 0 -> observed with value 0
  const row4Indicators = unresolvedRes.indicators.filter((ind) => ind.source_area_code === '206041199');
  assert.ok(row4Indicators.length > 0);
  const suppressedInd = row4Indicators.find((ind) => ind.status === 'suppressed');
  assert.ok(suppressedInd, 'Must have at least one suppressed indicator for "-" marker');
  assert.equal(suppressedInd.value, null);

  const missingInd = row4Indicators.find((ind) => ind.status === 'missing');
  assert.ok(missingInd, 'Must have at least one missing indicator for ".." or null');
  assert.equal(missingInd.value, null);

  const observedZero = row4Indicators.find((ind) => ind.status === 'observed' && ind.value === 0);
  assert.ok(observedZero, 'Genuine zero count must be preserved as observed 0');

  // With matching official 2021 ASGS boundary evidence:
  const boundaries: AreaBoundaryEvidence['boundaries'] = [
    {
      boundary_id: 'ASGS_SA2:206041122:2021',
      scheme: 'ASGS_SA2',
      code: '206041122',
      name: 'Melbourne',
      vintage: '2021',
    },
  ];
  const mappedRes = normalizeAbsCensusStatistics(fixture, {
    sourceAreaVintage: '2021',
    boundaries,
  });
  assert.ok(mappedRes.mapped >= 1);
  const mappedInd = mappedRes.indicators.find((ind) => ind.source_area_code === '206041122');
  assert.ok(mappedInd);
  assert.equal(mappedInd.boundary_id, 'ASGS_SA2:206041122:2021');
  assert.equal(mappedInd.source_area_vintage, '2021');
  assert.equal(mappedInd.unit, 'persons');

  // Vintage mismatch: evidence vintage 2016 vs census vintage 2021 without crosswalk leaves unresolved
  const mismatchRes = normalizeAbsCensusStatistics(fixture, {
    sourceAreaVintage: '2016',
    boundaries: boundaries.map((b) => ({ ...b, vintage: '2016', boundary_id: 'ASGS_SA2:206041122:2016' })),
  });
  assert.equal(mismatchRes.mapped, 0);
  const mismatchInd = mismatchRes.indicators.find((ind) => ind.source_area_code === '206041122');
  assert.ok(mismatchInd?.boundary_id.includes(':unresolved'));
  assert.equal(mismatchInd?.source_area_vintage, '2021');

  // Crosswalk allows bridging cross-vintage boundaries
  const crosswalkRes = normalizeAbsCensusStatistics(fixture, {
    sourceAreaVintage: '2016',
    boundaries: [],
    crosswalk: { '206041122': 'ASGS_SA2:206041122:2016' },
  });
  assert.ok(crosswalkRes.mapped >= 1);
  const bridgedInd = crosswalkRes.indicators.find((ind) => ind.source_area_code === '206041122');
  assert.equal(bridgedInd?.boundary_id, 'ASGS_SA2:206041122:2016');
  assert.equal(bridgedInd?.source_area_vintage, '2021');
});

// ---------------------------------------------------------------------------
// 5. CLUE Employment Normalization
// ---------------------------------------------------------------------------
test('normalizeClueEmploymentStatistics maps blocks, preserves jobs units and suppression, handles vintage', async () => {
  const rows = await loadClueFixture();
  assert.ok(rows.length > 0);

  // Without boundary evidence: unresolved
  const unresolved = normalizeClueEmploymentStatistics(rows);
  assert.ok(unresolved.indicators.length > 0);
  assert.equal(unresolved.mapped, 0);
  for (const ind of unresolved.indicators) {
    assert.equal(ind.assertion_kind, 'observation');
    assert.equal(ind.unit, 'jobs');
    assert.ok(ind.boundary_id.startsWith('CLUE_BLOCK_UNRESOLVED:'));
    assert.equal(ind.source_area_vintage, null);
  }

  // Row 1 (block 17): agriculture_and_mining is 0 (observed 0), accommodation is null (suppressed null)
  const block17Indicators = unresolved.indicators.filter((ind) => ind.source_area_code === '17');
  const observedZero = block17Indicators.find((ind) => ind.status === 'observed' && ind.value === 0);
  assert.ok(observedZero, 'Genuine zero employment must be preserved as observed 0');

  const suppressedJobs = block17Indicators.find((ind) => ind.status === 'suppressed');
  assert.ok(suppressedJobs, 'Suppressed industry count must be suppressed status');
  assert.equal(suppressedJobs.value, null, 'Suppressed value must be null, never 0');

  // Matching vintage boundary evidence:
  const boundaries: AreaBoundaryEvidence['boundaries'] = [
    {
      boundary_id: 'com_clue_block:17:2024',
      scheme: 'com_clue_block',
      code: '17',
      name: 'Block 17',
      vintage: '2024',
    },
  ];
  const mapped = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2024',
    boundaries,
  });
  assert.ok(mapped.mapped >= 1);
  const mappedInd = mapped.indicators.find((ind) => ind.source_area_code === '17');
  assert.ok(mappedInd);
  assert.equal(mappedInd.boundary_id, 'com_clue_block:17:2024');
  assert.equal(mappedInd.source_area_vintage, '2024');

  // Vintage mismatch: 2024 employment cannot join 2025 boundary without crosswalk
  const vintageMismatch = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2025',
    boundaries: [{ ...boundaries[0]!, vintage: '2025', boundary_id: 'com_clue_block:17:2025' }],
  });
  assert.equal(vintageMismatch.mapped, 0);

  // With explicit crosswalk
  const crosswalked = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2025',
    boundaries: [],
    crosswalk: { '17': 'com_clue_block:17:2025' },
  });
  assert.ok(crosswalked.mapped >= 1);
  const cwInd = crosswalked.indicators.find((ind) => ind.source_area_code === '17');
  assert.equal(cwInd?.boundary_id, 'com_clue_block:17:2025');
});

// ---------------------------------------------------------------------------
// 6. Homes Victoria Quarterly Rents Normalization
// ---------------------------------------------------------------------------
test('normalizeHomesVictoriaStatistics enforces AUD/week unit, suppression preservation, and boundary mapping', async () => {
  const payload = await loadRentsFixture();

  // Unresolved without evidence
  const unresolved = normalizeHomesVictoriaStatistics(payload);
  assert.ok(unresolved.indicators.length > 0);
  for (const ind of unresolved.indicators) {
    assert.equal(ind.assertion_kind, 'observation');
    assert.equal(ind.unit, 'AUD/week');
    assert.ok(ind.boundary_id.includes(':unresolved'));
  }

  // Matching LGA boundary evidence maps Melbourne LGA
  const boundaries: AreaBoundaryEvidence['boundaries'] = [
    {
      boundary_id: 'ASGS_LGA:24600:2025',
      scheme: 'ASGS_LGA',
      code: '24600',
      name: 'Melbourne',
      vintage: '2025',
    },
  ];
  const mapped = normalizeHomesVictoriaStatistics(payload, {
    sourceAreaVintage: '2025',
    boundaries,
  });
  assert.ok(mapped.mapped >= 1);
  const melbInd = mapped.indicators.find((ind) => ind.source_area_name === 'Melbourne');
  assert.ok(melbInd);
  assert.equal(melbInd.boundary_id, 'ASGS_LGA:24600:2025');
  assert.equal(melbInd.source_area_vintage, '2025');
  assert.equal(melbInd.status, 'observed');
  assert.equal(typeof melbInd.value, 'number');

  // Test suppression: when raw record has status 'suppressed' / count < 4
  const suppressedPayload: HomesVictoriaPayload = {
    ...payload,
    results: [
      {
        quarter: 'Sep 2025',
        quarter_code: '2025-Q3',
        period_start: '2025-07-01T00:00:00Z',
        period_end: '2025-10-01T00:00:00Z',
        lga_name: 'Melbourne',
        region_group: 'Metropolitan',
        suburb: null,
        property_type: '1 bedroom flat',
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

  const suppressedRes = normalizeHomesVictoriaStatistics(suppressedPayload, {
    sourceAreaVintage: '2025',
    boundaries,
  });
  assert.equal(suppressedRes.indicators.length, 1);
  const suppInd = suppressedRes.indicators[0]!;
  assert.equal(suppInd.status, 'suppressed');
  assert.equal(suppInd.value, null, 'Suppressed rental rate MUST be null, never 0');
});

// ---------------------------------------------------------------------------
// 7. Universal Dispatcher normalizeAreaIndicators
// ---------------------------------------------------------------------------
test('normalizeAreaIndicators dispatches to each supported statistical source', async () => {
  const csaRes = normalizeAreaIndicators('victoria.csa.recorded_offences', csaFixture('observed'));
  assert.equal(csaRes.indicators.length, 2);

  const absPayload = await loadAbsFixture();
  const absRes = normalizeAreaIndicators('abs.census', absPayload);
  assert.ok(absRes.indicators.length > 0);

  const cluePayload = await loadClueFixture();
  const clueRes = normalizeAreaIndicators('melbourne.clue.employment', cluePayload);
  assert.ok(clueRes.indicators.length > 0);

  const rentsPayload = await loadRentsFixture();
  const rentsRes = normalizeAreaIndicators('homes_victoria.rents', rentsPayload);
  assert.ok(rentsRes.indicators.length > 0);

  // Unknown source throws
  assert.throws(
    () => normalizeAreaIndicators('unknown.statistical.source', {}),
    /Unsupported statistical source for AreaIndicator normalization/,
  );
});

// ---------------------------------------------------------------------------
// 8. Rework Tests for Review Findings G16–G20
// ---------------------------------------------------------------------------

// G16: CLUE block matching strictly by code / boundary_id, never substring, handles candidates & ambiguity
test('G16: normalizeClueEmploymentStatistics strictly matches blockId and rejects substring or ambiguous matches', () => {
  const baseRow: ClueEmploymentRawRow = {
    census_year: '2024',
    block_id: 1,
    clue_small_area: 'Melbourne CBD',
    total_jobs_in_block: 50,
  };

  // Boundaries containing Block 10, 11, 101, but NOT Block 1
  const boundariesWithoutBlock1: AreaBoundaryEvidence['boundaries'] = [
    {
      boundary_id: 'com_clue_block:10:2024',
      scheme: 'com_clue_block',
      code: '10',
      name: 'Block 10',
      vintage: '2024',
    },
    {
      boundary_id: 'com_clue_block:11:2024',
      scheme: 'com_clue_block',
      code: '11',
      name: 'Block 11',
      vintage: '2024',
    },
    {
      boundary_id: 'com_clue_block:101:2024',
      scheme: 'com_clue_block',
      code: '101',
      name: 'Block 101',
      vintage: '2024',
    },
  ];

  // Block 1 must NOT match Block 10, 11, 101 despite 'name' containing '1'
  const res1 = normalizeClueEmploymentStatistics([baseRow], {
    sourceAreaVintage: '2024',
    boundaries: boundariesWithoutBlock1,
  });
  assert.equal(res1.mapped, 0);
  assert.equal(res1.unresolved, 1);
  assert.equal(res1.indicators[0]?.boundary_id, 'CLUE_BLOCK_UNRESOLVED:1:2024');

  // Boundaries with correct Block 1 plus Block 10, shuffled
  const block1Boundary = {
    boundary_id: 'com_clue_block:1:2024',
    scheme: 'com_clue_block' as const,
    code: '1',
    name: 'Block 1',
    vintage: '2024',
  };
  const block10Boundary = {
    boundary_id: 'com_clue_block:10:2024',
    scheme: 'com_clue_block' as const,
    code: '10',
    name: 'Block 10',
    vintage: '2024',
  };

  // Candidate order [block10, block1]
  const resOrder1 = normalizeClueEmploymentStatistics([baseRow], {
    sourceAreaVintage: '2024',
    boundaries: [block10Boundary, block1Boundary],
  });
  assert.equal(resOrder1.mapped, 1);
  assert.equal(resOrder1.indicators[0]?.boundary_id, 'com_clue_block:1:2024');

  // Candidate order [block1, block10]
  const resOrder2 = normalizeClueEmploymentStatistics([baseRow], {
    sourceAreaVintage: '2024',
    boundaries: [block1Boundary, block10Boundary],
  });
  assert.equal(resOrder2.mapped, 1);
  assert.equal(resOrder2.indicators[0]?.boundary_id, 'com_clue_block:1:2024');

  // Ambiguous candidates: two boundaries both claiming Block 1
  const duplicateBlock1 = {
    boundary_id: 'com_clue_block:1_alt:2024',
    scheme: 'com_clue_block' as const,
    code: '1',
    name: 'Block 1 Duplicate',
    vintage: '2024',
  };
  const resAmbiguous = normalizeClueEmploymentStatistics([baseRow], {
    sourceAreaVintage: '2024',
    boundaries: [block1Boundary, duplicateBlock1],
  });
  assert.equal(resAmbiguous.mapped, 0);
  assert.equal(resAmbiguous.unresolved, 1);
  assert.equal(resAmbiguous.indicators[0]?.boundary_id, 'CLUE_BLOCK_UNRESOLVED:1:2024');

  // ABS code conflict check: cleanCode 206041122 with boundary code 206041199 having same name
  const absIndicator = makeValidIndicator({
    boundary_id: 'ASGS_SA2:206041122:2021',
    source_area_code: '206041122',
    source_area_name: 'Melbourne',
    source_area_vintage: '2021',
  });
  const conflictingBoundary = {
    boundary_id: 'ASGS_SA2:206041199:2021',
    scheme: 'ASGS_SA2' as const,
    code: '206041199', // conflicting code
    name: 'Melbourne', // matching name
    vintage: '2021',
  };
  const resAbsConflict = normalizeAbsCensusStatistics([absIndicator], {
    sourceAreaVintage: '2021',
    boundaries: [conflictingBoundary],
  });
  assert.equal(resAbsConflict.mapped, 0);
  assert.equal(resAbsConflict.unresolved, 1);
  assert.equal(resAbsConflict.indicators[0]?.boundary_id, 'ASGS_SA2:206041122:unresolved');
});

// G17: Suburb records must ONLY query mappings for their own statistical unit, never parent LGA mapping
test('G17: normalizeHomesVictoriaStatistics prevents suburb records from falling back to parent LGA crosswalk', () => {
  const rentalRows: HomesVictoriaRentRawRecord[] = [
    // Suburb record
    {
      quarter: 'Sep 2025',
      quarter_code: '2025-Q3',
      period_start: '2025-07-01T00:00:00Z',
      period_end: '2025-10-01T00:00:00Z',
      lga_name: 'Melbourne',
      region_group: 'Metropolitan',
      suburb: 'Carlton',
      property_type: '2 bedroom flat',
      raw_count: '150',
      raw_median: '550',
      count: 150,
      median_rent: 550,
      measure: 'median_weekly_rent',
      currency: 'AUD',
      status: 'observed',
    },
    // Whole LGA record
    {
      quarter: 'Sep 2025',
      quarter_code: '2025-Q3',
      period_start: '2025-07-01T00:00:00Z',
      period_end: '2025-10-01T00:00:00Z',
      lga_name: 'Melbourne',
      region_group: 'Metropolitan',
      suburb: null,
      property_type: '2 bedroom flat',
      raw_count: '800',
      raw_median: '600',
      count: 800,
      median_rent: 600,
      measure: 'median_weekly_rent',
      currency: 'AUD',
      status: 'observed',
    },
  ];

  // Crosswalk only defines parent LGA mapping
  const evidenceParentLgaOnly: AreaBoundaryEvidence = {
    sourceAreaVintage: '2025',
    boundaries: [],
    crosswalk: {
      'lga:melbourne': 'ASGS_LGA:24600:2025',
    },
  };

  const res = normalizeHomesVictoriaStatistics(rentalRows, evidenceParentLgaOnly);
  assert.equal(res.mapped, 1, 'Only LGA record should be mapped');
  assert.equal(res.unresolved, 1, 'Suburb record must remain unresolved without its own mapping');

  const suburbInd = res.indicators.find((ind) => ind.source_area_name === 'Melbourne - Carlton');
  assert.ok(suburbInd);
  assert.equal(suburbInd.boundary_id, 'VIC_SUBURB_NAME:carlton:unresolved');

  const lgaInd = res.indicators.find((ind) => ind.source_area_name === 'Melbourne');
  assert.ok(lgaInd);
  assert.equal(lgaInd.boundary_id, 'ASGS_LGA:24600:2025');

  // When suburb crosswalk is supplied, suburb maps to its own boundary
  const evidenceWithSuburb: AreaBoundaryEvidence = {
    sourceAreaVintage: '2025',
    boundaries: [],
    crosswalk: {
      'lga:melbourne': 'ASGS_LGA:24600:2025',
      'suburb:carlton': 'ASGS_SAL:20534:2025',
    },
  };
  const resWithBoth = normalizeHomesVictoriaStatistics(rentalRows, evidenceWithSuburb);
  assert.equal(resWithBoth.mapped, 2);
  assert.equal(resWithBoth.unresolved, 0);
  const mappedSuburb = resWithBoth.indicators.find((ind) => ind.source_area_name === 'Melbourne - Carlton');
  assert.equal(mappedSuburb?.boundary_id, 'ASGS_SAL:20534:2025');
});

// G18: Homes Victoria rent cross-vintage remapping requires explicit crosswalk and segregates cache key by vintage
test('G18: normalizeHomesVictoriaStatistics enforces crosswalk for cross-vintage rent remapping and segregates cache by vintage', () => {
  const base2021Indicator = makeValidIndicator({
    source_id: 'homes_victoria.rents',
    boundary_id: 'ASGS_LGA:24600:2021',
    source_area_name: 'Melbourne',
    source_area_vintage: '2021',
    unit: 'AUD/week',
    status: 'observed',
    value: 480,
  });

  const base2025Indicator = makeValidIndicator({
    source_id: 'homes_victoria.rents',
    boundary_id: 'ASGS_LGA:24600:2025',
    source_area_name: 'Melbourne',
    source_area_vintage: '2025',
    unit: 'AUD/week',
    status: 'observed',
    value: 550,
  });

  // Evidence has 2025 Melbourne boundary, but NO crosswalk
  const evidence2025: AreaBoundaryEvidence = {
    sourceAreaVintage: '2025',
    boundaries: [
      {
        boundary_id: 'ASGS_LGA:24600:2025',
        scheme: 'ASGS_LGA',
        code: '24600',
        name: 'Melbourne',
        vintage: '2025',
      },
    ],
  };

  // 1. Without crosswalk: 2021 indicator must NOT be remapped to 2025 by name alone
  const resNoCrosswalk = normalizeHomesVictoriaStatistics([base2021Indicator], evidence2025);
  assert.equal(resNoCrosswalk.mapped, 0);
  assert.equal(resNoCrosswalk.unresolved, 1);
  assert.equal(resNoCrosswalk.indicators[0]?.boundary_id, 'ASGS_LGA:24600:2021');
  assert.equal(resNoCrosswalk.indicators[0]?.source_area_vintage, '2021');

  // 2. With explicit crosswalk: 2021 indicator maps to 2025 boundary while retaining source_area_vintage = '2021'
  const evidenceWithCrosswalk: AreaBoundaryEvidence = {
    ...evidence2025,
    crosswalk: {
      'ASGS_LGA:24600:2021': 'ASGS_LGA:24600:2025',
    },
  };
  const resCrosswalk = normalizeHomesVictoriaStatistics([base2021Indicator], evidenceWithCrosswalk);
  assert.equal(resCrosswalk.mapped, 1);
  assert.equal(resCrosswalk.indicators[0]?.boundary_id, 'ASGS_LGA:24600:2025');
  assert.equal(resCrosswalk.indicators[0]?.source_area_vintage, '2021', 'Original statistical vintage must be preserved');

  // 3. Batch mixing 2021 and 2025 records: separate cache keys, no collision
  const mixedRes = normalizeHomesVictoriaStatistics([base2021Indicator, base2025Indicator], evidence2025);
  assert.equal(mixedRes.mapped, 1, 'Only 2025 record matches 2025 boundary');
  assert.equal(mixedRes.unresolved, 1, '2021 record without crosswalk remains unmapped');
  const ind2021 = mixedRes.indicators.find((ind) => ind.source_area_vintage === '2021');
  const ind2025 = mixedRes.indicators.find((ind) => ind.source_area_vintage === '2025');
  assert.equal(ind2021?.boundary_id, 'ASGS_LGA:24600:2021');
  assert.equal(ind2025?.boundary_id, 'ASGS_LGA:24600:2025');
});

// G19: ABS Census retains source_area_vintage = '2021' across unmapped, mismatched, and crosswalked states
test('G19: normalizeAbsCensusStatistics preserves source_area_vintage = "2021" across unmapped, mismatched, and crosswalked states', async () => {
  const fixture = await loadAbsFixture();

  // Scenario 1: No evidence -> unmapped, retains '2021'
  const unmapped = normalizeAbsCensusStatistics(fixture, null);
  for (const ind of unmapped.indicators) {
    assert.equal(ind.source_area_vintage, '2021');
    assert.ok(ind.boundary_id.includes(':unresolved'));
  }

  // Scenario 2: Mismatched vintage evidence (2016) without crosswalk -> unmapped, retains '2021'
  const mismatched = normalizeAbsCensusStatistics(fixture, {
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
  });
  const mismatchedInd = mismatched.indicators.find((ind) => ind.source_area_code === '206041122');
  assert.equal(mismatchedInd?.source_area_vintage, '2021');
  assert.ok(mismatchedInd?.boundary_id.includes(':unresolved'));

  // Scenario 3: Mapped via explicit crosswalk to 2016 target boundary -> boundary is 2016, but source_area_vintage remains '2021'
  const crosswalked = normalizeAbsCensusStatistics(fixture, {
    sourceAreaVintage: '2016',
    boundaries: [],
    crosswalk: { '206041122': 'ASGS_SA2:206041122:2016' },
  });
  const crosswalkedInd = crosswalked.indicators.find((ind) => ind.source_area_code === '206041122');
  assert.equal(crosswalkedInd?.boundary_id, 'ASGS_SA2:206041122:2016');
  assert.equal(crosswalkedInd?.source_area_vintage, '2021', 'Must retain 2021, NOT overwritten with target vintage 2016');
});

// G20: assertComparableIndicators case-insensitively rejects UNRESOLVED boundary IDs even with known vintage
test('G20: assertComparableIndicators rejects case-insensitive UNRESOLVED boundary IDs even with known vintage', () => {
  const clueUnresolved1 = makeValidIndicator({
    boundary_id: 'CLUE_BLOCK_UNRESOLVED:1:2024',
    source_area_vintage: '2024',
    period_start: '2024-01-01T00:00:00Z',
    period_end: '2024-12-31T23:59:59Z',
  });
  const clueUnresolved2 = makeValidIndicator({
    boundary_id: 'CLUE_BLOCK_UNRESOLVED:1:2024',
    source_area_vintage: '2024',
    period_start: '2024-01-01T00:00:00Z',
    period_end: '2024-12-31T23:59:59Z',
  });

  // Identical boundary_id with uppercase UNRESOLVED and same vintage MUST throw without explicit mapping
  assert.throws(
    () => assertComparableIndicators(clueUnresolved1, clueUnresolved2),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
  );

  // Mixed case Unresolved must also throw
  const mixedCase1 = makeValidIndicator({
    boundary_id: 'VIC_SUBURB_NAME:carlton:Unresolved',
    source_area_vintage: '2025',
  });
  const mixedCase2 = makeValidIndicator({
    boundary_id: 'VIC_SUBURB_NAME:carlton:Unresolved',
    source_area_vintage: '2025',
  });
  assert.throws(
    () => assertComparableIndicators(mixedCase1, mixedCase2),
    /requires an explicit boundary mapping/,
  );

  // With explicit mapping to confirmed boundary, it succeeds
  const resolvedTarget = makeValidIndicator({
    boundary_id: 'com_clue_block:1:2024',
    source_area_vintage: '2024',
  });
  assert.doesNotThrow(() =>
    assertComparableIndicators(clueUnresolved1, resolvedTarget, {
      'CLUE_BLOCK_UNRESOLVED:1:2024': 'com_clue_block:1:2024',
    }),
  );
});

// G24: CLUE preserves source_area_vintage = null without boundary evidence, separates statistical period from boundary vintage, and asserts comparability
test('G24: normalizeClueEmploymentStatistics preserves source_area_vintage = null without boundary evidence and enforces comparability rules', async () => {
  const rows = await loadClueFixture();
  assert.ok(rows.length > 0);

  // 1. Without boundary evidence: source_area_vintage must be null, statistical period preserved
  const unresolved = normalizeClueEmploymentStatistics(rows, null);
  assert.ok(unresolved.indicators.length > 0);
  assert.equal(unresolved.mapped, 0);
  assert.ok(unresolved.unresolved > 0);

  for (const ind of unresolved.indicators) {
    assert.equal(ind.source_area_vintage, null, 'Unknown source boundary vintage must be null, NOT inferred from censusYear');
    assert.ok(ind.boundary_id.startsWith('CLUE_BLOCK_UNRESOLVED:'));
    assert.ok(['2023', '2024'].includes(ind.period_start.slice(0, 4)), 'Statistical period must be retained independently of boundary vintage');
  }

  const block17_2024_Unresolved = unresolved.indicators.find(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2024'),
  );
  assert.ok(block17_2024_Unresolved);
  assert.equal(block17_2024_Unresolved.source_area_vintage, null);
  assert.equal(block17_2024_Unresolved.boundary_id, 'CLUE_BLOCK_UNRESOLVED:17:2024');

  // 2. Comparing indicators when boundary evidence was omitted fails closed
  const anotherUnresolved = unresolved.indicators.filter(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2024'),
  )[1];
  assert.ok(anotherUnresolved);
  assert.throws(
    () => assertComparableIndicators(block17_2024_Unresolved, anotherUnresolved),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
    'Unresolved boundary with null vintage must not be comparable without explicit mapping',
  );

  // 3. With explicit matching boundary evidence: boundary_id and source_area_vintage resolve, statistical period untouched
  const boundaries2024: AreaBoundaryEvidence['boundaries'] = [
    {
      boundary_id: 'com_clue_block:17:2024',
      scheme: 'com_clue_block',
      code: '17',
      name: 'Block 17',
      vintage: '2024',
    },
    {
      boundary_id: 'com_clue_block:18:2024',
      scheme: 'com_clue_block',
      code: '18',
      name: 'Block 18',
      vintage: '2024',
    },
  ];
  const mapped = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2024',
    boundaries: boundaries2024,
  });
  assert.ok(mapped.mapped >= 1);

  // 2024 row matches 2024 boundary evidence
  const block17_2024_Mapped = mapped.indicators.filter(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2024'),
  );
  assert.ok(block17_2024_Mapped.length > 0);
  for (const ind of block17_2024_Mapped) {
    assert.equal(ind.boundary_id, 'com_clue_block:17:2024');
    assert.equal(ind.source_area_vintage, '2024', 'Explicit boundary evidence resolves source_area_vintage');
    assert.equal(ind.period_start.slice(0, 4), '2024', 'Statistical period must remain 2024 and not be overwritten');
  }

  // 2023 row without 2023 boundary evidence remains unresolved with null vintage
  const block17_2023_Mapped = mapped.indicators.filter(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2023'),
  );
  assert.ok(block17_2023_Mapped.length > 0);
  for (const ind of block17_2023_Mapped) {
    assert.equal(ind.boundary_id, 'CLUE_BLOCK_UNRESOLVED:17:2023');
    assert.equal(ind.source_area_vintage, null, '2023 data cannot join 2024 boundary evidence without crosswalk');
    assert.equal(ind.period_start.slice(0, 4), '2023');
  }

  // 4. Comparable indicators with matching boundary evidence succeed for same block/vintage
  assert.doesNotThrow(() => assertComparableIndicators(block17_2024_Mapped[0]!, block17_2024_Mapped[1]!));

  // 5. Comparing resolved indicator against unresolved indicator throws
  assert.throws(
    () => assertComparableIndicators(block17_2024_Mapped[0]!, block17_2024_Unresolved),
    /Cross-vintage or unresolved boundary comparison.*requires an explicit boundary mapping/,
  );

  // 6. Vintage mismatch (e.g. 2024 statistical period vs 2025 boundary evidence) without crosswalk leaves vintage null and unresolved
  const mismatched = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2025',
    boundaries: [
      {
        boundary_id: 'com_clue_block:17:2025',
        scheme: 'com_clue_block',
        code: '17',
        name: 'Block 17',
        vintage: '2025',
      },
    ],
  });
  assert.equal(mismatched.mapped, 0);
  const mismatchedInd = mismatched.indicators.find(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2024'),
  );
  assert.ok(mismatchedInd);
  assert.equal(mismatchedInd.source_area_vintage, null);
  assert.ok(mismatchedInd.boundary_id.startsWith('CLUE_BLOCK_UNRESOLVED:'));

  // 7. Explicit crosswalk bridges to target boundary
  const crosswalked = normalizeClueEmploymentStatistics(rows, {
    sourceAreaVintage: '2025',
    boundaries: [],
    crosswalk: { '17': 'com_clue_block:17:2025' },
  });
  assert.ok(crosswalked.mapped >= 1);
  const crosswalkedInd = crosswalked.indicators.find(
    (ind) => ind.source_area_code === '17' && ind.period_start.startsWith('2024'),
  );
  assert.equal(crosswalkedInd?.boundary_id, 'com_clue_block:17:2025');
  assert.equal(crosswalkedInd?.source_area_vintage, '2025');
  assert.equal(crosswalkedInd?.period_start.slice(0, 4), '2024');

  // 8. If input AreaIndicator already had an explicit known source_area_vintage (e.g. '2023'), it must be preserved
  const preKnownIndicator = makeValidIndicator({
    source_id: 'melbourne.clue.employment',
    boundary_id: 'CLUE_BLOCK_UNRESOLVED:17:2023',
    source_area_code: '17',
    source_area_vintage: '2023',
    period_start: '2023-01-01T00:00:00Z',
    period_end: '2024-01-01T00:00:00Z',
    unit: 'jobs',
    status: 'observed',
    value: 120,
  });
  const unmappedPreKnown = normalizeClueEmploymentStatistics([preKnownIndicator], null);
  assert.equal(unmappedPreKnown.indicators[0]?.source_area_vintage, '2023', 'Pre-known vintage must not be erased');

  // Crosswalk with pre-known vintage preserves original source_area_vintage = '2023' (G19 rule)
  const crosswalkPreKnown = normalizeClueEmploymentStatistics([preKnownIndicator], {
    sourceAreaVintage: '2025',
    boundaries: [],
    crosswalk: { '17': 'com_clue_block:17:2025' },
  });
  assert.equal(crosswalkPreKnown.indicators[0]?.boundary_id, 'com_clue_block:17:2025');
  assert.equal(crosswalkPreKnown.indicators[0]?.source_area_vintage, '2023', 'Original source_area_vintage must be preserved under crosswalk');
});

