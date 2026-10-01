import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

import {
  CATALOG_URL,
  CsaRecordedOffencesConnector,
  LANDING_URL,
  monthEnding,
  monthNumber,
  numericValue,
  parseCsaWorkbook,
  parseRate,
  selectCsaResource,
  SOURCE_ID,
  type CsaOffenceStat,
  type CsaResource,
} from '../../src/connectors/csa_recorded_offences/index.js';
import { isConnector, parseConnectorInput } from '../../src/core/connector.js';
import { HttpFailure } from '../../src/core/http.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import {
  assertComparableIndicators,
  normalizeCsaStatistics,
  type AreaBoundaryEvidence,
} from '../../src/normalization/area-indicators.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * In-memory builder for valid CSA XLSX workbooks.
 */
function buildSyntheticCsaXlsx(table01Rows: readonly (readonly (string | number | null | undefined)[])[]): Uint8Array {
  const sharedStrings: string[] = [];
  const stringMap = new Map<string, number>();

  function getStrIdx(str: string): number {
    const existing = stringMap.get(str);
    if (existing !== undefined) return existing;
    const idx = sharedStrings.length;
    sharedStrings.push(str);
    stringMap.set(str, idx);
    return idx;
  }

  const sheetRowsXml = table01Rows.map((row, rIdx) => {
    const rowNum = rIdx + 1;
    const colLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const cellsXml = row.map((val, cIdx) => {
      const col = colLetters[cIdx];
      const addr = `${col}${rowNum}`;
      if (val === null || val === undefined) {
        return `<c r="${addr}"/>`;
      }
      if (typeof val === 'number') {
        return `<c r="${addr}"><v>${val}</v></c>`;
      }
      const sIdx = getStrIdx(String(val));
      return `<c r="${addr}" t="s"><v>${sIdx}</v></c>`;
    }).join('');
    return `<row r="${rowNum}">${cellsXml}</row>`;
  }).join('');

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map(s => `<si><t>${s}</t></si>`).join('\n')}
</sst>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Table 01" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetRowsXml}
  </sheetData>
</worksheet>`;

  return zipSync({
    'xl/workbook.xml': strToU8(workbookXml),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml),
    'xl/sharedStrings.xml': strToU8(sharedStringsXml),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  });
}

const sampleResource: CsaResource = {
  id: '06bb24c8-8f62-4144-a746-99ef5492e4f9',
  name: 'Recorded offences by LGA - Year ending Jun 2026',
  url: 'https://files.crimestatistics.vic.gov.au/2026-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2026.xlsx',
  periodEnd: '2026-06-30',
  releaseDate: '2026-09-24',
};

const defaultHeaders = [
  'Year',
  'Year ending',
  'Police Region',
  'Local Government Area',
  'Offence Count',
  'Rate per 100,000 population',
] as const;

test('SourceRegistry admission: registers victoria.csa.recorded_offences with review_required and candidate status', async () => {
  const connectorsDir = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsDir);

  const entry = registry.get(SOURCE_ID);
  assert.ok(entry, `Source ${SOURCE_ID} must be registered in SourceRegistry`);
  assert.equal(entry.dataSource.source_id, SOURCE_ID);
  assert.equal(entry.dataSource.provider, 'Crime Statistics Agency Victoria');
  assert.equal(entry.dataSource.dataset_title, 'Recorded offences by local government area');
  assert.equal(entry.dataSource.topic, 'crime_statistics');
  assert.equal(entry.dataSource.scope, 'victoria');

  // Governance invariants: candidate and review_required until full human review & LGA code join
  assert.equal(entry.dataSource.license_status, 'review_required');
  assert.equal(entry.dataSource.access_status, 'candidate');
  assert.equal(entry.dataSource.landing_url, LANDING_URL);
  assert.ok(entry.dataSource.admission_evidence.missing_requirements.includes('quota_requests_per_day'));
  assert.ok(entry.dataSource.admission_evidence.missing_requirements.includes('connector_owner'));

  const loaded = await loadConnector(entry);
  assert.ok(isConnector(loaded), 'Loaded entry must conform to Connector interface');
  assert.equal(loaded.sourceId, SOURCE_ID);
});

test('selectCsaResource: correctly filters, sorts by period_end, and validates trusted official domains', () => {
  const validCatalog = {
    success: true,
    result: {
      resources: [
        {
          id: 'a1111111-1111-4111-8111-111111111111',
          name: 'Recorded offences by LGA - Year ending Jun 2025',
          format: 'XLSX',
          url: 'https://files.crimestatistics.vic.gov.au/2025-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2025.xlsx',
          period_end: '2025-06-30',
          release_date: '2025-09-25',
        },
        {
          id: 'b2222222-2222-4222-8222-222222222222',
          name: 'Recorded offences by LGA - Year ending Jun 2026',
          format: 'XLSX',
          url: 'https://files.crimestatistics.vic.gov.au/2026-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2026.xlsx',
          period_end: '2026-06-30',
          release_date: '2026-09-24',
        },
        {
          id: 'c3333333-3333-4333-8333-333333333333',
          name: 'Recorded offences by LGA - Year ending Mar 2026',
          format: 'CSV', // CSV must be ignored, only XLSX accepted
          url: 'https://files.crimestatistics.vic.gov.au/2026-06/table.csv',
          period_end: '2026-03-31',
          release_date: '2026-06-18',
        },
        {
          id: 'd4444444-4444-4444-8444-444444444444',
          name: 'Family incidents by LGA', // Non-matching name ignored
          format: 'XLSX',
          url: 'https://files.crimestatistics.vic.gov.au/2026-09/family.xlsx',
          period_end: '2026-06-30',
          release_date: '2026-09-24',
        },
        {
          id: 'e5555555-5555-4555-8555-555555555555',
          name: 'Recorded offences by LGA - Year ending Jun 2026',
          format: 'XLSX',
          url: 'https://untrusted-domain.com/data.xlsx', // Untrusted domain ignored
          period_end: '2026-06-30',
          release_date: '2026-09-24',
        },
      ],
    },
  };

  // 'latest' revision picks the latest period_end (2026-06-30)
  const latest = selectCsaResource(validCatalog, 'latest');
  assert.equal(latest.id, 'b2222222-2222-4222-8222-222222222222');
  assert.equal(latest.periodEnd, '2026-06-30');
  assert.equal(latest.releaseDate, '2026-09-24');

  // Explicit revision picks the specified revision ID
  const explicit = selectCsaResource(validCatalog, 'a1111111-1111-4111-8111-111111111111');
  assert.equal(explicit.id, 'a1111111-1111-4111-8111-111111111111');
  assert.equal(explicit.periodEnd, '2025-06-30');

  // Unknown revision throws error
  assert.throws(
    () => selectCsaResource(validCatalog, 'f9999999-9999-4999-8999-999999999999'),
    /CSA catalog has no valid by-LGA XLSX resource/
  );

  // Non-matching catalog throws error
  assert.throws(
    () => selectCsaResource({ success: false }, 'latest'),
    (err: any) => err?.name === 'ZodError'
  );
});

test('Unit parsing invariants: monthEnding, numericValue, and parseRate', () => {
  // monthEnding
  assert.equal(monthEnding('June'), 'June');
  assert.equal(monthEnding('jun'), 'June');
  assert.equal(monthEnding('March'), 'March');
  assert.equal(monthEnding('mar'), 'March');
  assert.equal(monthEnding('September'), 'September');
  assert.equal(monthEnding('sep'), 'September');
  assert.equal(monthEnding('December'), 'December');
  assert.equal(monthEnding('dec'), 'December');
  assert.throws(() => monthEnding('January'), /unsupported year-ending month/);

  // monthNumber
  assert.equal(monthNumber('March'), 3);
  assert.equal(monthNumber('June'), 6);
  assert.equal(monthNumber('September'), 9);
  assert.equal(monthNumber('December'), 12);

  // numericValue - observed integers
  const obs = numericValue('10632');
  assert.equal(obs.status, 'observed');
  assert.equal(obs.count, 10632);

  const obsZero = numericValue('0');
  assert.equal(obsZero.status, 'observed');
  assert.equal(obsZero.count, 0);

  // numericValue - suppressed markers must maintain count = null, NEVER 0
  for (const marker of ['*', 's', 'suppressed', 'np', 'n.p.', 'S', 'NP']) {
    const supp = numericValue(marker);
    assert.equal(supp.status, 'suppressed');
    assert.equal(supp.count, null, `Suppressed marker ${marker} must have count null`);
    assert.equal(supp.sourceMarker, marker);
  }

  // numericValue - missing values
  for (const empty of [null, '', '   ']) {
    const miss = numericValue(empty);
    assert.equal(miss.status, 'missing');
    assert.equal(miss.count, null, 'Missing value must have count null');
  }

  // numericValue - invalid / unknown markers fail fast
  assert.throws(() => numericValue('-5'), /unknown nonnumeric marker/);
  assert.throws(() => numericValue('invalid_count'), /unknown nonnumeric marker/);

  // parseRate
  assert.equal(parseRate('7978.0353'), 7978.0353);
  assert.equal(parseRate('0'), 0);
  assert.equal(parseRate(null), null);
  assert.equal(parseRate(''), null);
  assert.equal(parseRate('*'), null);
  assert.equal(parseRate('np'), null);
  assert.throws(() => parseRate('-10.5'), /rate is invalid/);
  assert.throws(() => parseRate('abc'), /rate is invalid/);
});

test('parseCsaWorkbook: parses valid Table 01, handles suppressions, filters Total rows, and preserves lgaCode: null', () => {
  const rows = [
    defaultHeaders,
    [2026, 'June', 'North West Metro', 'Melbourne', 44694, 22860.2],
    [2026, 'June', 'North West Metro', 'Yarra', 15823, 15518.2],
    [2026, 'June', 'North West Metro', 'Small Shire', '*', null], // suppressed
    [2026, 'June', 'North West Metro', 'Unincorporated Vic', 113, null], // null rate
    [2026, 'June', 'North West Metro', 'Missing Data Shire', null, null], // missing
    [2026, 'June', 'North West Metro', 'Total', 100000, 18000.0], // Police region total, must be filtered
  ];

  const bytes = buildSyntheticCsaXlsx(rows);
  const stats = parseCsaWorkbook(bytes, sampleResource);

  // Total row was filtered, leaving 5 data rows
  assert.equal(stats.length, 5);

  const melb = stats.find(s => s.lgaName === 'Melbourne')!;
  assert.ok(melb);
  assert.equal(melb.status, 'observed');
  assert.equal(melb.count, 44694);
  assert.equal(melb.ratePer100k, 22860.2);
  assert.equal(melb.lgaCode, null, 'Official workbook has no LGA code; lgaCode must remain null');
  assert.equal(melb.yearEnding, 2026);
  assert.equal(melb.monthEnding, 'June');
  assert.equal(melb.periodStart, '2025-07-01T00:00:00.000Z');
  assert.equal(melb.periodEndExclusive, '2026-07-01T00:00:00.000Z');
  assert.equal(melb.statisticalDefinition, 'rolling_12_month_offence_count');
  assert.equal(melb.releaseDate, '2026-09-24');

  // Suppressed row
  const supp = stats.find(s => s.lgaName === 'Small Shire')!;
  assert.ok(supp);
  assert.equal(supp.status, 'suppressed');
  assert.equal(supp.count, null);
  assert.equal(supp.ratePer100k, null);

  // Null rate row (e.g. Unincorporated Vic)
  const uninc = stats.find(s => s.lgaName === 'Unincorporated Vic')!;
  assert.ok(uninc);
  assert.equal(uninc.status, 'observed');
  assert.equal(uninc.count, 113);
  assert.equal(uninc.ratePer100k, null);

  // Missing row
  const miss = stats.find(s => s.lgaName === 'Missing Data Shire')!;
  assert.ok(miss);
  assert.equal(miss.status, 'missing');
  assert.equal(miss.count, null);
  assert.equal(miss.ratePer100k, null);
});

test('parseCsaWorkbook: rejects changed headers, duplicate rows, missing Table 01, and invalid years', () => {
  // Missing Table 01
  const emptyZip = zipSync({
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Contents" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    'xl/sharedStrings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst count="0" uniqueCount="0"/>`),
  });
  assert.throws(() => parseCsaWorkbook(emptyZip, sampleResource), /Table 01 is absent/);

  // Altered header
  const badHeaders = [
    ['Year', 'Year ending', 'Police Region', 'LGA_NAME_CHANGED', 'Offence Count', 'Rate per 100,000 population'],
    [2026, 'June', 'North West Metro', 'Melbourne', 100, 10.0],
  ];
  assert.throws(() => parseCsaWorkbook(buildSyntheticCsaXlsx(badHeaders), sampleResource), /header D changed/);

  // Duplicate LGA & period row
  const dupRows = [
    defaultHeaders,
    [2026, 'June', 'North West Metro', 'Melbourne', 100, 10.0],
    [2026, 'June', 'North West Metro', 'Melbourne', 105, 10.5],
  ];
  assert.throws(() => parseCsaWorkbook(buildSyntheticCsaXlsx(dupRows), sampleResource), /duplicate LGA\/period row/);

  // Invalid year
  const badYear = [
    defaultHeaders,
    [1850, 'June', 'North West Metro', 'Melbourne', 100, 10.0],
  ];
  assert.throws(() => parseCsaWorkbook(buildSyntheticCsaXlsx(badYear), sampleResource), /year is invalid/);

  // Empty LGA name
  const emptyLga = [
    defaultHeaders,
    [2026, 'June', 'North West Metro', '   ', 100, 10.0],
  ];
  assert.throws(() => parseCsaWorkbook(buildSyntheticCsaXlsx(emptyLga), sampleResource), /LGA name is missing/);
});

test('CsaRecordedOffencesConnector.collect: rejects time window and mismatched source ID', async () => {
  const connector = new CsaRecordedOffencesConnector();

  // Time window rejected (only snapshot allowed)
  const timeInput = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2025-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' },
    checkpoint: null,
    runId: 'test-run-time',
  });
  const timeResult = await connector.collect(timeInput);
  assert.equal(timeResult.kind, 'failure');
  assert.equal(timeResult.code, 'validation_failed');
  assert.ok(timeResult.message.includes('snapshot revision'));

  // Wrong source ID rejected
  const wrongSourceInput = parseConnectorInput({
    sourceId: 'victoria.csa.wrong_id',
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'test-run-wrong',
  });
  const wrongResult = await connector.collect(wrongSourceInput);
  assert.equal(wrongResult.kind, 'failure');
  assert.equal(wrongResult.code, 'validation_failed');
});

test('CsaRecordedOffencesConnector.collect: graceful failure when upstream catalog or workbook fails', async () => {
  // Catalog failure
  const mockHttpCatalogFail = {
    getJson: async () => {
      throw new HttpFailure('upstream_unavailable', 503, 3);
    },
    getBytes: async () => {
      throw new Error('should not be called');
    },
  };
  const connCatalogFail = new CsaRecordedOffencesConnector({ http: mockHttpCatalogFail as any });
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'test-run-fail-1',
  });
  const failResult1 = await connCatalogFail.collect(input);
  assert.equal(failResult1.kind, 'failure');
  assert.equal(failResult1.code, 'upstream_unavailable');

  // Corrupt workbook bytes
  const connCorruptXlsx = new CsaRecordedOffencesConnector({
    catalogJson: {
      success: true,
      result: {
        resources: [
          {
            id: '06bb24c8-8f62-4144-a746-99ef5492e4f9',
            name: 'Recorded offences by LGA - Year ending Jun 2026',
            format: 'XLSX',
            url: 'https://files.crimestatistics.vic.gov.au/2026-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2026.xlsx',
            period_end: '2026-06-30',
            release_date: '2026-09-24',
          },
        ],
      },
    },
    rawWorkbookBytes: new Uint8Array([0x00, 0x01, 0x02, 0x03]), // corrupted non-zip
  });
  const failResult2 = await connCorruptXlsx.collect(input);
  assert.equal(failResult2.kind, 'failure');
  assert.equal(failResult2.code, 'schema_changed');
});

test('CsaRecordedOffencesConnector.collect: successfully parses snapshot, generates SourceRecords, and exports statistics with lgaCode: null', async () => {
  const rows = [
    defaultHeaders,
    [2026, 'June', 'North West Metro', 'Melbourne', 44694, 22860.2],
    [2026, 'June', 'North West Metro', 'Yarra', 15823, 15518.2],
    [2026, 'June', 'North West Metro', 'Merri-bek', 14100, 7460.7],
  ];
  const workbookBytes = buildSyntheticCsaXlsx(rows);

  const connector = new CsaRecordedOffencesConnector({
    catalogJson: {
      success: true,
      result: {
        resources: [
          {
            id: '06bb24c8-8f62-4144-a746-99ef5492e4f9',
            name: 'Recorded offences by LGA - Year ending Jun 2026',
            format: 'XLSX',
            url: 'https://files.crimestatistics.vic.gov.au/2026-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2026.xlsx',
            period_end: '2026-06-30',
            release_date: '2026-09-24',
          },
        ],
      },
    },
    rawWorkbookBytes: workbookBytes,
  });

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'csa-success-test-run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceId, SOURCE_ID);
  assert.equal(result.runId, 'csa-success-test-run');
  assert.equal(result.sourceRevision, '06bb24c8-8f62-4144-a746-99ef5492e4f9');
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(result.completeness.expected_records, 3);
  assert.equal(result.completeness.fetched_records, 3);

  // SourceRecords invariants
  assert.equal(result.sourceRecords.length, 3);
  for (const sr of result.sourceRecords) {
    assert.equal(sr.source_id, SOURCE_ID);
    assert.equal(sr.batch_id, 'csa-success-test-run');
    assert.equal(sr.record_status, 'active');
    assert.equal(sr.assertion_kind, 'observation');
    assert.equal(sr.rights_status, 'review_required');
    assert.equal(sr.valid_from, '2025-07-01T00:00:00.000Z');
    assert.equal(sr.valid_to, '2026-07-01T00:00:00.000Z');
    assert.equal(sr.source_updated_at, '2026-06-30T00:00:00.000Z');
    assert.ok(sr.time_missing_reason?.includes('rolling-year period'));
  }

  // Statistics payload invariants
  assert.equal(result.statistics.length, 3);
  for (const stat of result.statistics) {
    assert.equal(stat.lgaCode, null, 'Must not invent or guess numeric LGA code');
    assert.equal(stat.yearEnding, 2026);
    assert.equal(stat.monthEnding, 'June');
    assert.equal(stat.statisticalDefinition, 'rolling_12_month_offence_count');
  }

  // Connector leaves areaIndicators empty, explicitly awaiting T058 boundary mapping
  assert.deepEqual(result.areaIndicators, []);
});

test('GM-02 Delivery Standard: Unversioned LGA names retain boundary_mapping_status = missing and prevent cross-vintage joins', async () => {
  // Two real regions across two real statistical periods:
  // - Melbourne (2026: 44694 offences / rate 22860.2, 2025: 45841 offences / rate 23570.9)
  // - Yarra (2026: 15823 offences / rate 15518.2, 2025: 15912 offences / rate 15699.1)
  const rows = [
    defaultHeaders,
    [2026, 'June', 'North West Metro', 'Melbourne', 44694, 22860.2],
    [2025, 'June', 'North West Metro', 'Melbourne', 45841, 23570.9],
    [2026, 'June', 'North West Metro', 'Yarra', 15823, 15518.2],
    [2025, 'June', 'North West Metro', 'Yarra', 15912, 15699.1],
    [2026, 'June', 'North West Metro', 'Merri-bek', 14100, 7460.7],
  ];
  const workbookBytes = buildSyntheticCsaXlsx(rows);

  const connector = new CsaRecordedOffencesConnector({
    catalogJson: {
      success: true,
      result: {
        resources: [
          {
            id: '06bb24c8-8f62-4144-a746-99ef5492e4f9',
            name: 'Recorded offences by LGA - Year ending Jun 2026',
            format: 'XLSX',
            url: 'https://files.crimestatistics.vic.gov.au/2026-09/Data_Tables_LGA_Recorded_Offences_Year_Ending_June_2026.xlsx',
            period_end: '2026-06-30',
            release_date: '2026-09-24',
          },
        ],
      },
    },
    rawWorkbookBytes: workbookBytes,
  });

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'csa-multi-area-period-run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // 1. Without boundary evidence, all indicators are normalized with unresolved boundary IDs
  const unmappedResult = normalizeCsaStatistics(result, null);
  assert.equal(unmappedResult.mapped, 0);
  assert.equal(unmappedResult.unresolved, 5); // 5 source statistics -> 10 indicators (5 count, 5 rate)
  assert.equal(unmappedResult.indicators.length, 10);

  for (const indicator of unmappedResult.indicators) {
    assert.ok(
      indicator.boundary_id.endsWith(':unresolved'),
      `Unmapped indicator boundary_id "${indicator.boundary_id}" must end with :unresolved`
    );
    assert.equal(
      indicator.source_area_code,
      null,
      'source_area_code must remain null without official code in source'
    );
    assert.equal(
      indicator.source_area_vintage,
      null,
      'source_area_vintage must remain null without verified geographic edition'
    );
  }

  // 2. Cross-period comparison without explicit boundary mapping MUST throw error
  const melb2025Count = unmappedResult.indicators.find(
    i => i.source_area_name === 'Melbourne' && i.period_end === '2025-07-01T00:00:00.000Z' && i.unit === 'recorded_offences'
  )!;
  const melb2026Count = unmappedResult.indicators.find(
    i => i.source_area_name === 'Melbourne' && i.period_end === '2026-07-01T00:00:00.000Z' && i.unit === 'recorded_offences'
  )!;
  assert.ok(melb2025Count && melb2026Count);
  assert.equal(melb2025Count.value, 45841);
  assert.equal(melb2026Count.value, 44694);

  // Must reject silent join between unresolved boundaries
  assert.throws(
    () => assertComparableIndicators(melb2025Count, melb2026Count),
    /requires an explicit boundary mapping/
  );

  // 3. Renamed LGA proof: In ASGS 2021, Moreland LGA had code 25250.
  // In 2022, Moreland was renamed to Merri-bek. CSA data labels it "Merri-bek".
  // Demonstrating that matching against ASGS 2021 by raw name fails for Merri-bek without explicit crosswalk:
  const asgs2021Evidence: AreaBoundaryEvidence = {
    sourceAreaVintage: '2021',
    boundaries: [
      { boundary_id: 'ASGS_LGA:24600:2021', scheme: 'ASGS_LGA', vintage: '2021', name: 'Melbourne', code: '24600' },
      { boundary_id: 'ASGS_LGA:27350:2021', scheme: 'ASGS_LGA', vintage: '2021', name: 'Yarra', code: '27350' },
      { boundary_id: 'ASGS_LGA:25250:2021', scheme: 'ASGS_LGA', vintage: '2021', name: 'Moreland', code: '25250' }, // Historical name in 2021
    ],
  };

  const partialMappedResult = normalizeCsaStatistics(result, asgs2021Evidence);
  // Melbourne (2 rows) and Yarra (2 rows) map because names match normalized forms.
  // Merri-bek (1 row) DOES NOT match Moreland, remaining unresolved!
  assert.equal(partialMappedResult.mapped, 4);
  assert.equal(partialMappedResult.unresolved, 1);

  const merribekInd = partialMappedResult.indicators.find(i => i.source_area_name === 'Merri-bek')!;
  assert.ok(merribekInd.boundary_id.includes('unresolved'), 'Merri-bek must remain unresolved without explicit 2021 crosswalk');

  // With explicit crosswalk supplied, Merri-bek can be mapped safely:
  const crosswalkEvidence: AreaBoundaryEvidence = {
    ...asgs2021Evidence,
    crosswalk: new Map([['Merri-bek', 'ASGS_LGA:2021:25250']]),
  };
  const fullyMappedResult = normalizeCsaStatistics(result, crosswalkEvidence);
  assert.equal(fullyMappedResult.mapped, 5);
  assert.equal(fullyMappedResult.unresolved, 0);

  const mappedMerribek = fullyMappedResult.indicators.find(i => i.source_area_name === 'Merri-bek')!;
  assert.equal(mappedMerribek.boundary_id, 'ASGS_LGA:2021:25250');
  assert.equal(mappedMerribek.source_area_vintage, '2021');
});
