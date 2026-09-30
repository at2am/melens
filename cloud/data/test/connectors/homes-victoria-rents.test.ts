import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  connector as defaultConnector,
  HomesVictoriaRentsConnector,
  LANDING_URL,
  normalizeHomesVictoriaRecord,
  normalizeRentalPayload,
  parseQuarter,
  parseRentalValue,
  SOURCE_ID,
  workbookModifiedAt,
  type HomesVictoriaPayload,
} from '../../src/connectors/homes_victoria_rents/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/homes_victoria_rents.json');

async function loadFixture(): Promise<HomesVictoriaPayload> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content) as HomesVictoriaPayload;
}

test('SourceRegistry admits Homes Victoria Rents with verified open rights', async () => {
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsRoot);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} must be registered in SourceRegistry`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.provider, 'Homes Victoria');
  assert.equal(entry.dataSource.topic, 'housing');
  assert.equal(entry.dataSource.scope, 'victoria');

  assert.equal(entry.dataSource.license_status, 'verified_open');
  assert.equal(entry.dataSource.access_status, 'active');
  assert.deepEqual(entry.dataSource.admission_evidence.missing_requirements, []);

  const loaded = await loadConnector(entry);
  assert.ok(isConnector(loaded), 'Loaded module must conform to Connector interface');
  assert.equal(loaded.sourceId, SOURCE_ID);
});

test('parseQuarter correctly converts quarter notations to UTC intervals and observedAt', () => {
  const q3 = parseQuarter('Sep 2025');
  assert.equal(q3.quarterCode, '2025-Q3');
  assert.equal(q3.periodStart, '2025-07-01T00:00:00Z');
  assert.equal(q3.periodEnd, '2025-10-01T00:00:00Z');
  assert.equal(q3.observedAt, '2025-09-30T23:59:59Z');

  const iso = parseQuarter('2025-Q1');
  assert.equal(iso.quarterCode, '2025-Q1');
  assert.equal(iso.periodStart, '2025-01-01T00:00:00Z');
  assert.equal(iso.periodEnd, '2025-04-01T00:00:00Z');

  const qIso = parseQuarter('Q2 2025');
  assert.equal(qIso.quarterCode, '2025-Q2');
  assert.equal(qIso.periodStart, '2025-04-01T00:00:00Z');
  assert.equal(qIso.periodEnd, '2025-07-01T00:00:00Z');

  const q4 = parseQuarter('Dec 2024');
  assert.equal(q4.quarterCode, '2024-Q4');
  assert.equal(q4.periodStart, '2024-10-01T00:00:00Z');
  assert.equal(q4.periodEnd, '2025-01-01T00:00:00Z');

  assert.throws(() => parseQuarter('InvalidQuarterString'));
});

test('live workbook revision uses its Last-Modified and rejects absent or future validators', () => {
  assert.equal(workbookModifiedAt('Fri, 20 Feb 2026 01:17:41 GMT', '2026-09-30T00:00:00Z'),
    '2026-02-20T01:17:41Z');
  assert.throws(() => workbookModifiedAt(null, '2026-09-30T00:00:00Z'));
  assert.throws(() => workbookModifiedAt('invalid', '2026-09-30T00:00:00Z'));
  assert.throws(() => workbookModifiedAt('Thu, 01 Oct 2026 00:00:00 GMT', '2026-09-30T00:00:00Z'));
});

test('parseRentalValue distinguishes observed, suppressed, and missing values without zero-filling', () => {
  // Observed numeric values
  const obsNum = parseRentalValue(670);
  assert.equal(obsNum.status, 'observed');
  assert.equal(obsNum.numericValue, 670);

  const obsStr = parseRentalValue('$670.00');
  assert.equal(obsStr.status, 'observed');
  assert.equal(obsStr.numericValue, 670);

  const obsComma = parseRentalValue('6,745');
  assert.equal(obsComma.status, 'observed');
  assert.equal(obsComma.numericValue, 6745);

  // 0 is a numeric observation, NOT missing or suppressed
  const zero = parseRentalValue(0);
  assert.equal(zero.status, 'observed');
  assert.equal(zero.numericValue, 0);

  // Confidentiality suppressed symbols must return null, NEVER 0
  for (const sym of ['-', '<4', 's', 'suppressed', 'np', '..']) {
    const supp = parseRentalValue(sym);
    assert.equal(supp.status, 'suppressed', `Expected status suppressed for ${sym}`);
    assert.equal(supp.numericValue, null, `Suppressed value must be null (not 0) for ${sym}`);
  }

  // Missing values must return null, NEVER 0
  for (const empty of [null, undefined, '', '   ', 'null', 'missing']) {
    const miss = parseRentalValue(empty);
    assert.equal(miss.status, 'missing');
    assert.equal(miss.numericValue, null);
  }
});

test('Invariant: Historical bond observations, strictly NOT active market rental listings', () => {
  const record = {
    quarter: 'Sep 2025',
    lga_name: 'Melbourne',
    property_type: 'All Properties',
    count: 6745,
    median_rent: 670,
    status: 'observed' as const,
  };

  const normalized = normalizeHomesVictoriaRecord(record, 'test-run-id', '2026-09-29T12:00:00Z');

  // Must explicitly denote historical observation and false for is_current_listing
  assert.equal(normalized.rentalRecord.is_current_listing, false);
  assert.equal(normalized.rentalRecord.is_prediction, false);
  assert.equal(normalized.sourceRecord.assertion_kind, 'observation');
  assert.equal(normalized.geoRecord.assertion_kind, 'observation');
  assert.equal(normalized.areaIndicator.assertion_kind, 'observation');

  assert.ok(
    normalized.rentalRecord.definition.includes('RTBA bond lodgements'),
    'Definition must explain data source is RTBA bond lodgements'
  );
  assert.ok(
    normalized.rentalRecord.definition.includes('not active market rental vacancy listing'),
    'Definition must explicitly state not active market rental vacancy listing'
  );
});

test('Invariant: Geography preserved at LGA/suburb level with no fabricated street coordinates', () => {
  const record = {
    quarter: 'Sep 2025',
    lga_name: 'Melbourne',
    suburb: 'Carlton',
    property_type: '2br Flat',
    count: 380,
    median_rent: 620,
    status: 'observed' as const,
  };

  const normalized = normalizeHomesVictoriaRecord(record, 'test-run-id', '2026-09-29T12:00:00Z');

  assert.equal(normalized.geoRecord.location_role, 'area_only');
  assert.equal(normalized.geoRecord.location_confidence, 'official_join');
  assert.equal(normalized.geoRecord.centroid_lat, null, 'Centroid latitude must be null for area aggregates');
  assert.equal(normalized.geoRecord.centroid_lon, null, 'Centroid longitude must be null for area aggregates');
  assert.equal(normalized.geoRecord.geometry_geojson, null, 'Geometry GeoJSON must be null without boundary polygon');

  const geoValidation = validateGeoRecordGeography(normalized.geoRecord);
  assert.equal(geoValidation.valid, true, 'GeoRecord must pass geographic validation');
  assert.ok(geoValidation.geographicRecord !== null);
});

test('Invariant: Confidentiality suppressed and missing records retain null without zero-filling', async () => {
  const fixture = await loadFixture();
  const normalized = normalizeRentalPayload(fixture, 'test-run-id', '2026-09-29T12:00:00Z');

  // Verify observed record
  const observedItem = normalized.areaIndicators.find(i => i.status === 'observed');
  assert.ok(observedItem, 'Should contain observed indicator');
  assert.equal(typeof observedItem.value, 'number');
  assert.ok((observedItem.value as number) > 0);

  // Verify suppressed record
  const suppressedIndicators = normalized.areaIndicators.filter(i => i.status === 'suppressed');
  assert.ok(suppressedIndicators.length > 0, 'Fixture should contain suppressed records');
  for (const supp of suppressedIndicators) {
    assert.equal(supp.status, 'suppressed');
    assert.equal(supp.value, null, 'Suppressed value must remain null, NEVER coerced to 0');
  }

  // Verify missing record
  const missingIndicators = normalized.areaIndicators.filter(i => i.status === 'missing');
  assert.ok(missingIndicators.length > 0, 'Fixture should contain missing records');
  for (const miss of missingIndicators) {
    assert.equal(miss.status, 'missing');
    assert.equal(miss.value, null, 'Missing value must remain null, NEVER coerced to 0');
  }
});

test('Governance & Publication: licensed source facts are queryable with provenance', async () => {
  const fixture = await loadFixture();
  const normalized = normalizeRentalPayload(fixture, 'test-run-id', '2026-09-29T12:00:00Z');

  for (const record of normalized.sourceRecords) {
    assert.equal(record.rights_status, 'verified_open');
    assert.equal(record.assertion_kind, 'observation');
    assert.equal(record.record_status, 'active');
    assert.doesNotThrow(() => parseSourceRecord(record));
  }

  for (const geo of normalized.geoRecords) {
    assert.equal(geo.rights_status, 'verified_open');
    assert.equal(geo.public_query_allowed, true);
  }
});

test('HomesVictoriaRentsConnector collects full 122-record fixture with ConnectorSuccess', async () => {
  const fixture = await loadFixture();
  const connector = new HomesVictoriaRentsConnector({ rawData: fixture });

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'test-batch-run-122',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceId, SOURCE_ID);
  assert.equal(result.inputCount, 122);
  assert.equal(result.outputCount, 122);
  assert.equal(result.rejectedCount, 0);
  assert.equal(result.sourceRecords.length, 122);
  assert.equal(result.geoRecords.length, 122);
  assert.equal(result.geoRecordSources.length, 122);
  assert.equal(result.areaIndicators.length, 122);

  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(result.completeness.expected_records, 122);
  assert.equal(result.completeness.fetched_records, 122);
  assert.equal(result.completeness.expected_pages, 1);
  assert.equal(result.completeness.fetched_pages, 1);
});

test('HomesVictoriaRentsConnector rejects mismatched sourceId gracefully', async () => {
  const connector = new HomesVictoriaRentsConnector();
  const input = parseConnectorInput({
    sourceId: 'another.source.id',
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'test-invalid-source',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;

  assert.equal(result.code, 'validation_failed');
  assert.equal(result.completeness.complete, false);
});

test('Default connector without fixture does NOT silently read fixture', async () => {
  assert.ok(isConnector(defaultConnector), 'Exported connector must satisfy isConnector');
  assert.equal(defaultConnector.sourceId, SOURCE_ID);

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'test-default-instance-run',
  });

  // Connector without fixture and disabled catalog must fail explicitly without silently reading bundled fixtures
  const connector = new HomesVictoriaRentsConnector({ catalogUrl: null });
  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'upstream_unavailable');
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.fetched_records, 0);
});

test('Explicit fixturePath mode parses fixture correctly', async () => {
  const connector = new HomesVictoriaRentsConnector({ fixturePath });
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'fixture-path-test',
  });
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.inputCount, 122);
  assert.equal(result.outputCount, 122);
  assert.equal(result.completeness.complete, true);
});

test('Homes Victoria catalog metadata cannot masquerade as an empty rental report', async () => {
  const catalogMetadata = { success: true, result: { resources: [] } };
  const connector = new HomesVictoriaRentsConnector({ rawData: catalogMetadata });
  const result = await connector.collect(parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'catalog-metadata-test',
  }));
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'schema_changed');
  assert.equal(result.completeness.complete, false);
});

test('Connector filters records properly when time window is provided', async () => {
  const fixture = await loadFixture();
  const connector = new HomesVictoriaRentsConnector({ rawData: fixture });

  // Window for Q3 2025: 2025-07-01 to 2025-10-01
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: {
      kind: 'time',
      from: '2025-07-01T00:00:00Z',
      to: '2025-10-01T00:00:00Z',
    },
    checkpoint: null,
    runId: 'test-time-window-q3-2025',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.ok(result.inputCount > 0 && result.inputCount < 122, `Expected filtered count, got ${result.inputCount}`);
  for (const record of result.sourceRecords) {
    assert.equal(record.valid_from, '2025-07-01T00:00:00Z');
    assert.equal(record.valid_to, '2025-10-01T00:00:00Z');
  }
});

test('Strict suppression and missing invariants: symbols remain null, never zero-filled', () => {
  // Test '< 4' and other variations
  const spaceSupp = parseRentalValue('< 4');
  assert.equal(spaceSupp.status, 'suppressed');
  assert.equal(spaceSupp.numericValue, null);

  const naSupp = parseRentalValue('N/A');
  assert.equal(naSupp.status, 'suppressed');
  assert.equal(naSupp.numericValue, null);

  // Missing raw count & median with no status passed
  const missingRecord = {
    quarter: 'Sep 2025',
    lga_name: 'Alpine',
    property_type: '1br Flat',
    raw_count: null,
    raw_median: null,
  };

  const normMissing = normalizeHomesVictoriaRecord(missingRecord, 'test-run', '2026-09-29T12:00:00Z');
  assert.equal(normMissing.areaIndicator.status, 'missing');
  assert.equal(normMissing.areaIndicator.value, null, 'Missing indicator value must be null (not 0)');
  assert.equal(normMissing.rentalRecord.status, 'missing');
  assert.equal(normMissing.rentalRecord.median_weekly_rent, null, 'Missing median rent must be null (not 0)');
  assert.equal(normMissing.rentalRecord.count, null, 'Missing count must be null (not 0)');

  // Suppressed raw median with '-' symbol
  const suppRecord = {
    quarter: 'Sep 2025',
    lga_name: 'Alpine',
    property_type: '1br Flat',
    raw_count: '<4',
    raw_median: '-',
  };

  const normSupp = normalizeHomesVictoriaRecord(suppRecord, 'test-run', '2026-09-29T12:00:00Z');
  assert.equal(normSupp.areaIndicator.status, 'suppressed');
  assert.equal(normSupp.areaIndicator.value, null, 'Suppressed indicator value must be null (not 0)');
  assert.equal(normSupp.rentalRecord.status, 'suppressed');
  assert.equal(normSupp.rentalRecord.median_weekly_rent, null, 'Suppressed median rent must be null (not 0)');
  assert.equal(normSupp.rentalRecord.count, null, 'Suppressed count must be null (not 0)');
});

test('Malformed envelope and resource structures fail with schema_changed', async () => {
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'malformed-test',
  });

  // Malformed object without results
  const res1 = await new HomesVictoriaRentsConnector({ rawData: { invalid: true } }).collect(input);
  assert.equal(res1.kind, 'failure');
  assert.equal(res1.code, 'schema_changed');

  // Malformed results not an array
  const res2 = await new HomesVictoriaRentsConnector({ rawData: { results: 'not-an-array' } }).collect(input);
  assert.equal(res2.kind, 'failure');
  assert.equal(res2.code, 'schema_changed');

  // Empty results array must fail, not return complete empty array
  const res3 = await new HomesVictoriaRentsConnector({ rawData: { results: [] } }).collect(input);
  assert.equal(res3.kind, 'failure');
  assert.equal(res3.code, 'schema_changed');

  // Malformed raw record inside array
  const res4 = await new HomesVictoriaRentsConnector({ rawData: [{ quarter: 'Sep 2025' }] }).collect(input);
  assert.equal(res4.kind, 'failure');
  assert.equal(res4.code, 'schema_changed');
});

test('G09: Corrected rental values update record version_id, area indicator version_id, and batch sourceRevision', async () => {
  const record1 = {
    quarter: 'Sep 2025',
    lga_name: 'Melbourne',
    property_type: 'All Properties',
    count: 100,
    median_rent: 500,
    status: 'observed' as const,
  };
  const record2 = {
    quarter: 'Sep 2025',
    lga_name: 'Melbourne',
    property_type: 'All Properties',
    count: 100,
    median_rent: 550, // Corrected value
    status: 'observed' as const,
  };

  const connector1 = new HomesVictoriaRentsConnector({ rawData: [record1] });
  const connector2 = new HomesVictoriaRentsConnector({ rawData: [record2] });

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'revision-test',
  });

  const res1 = await connector1.collect(input);
  const res2 = await connector2.collect(input);

  assert.equal(res1.kind, 'success');
  assert.equal(res2.kind, 'success');
  if (res1.kind !== 'success' || res2.kind !== 'success') return;

  // Same logical identities across versions
  assert.equal(res1.sourceRecords[0]?.source_record_id, res2.sourceRecords[0]?.source_record_id);
  assert.equal(res1.areaIndicators[0]?.indicator_id, res2.areaIndicators[0]?.indicator_id);

  // Distinct version IDs and sourceRevision
  assert.notEqual(res1.sourceRecords[0]?.version_id, res2.sourceRecords[0]?.version_id);
  assert.notEqual(res1.areaIndicators[0]?.version_id, res2.areaIndicators[0]?.version_id);
  assert.notEqual(res1.geoRecords[0]?.version_id, res2.geoRecords[0]?.version_id);
  assert.notEqual(res1.sourceRevision, res2.sourceRevision, 'Corrected rental value must generate distinct sourceRevision');

  // Idempotent replay of original value
  const connector1Replay = new HomesVictoriaRentsConnector({ rawData: [record1] });
  const res1Replay = await connector1Replay.collect(input);
  assert.equal(res1Replay.kind, 'success');
  if (res1Replay.kind !== 'success') return;
  assert.equal(res1.sourceRevision, res1Replay.sourceRevision);
  assert.equal(res1.sourceRecords[0]?.version_id, res1Replay.sourceRecords[0]?.version_id);
});

test('G09: source_version_ordinal and source_updated_at default to null when absent and are preserved when present', async () => {
  const unversioned = {
    quarter: 'Sep 2025',
    lga_name: 'Melbourne',
    property_type: 'All Properties',
    count: 100,
    median_rent: 500,
    status: 'observed' as const,
  };
  const versioned = {
    ...unversioned,
    source_updated_at: '2025-10-15T00:00:00Z',
    source_version_ordinal: 2,
  };

  const normUnversioned = normalizeHomesVictoriaRecord(unversioned, 'test-run', '2026-09-29T12:00:00Z');
  assert.equal(normUnversioned.sourceRecord.source_version_ordinal, null, 'source_version_ordinal must be null when not provided');
  assert.equal(normUnversioned.sourceRecord.source_updated_at, null, 'source_updated_at must be null when not provided');
  assert.equal(normUnversioned.areaIndicator.source_version_ordinal, null);
  assert.equal(normUnversioned.areaIndicator.source_updated_at, null);
  assert.equal(normUnversioned.geoRecord.source_version_ordinal, null);
  assert.equal(normUnversioned.geoRecord.source_updated_at, null);

  const normVersioned = normalizeHomesVictoriaRecord(versioned, 'test-run', '2026-09-29T12:00:00Z');
  assert.equal(normVersioned.sourceRecord.source_version_ordinal, 2);
  assert.equal(normVersioned.sourceRecord.source_updated_at, '2025-10-15T00:00:00Z');
  assert.equal(normVersioned.areaIndicator.source_version_ordinal, 2);
  assert.equal(normVersioned.areaIndicator.source_updated_at, '2025-10-15T00:00:00Z');
  assert.equal(normVersioned.geoRecord.source_version_ordinal, 2);
  assert.equal(normVersioned.geoRecord.source_updated_at, '2025-10-15T00:00:00Z');
});
