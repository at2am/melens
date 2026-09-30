import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GeoRecord, SourceRecord } from '../../src/core/types.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord, sourceRecordId, sourceVersionId } from '../../src/validation/record.js';

const source: SourceRecord = {
  batch_id: 'batch', source_id: 'melbourne.news', schema_version: 1,
  fetched_at: '2026-09-28T00:15:00Z', source_record_id: 'melbourne.news:1',
  version_id: 'v1', original_url: 'https://example.org/story', raw_uri: null,
  published_at: '2026-09-28T00:00:00Z', observed_at: null,
  first_accessible_at: null, time_missing_reason: null,
  valid_from: null, valid_to: null, source_updated_at: null,
  source_version_ordinal: null, record_status: 'active',
  assertion_kind: 'report', rights_status: 'verified_open',
};

const geo: GeoRecord = {
  batch_id: 'batch', source_id: 'melbourne.news', schema_version: 1,
  fetched_at: '2026-09-28T00:15:00Z', geo_record_id: 'event:1',
  version_id: 'v1', topic: 'news', assertion_kind: 'report', title: null,
  summary: null, original_url: null,
  geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
  centroid_lat: -37.81, centroid_lon: 144.96,
  location_role: 'event_site', location_confidence: 'source_coordinate',
  area_refs: [], published_at: null, observed_at: null, valid_from: null,
  valid_to: null, source_updated_at: null, source_version_ordinal: null,
  freshness_state: 'unknown', record_status: 'active',
  rights_status: 'verified_open', public_query_allowed: true,
};

test('source identity ignores URL tracking and content key order', () => {
  const base = { sourceId: 'melbourne.news', nativeId: null, sourceTime: '2026-09-28T00:00:00Z' };
  assert.equal(
    sourceRecordId({ ...base, originalUrl: 'https://example.org/story?a=1&utm_source=x' }),
    sourceRecordId({ ...base, originalUrl: 'https://example.org/story?a=1' }),
  );
  assert.equal(sourceVersionId(null, { b: 1, a: 2 }), sourceVersionId(null, { a: 2, b: 1 }));
  assert.notEqual(sourceVersionId(null, { a: 1 }), sourceVersionId(null, { a: 2 }));
});

test('source fact needs traceability and explicit missing-time reason', () => {
  assert.deepEqual(parseSourceRecord(source), source);
  assert.throws(() => parseSourceRecord({ ...source, original_url: null }));
  assert.throws(() => parseSourceRecord({ ...source, published_at: null }));
  assert.doesNotThrow(() => parseSourceRecord({ ...source, published_at: null, time_missing_reason: 'not supplied upstream' }));
  assert.throws(() => parseSourceRecord({ ...source, valid_from: '2026-09-29T00:00:00Z', valid_to: '2026-09-28T00:00:00Z' }));
});

test('bad location is quarantined without deleting its source fact', () => {
  assert.equal(validateGeoRecordGeography(geo).valid, true);
  const bad = validateGeoRecordGeography({ ...geo, geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [-37.81, 190] }) });
  assert.equal(bad.valid, false);
  assert.equal(bad.geographicRecord, null);
  assert.deepEqual(parseSourceRecord(source), source);
});

test('area evidence cannot create a precise event point', () => {
  const bad = validateGeoRecordGeography({ ...geo, location_role: 'area_only', location_confidence: 'resolved_area' });
  assert.equal(bad.valid, false);
  assert.equal(bad.geographicRecord, null);
});
