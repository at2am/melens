import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ParkingRestrictionsConnector,
  SOURCE_ID,
  daysInInclusiveRange,
  findRuleConflicts,
  inferVehicleClass,
  parseExemption,
  parseHolidayApplicability,
  parseIsoTimestamp,
  parseRecordStatus,
  rulesOverlap,
  timeMinute,
} from '../../src/connectors/com_parking_restrictions/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { OdsIncompleteWindow, OpenDataSoftClient, type OdsQuery, type OdsRecords } from '../../src/core/opendatasoft.js';
import { parseSourceManifest } from '../../src/core/registry.js';
import type { ParkingBay, ParkingObservation, ParkingRule } from '../../src/core/types.js';
import { evaluateParkingBay } from '../../src/normalization/parking.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/com_parking_restrictions.json');
const manifestPath = join(__dirname, '../../src/connectors/com_parking_restrictions/source.json');

async function loadFixture(): Promise<{ total_count: number; results: unknown[] }> {
  const content = await readFile(fixturePath, 'utf8');
  return JSON.parse(content) as { total_count: number; results: unknown[] };
}

const input = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: '2022-11-13' },
  checkpoint: null,
  runId: 'fixture-test-run',
});

test('source.json has complete reviewed open-data admission', async () => {
  const content = await readFile(manifestPath, 'utf8');
  const manifest = parseSourceManifest(JSON.parse(content));

  assert.equal(manifest.source_id, SOURCE_ID);
  assert.equal(manifest.license_status, 'verified_open');
  assert.ok(['candidate', 'active'].includes(manifest.access_status));
  assert.deepEqual(manifest.admission_evidence.missing_requirements, []);
  assert.equal(manifest.topic, 'parking');
  assert.equal(manifest.scope, 'city');
  assert.equal(manifest.check_interval_seconds, 86400);
  assert.equal(manifest.record_granularity, 'bay_rule_slot');
  assert.equal(manifest.provider, 'City of Melbourne');
});

test('production restrictions use the full export and official dataset revision rather than fetch time', async () => {
  const fixture = await loadFixture();
  const requests: HttpRequest[] = [];
  class ExportClient extends HttpClient {
    override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
      requests.push(request);
      const url = String(request.url);
      const body = url.endsWith('/records?limit=0') ? { total_count: fixture.total_count }
        : url.endsWith('/exports/json') ? fixture.results
          : { metas: { default: { data_processed: '2022-11-13T10:30:19+00:00' } } };
      return { body, status: 200, fetchedAt: '2026-10-01T10:00:00Z', etag: null,
        lastModified: '2026-10-01T09:59:00Z', contentType: 'application/json' };
    }
  }
  const result = await new ParkingRestrictionsConnector(new ExportClient()).collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.equal(result.sourceRevision, '2022-11-13T10:30:19.000Z');
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.maxAttempts === 1 && request.redirect === 'error'));
  assert.ok(result.parkingRules.every(rule => rule.valid_from === null && rule.valid_to === null));
});

test('com_parking_restrictions parses fixture, preserves multiple non-overlapping rule slots per bay', async () => {
  const fixture = await loadFixture();

  class MockOdsClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: fixture.results,
        totalCount: fixture.total_count,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: '2022-11-13T10:30:19Z',
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new MockOdsClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.inputCount, 3);
  assert.equal(result.outputCount, 4);
  assert.equal(result.sourceRecords.length, 3);
  assert.equal(result.parkingRules.length, 4);
  assert.equal(result.geoRecords.length, 4);
  assert.equal(result.geoRecordSources.length, 4);
  assert.equal(result.sourceRevision, '2022-11-13T10:30:19.000Z');
  assert.equal(result.checkpointAfter, '2022-11-13');

  // Verify Bay 2313 has 2 distinct non-overlapping rules
  const bay2313Rules = result.parkingRules.filter(r => r.bay_id === 'restriction_bay:2313');
  assert.equal(bay2313Rules.length, 2);

  const slot1 = bay2313Rules.find(r => r.rule_id.endsWith(':slot1'));
  const slot2 = bay2313Rules.find(r => r.rule_id.endsWith(':slot2'));
  assert.ok(slot1);
  assert.ok(slot2);

  // Both slots must not overlap in time
  assert.equal(rulesOverlap(slot1, slot2), false);

  // Slot 1: 1P Meter M-F 9:30-18:30
  assert.deepEqual(slot1.days_of_week, [1, 2, 3, 4, 5]);
  assert.equal(slot1.start_minute_of_day, 570);
  assert.equal(slot1.end_minute_of_day, 1110);
  assert.equal(slot1.max_stay_minutes, 60);
  assert.equal(slot1.holiday_applicability, 'does_not_apply');
  assert.equal(slot1.vehicle_class, 'all');
  assert.equal(slot1.restriction_type, '1P Meter');
  assert.equal(slot1.exemption, null);
  assert.equal(slot1.valid_from, null);
  assert.equal(slot1.valid_to, null);

  // Slot 2: 2P Meter M-SAT 18:30-20:30
  assert.deepEqual(slot2.days_of_week, [1, 2, 3, 4, 5, 6]);
  assert.equal(slot2.start_minute_of_day, 1110);
  assert.equal(slot2.end_minute_of_day, 1230);
  assert.equal(slot2.max_stay_minutes, 120);
  assert.equal(slot2.holiday_applicability, 'does_not_apply');
  assert.equal(slot2.vehicle_class, 'all');
  assert.equal(slot2.restriction_type, '2P Meter');
  assert.equal(slot2.exemption, null);

  // Verify Bay 8801: Disability bay effective on public holiday
  const bay8801Rules = result.parkingRules.filter(r => r.bay_id === 'restriction_bay:8801');
  assert.equal(bay8801Rules.length, 1);
  const disRule = bay8801Rules[0]!;
  assert.deepEqual(disRule.days_of_week, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(disRule.start_minute_of_day, 0);
  assert.equal(disRule.end_minute_of_day, 1439);
  assert.equal(disRule.max_stay_minutes, 30);
  assert.equal(disRule.holiday_applicability, 'applies');
  assert.equal(disRule.vehicle_class, 'disability');
  assert.equal(disRule.exemption, 'Disability Permit Only');

  // Verify Bay 9902: Sunday only rule
  const bay9902Rules = result.parkingRules.filter(r => r.bay_id === 'restriction_bay:9902');
  assert.equal(bay9902Rules.length, 1);
  const sunRule = bay9902Rules[0]!;
  assert.deepEqual(sunRule.days_of_week, [7]);
  assert.equal(sunRule.start_minute_of_day, 600);
  assert.equal(sunRule.end_minute_of_day, 1020);
  assert.equal(sunRule.max_stay_minutes, 15);
  assert.equal(sunRule.holiday_applicability, 'does_not_apply');

  // Verify source records retain review_required and missing publication time explanation
  for (const srcRec of result.sourceRecords) {
    assert.equal(srcRec.rights_status, 'verified_open');
    assert.equal(srcRec.assertion_kind, 'plan');
    assert.equal(srcRec.record_status, 'active');
    assert.equal(srcRec.valid_from, null);
    assert.equal(srcRec.valid_to, null);
    assert.equal(srcRec.time_missing_reason, 'No per-bay rule publication time');
  }

  // Verify geo records retain review_required and private query status
  for (const geoRec of result.geoRecords) {
    assert.equal(geoRec.rights_status, 'verified_open');
    assert.equal(geoRec.public_query_allowed, true);
    assert.equal(geoRec.topic, 'parking');
    assert.equal(geoRec.assertion_kind, 'plan');
    assert.equal(geoRec.freshness_state, 'unknown');
  }

  // Verify geo record sources link rules to source records
  assert.equal(result.geoRecordSources.every(link => link.evidence_role === 'official_bay_restriction'), true);
});

test('daysInInclusiveRange maps upstream days to Monday=1..Sunday=7 correctly', () => {
  assert.deepEqual(daysInInclusiveRange(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(daysInInclusiveRange(1, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(daysInInclusiveRange(6, 0), [6, 7]);
  assert.deepEqual(daysInInclusiveRange(0, 0), [7]);
  assert.deepEqual(daysInInclusiveRange(1, 0), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(daysInInclusiveRange(5, 1), [5, 6, 7, 1]);
  assert.throws(() => daysInInclusiveRange(-1, 5), RangeError);
  assert.throws(() => daysInInclusiveRange(1, 7), RangeError);
});

test('timeMinute handles various timestamp and time string formats', () => {
  assert.equal(timeMinute('0001-01-01T09:30:00+00:00'), 570);
  assert.equal(timeMinute('0001-01-01T18:30:00+00:00'), 1110);
  assert.equal(timeMinute('09:30:00'), 570);
  assert.equal(timeMinute('09:30'), 570);
  assert.equal(timeMinute('00:00:00'), 0);
  assert.equal(timeMinute('23:59:00'), 1439);
  assert.equal(timeMinute('24:00:00'), 1440);
  assert.equal(timeMinute('24:00'), 1440);
  assert.equal(timeMinute('24:01:00'), null);
  assert.equal(timeMinute('25:00:00'), null);
  assert.equal(timeMinute(''), null);
  assert.equal(timeMinute(null), null);
  assert.equal(timeMinute(undefined), null);
});

test('inferVehicleClass categorizes vehicle classes correctly', () => {
  assert.equal(inferVehicleClass('1P Meter', '1P MTR M-F 9:30-18:30'), 'all');
  assert.equal(inferVehicleClass('2P Ticket', null), 'all');
  assert.equal(inferVehicleClass('1/2P Meter', null), 'all');
  assert.equal(inferVehicleClass('1/4P', null), 'all');
  assert.equal(inferVehicleClass('P 05 Min', null), 'all');
  assert.equal(inferVehicleClass('P 10 Mins', null), 'all');
  assert.equal(inferVehicleClass('P/ 15 Min -No Park', null), 'all');
  assert.equal(inferVehicleClass('Disabled', 'Disability Permit Only'), 'disability');
  assert.equal(inferVehicleClass('2P Disabled Only', null), 'disability');
  assert.equal(inferVehicleClass('Motorcycle Only', null), 'motorcycle');
  assert.equal(inferVehicleClass('Loading Zone', 'Commercial Loading'), 'loading_vehicle');
  assert.equal(inferVehicleClass('Loading Zone 30M 722', null), 'loading_vehicle');
  assert.equal(inferVehicleClass('Bus Zone', null), 'bus');
  assert.equal(inferVehicleClass('Taxi Only', null), 'taxi');
  assert.equal(inferVehicleClass('No Stopping', null), 'all');
  assert.equal(inferVehicleClass('Special Permit', null), null);
});

test('rulesOverlap detects overlapping vs non-overlapping rules on the same bay', () => {
  const provenance = {
    batch_id: 'batch',
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: '2026-09-29T12:00:00Z',
    source_record_id: 'src:1',
    source_updated_at: null,
    source_version_ordinal: null,
    valid_from: null,
    valid_to: null,
    version_id: 'v1',
  };

  const ruleA: ParkingRule = {
    ...provenance,
    rule_id: 'r:1',
    bay_id: 'restriction_bay:100',
    days_of_week: [1, 2, 3, 4, 5],
    start_minute_of_day: 570,
    end_minute_of_day: 1110,
    holiday_applicability: null,
    vehicle_class: 'all',
    restriction_type: '1P',
    max_stay_minutes: 60,
    exemption: null,
  };

  const ruleB: ParkingRule = {
    ...provenance,
    rule_id: 'r:2',
    bay_id: 'restriction_bay:100',
    days_of_week: [1, 2, 3, 4, 5],
    start_minute_of_day: 1110,
    end_minute_of_day: 1230,
    holiday_applicability: null,
    vehicle_class: 'all',
    restriction_type: '2P',
    max_stay_minutes: 120,
    exemption: null,
  };

  // Contiguous boundary at 1110 (18:30) does not overlap
  assert.equal(rulesOverlap(ruleA, ruleB), false);

  const ruleC: ParkingRule = {
    ...ruleB,
    rule_id: 'r:3',
    start_minute_of_day: 1000, // starts before ruleA ends
    end_minute_of_day: 1200,
  };
  assert.equal(rulesOverlap(ruleA, ruleC), true);

  const ruleD: ParkingRule = {
    ...ruleC,
    rule_id: 'r:4',
    days_of_week: [6, 7], // Weekend only, no shared days
  };
  assert.equal(rulesOverlap(ruleA, ruleD), false);

  const ruleOtherBay: ParkingRule = {
    ...ruleC,
    bay_id: 'restriction_bay:200',
  };
  assert.equal(rulesOverlap(ruleA, ruleOtherBay), false);

  // Non-overlapping validity date intervals on the same bay and times
  const ruleYear2022: ParkingRule = {
    ...ruleA,
    rule_id: 'r:2022',
    valid_from: '2022-01-01T00:00:00.000Z',
    valid_to: '2022-12-31T23:59:59.000Z',
  };
  const ruleYear2023: ParkingRule = {
    ...ruleA,
    rule_id: 'r:2023',
    valid_from: '2023-01-01T00:00:00.000Z',
    valid_to: '2023-12-31T23:59:59.000Z',
  };
  assert.equal(rulesOverlap(ruleYear2022, ruleYear2023), false);
});

test('duplicate bayid in the same snapshot fails closed with validation_failed', async () => {
  const row = {
    bayid: 2313,
    description1: '1P Meter',
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T09:30:00+00:00',
    endtime1: '0001-01-01T18:30:00+00:00',
    typedesc1: '1P Meter',
  };

  class DuplicateClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [row, row],
        totalCount: 2,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new DuplicateClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('invalid slot schema returns schema_changed failure', async () => {
  const badRow = {
    bayid: 5555,
    fromday1: 99, // Invalid day of week (must be 0..6)
    today1: 5,
    starttime1: '0001-01-01T09:30:00+00:00',
    endtime1: '0001-01-01T18:30:00+00:00',
    typedesc1: '1P Meter',
  };

  class BadSchemaClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [badRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new BadSchemaClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('null or missing fromday on active slot fails schema validation with schema_changed', async () => {
  const badRow = {
    bayid: 5556,
    fromday1: null, // Must not be silently coerced to 0 (Sunday)
    today1: 5,
    starttime1: '0001-01-01T09:30:00+00:00',
    endtime1: '0001-01-01T18:30:00+00:00',
    typedesc1: '1P Meter',
  };

  class BadFromDayClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [badRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new BadFromDayClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('unknown holidays and exemptions stay unknown / null', async () => {
  // Unit tests for helper functions
  assert.equal(parseHolidayApplicability(null), null);
  assert.equal(parseHolidayApplicability(undefined), null);
  assert.equal(parseHolidayApplicability(''), null);
  assert.equal(parseHolidayApplicability('unknown'), null);
  assert.equal(parseHolidayApplicability(2), null);
  assert.equal(parseHolidayApplicability(-1), null);
  assert.equal(parseHolidayApplicability('other'), null);
  assert.equal(parseHolidayApplicability(1), 'applies');
  assert.equal(parseHolidayApplicability('1'), 'applies');
  assert.equal(parseHolidayApplicability(true), 'applies');
  assert.equal(parseHolidayApplicability(0), 'does_not_apply');
  assert.equal(parseHolidayApplicability('0'), 'does_not_apply');
  assert.equal(parseHolidayApplicability(false), 'does_not_apply');

  assert.equal(parseExemption('Disability Permit Only'), 'Disability Permit Only');
  assert.equal(parseExemption('Resident Permit Area 1B'), 'Resident Permit Area 1B');
  assert.equal(parseExemption(null), null);
  assert.equal(parseExemption(undefined), null);
  assert.equal(parseExemption(''), null);
  assert.equal(parseExemption('   '), null);
  assert.equal(parseExemption('none'), null);
  assert.equal(parseExemption('None'), null);
  assert.equal(parseExemption('N/A'), null);
  assert.equal(parseExemption('null'), null);
  assert.equal(parseExemption('unknown'), null);
  assert.equal(parseExemption('UNKNOWN'), null);
  assert.equal(parseExemption('no exemption'), null);

  // Connector collect() with unknown holiday and unknown exemption values
  const rowWithUnknowns = {
    bayid: 7001,
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T08:00:00+00:00',
    endtime1: '0001-01-01T18:00:00+00:00',
    typedesc1: '2P Meter',
    duration1: 120,
    effectiveonph1: null, // Unknown holiday
    exemption1: 'None', // Unknown/none exemption
  };

  class UnknownsClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [rowWithUnknowns],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new UnknownsClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.parkingRules.length, 1);
  const rule = result.parkingRules[0]!;
  assert.equal(rule.holiday_applicability, null);
  assert.equal(rule.exemption, null);
});

test('rule slot and row dates and statuses are preserved when supplied', async () => {
  const rowWithDates = {
    bayid: 7002,
    valid_from: '2024-01-01T00:00:00Z',
    valid_to: '2024-12-31T23:59:59Z',
    status: 'active',
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T09:00:00+00:00',
    endtime1: '0001-01-01T17:00:00+00:00',
    typedesc1: '1P Meter',
    duration1: 60,
    effectiveonph1: 0,
    exemption1: null,
    status1: 'cancelled',
    fromday2: 6,
    today2: 6,
    starttime2: '0001-01-01T09:00:00+00:00',
    endtime2: '0001-01-01T12:00:00+00:00',
    typedesc2: '2P Meter',
    duration2: 120,
    effectiveonph2: 1,
    exemption2: 'Resident Permit Area 1B',
    validfrom2: '2024-06-01T00:00:00Z',
    validto2: '2024-12-31T23:59:59Z',
  };

  class DatesClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [rowWithDates],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new DatesClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.sourceRecords.length, 1);
  const src = result.sourceRecords[0]!;
  assert.equal(src.valid_from, '2024-01-01T00:00:00.000Z');
  assert.equal(src.valid_to, '2024-12-31T23:59:59.000Z');
  assert.equal(src.record_status, 'active');

  assert.equal(result.parkingRules.length, 2);
  const rule1 = result.parkingRules.find(r => r.rule_id.endsWith(':slot1'))!;
  const rule2 = result.parkingRules.find(r => r.rule_id.endsWith(':slot2'))!;

  // Slot 1 inherits row valid_from and valid_to
  assert.equal(rule1.valid_from, '2024-01-01T00:00:00.000Z');
  assert.equal(rule1.valid_to, '2024-12-31T23:59:59.000Z');

  // Slot 2 has explicit slot-level valid_from
  assert.equal(rule2.valid_from, '2024-06-01T00:00:00.000Z');
  assert.equal(rule2.valid_to, '2024-12-31T23:59:59.000Z');
  assert.equal(rule2.exemption, 'Resident Permit Area 1B');

  // GeoRecords reflect slot statuses
  const geo1 = result.geoRecords.find(g => g.geo_record_id.endsWith(':slot1'))!;
  const geo2 = result.geoRecords.find(g => g.geo_record_id.endsWith(':slot2'))!;
  assert.equal(geo1.record_status, 'cancelled');
  assert.equal(geo2.record_status, 'active');
});

test('valid_to preceding valid_from fails closed with validation_failed', async () => {
  const badRow = {
    bayid: 7003,
    valid_from: '2025-01-01T00:00:00Z',
    valid_to: '2024-01-01T00:00:00Z', // Precedes valid_from
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T09:00:00+00:00',
    endtime1: '0001-01-01T17:00:00+00:00',
    typedesc1: '1P Meter',
  };

  class InvertedDatesClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [badRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new InvertedDatesClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('invalid date timestamp fails closed with validation_failed', async () => {
  const badDateRow = {
    bayid: 7004,
    valid_from: 'not-a-valid-date',
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T09:00:00+00:00',
    endtime1: '0001-01-01T17:00:00+00:00',
    typedesc1: '1P Meter',
  };

  class BadDateClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [badDateRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new BadDateClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('non-consecutive rule slots are preserved without skipping or shifting', async () => {
  const sparseRow = {
    bayid: 7005,
    typedesc1: '1P Meter',
    fromday1: 1,
    today1: 5,
    starttime1: '0001-01-01T09:00:00+00:00',
    endtime1: '0001-01-01T17:00:00+00:00',
    // slot 2 is null
    typedesc3: '2P Meter',
    fromday3: 6,
    today3: 6,
    starttime3: '0001-01-01T09:00:00+00:00',
    endtime3: '0001-01-01T13:00:00+00:00',
  };

  class SparseClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [sparseRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new SparseClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.parkingRules.length, 2);
  const slot1 = result.parkingRules.find(r => r.rule_id.endsWith(':slot1'));
  const slot3 = result.parkingRules.find(r => r.rule_id.endsWith(':slot3'));
  assert.ok(slot1);
  assert.ok(slot3);
  assert.equal(slot1.bay_id, 'restriction_bay:7005');
  assert.equal(slot3.bay_id, 'restriction_bay:7005');
});

test('midnight end-time mapping preserves overnight window for daytime start', async () => {
  // Live dataset bay 6002: starts at 5:00 AM, endtime is 00:00:00 (midnight)
  const midnightRow = {
    bayid: 6002,
    description1: 'P/10 M-SUN 5:00-11:59 - No Park',
    fromday1: 1,
    today1: 0,
    starttime1: '0001-01-01T05:00:00+00:00',
    endtime1: '0001-01-01T00:00:00+00:00',
    typedesc1: 'P/ 10 Min',
    duration1: 10,
    effectiveonph1: 0,
  };

  class MidnightClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [midnightRow],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-29T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector(new MidnightClient());
  const result = await connector.collect(input);

  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  assert.equal(result.parkingRules.length, 1);
  const rule = result.parkingRules[0]!;
  assert.equal(rule.start_minute_of_day, 300); // 5:00 AM
  assert.equal(rule.end_minute_of_day, 1440); // 24:00 (midnight end of day)
  assert.equal(rule.vehicle_class, 'all');
});

test('parseIsoTimestamp and parseRecordStatus handle variations correctly', () => {
  assert.equal(parseIsoTimestamp('2024-01-01T12:00:00Z'), '2024-01-01T12:00:00.000Z');
  assert.equal(parseIsoTimestamp('2024-01-01'), '2024-01-01T00:00:00.000Z');
  assert.equal(parseIsoTimestamp(null), null);
  assert.equal(parseIsoTimestamp(undefined), null);
  assert.equal(parseIsoTimestamp(''), null);
  assert.throws(() => parseIsoTimestamp('invalid-date'), RangeError);

  assert.deepEqual(parseRecordStatus('active'), { sourceRecordStatus: 'active', geoRecordStatus: 'active' });
  assert.deepEqual(parseRecordStatus('cancelled'), { sourceRecordStatus: 'cancelled', geoRecordStatus: 'cancelled' });
  assert.deepEqual(parseRecordStatus('withdrawn'), { sourceRecordStatus: 'withdrawn', geoRecordStatus: 'withdrawn' });
  assert.deepEqual(parseRecordStatus('corrected'), { sourceRecordStatus: 'corrected', geoRecordStatus: 'active' });
  assert.deepEqual(parseRecordStatus('planned'), { sourceRecordStatus: 'active', geoRecordStatus: 'planned' });
  assert.deepEqual(parseRecordStatus(null), { sourceRecordStatus: 'active', geoRecordStatus: 'active' });
});

test('network and upstream error codes are mapped correctly', async () => {
  class RateLimitedClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      throw new HttpFailure('rate_limited', 429, 1);
    }
  }
  const rlResult = await new ParkingRestrictionsConnector(new RateLimitedClient()).collect(input);
  assert.equal(rlResult.kind, 'failure');
  if (rlResult.kind === 'failure') assert.equal(rlResult.code, 'rate_limited');

  class UpstreamUnavailableClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      throw new HttpFailure('upstream_unavailable', 503, 1);
    }
  }
  const uaResult = await new ParkingRestrictionsConnector(new UpstreamUnavailableClient()).collect(input);
  assert.equal(uaResult.kind, 'failure');
  if (uaResult.kind === 'failure') assert.equal(uaResult.code, 'upstream_unavailable');

  class IncompleteClient extends OpenDataSoftClient {
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      throw new OdsIncompleteWindow('count changed during pagination', 10);
    }
  }
  const incResult = await new ParkingRestrictionsConnector(new IncompleteClient()).collect(input);
  assert.equal(incResult.kind, 'failure');
  if (incResult.kind === 'failure') assert.equal(incResult.code, 'incomplete_window');
});

test('sourceId mismatch fails closed with validation_failed', async () => {
  const mismatchInput = { ...input, sourceId: 'wrong.source.id' };
  const connector = new ParkingRestrictionsConnector();
  const result = await connector.collect(mismatchInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('findRuleConflicts accurately detects conflicting rules on the same bay', () => {
  const provenance = {
    batch_id: 'batch',
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: '2026-09-29T12:00:00Z',
    source_record_id: 'src:1',
    source_updated_at: '2022-11-13T10:30:19.000Z',
    source_version_ordinal: null,
    valid_from: null,
    valid_to: null,
    version_id: 'v1',
  };

  const ruleA: ParkingRule = {
    ...provenance,
    rule_id: 'r:1',
    bay_id: 'restriction_bay:100',
    days_of_week: [1, 2, 3, 4, 5],
    start_minute_of_day: 570,
    end_minute_of_day: 1110,
    holiday_applicability: null,
    vehicle_class: 'all',
    restriction_type: '1P Meter',
    max_stay_minutes: 60,
    exemption: null,
  };

  const ruleB: ParkingRule = {
    ...provenance,
    rule_id: 'r:2',
    bay_id: 'restriction_bay:100',
    days_of_week: [1, 2, 3, 4, 5],
    start_minute_of_day: 1110,
    end_minute_of_day: 1230,
    holiday_applicability: null,
    vehicle_class: 'all',
    restriction_type: '2P Meter',
    max_stay_minutes: 120,
    exemption: null,
  };

  // No conflict between non-overlapping contiguous rules A and B
  assert.equal(findRuleConflicts([ruleA, ruleB]).length, 0);

  const conflictingRule: ParkingRule = {
    ...provenance,
    rule_id: 'r:3',
    bay_id: 'restriction_bay:100',
    days_of_week: [1, 2, 3],
    start_minute_of_day: 600,
    end_minute_of_day: 900,
    holiday_applicability: null,
    vehicle_class: 'all',
    restriction_type: 'No Stopping',
    max_stay_minutes: 0,
    exemption: null,
  };

  const conflicts = findRuleConflicts([ruleA, ruleB, conflictingRule]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]![0].rule_id, 'r:1');
  assert.equal(conflicts[0]![1].rule_id, 'r:3');
});

test('rules from com_parking_restrictions ensure undated, expired, unknown-holiday, and conflicting rules never produce may_park_now = yes', () => {
  const provenance = {
    batch_id: 'batch',
    source_id: SOURCE_ID,
    schema_version: 1,
    fetched_at: '2026-09-30T12:00:00Z',
    source_record_id: 'src:2313',
    source_updated_at: '2022-11-13T10:30:19.000Z',
    source_version_ordinal: null,
    version_id: 'v1',
  };

  const bay: ParkingBay = {
    ...provenance,
    bay_id: 'bay:2313',
    marker_id: 'marker:2313',
    geometry_geojson: null,
    public_access: true,
    valid_from: null,
    valid_to: null,
  };

  const observation: ParkingObservation = {
    ...provenance,
    sensor_id: 'sensor:2313',
    bay_id: 'sensor-bay:2313',
    marker_id: 'marker:2313',
    observed_at: '2026-09-30T00:58:00Z',
    occupied: false,
  };

  // Official upstream rule: undated sign from 2022 dataset with valid_from = null
  const undatedRule: ParkingRule = {
    ...provenance,
    rule_id: 'rule:2313:slot1',
    bay_id: 'restriction_bay:2313',
    days_of_week: [1, 2, 3, 4, 5],
    start_minute_of_day: 570,
    end_minute_of_day: 1110,
    holiday_applicability: 'does_not_apply',
    vehicle_class: 'all',
    restriction_type: '1P Meter',
    max_stay_minutes: 60,
    exemption: null,
    valid_from: null, // Upstream restrictions have no row effective dates
    valid_to: null,
  };

  const baseInput = {
    bay,
    allBays: [bay],
    observations: [observation],
    rules: [undatedRule],
    ruleCrosswalk: {
      bayId: bay.bay_id,
      sensorBayId: observation.bay_id!,
      ruleBayId: undatedRule.bay_id,
      evidenceUrl: 'https://data.melbourne.vic.gov.au/explore/dataset/on-street-car-park-bay-restrictions/',
      verified: true as const,
    },
    now: new Date('2026-09-30T01:00:00Z'), // 11:00 AM Melbourne time (day 3 / Wednesday)
    melbournePublicHoliday: false,
    vehicleClass: 'car',
    cadenceSeconds: 300,
    lastSuccessfulCheckAt: '2026-09-30T00:59:00Z',
  };

  // 1. Undated historical rule: cannot prove permission today -> unknown (no_current_rule)
  const undatedDecision = evaluateParkingBay(baseInput);
  assert.equal(undatedDecision.mayParkNow, 'unknown');
  assert.ok(undatedDecision.reasons.includes('no_current_rule'));

  // 2. Expired rule: valid_to in the past -> unknown (no_current_rule)
  const expiredRule: ParkingRule = {
    ...undatedRule,
    valid_from: '2022-01-01T00:00:00Z',
    valid_to: '2022-12-31T23:59:59Z',
  };
  const expiredDecision = evaluateParkingBay({ ...baseInput, rules: [expiredRule] });
  assert.equal(expiredDecision.mayParkNow, 'unknown');
  assert.ok(expiredDecision.reasons.includes('no_current_rule'));

  // 3. Known valid date but unknown holiday state -> unknown (rule_ambiguous)
  const datedRule: ParkingRule = {
    ...undatedRule,
    restriction_type: 'allowed',
    valid_from: '2026-01-01T00:00:00Z',
    valid_to: '2026-12-31T23:59:59Z',
  };
  const unknownHolidayDecision = evaluateParkingBay({
    ...baseInput,
    rules: [datedRule],
    melbournePublicHoliday: null,
  });
  assert.equal(unknownHolidayDecision.mayParkNow, 'unknown');
  assert.ok(unknownHolidayDecision.reasons.includes('rule_ambiguous'));

  // 4. A rule that excludes public holidays gives no applicable rule that day.
  const doesNotApplyRule: ParkingRule = {
    ...datedRule,
    holiday_applicability: 'does_not_apply',
  };
  const holidayDecision = evaluateParkingBay({
    ...baseInput,
    rules: [doesNotApplyRule],
    melbournePublicHoliday: true,
  });
  assert.equal(holidayDecision.mayParkNow, 'unknown');
  assert.ok(holidayDecision.reasons.includes('no_current_rule'));

  // 5. Rule with exemption -> unknown (rule_ambiguous)
  const exemptionRule: ParkingRule = {
    ...datedRule,
    exemption: 'Disability Permit Only',
  };
  const exemptionDecision = evaluateParkingBay({ ...baseInput, rules: [exemptionRule] });
  assert.equal(exemptionDecision.mayParkNow, 'unknown');
  assert.ok(exemptionDecision.reasons.includes('rule_ambiguous'));

  // 6. Conflicting overlapping rules on same bay -> unknown (rule_ambiguous)
  const conflictingRule: ParkingRule = {
    ...datedRule,
    rule_id: 'rule:2313:slot2',
    restriction_type: 'no_parking',
  };
  const conflictDecision = evaluateParkingBay({
    ...baseInput,
    rules: [datedRule, conflictingRule],
  });
  assert.equal(conflictDecision.mayParkNow, 'unknown');
  assert.ok(conflictDecision.reasons.includes('rule_ambiguous'));

  // 7. No verified crosswalk (the real situation today between restrictions bayid and sensor kerbsideid)
  const noCrosswalkDecision = evaluateParkingBay({ ...baseInput, rules: [datedRule], ruleCrosswalk: null });
  assert.equal(noCrosswalkDecision.mayParkNow, 'unknown');
  assert.ok(noCrosswalkDecision.reasons.includes('rule_crosswalk_unverified'));
});

test('fetchMetadataRevision retrieves official data_processed timestamp and autoFetchMetadata populates sourceUpdatedAt', async () => {
  class MetadataClient extends OpenDataSoftClient {
    override async fetchDatasetDataProcessed(query: Pick<OdsQuery, 'portalUrl' | 'datasetId'>): Promise<string> {
      assert.equal(query.datasetId, 'on-street-car-park-bay-restrictions');
      return '2022-11-13T10:30:19.000Z';
    }
    override async fetchRecords(_query: OdsQuery): Promise<OdsRecords> {
      return {
        records: [{
          bayid: 1001,
          fromday1: 1,
          today1: 5,
          starttime1: '0001-01-01T09:00:00+00:00',
          endtime1: '0001-01-01T17:00:00+00:00',
          typedesc1: '2P Meter',
        }],
        totalCount: 1,
        pageCount: 1,
        fetchedAt: '2026-09-30T12:00:00Z',
        lastModified: null,
      };
    }
  }

  const connector = new ParkingRestrictionsConnector({
    client: new MetadataClient(),
    fetchMetadataRevision: true,
  });

  const metadataRevision = await connector.fetchMetadataRevision();
  assert.equal(metadataRevision, '2022-11-13T10:30:19.000Z');

  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.sourceRevision, '2022-11-13T10:30:19.000Z');
    assert.equal(result.sourceLatestUpdateAt, '2022-11-13T10:30:19.000Z');
    assert.equal(result.sourceRecords[0]!.source_updated_at, '2022-11-13T10:30:19.000Z');
    assert.equal(result.parkingRules[0]!.source_updated_at, '2022-11-13T10:30:19.000Z');
    assert.equal(result.geoRecords[0]!.source_updated_at, '2022-11-13T10:30:19.000Z');
  }
});
