import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AbsCensusConnector,
  CENSUS_DATA_DICTIONARY,
  detectGeographicScheme,
  normalizeAreaCode,
  normalizeCensusPayload,
  parseCensusValue,
  parseCsvRows,
  SOURCE_ID,
  type CensusPayload,
} from '../../src/connectors/abs_census/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const input = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: '2021' },
  checkpoint: null,
  runId: 'census-test-run',
});

async function loadFixture(): Promise<CensusPayload> {
  const fixtureUrl = new URL('../fixtures/abs_census.json', import.meta.url);
  const text = await readFile(fixtureUrl, 'utf8');
  return JSON.parse(text) as CensusPayload;
}

test('ABS Census connector conforms to frozen Connector interface and registers in source registry', async () => {
  const connectorsDir = fileURLToPath(new URL('../../src/connectors', import.meta.url));
  const registry = await loadSourceRegistry(connectorsDir);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} should be registered`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.provider, 'Australian Bureau of Statistics');
  assert.equal(entry.dataSource.topic, 'demographics');
  assert.equal(entry.dataSource.scope, 'victoria');

  assert.equal(entry.dataSource.license_status, 'verified_open');
  assert.equal(entry.dataSource.access_status, 'active');

  const loaded = await loadConnector(entry);
  assert.ok(isConnector(loaded));
  assert.equal(loaded.sourceId, SOURCE_ID);
});

test('Geographic scheme detection and area code normalization for SA1, SA2, and LGA', () => {
  assert.equal(detectGeographicScheme('SA2_CODE_2021'), 'ASGS_SA2');
  assert.equal(detectGeographicScheme('SA1_CODE_2021'), 'ASGS_SA1');
  assert.equal(detectGeographicScheme('LGA_CODE_2021'), 'ASGS_LGA');
  assert.equal(detectGeographicScheme('region_id', '206041122'), 'ASGS_SA2');
  assert.equal(detectGeographicScheme('region_id', '20604112201'), 'ASGS_SA1');
  assert.equal(detectGeographicScheme('region_id', '24600'), 'ASGS_LGA');

  assert.equal(normalizeAreaCode('206041122'), '206041122');
  assert.equal(normalizeAreaCode('LGA24600'), '24600');
  assert.equal(normalizeAreaCode(' LGA27350 '), '27350');
});

test('Suppressed and missing values remain null and are never zero-filled', () => {
  const observed = parseCensusValue(22639);
  assert.equal(observed.status, 'observed');
  assert.equal(observed.value, 22639);

  const observedString = parseCensusValue('1089');
  assert.equal(observedString.status, 'observed');
  assert.equal(observedString.value, 1089);

  // Explicit suppression symbols
  for (const sym of ['..', '-', 'np', 'suppressed', '*']) {
    const suppressed = parseCensusValue(sym);
    assert.equal(suppressed.status, 'suppressed', `Expected status suppressed for ${sym}`);
    assert.equal(suppressed.value, null, `Expected null value (not 0) for ${sym}`);
  }

  // Missing values
  for (const empty of [null, undefined, '', '   ', 'null']) {
    const missing = parseCensusValue(empty);
    assert.equal(missing.status, 'missing');
    assert.equal(missing.value, null);
  }

  // Zero is observed, not missing
  const zero = parseCensusValue(0);
  assert.equal(zero.status, 'observed');
  assert.equal(zero.value, 0);
});

test('ABS Census DataPacks normalization produces valid SourceRecords and AreaIndicators', async () => {
  const fixture = await loadFixture();
  const result = normalizeCensusPayload(fixture, 'test-run', '2026-09-29T00:00:00Z');

  assert.ok(result.sourceRecords.length > 0);
  assert.ok(result.areaIndicators.length > 0);

  // Validate every SourceRecord conforms to the admitted licence status.
  for (const sr of result.sourceRecords) {
    assert.doesNotThrow(() => parseSourceRecord(sr));
    assert.equal(sr.rights_status, 'verified_open');
    assert.equal(sr.assertion_kind, 'observation');
    assert.equal(sr.source_id, SOURCE_ID);
    assert.equal(sr.observed_at, '2021-08-10T00:00:00Z');
  }

  // Check AreaIndicators
  const southbankPersons = result.areaIndicators.find(
    i => i.boundary_id === 'ASGS_SA2:206041122:2021' && i.definition.includes('Total Persons (Persons)'),
  );
  assert.ok(southbankPersons, 'Should find Southbank Total Persons indicator');
  assert.equal(southbankPersons.status, 'observed');
  assert.equal(southbankPersons.value, 22639);
  assert.equal(southbankPersons.unit, 'persons');
  assert.equal(southbankPersons.source_area_code, '206041122');
  assert.equal(southbankPersons.source_area_vintage, '2021');
  assert.equal(southbankPersons.assertion_kind, 'observation');
  assert.equal(southbankPersons.period_start, '2021-08-10T00:00:00Z');
  assert.equal(southbankPersons.period_end, '2021-08-11T00:00:00.000Z');

  // Check SA1 support
  const sa1Indicator = result.areaIndicators.find(
    i => i.boundary_id === 'ASGS_SA1:20604112201:2021' && i.definition.includes('Total Persons (Persons)'),
  );
  assert.ok(sa1Indicator, 'Should find SA1 indicator');
  assert.equal(sa1Indicator.status, 'observed');
  assert.equal(sa1Indicator.value, 360);

  // Check LGA support
  const lgaMedianAge = result.areaIndicators.find(
    i => i.boundary_id === 'ASGS_LGA:24600:2021' && i.definition.includes('Median Age of Persons'),
  );
  assert.ok(lgaMedianAge, 'Should find LGA 24600 median age');
  assert.equal(lgaMedianAge.status, 'observed');
  assert.equal(lgaMedianAge.value, 28);
  assert.equal(lgaMedianAge.unit, 'years');

  // Check suppression in indicators
  const suppressedIndicators = result.areaIndicators.filter(i => i.status === 'suppressed');
  assert.ok(suppressedIndicators.length > 0, 'Should have suppressed indicators');
  for (const ind of suppressedIndicators) {
    assert.equal(ind.value, null, 'Suppressed indicator value MUST be null, not 0');
  }

  // Check missing in indicators
  const missingIndicators = result.areaIndicators.filter(i => i.status === 'missing');
  assert.ok(missingIndicators.length > 0, 'Should have missing indicators');
  for (const ind of missingIndicators) {
    assert.equal(ind.value, null, 'Missing indicator value MUST be null, not 0');
  }
});

test('CSV parsing extracts table data accurately', () => {
  const csv = `SA2_CODE_2021,Tot_P_M,Tot_P_F,Tot_P_P
206041122,11420,11219,22639
206041199,..,..,..`;

  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.['SA2_CODE_2021'], '206041122');
  assert.equal(rows[0]?.['Tot_P_P'], '22639');
  assert.equal(rows[1]?.['Tot_P_P'], '..');
});

test('AbsCensusConnector collect method succeeds with valid snapshot and rejects invalid revision', async () => {
  const fixture = await loadFixture();
  const connector = new AbsCensusConnector({ rawData: fixture });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.sourceId, SOURCE_ID);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.method, 'feed_snapshot');
    assert.ok(result.areaIndicators.length > 0);
    assert.ok(result.sourceRecords.length > 0);
    assert.equal(result.sourceRevision, '2021_v2021');
  }

  // Invalid revision
  const badInput = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: '1996' },
    checkpoint: null,
    runId: 'bad-revision',
  });
  const badResult = await connector.collect(badInput);
  assert.equal(badResult.kind, 'failure');
  if (badResult.kind === 'failure') {
    assert.equal(badResult.code, 'validation_failed');
  }
});

test('ABS Census connector with official source disabled never reads bundled fixtures', async () => {
  const result = await new AbsCensusConnector({ officialArchives: false }).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind !== 'failure') return;
  assert.equal(result.code, 'upstream_unavailable');
  assert.equal(result.completeness.complete, false);
});

test('ABS Census production defaults ignore environment fixture and URL overrides', async () => {
  const previousFixture = process.env.ABS_CENSUS_FIXTURE_PATH;
  const previousUrl = process.env.ABS_CENSUS_DATA_URL;
  process.env.ABS_CENSUS_FIXTURE_PATH = fileURLToPath(new URL('../fixtures/abs_census.json', import.meta.url));
  process.env.ABS_CENSUS_DATA_URL = 'https://example.invalid/unreviewed-census.json';
  try {
    const result = await new AbsCensusConnector({ officialArchives: false }).collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') assert.equal(result.code, 'upstream_unavailable');
  } finally {
    if (previousFixture === undefined) delete process.env.ABS_CENSUS_FIXTURE_PATH;
    else process.env.ABS_CENSUS_FIXTURE_PATH = previousFixture;
    if (previousUrl === undefined) delete process.env.ABS_CENSUS_DATA_URL;
    else process.env.ABS_CENSUS_DATA_URL = previousUrl;
  }
});
