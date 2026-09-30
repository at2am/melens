import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient } from '../../src/core/http.js';
import { UnplannedRoadConnector, normalizeRoadSnapshot, parseRoadPage } from
  '../../src/connectors/tv_road_unplanned/index.js';

const input = parseConnectorInput({ sourceId: 'victoria.transport.road_unplanned',
  window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
  checkpoint: '2026-09-28T00:00:00Z', runId: 'fixture-run' });
const fetchedAt = '2026-09-28T00:06:00Z';

async function fixture() {
  const bytes = await readFile(new URL('../fixtures/tv_road_unplanned.json', import.meta.url), 'utf8');
  return parseRoadPage(JSON.parse(bytes));
}

test('road incident keeps parent and each impact, with resolved status based on closure', async () => {
  const page = await fixture();
  const result = normalizeRoadSnapshot(page.data.features, input, fetchedAt);
  assert.equal(result.geoRecords.length, 2);
  assert.equal(result.geoRecords[0]?.record_status, 'active');
  assert.equal(result.geoRecords[1]?.record_status, 'resolved');
  assert.equal(result.geoRecords[0]?.valid_to, null);
  assert.equal(result.geoRecords[1]?.valid_to, '2026-09-28T00:04:00.000Z');
  assert.equal(result.geoRecords[0]?.geometry_geojson?.includes('LineString'), true);
  assert.equal(result.geoRecordSources.filter(link => link.evidence_role === 'parent_incident').length, 2);
  assert.equal(result.geoRecordSources.filter(link => link.evidence_role === 'child_impact').length, 2);
  assert.equal(result.geoRecords[0]?.public_query_allowed, false);
});

test('one complete v3 page can be collected without logging KeyID', async () => {
  const page = await fixture();
  class FixtureClient extends HttpClient {
    override async getJson() {
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const connector = new UnplannedRoadConnector(new FixtureClient(), () => 'fixture-key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.fetched_records, 2);
    assert.equal(result.geoRecords.length, 2);
  }
  const withoutKey = await new UnplannedRoadConnector(new FixtureClient(), () => undefined)
    .collect(input);
  assert.equal(withoutKey.kind, 'failure');
  if (withoutKey.kind === 'failure') assert.equal(withoutKey.code, 'auth_failed');
});

test('a pending impact stays out of current incident status and missing geometry stays unlocated', async () => {
  const page = await fixture();
  const first = page.data.features[0];
  assert.ok(first);
  const changed = { ...first, geometry: { type: 'Point', coordinates: [300, 95] },
    properties: { ...first.properties, eventLocationStatus: 'Pending' } };
  const result = normalizeRoadSnapshot([changed], input, fetchedAt);
  assert.equal(result.geoRecords[0]?.record_status, 'planned');
  assert.equal(result.geoRecords[0]?.geometry_geojson, null);
  assert.equal(result.geoRecords[0]?.location_role, 'unknown');
  assert.equal(result.sourceRecords.length, 2);
});
