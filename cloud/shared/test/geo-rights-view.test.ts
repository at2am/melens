import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import { preparePublicRecordQuery } from '../src/query/public-record-queries.js';
import { prepareViewQuery } from '../src/query/view-queries.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const request = parseViewportQuery({ requestId: 'geo-rights-view', bbox: [144.9, -37.9, 145.1, -37.7],
  zoom: 14, layers: ['planning'], mode: 'current',
  window: { from: '2026-10-15T00:00:00Z', to: '2026-10-16T00:00:00Z' } });

test('current display reads the served copy while record rights read the live current gate', () => {
  for (const queryId of ['planning', 'disruption', 'event', 'news'] as const) {
    const display = prepareViewQuery({ queryId, request, config, pageSize: 1_000 });
    const proof = preparePublicRecordQuery({ queryId, request, config, pageSize: 1_000,
      recordKeys: [{ id: 'wanted', versionId: 'v1', sourceId: 'public.source' }] });
    assert.match(display.query, /`melens-testing\.melens_query\.v_geo_records_current_served`/);
    assert.match(proof.query, /`melens-testing\.melens_query\.v_geo_records_current`/);
    assert.doesNotMatch(proof.query, /_served|melens_ingest/);
    assert.match(proof.query, /requested\.version_id = g\.version_id/);
    assert.match(proof.query, /g\.record_status IN \('active', 'planned'\)/);
    assert.equal(proof.maximumBytesBilled, String(config.dynamicScanBytes));
  }
});

test('historical display and rights retain the historical view and lifecycle rules', () => {
  const historical = { ...request, mode: 'historical' as const };
  const display = prepareViewQuery({ queryId: 'planning', request: historical, config, pageSize: 1_000 });
  const proof = preparePublicRecordQuery({ queryId: 'planning', request: historical, config, pageSize: 1_000,
    recordKeys: [{ id: 'wanted', versionId: 'v1', sourceId: 'public.source' }] });
  assert.match(display.query, /`melens-testing\.melens_query\.v_geo_records_history`/);
  assert.match(proof.query, /`melens-testing\.melens_query\.v_geo_records_history`/);
  assert.match(proof.query, /g\.record_status != 'withdrawn'/);
  assert.equal(proof.maximumBytesBilled, String(config.historicalScanBytes));
});

test('a caller that proved the copy current may read current rights from it; history keeps its view', () => {
  const keys = [{ id: 'wanted', versionId: 'v1', sourceId: 'public.source' }];
  const served = preparePublicRecordQuery({ queryId: 'news', request, config, pageSize: 1_000, recordKeys: keys,
    currentGeoRead: 'served' });
  assert.match(served.query, /`melens-testing\.melens_query\.v_geo_records_current_served`/);
  assert.match(served.query, /requested\.version_id = g\.version_id/);
  assert.match(served.query, /g\.record_status IN \('active', 'planned'\)/);
  const historical = preparePublicRecordQuery({ queryId: 'news', request: { ...request, mode: 'historical' }, config,
    pageSize: 1_000, recordKeys: keys, currentGeoRead: 'served' });
  assert.match(historical.query, /`melens-testing\.melens_query\.v_geo_records_history`/);
});
