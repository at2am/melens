import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ClueBlocksConnector,
  SOURCE_ID as BLOCKS_SOURCE_ID,
  parseClueBlockRow,
} from '../../src/connectors/com_clue_blocks/index.js';
import {
  ClueEmploymentConnector,
  SOURCE_ID as EMPLOYMENT_SOURCE_ID,
  normalizeClueEmploymentRow,
  parseClueEmploymentRow,
  type ClueEmploymentRawRow,
} from '../../src/connectors/com_clue_employment/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { loadConnector, loadSourceRegistry } from '../../src/core/registry.js';
import { parseBoundaryGeometry } from '../../src/validation/geography.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../fixtures');

async function loadEmploymentFixture(): Promise<unknown[]> {
  const content = await readFile(join(fixturesDir, 'com_clue_employment.json'), 'utf8');
  return JSON.parse(content) as unknown[];
}

async function loadBlocksFixture(): Promise<unknown[]> {
  const content = await readFile(join(fixturesDir, 'com_clue_blocks.json'), 'utf8');
  return JSON.parse(content) as unknown[];
}

test('SourceRegistry keeps employment under review and marks published CLUE blocks active', async () => {
  const connectorsRoot = join(__dirname, '../../src/connectors');
  const registry = await loadSourceRegistry(connectorsRoot);

  const employmentEntry = registry.get(EMPLOYMENT_SOURCE_ID);
  assert.ok(employmentEntry, 'melbourne.clue.employment must be registered');
  assert.equal(employmentEntry.dataSource.source_id, EMPLOYMENT_SOURCE_ID);
  assert.equal(employmentEntry.dataSource.topic, 'employment');
  assert.equal(employmentEntry.dataSource.scope, 'city');
  assert.equal(employmentEntry.dataSource.license_status, 'review_required');
  assert.equal(employmentEntry.dataSource.access_status, 'candidate');

  const blocksEntry = registry.get(BLOCKS_SOURCE_ID);
  assert.ok(blocksEntry, 'melbourne.clue.blocks must be registered');
  assert.equal(blocksEntry.dataSource.source_id, BLOCKS_SOURCE_ID);
  assert.equal(blocksEntry.dataSource.topic, 'boundary');
  assert.equal(blocksEntry.dataSource.scope, 'city');
  assert.equal(blocksEntry.dataSource.license_status, 'verified_open');
  assert.equal(blocksEntry.dataSource.access_status, 'active');
  assert.deepEqual(blocksEntry.dataSource.admission_evidence.missing_requirements, []);
  assert.equal(blocksEntry.dataSource.admission_evidence.raw_retention_days, 0);

  const employmentConnector = await loadConnector(employmentEntry);
  assert.equal(employmentConnector.sourceId, EMPLOYMENT_SOURCE_ID);

  const blocksConnector = await loadConnector(blocksEntry);
  assert.equal(blocksConnector.sourceId, BLOCKS_SOURCE_ID);
});

test('com_clue_blocks parses fixture, validates polygons, and emits canonical boundaries', async () => {
  const records = await loadBlocksFixture();

  class MockBlocksClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records,
        totalCount: records.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-06-01T00:00:00Z',
      };
    }
  }

  const connector = new ClueBlocksConnector(new MockBlocksClient());
  const input = parseConnectorInput({
    sourceId: BLOCKS_SOURCE_ID,
    window: { kind: 'snapshot', revision: '2025' },
    checkpoint: null,
    runId: 'test_blocks_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 3);
  assert.equal(result.outputCount, 3);
  assert.equal(result.boundaries.length, 3);
  assert.equal(result.sourceRecords.length, 3);

  for (const record of result.sourceRecords) {
    assert.equal(record.rights_status, 'verified_open');
    assert.equal(record.assertion_kind, 'observation');
    assert.equal(record.record_status, 'active');
    assert.equal(record.valid_from, null);
    assert.ok(record.time_missing_reason?.includes('spatial boundary'));
  }

  const block17 = result.boundaries.find(b => b.code === '17');
  assert.ok(block17, 'Block 17 boundary must exist');
  assert.equal(block17.scheme, 'com_clue_block');
  assert.equal(block17.vintage, '2025');
  assert.equal(block17.boundary_id, 'com_clue_block:17:2025');
  assert.equal(block17.name, 'CBD East');

  const parsedGeo = parseBoundaryGeometry(JSON.parse(block17.geometry_geojson));
  assert.equal(parsedGeo.type, 'Polygon');
  const firstRing = parsedGeo.coordinates[0];
  assert.ok(firstRing !== undefined && firstRing.length >= 4);
});

test('com_clue_blocks enforces unique block_ids in batch', async () => {
  const records = await loadBlocksFixture();
  const duplicates = [...records, records[0]];

  class DuplicateBlocksClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: duplicates,
        totalCount: duplicates.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-06-01T00:00:00Z',
      };
    }
  }

  const connector = new ClueBlocksConnector(new DuplicateBlocksClient());
  const input = parseConnectorInput({
    sourceId: BLOCKS_SOURCE_ID,
    window: { kind: 'snapshot', revision: '2025' },
    checkpoint: null,
    runId: 'test_dup_blocks',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Duplicate block_id'));
  }
});

test('current CLUE block layer cannot be relabelled as a historic polygon vintage', async () => {
  const connector = new ClueBlocksConnector();
  const result = await connector.collect(parseConnectorInput({ sourceId: BLOCKS_SOURCE_ID,
    window: { kind: 'snapshot', revision: '2024' }, checkpoint: null,
    runId: 'historic-block-request' }));
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('com_clue_employment preserves block ID, census year, industry, and suppressed values without zero-filling', async () => {
  const allRecords = await loadEmploymentFixture();
  const year2024Records = allRecords.filter((r: any) => String(r.census_year) === '2024');

  class MockEmploymentClient extends OpenDataSoftClient {
    override async fetchRecords(query: OdsQuery): Promise<OdsRecords> {
      assert.ok(query.where?.includes("census_year = date'2024-01-01'"));
      return {
        records: year2024Records,
        totalCount: year2024Records.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-06-01T00:00:00Z',
      };
    }
  }

  const connector = new ClueEmploymentConnector(new MockEmploymentClient());
  const input = parseConnectorInput({
    sourceId: EMPLOYMENT_SOURCE_ID,
    window: { kind: 'snapshot', revision: '2024' },
    checkpoint: null,
    runId: 'test_employment_run',
  });

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 3);
  assert.equal(result.sourceRecords.length, 3);
  // 3 blocks * 21 indicators each (20 industries + 1 total) = 63 indicators
  assert.equal(result.areaIndicators.length, 63);

  for (const record of result.sourceRecords) {
    assert.equal(record.rights_status, 'review_required');
    assert.equal(record.assertion_kind, 'observation');
    assert.equal(record.record_status, 'active');
    assert.equal(record.valid_from, '2024-01-01T00:00:00Z');
    assert.equal(record.valid_to, '2025-01-01T00:00:00Z');
    assert.equal(record.observed_at, null);
    assert.ok(record.time_missing_reason?.includes('not a precise observation date'));
  }

  // Verification of Invariant 1: Suppressed industry count MUST be status: 'suppressed' and value: null (NOT 0)
  const block17Accommodation = result.areaIndicators.find(
    i => i.boundary_id === 'CLUE_BLOCK_UNRESOLVED:17:2024' && i.definition.includes('Accommodation'),
  );
  assert.ok(block17Accommodation, 'Block 17 accommodation indicator must exist');
  assert.equal(block17Accommodation.status, 'suppressed');
  assert.equal(block17Accommodation.value, null, 'Suppressed value must be null, NEVER zero-filled');
  assert.equal(block17Accommodation.unit, 'jobs');
  assert.equal(block17Accommodation.source_area_name, 'Melbourne (CBD)');
  assert.equal(block17Accommodation.source_area_code, '17');
  assert.equal(block17Accommodation.source_area_vintage, null);

  // Verification of Invariant 2: Observed zero count MUST be status: 'observed' and value: 0
  const block17Agriculture = result.areaIndicators.find(
    i => i.boundary_id === 'CLUE_BLOCK_UNRESOLVED:17:2024' && i.definition.includes('Agriculture'),
  );
  assert.ok(block17Agriculture, 'Block 17 agriculture indicator must exist');
  assert.equal(block17Agriculture.status, 'observed');
  assert.equal(block17Agriculture.value, 0, 'Genuine zero count must be preserved as numeric 0');

  // Verification of Invariant 3: Observed positive count
  const block17Business = result.areaIndicators.find(
    i => i.boundary_id === 'CLUE_BLOCK_UNRESOLVED:17:2024' && i.definition.includes('Business Services'),
  );
  assert.ok(block17Business, 'Block 17 business services indicator must exist');
  assert.equal(block17Business.status, 'observed');
  assert.equal(block17Business.value, 510);

  // Verification of Invariant 4: Observed total jobs
  const block17Total = result.areaIndicators.find(
    i => i.boundary_id === 'CLUE_BLOCK_UNRESOLVED:17:2024' && i.definition.includes('total employment'),
  );
  assert.ok(block17Total, 'Block 17 total jobs indicator must exist');
  assert.equal(block17Total.status, 'observed');
  assert.equal(block17Total.value, 2865);

  // Verification of Invariant 5: Missing / suppressed total jobs in block 244
  const block244Total = result.areaIndicators.find(
    i => i.boundary_id === 'CLUE_BLOCK_UNRESOLVED:244:2024' && i.definition.includes('total employment'),
  );
  assert.ok(block244Total, 'Block 244 total jobs indicator must exist');
  assert.equal(block244Total.status, 'missing');
  assert.equal(block244Total.value, null, 'Missing total jobs must be null, not 0');
});

test('com_clue_employment supports multi-year normalization without cross-year bleed', async () => {
  const records = await loadEmploymentFixture();
  const row2024 = parseClueEmploymentRow(records.find((r: any) => r.block_id === 17 && r.census_year === '2024'));
  const row2023 = parseClueEmploymentRow(records.find((r: any) => r.block_id === 17 && r.census_year === '2023'));

  const norm2024 = normalizeClueEmploymentRow(row2024, 'run_2024', '2026-09-29T10:00:00Z', null);
  const norm2023 = normalizeClueEmploymentRow(row2023, 'run_2023', '2026-09-29T10:00:00Z', null);

  assert.equal(norm2024.sourceRecord.valid_from, '2024-01-01T00:00:00Z');
  assert.equal(norm2023.sourceRecord.valid_from, '2023-01-01T00:00:00Z');

  const biz2024 = norm2024.indicators.find(i => i.definition.includes('Business Services'));
  const biz2023 = norm2023.indicators.find(i => i.definition.includes('Business Services'));

  assert.equal(biz2024?.value, 510);
  assert.equal(biz2023?.value, 410);

  assert.equal(biz2024?.boundary_id, 'CLUE_BLOCK_UNRESOLVED:17:2024');
  assert.equal(biz2023?.boundary_id, 'CLUE_BLOCK_UNRESOLVED:17:2023');
});

test('CLUE date field is a census year and mismatched response years fail closed', async () => {
  const records = await loadEmploymentFixture();
  const row2024 = parseClueEmploymentRow(records.find((row: any) =>
    row.block_id === 17 && row.census_year === '2024'));
  assert.equal(parseClueEmploymentRow({ ...row2024, census_year: '2024-01-01' }).census_year,
    '2024');
  assert.equal(parseClueEmploymentRow({ ...row2024, census_year: '2024-01-01T00:00:00+00:00' }).census_year,
    '2024');
  assert.equal(parseClueEmploymentRow({ ...row2024, census_year: '2024-01-01T00:00:00Z' }).census_year,
    '2024');
  assert.throws(() => parseClueEmploymentRow({ ...row2024, census_year: '2024-07-01' }));
  assert.throws(() => parseClueEmploymentRow({ ...row2024, census_year: 'invalid-year' }));

  class WrongYearClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return { records: [{ ...row2024, census_year: '2023-01-01' }],
        totalCount: 1, pageCount: 1, fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null };
    }
  }
  const result = await new ClueEmploymentConnector(new WrongYearClient()).collect(
    parseConnectorInput({ sourceId: EMPLOYMENT_SOURCE_ID,
      window: { kind: 'snapshot', revision: '2024' }, checkpoint: null,
      runId: 'wrong-year' }));
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('CLUE employment empty response for requested year fails closed with validation_failed', async () => {
  class EmptyClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return { records: [], totalCount: 0, pageCount: 0, fetchedAt: '2026-09-29T10:00:00Z', lastModified: null };
    }
  }

  const connector = new ClueEmploymentConnector(new EmptyClient());
  const result = await connector.collect(
    parseConnectorInput({
      sourceId: EMPLOYMENT_SOURCE_ID,
      window: { kind: 'snapshot', revision: '1999' },
      checkpoint: null,
      runId: 'empty-test-run',
    }),
  );

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('No CLUE employment records found'));
  }
});

test('CLUE employment duplicate (census_year, block_id) in batch fails closed with validation_failed', async () => {
  const records = await loadEmploymentFixture();
  const row2024 = parseClueEmploymentRow(records.find((row: any) =>
    row.block_id === 17 && row.census_year === '2024'));

  class DuplicateEmploymentClient extends OpenDataSoftClient {
    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: [row2024, row2024],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: '2025-06-01T00:00:00Z',
      };
    }
  }

  const connector = new ClueEmploymentConnector(new DuplicateEmploymentClient());
  const result = await connector.collect(
    parseConnectorInput({
      sourceId: EMPLOYMENT_SOURCE_ID,
      window: { kind: 'snapshot', revision: '2024' },
      checkpoint: null,
      runId: 'duplicate-test-run',
    }),
  );

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
    assert.ok(result.message.includes('Duplicate (census_year, block_id)'));
  }
});

test('CLUE employment fetchMetadataRevision retrieves official data_processed and autoFetchMetadata populates sourceUpdatedAt', async () => {
  const records = await loadEmploymentFixture();
  const year2024Records = records.filter((r: any) => String(r.census_year) === '2024');
  const officialProcessedTimestamp = '2026-03-16T21:34:59.000Z';

  class MockMetadataClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(): Promise<string> {
      return officialProcessedTimestamp;
    }

    override async fetchRecords(): Promise<OdsRecords> {
      return {
        records: year2024Records,
        totalCount: year2024Records.length,
        pageCount: 1,
        fetchedAt: '2026-09-29T10:00:00Z',
        lastModified: null, // Records API omits Last-Modified header
      };
    }
  }

  const client = new MockMetadataClient();
  const connector = new ClueEmploymentConnector({ client, fetchMetadataRevision: true });

  const metadataTimestamp = await connector.fetchMetadataRevision();
  assert.equal(metadataTimestamp, officialProcessedTimestamp);

  const result = await connector.collect(
    parseConnectorInput({
      sourceId: EMPLOYMENT_SOURCE_ID,
      window: { kind: 'snapshot', revision: '2024' },
      checkpoint: null,
      runId: 'metadata-test-run',
    }),
  );

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceLatestUpdateAt, officialProcessedTimestamp);
  for (const record of result.sourceRecords) {
    assert.equal(record.source_updated_at, officialProcessedTimestamp);
  }
  for (const indicator of result.areaIndicators) {
    assert.equal(indicator.source_updated_at, officialProcessedTimestamp);
  }
});
