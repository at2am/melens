import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient } from '../../src/core/http.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import { normalizePlannedRoadSnapshot, parsePlannedRoadPage,
  parseVictorianTimestamp, PlannedRoadConnector } from
  '../../src/connectors/tv_road_planned/index.js';

const input = parseConnectorInput({ sourceId: 'victoria.transport.road_planned',
  window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:30:00Z' },
  checkpoint: '2026-09-28T00:00:00Z', runId: 'fixture-run' });
const fetchedAt = '2026-09-28T02:30:00.000Z';

async function fixture() {
  const bytes = await readFile(new URL('../fixtures/tv_road_planned.json', import.meta.url), 'utf8');
  const page = parsePlannedRoadPage(JSON.parse(bytes));
  assert.equal(page.kind, 'numbered');
  if (page.kind !== 'numbered') throw new Error('Expected numbered fixture');
  return page.body;
}

test('planned works retain schedule, affected segment, source status and geometry', async () => {
  const page = await fixture();
  const normalized = normalizePlannedRoadSnapshot(page.data.features, input, fetchedAt);
  assert.equal(normalized.sourceRecords.length, 2);
  assert.equal(normalized.geoRecords.length, 3);
  assert.equal(normalized.geoRecords[0]?.record_status, 'planned');
  assert.equal(normalized.geoRecords[0]?.assertion_kind, 'plan');
  assert.equal(normalized.geoRecords[0]?.valid_from, '2026-10-01T10:00:00.000Z');
  assert.equal(normalized.geoRecords[0]?.valid_to, '2026-10-09T18:00:00.000Z');
  assert.equal(normalized.geoRecords[0]?.geometry_geojson?.includes('LineString'), true);
  assert.equal(normalized.geoRecords[1]?.geometry_geojson?.includes('Point'), true);
  assert.equal(normalized.geoRecords[2]?.record_status, 'active');
  assert.equal(normalized.geoRecords[0]?.public_query_allowed, false);
  normalized.sourceRecords.forEach(row => assert.deepEqual(parseSourceRecord(row), row));
  normalized.geoRecords.forEach(row => assert.equal(validateGeoRecordGeography(row).valid, true));
  const details = JSON.parse(normalized.geoRecords[0]?.summary ?? '{}');
  assert.equal(details.impact.direction, 'Northbound');
  assert.equal(details.duration.recurrences[0].duration, 'PT9H');
  assert.equal(normalized.geoRecordSources.length, 3);
});

test('Victorian local timestamps respect daylight saving and reject ambiguous clock time', () => {
  assert.equal(parseVictorianTimestamp('2026-01-20T12:00:00'), '2026-01-20T01:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-07-20T12:00:00'), '2026-07-20T02:00:00.000Z');
  assert.throws(() => parseVictorianTimestamp('2026-04-05T02:30:00'));
  assert.throws(() => parseVictorianTimestamp('2026-10-04T02:30:00'));
});

test('numbered snapshot validates totals, uses KeyID header and does not accept missing key', async () => {
  const page = await fixture();
  class FixtureClient extends HttpClient {
    override async getJson(request: Parameters<HttpClient['getJson']>[0]) {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.equal((request.headers as Record<string, string>).KeyID, 'fixture-key');
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const client = new FixtureClient();
  const result = await new PlannedRoadConnector(client, () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.fetched_records, 2);
    assert.equal(result.geoRecords.length, 3);
  }
  const withoutKey = await new PlannedRoadConnector(client, () => undefined, 0).collect(input);
  assert.equal(withoutKey.kind, 'failure');
  if (withoutKey.kind === 'failure') assert.equal(withoutKey.code, 'auth_failed');
});

test('older token pagination requires final hasMoreRecords=false and unique events', async () => {
  const page = await fixture();
  const pages = [
    { type: 'FeatureCollection', features: [page.data.features[0]],
      nextPageDetails: { hasMoreRecords: true, nextPageToken: 'next' } },
    { type: 'FeatureCollection', features: [page.data.features[1]],
      nextPageDetails: { hasMoreRecords: false, nextPageToken: null } },
  ];
  class TokenClient extends HttpClient {
    calls = 0;
    override async getJson(request: Parameters<HttpClient['getJson']>[0]) {
      const headers = request.headers as Record<string, string>;
      assert.equal(headers.NextPageToken, this.calls === 0 ? undefined : 'next');
      const body = pages[this.calls];
      this.calls += 1;
      return { body, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const client = new TokenClient();
  const result = await new PlannedRoadConnector(client, () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.expected_records, null);
    assert.equal(result.completeness.fetched_pages, 2);
  }
  assert.equal(client.calls, 2);
});

test('a changed page total fails the snapshot', async () => {
  const page = await fixture();
  const first = { meta: { total_records: 2, total_pages: 2, page: 1, count: 1 },
    data: { type: 'FeatureCollection', features: [page.data.features[0]] } };
  const second = { meta: { total_records: 3, total_pages: 2, page: 2, count: 1 },
    data: { type: 'FeatureCollection', features: [page.data.features[1]] } };
  class ChangedTotalClient extends HttpClient {
    calls = 0;
    override async getJson() {
      const body = this.calls++ === 0 ? first : second;
      return { body, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new PlannedRoadConnector(new ChangedTotalClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'incomplete_window');
});
