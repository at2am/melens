import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest } from '../../src/core/http.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import { UnplannedRoadConnector, normalizeRoadSnapshot, parseRoadPage,
  parseVictorianTimestamp } from '../../src/connectors/tv_road_unplanned/index.js';

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
  const connector = new UnplannedRoadConnector(new FixtureClient(), () => 'fixture-key', 0);
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.completeness.fetched_records, 2);
    assert.equal(result.geoRecords.length, 2);
  }
  const withoutKey = await new UnplannedRoadConnector(new FixtureClient(), () => undefined, 0)
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
  assert.equal(result.sourceRecords.length, 3);
});

test('parent incident deduplication, child impact links, parseSourceRecord and validateGeoRecordGeography invariants', async () => {
  const page = await fixture();
  const result = normalizeRoadSnapshot(page.data.features, input, fetchedAt);

  const parentRecords = result.sourceRecords.filter(r => r.source_record_id.endsWith(':incident:RUD-INC001'));
  assert.equal(parentRecords.length, 1, 'One consistent parent incident accompanies two independently located impacts');

  // If two features share the EXACT SAME parent version, it must be deduplicated to 1
  const sameParentFeatures = [
    page.data.features[0]!,
    { ...page.data.features[0]!, properties: { ...page.data.features[0]!.properties, impactId: 'IMP-NEW' } },
  ];
  const dedupResult = normalizeRoadSnapshot(sameParentFeatures, input, fetchedAt);
  const dedupParent = dedupResult.sourceRecords.filter(r => r.source_record_id.endsWith(':incident:RUD-INC001'));
  assert.equal(dedupParent.length, 1, 'Identical parent version must only be emitted once');
  assert.equal(dedupResult.sourceRecords.filter(r => r.source_record_id.includes(':impact:')).length, 2);

  // Each impact has its own child source record in fixture result
  const childRecords = result.sourceRecords.filter(r => r.source_record_id.includes(':impact:RUD-INC001:'));
  assert.equal(childRecords.length, 2, 'Each impact must have its own source record');

  // All source records must satisfy schema invariants
  for (const record of result.sourceRecords) {
    assert.deepEqual(parseSourceRecord(record), record);
    assert.equal(record.rights_status, 'review_required');
    assert.equal(record.assertion_kind, 'report');
  }

  // All geo records must satisfy geography validation
  for (const geo of result.geoRecords) {
    const geoValidation = validateGeoRecordGeography(geo);
    assert.equal(geoValidation.valid, true, `GeoRecord geography must be valid: ${geoValidation.issues.join(', ')}`);
    assert.equal(geo.rights_status, 'review_required');
    assert.equal(geo.public_query_allowed, false);
  }

  // Each child impact geo record links to BOTH parent incident and child impact
  for (const geo of result.geoRecords) {
    const links = result.geoRecordSources.filter(l => l.geo_record_id === geo.geo_record_id);
    assert.equal(links.length, 3);
    assert.ok(links.some(l => l.evidence_role === 'parent_incident'));
    assert.ok(links.some(l => l.evidence_role === 'child_impact'));
  }
});

test('incident without child impacts creates one parent geography with parent and snapshot evidence', async () => {
  const featureWithoutImpact = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.963, -37.814] },
    properties: {
      id: 'RUD-INC-SINGLE',
      impactId: null,
      status: 'Active',
      eventLocationStatus: 'Active',
      eventType: 'Hazard',
      description: 'Debris on road',
      created: '2026-09-28T01:00:00Z',
      lastUpdated: '2026-09-28T01:05:00Z',
      reference: { localRoadName: 'Flinders St', localGovernmentArea: 'Melbourne' },
    },
  };

  const result = normalizeRoadSnapshot([featureWithoutImpact], input, fetchedAt);

  assert.equal(result.sourceRecords.length, 2, 'The parent incident and complete snapshot are emitted when impactId is absent');
  assert.equal(result.sourceRecords[0]?.source_record_id, 'victoria.transport.road_unplanned:incident:RUD-INC-SINGLE');
  assert.deepEqual(parseSourceRecord(result.sourceRecords[0]), result.sourceRecords[0]);

  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.geoRecords[0]?.geo_record_id, 'victoria.transport.road_unplanned:incident:RUD-INC-SINGLE');
  assert.equal(result.geoRecords[0]?.record_status, 'active');
  assert.equal(result.geoRecords[0]?.centroid_lon, 144.963);
  assert.equal(result.geoRecords[0]?.centroid_lat, -37.814);
  assert.equal(validateGeoRecordGeography(result.geoRecords[0]!).valid, true);

  // The incident has one parent evidence link and one complete snapshot membership link.
  assert.equal(result.geoRecordSources.length, 2);
  assert.equal(result.geoRecordSources[0]?.evidence_role, 'parent_incident');
  assert.equal(result.geoRecordSources[0]?.source_record_id, 'victoria.transport.road_unplanned:incident:RUD-INC-SINGLE');
});

test('duplicate incident-impact pairs in same snapshot fail fast with validation_failed', async () => {
  const page = await fixture();
  const duplicateFeatures = [page.data.features[0]!, page.data.features[0]!];

  assert.throws(
    () => normalizeRoadSnapshot(duplicateFeatures, input, fetchedAt),
    /Duplicate incident-impact pair/,
  );

  class DuplicateClient extends HttpClient {
    override async getJson() {
      return {
        body: { meta: { total_records: 2, total_pages: 1, page: 1, count: 2 },
          data: { type: 'FeatureCollection', features: duplicateFeatures } },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json',
      };
    }
  }

  const result = await new UnplannedRoadConnector(new DuplicateClient(), () => 'key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('incident clearance ("解除"): resolved status preserved, missing lastClosed keeps valid_to null and records missing reason', async () => {
  const inactiveWithoutLastClosed = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.95, -37.81] },
    properties: {
      id: 'RUD-INC-CLEARED',
      impactId: 'IMP-CLEARED',
      status: 'Inactive',
      eventLocationStatus: 'Inactive',
      eventType: 'Crash',
      description: 'Crash cleared',
      created: '2026-09-28T00:00:00Z',
      lastUpdated: '2026-09-28T00:30:00Z',
      lastClosed: null, // Upstream omitted explicit lastClosed
      reference: { localRoadName: 'King St' },
    },
  };

  const result = normalizeRoadSnapshot([inactiveWithoutLastClosed], input, fetchedAt);
  const geo = result.geoRecords[0];
  assert.ok(geo);
  assert.equal(geo.record_status, 'resolved', 'Inactive disruption is correctly classified as resolved');
  // Without official lastClosed, valid_to must remain null to prevent inventing event end times
  assert.equal(geo.valid_to, null, 'Must NOT invent valid_to or substitute fetchedAt when lastClosed is absent');

  const childSourceRec = result.sourceRecords.find(r => r.source_record_id.includes('impact:'));
  assert.ok(childSourceRec);
  assert.equal(childSourceRec.valid_to, null);
  assert.equal(childSourceRec.time_missing_reason, 'Incident clearance time absent upstream');
  assert.deepEqual(parseSourceRecord(childSourceRec), childSourceRec);

  const parentSourceRec = result.sourceRecords.find(r => r.source_record_id.includes('incident:'));
  assert.ok(parentSourceRec);
  assert.equal(parentSourceRec.valid_to, null);
  assert.equal(parentSourceRec.time_missing_reason, 'Incident clearance time absent upstream');
  assert.deepEqual(parseSourceRecord(parentSourceRec), parentSourceRec);
});

test('idempotency and replay: identical payload normalized at different fetchedAt yields 100% identical valid_to, event times, and version_ids', async () => {
  const inactivePayload = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.95, -37.81] },
    properties: {
      id: 'RUD-INC-REPLAY',
      impactId: 'IMP-REPLAY',
      status: 'Inactive',
      eventLocationStatus: 'Inactive',
      eventType: 'Hazard',
      description: 'Hazard removed',
      created: '2026-09-28T00:00:00Z',
      lastUpdated: '2026-09-28T00:15:00Z',
      lastClosed: null, // No explicit lastClosed
    },
  };

  const fetchedAtRun1 = '2026-09-28T01:00:00.000Z';
  const fetchedAtRun2 = '2026-09-28T05:30:00.000Z'; // Run 4.5 hours later

  const result1 = normalizeRoadSnapshot([inactivePayload], input, fetchedAtRun1);
  const result2 = normalizeRoadSnapshot([inactivePayload], input, fetchedAtRun2);

  // GeoRecords comparison
  const geo1 = result1.geoRecords[0]!;
  const geo2 = result2.geoRecords[0]!;
  assert.equal(geo1.version_id, geo2.version_id, 'version_id must be completely deterministic and independent of fetchedAt');
  assert.equal(geo1.valid_to, null);
  assert.equal(geo2.valid_to, null);
  assert.equal(geo1.valid_to, geo2.valid_to, 'valid_to must remain identical (null) across replays');
  assert.equal(geo1.observed_at, geo2.observed_at);
  assert.equal(geo1.valid_from, geo2.valid_from);
  assert.equal(geo1.source_updated_at, geo2.source_updated_at);
  assert.equal(geo1.record_status, geo2.record_status);

  // SourceRecords comparison
  for (let i = 0; i < result1.sourceRecords.length - 1; i++) {
    const s1 = result1.sourceRecords[i]!;
    const s2 = result2.sourceRecords[i]!;
    assert.equal(s1.source_record_id, s2.source_record_id);
    assert.equal(s1.version_id, s2.version_id, 'SourceRecord version_id must match across replays');
    assert.equal(s1.valid_to, s2.valid_to, 'SourceRecord valid_to must match across replays');
    assert.equal(s1.observed_at, s2.observed_at);
    assert.equal(s1.valid_from, s2.valid_from);
    assert.equal(s1.time_missing_reason, s2.time_missing_reason);
  }
});

test('endTime does NOT cause incident resolution without explicit inactive status', async () => {
  // Transport Victoria notes state: v3 endTime is an estimate, not evidence that an incident resolved.
  const activePastEndTime = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.95, -37.81] },
    properties: {
      id: 'RUD-INC-ESTIMATE',
      impactId: 'IMP-1',
      status: 'Active',
      eventLocationStatus: 'Active',
      eventType: 'Congestion',
      description: 'Heavy traffic',
      created: '2026-09-28T00:00:00Z',
      lastUpdated: '2026-09-28T00:10:00Z',
      endTime: '2026-09-28T00:05:00Z', // In the past!
      lastClosed: null,
    },
  };

  const result = normalizeRoadSnapshot([activePastEndTime], input, fetchedAt);
  const geo = result.geoRecords[0];
  assert.ok(geo);
  assert.equal(geo.record_status, 'active', 'Estimated endTime must not mark active disruption as resolved');
  assert.equal(geo.valid_to, null, 'Active disruption must keep valid_to null');
});

test('temporal clearance progression across batches (Run 1 active -> Run 2 resolved)', async () => {
  const page = await fixture();
  const run1Input = parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:15:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'run-1',
  });

  const activeFeature = page.data.features[0]!;
  const resultRun1 = normalizeRoadSnapshot([activeFeature], run1Input, '2026-09-28T00:06:00Z');
  assert.equal(resultRun1.geoRecords[0]?.record_status, 'active');
  assert.equal(resultRun1.geoRecords[0]?.valid_to, null);

  const run2Input = parseConnectorInput({
    sourceId: 'victoria.transport.road_unplanned',
    window: { kind: 'time', from: '2026-09-28T00:15:00Z', to: '2026-09-28T00:30:00Z' },
    checkpoint: '2026-09-28T00:15:00Z',
    runId: 'run-2',
  });

  const clearedFeature = {
    ...activeFeature,
    properties: {
      ...activeFeature.properties,
      status: 'Inactive',
      eventLocationStatus: 'Inactive',
      lastClosed: '2026-09-28T00:20:00Z',
      lastUpdated: '2026-09-28T00:22:00Z',
    },
  };

  const resultRun2 = normalizeRoadSnapshot([clearedFeature], run2Input, '2026-09-28T00:25:00Z');
  assert.equal(resultRun2.geoRecords[0]?.record_status, 'resolved');
  assert.equal(resultRun2.geoRecords[0]?.valid_to, '2026-09-28T00:20:00.000Z');
  assert.equal(resultRun2.geoRecords[0]?.geo_record_id, resultRun1.geoRecords[0]?.geo_record_id);
  assert.notEqual(resultRun2.geoRecords[0]?.version_id, resultRun1.geoRecords[0]?.version_id, 'Version must update upon clearance');
});

test('source.json contract: cadence_seconds=60, check_interval_seconds=60, license_status=review_required, access_status=candidate', async () => {
  const raw = await readFile(new URL('../../src/connectors/tv_road_unplanned/source.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.source_id, 'victoria.transport.road_unplanned');
  assert.equal(manifest.cadence_seconds, 60);
  assert.equal(manifest.check_interval_seconds, 60);
  assert.equal(manifest.requires_monitoring, true);
  assert.equal(manifest.license_status, 'review_required');
  assert.equal(manifest.access_status, 'candidate');
  assert.deepEqual(manifest.admission_evidence.secret_names, ['transport_victoria_key_id']);
});

test('sourceLatestUpdateAt tracks max lastUpdated and missing created sets time_missing_reason', async () => {
  const feat1 = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.96, -37.81] },
    properties: {
      id: 'RUD-INC-TIME-1',
      impactId: 'IMP-A',
      status: 'Active',
      eventType: 'Hazard',
      created: null, // Missing created
      lastUpdated: '2026-09-28T00:10:00Z',
    },
  };
  const feat2 = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.97, -37.82] },
    properties: {
      id: 'RUD-INC-TIME-2',
      impactId: 'IMP-B',
      status: 'Active',
      eventType: 'Hazard',
      created: '2026-09-28T00:00:00Z',
      lastUpdated: '2026-09-28T00:15:00Z', // Later update
    },
  };

  const result = normalizeRoadSnapshot([feat1, feat2], input, fetchedAt);
  assert.equal(result.latestUpdate, '2026-09-28T00:15:00.000Z');

  const missingCreatedParent = result.sourceRecords.find(r => r.source_record_id.endsWith(':incident:RUD-INC-TIME-1'));
  assert.ok(missingCreatedParent);
  assert.equal(missingCreatedParent.observed_at, null);
  assert.equal(missingCreatedParent.time_missing_reason, 'Incident created time absent upstream');
  assert.deepEqual(parseSourceRecord(missingCreatedParent), missingCreatedParent);
});

test('rate limiting (HTTP 429) returns rate_limited failure code with retryAfterSeconds', async () => {
  class RateLimitedClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('rate_limited', 429, 3, 45000);
    }
  }

  const connector = new UnplannedRoadConnector(new RateLimitedClient(), () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
    assert.equal(result.retryAfterSeconds, 45);
    assert.equal(result.completeness.complete, false);
    assert.ok(result.message.includes('Rate limit exceeded') || result.message.includes('rate limit'));
  }
});

test('rate limiting default retryAfterSeconds without retry-after header defaults to 60s', async () => {
  class RateLimitedWithoutHeaderClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('rate_limited', 429, 3, null);
    }
  }

  const connector = new UnplannedRoadConnector(new RateLimitedWithoutHeaderClient(), () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
    assert.equal(result.retryAfterSeconds, 60, 'Should default to 60s Transport Victoria window');
    assert.equal(result.completeness.complete, false);
  }
});

test('multi-page rate limit: rate limit on page 2 aborts and returns rate_limited without emitting partial records', async () => {
  const page = await fixture();
  const page1 = {
    meta: { total_records: 200, total_pages: 2, page: 1, limit: 100, count: 1 },
    data: { type: 'FeatureCollection', features: [page.data.features[0]!] },
  };

  class SecondPageRateLimitClient extends HttpClient {
    calls = 0;
    override async getJson() {
      this.calls += 1;
      if (this.calls === 1) {
        return { body: page1, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }
      throw new HttpFailure('rate_limited', 429, 3, 60000);
    }
  }

  const client = new SecondPageRateLimitClient();
  const connector = new UnplannedRoadConnector(client, () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(client.calls, 2);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
    assert.equal(result.retryAfterSeconds, 60);
    assert.equal(result.completeness.fetched_records, 0, 'No partial records committed on failure');
  }
});

test('upstream 500/503 returns upstream_unavailable', async () => {
  class Upstream503Client extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('upstream_unavailable', 503, 3, null);
    }
  }

  const connector = new UnplannedRoadConnector(new Upstream503Client(), () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'upstream_unavailable');
  }
});

test('unauthorized KeyID returns auth_failed without leaking credentials', async () => {
  const sensitiveKey = 'super-secret-tv-key-value-98765';
  class UnauthorizedClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('auth_failed', 401, 1, null);
    }
  }

  const connector = new UnplannedRoadConnector(new UnauthorizedClient(), () => sensitiveKey, 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'auth_failed');
    assert.equal(result.message.includes(sensitiveKey), false, 'KeyID must never appear in message');
  }
});

test('malformed page payload returns schema_changed', async () => {
  class MalformedClient extends HttpClient {
    override async getJson() {
      return {
        body: { unexpected_field: true },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json',
      };
    }
  }

  const connector = new UnplannedRoadConnector(new MalformedClient(), () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }
});

test('inconsistent page totals or counts fail with incomplete_window', async () => {
  const page = await fixture();
  // Page 1 says total_records is 2, Page 2 says total_records changed to 3
  const page1 = {
    meta: { total_records: 2, total_pages: 2, page: 1, limit: 1, count: 1 },
    data: { type: 'FeatureCollection', features: [page.data.features[0]!] },
  };
  const page2Inconsistent = {
    meta: { total_records: 3, total_pages: 2, page: 2, limit: 1, count: 1 },
    data: { type: 'FeatureCollection', features: [page.data.features[1]!] },
  };

  class InconsistentTotalClient extends HttpClient {
    calls = 0;
    override async getJson() {
      const body = this.calls++ === 0 ? page1 : page2Inconsistent;
      return { body, status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }

  const connector = new UnplannedRoadConnector(new InconsistentTotalClient(), () => 'valid-key', 0);
  const result = await connector.collect(input);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
  }
});

test('mismatched sourceId in input returns validation_failed', async () => {
  const wrongInput = parseConnectorInput({
    sourceId: 'melbourne.pedestrian.hourly',
    window: { kind: 'snapshot', revision: 'latest' },
    checkpoint: null,
    runId: 'wrong-run',
  });

  const connector = new UnplannedRoadConnector(new HttpClient(), () => 'key', 0);
  const result = await connector.collect(wrongInput);

  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'validation_failed');
  }
});

test('offsetless road timestamps remain unverified; only explicit offsets produce UTC instants', () => {
  assert.equal(parseVictorianTimestamp('2026-09-28T00:00:00Z'), '2026-09-28T00:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-09-28T10:00:00+10:00'), '2026-09-28T00:00:00.000Z');
  for (const raw of ['2026-07-20T12:00:00', '2026-01-20T12:00:00',
    '2026-10-01T09:49:04', '2026-10-04T02:30:00', '2026-04-05T02:30:00']) {
    assert.equal(parseVictorianTimestamp(raw), null);
  }
  assert.throws(() => parseVictorianTimestamp('not-a-timestamp'));
  assert.throws(() => parseVictorianTimestamp('2026-02-30T12:00:00'));
});

test('cloud probe offsetless clocks retain raw evidence and cannot certify freshness or absolute times', () => {
  const feature = parseRoadPage({ meta: { total_records: 1, total_pages: 1, page: 1, count: 1 },
    data: { type: 'FeatureCollection', features: [{ type: 'Feature',
      geometry: { type: 'Point', coordinates: [144.96, -37.81] },
      properties: { id: 'RUD-INC-PROBE', impactId: 'IMP-PROBE', status: 'Active',
        eventLocationStatus: 'Active', eventType: 'Crash', description: 'Probe observed crash',
        created: '2026-10-01T09:30:00', lastUpdated: '2026-10-01T09:49:04' } }] } });
  const result = normalizeRoadSnapshot(feature.data.features, input, '2026-09-30T23:53:48.526Z');
  for (const source of result.sourceRecords.filter(row => !row.source_record_id.includes(':snapshot:'))) {
    assert.equal(source.source_updated_at, null);
    assert.equal(source.observed_at, null);
    assert.equal(source.valid_from, null);
    assert.match(source.time_missing_reason ?? '', /timezone unverified/);
    parseSourceRecord(source);
  }
  assert.equal(result.latestUpdate, null);
  assert.ok(result.sourceRevision);
  const summary = JSON.parse(result.geoRecords[0]?.summary ?? '{}');
  assert.equal(summary.created, '2026-10-01T09:30:00');
  assert.equal(summary.last_updated, '2026-10-01T09:49:04');
  assert.equal(summary.timezone_status, 'unverified');
});

test('estimates vs resolution: nextUpdateDue and endTime never mark active incident as resolved', async () => {
  const activeWithPastEstimates = {
    type: 'Feature' as const,
    geometry: { type: 'Point', coordinates: [144.96, -37.81] },
    properties: {
      id: 'RUD-INC-ESTIMATES',
      impactId: 'IMP-1',
      status: 'Active',
      eventLocationStatus: 'Active',
      eventType: 'Congestion',
      description: 'Active event with expired nextUpdateDue and endTime',
      created: '2026-09-28T00:00:00Z',
      lastUpdated: '2026-09-28T01:00:00Z',
      endTime: '2026-09-28T02:00:00Z', // Past estimated end time
      nextUpdateDue: '2026-09-28T01:30:00Z', // Past update reminder
      lastClosed: null,
    },
  };

  const result = normalizeRoadSnapshot([activeWithPastEstimates], input, fetchedAt);
  const geo = result.geoRecords[0];
  assert.ok(geo);

  // Must strictly remain 'active' with valid_to = null
  assert.equal(geo.record_status, 'active');
  assert.equal(geo.valid_to, null, 'Past endTime or nextUpdateDue must NEVER resolve an active incident');

  const sourceRec = result.sourceRecords.find(r => r.source_record_id.includes('impact:'));
  assert.ok(sourceRec);
  assert.equal(sourceRec.valid_to, null);
});


test('parent incident changes propagate to child and snapshot revisions even without a verified clock', async () => {
  const page = await fixture();
  const original = page.data.features[0];
  assert.ok(original);
  const offsetless = { ...original, properties: { ...original.properties,
    created: '2026-10-01T09:30:00', lastUpdated: '2026-10-01T09:49:04' } };
  const first = normalizeRoadSnapshot([offsetless], input, fetchedAt);
  const revised = normalizeRoadSnapshot([{ ...offsetless, properties: { ...offsetless.properties,
    description: 'Upstream incident description revised', status: 'Inactive' } }], input, fetchedAt);
  assert.equal(first.geoRecords[0]?.geo_record_id, revised.geoRecords[0]?.geo_record_id);
  assert.notEqual(first.geoRecords[0]?.version_id, revised.geoRecords[0]?.version_id);
  assert.notEqual(first.sourceRevision, revised.sourceRevision);
  assert.equal(first.latestUpdate, null);
  assert.equal(revised.latestUpdate, null);
  const replay = normalizeRoadSnapshot([offsetless], { ...input, runId: 'replay' }, '2026-10-03T00:00:00Z');
  assert.notEqual(first.sourceRevision, replay.sourceRevision);
  assert.deepEqual(first.geoRecords.map(row => row.version_id), replay.geoRecords.map(row => row.version_id));
});

test('unrecognized or missing incident status and unknown impact status cannot become active', async () => {
  const page = await fixture();
  const feature = page.data.features[0];
  assert.ok(feature);
  for (const properties of [
    { ...feature.properties, status: 'Unknown' },
    { ...feature.properties, status: null },
    { ...feature.properties, eventLocationStatus: 'CancelledElsewhere' },
  ]) {
    const changed = { ...feature, properties };
    assert.throws(() => normalizeRoadSnapshot([changed], input, fetchedAt));
    class ChangedClient extends HttpClient {
      override async getJson() {
        return { body: { ...page, meta: { ...page.meta, total_records: 1, count: 1 },
          data: { ...page.data, features: [changed] } },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
      }
    }
    const result = await new UnplannedRoadConnector(new ChangedClient(), () => 'fixture-key', 0)
      .collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') assert.equal(result.code, 'schema_changed');
  }
  const reopened = normalizeRoadSnapshot([{ ...feature,
    properties: { ...feature.properties, status: 'Reopened', eventLocationStatus: 'Reopened' } }], input, fetchedAt);
  assert.equal(reopened.geoRecords[0]?.record_status, 'active');
});

test('contradictory parent incident versions abort an otherwise complete snapshot', async () => {
  const page = await fixture();
  const feature = page.data.features[1];
  assert.ok(feature);
  const changed = { ...feature, properties: { ...feature.properties, status: 'Inactive' } };
  const features = [page.data.features[0], changed].filter(feature => feature !== undefined);
  assert.throws(() => normalizeRoadSnapshot(features, input, fetchedAt), /Conflicting parent incident/);
  class ContradictoryClient extends HttpClient {
    override async getJson() {
      return { body: { ...page, data: { ...page.data, features } },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new UnplannedRoadConnector(new ContradictoryClient(), () => 'fixture-key', 0)
    .collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('complete snapshot evidence includes every impact and supports empty snapshots without fabricated resolution', async () => {
  const page = await fixture();
  const full = normalizeRoadSnapshot(page.data.features, input, fetchedAt);
  const snapshot = full.sourceRecords.find(row => row.source_record_id.includes(':snapshot:'));
  assert.ok(snapshot);
  assert.equal(snapshot.source_record_id, `victoria.transport.road_unplanned:snapshot:${fetchedAt}`);
  assert.equal(snapshot.observed_at, null);
  assert.equal(snapshot.source_updated_at, null);
  assert.equal(snapshot.first_accessible_at, fetchedAt);
  parseSourceRecord(snapshot);
  const membership = full.geoRecordSources.filter(link => link.evidence_role === 'road_snapshot_membership');
  assert.equal(membership.length, full.geoRecords.length);
  for (const record of full.geoRecords) {
    const link = membership.find(link => link.geo_record_id === record.geo_record_id
      && link.version_id === record.version_id);
    assert.ok(link);
    assert.equal(link.source_record_id, snapshot.source_record_id);
    assert.equal(link.source_version_id, snapshot.version_id);
  }
  const empty = normalizeRoadSnapshot([], { ...input, runId: 'empty' }, '2026-09-28T00:07:00Z');
  assert.equal(empty.sourceRecords.length, 1);
  assert.equal(empty.geoRecords.length, 0);
  assert.equal(empty.geoRecordSources.length, 0);
  assert.notEqual(empty.sourceRevision, full.sourceRevision);
  const replay = normalizeRoadSnapshot(page.data.features, { ...input, runId: 'repeat' }, '2026-09-28T00:08:00Z');
  assert.notEqual(replay.sourceRevision, full.sourceRevision);
  assert.deepEqual(replay.geoRecords.map(row => row.version_id), full.geoRecords.map(row => row.version_id));
  const reordered = normalizeRoadSnapshot([...page.data.features].reverse(), input, fetchedAt);
  assert.equal(reordered.sourceRevision, full.sourceRevision);
});

test('a successful empty API response still emits one complete snapshot proof', async () => {
  class EmptyClient extends HttpClient {
    override async getJson() {
      return { body: { meta: { total_records: 0, total_pages: 0, page: 1, count: 0 },
        data: { type: 'FeatureCollection', features: [] } },
      status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new UnplannedRoadConnector(new EmptyClient(), () => 'fixture-key', 0)
    .collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.inputCount, 0);
    assert.equal(result.outputCount, 1);
    assert.equal(result.sourceRecords.length, 1);
    assert.equal(result.geoRecords.length, 0);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.completeness.expected_pages, 1);
    assert.equal(result.completeness.fetched_pages, 1);
  }
});

test('a no-impact incident geometry change creates matching evidence and geography versions', async () => {
  const page = await fixture();
  const first = page.data.features[0];
  assert.ok(first);
  const feature = { ...first, properties: { ...first.properties, impactId: null } };
  const original = normalizeRoadSnapshot([feature], input, fetchedAt);
  const changed = normalizeRoadSnapshot([{ ...feature,
    geometry: { type: 'Point', coordinates: [144.99, -37.82] } }], input, fetchedAt);
  assert.notEqual(original.geoRecords[0]?.version_id, changed.geoRecords[0]?.version_id);
  assert.notEqual(original.sourceRecords[0]?.version_id, changed.sourceRecords[0]?.version_id);
  assert.equal(changed.geoRecords[0]?.version_id, changed.sourceRecords[0]?.version_id);
});

test('impact attributes and raw time evidence survive normalization and change business versions', async () => {
  const page = await fixture();
  const first = page.data.features[0];
  assert.ok(first);
  const original = normalizeRoadSnapshot([first], input, fetchedAt);
  const changed = normalizeRoadSnapshot([{ ...first,
    properties: { ...first.properties, numberLanesImpacted: '3',
      roadAccessType: 'Emergency services access only' } }], input, fetchedAt);
  assert.notEqual(original.geoRecords[0]?.version_id, changed.geoRecords[0]?.version_id);
  const summary = JSON.parse(changed.geoRecords[0]?.summary ?? '{}');
  assert.equal(summary.source_properties.numberLanesImpacted, '3');
  assert.equal(summary.source_properties.roadAccessType, 'Emergency services access only');
  assert.equal(summary.reference.localRoadName, 'Example Road');
});

test('KeyID requests reject redirects and disable unpaced HTTP retries', async () => {
  const page = await fixture();
  class InspectClient extends HttpClient {
    override async getJson(request: HttpRequest) {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(url.searchParams.get('limit'), '100');
      assert.equal(request.redirect, 'error');
      assert.equal(request.maxAttempts, 1);
      assert.equal(new Headers(request.headers).get('KeyID'), 'fixture-only-key');
      assert.equal(url.href.includes('fixture-only-key'), false);
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new UnplannedRoadConnector(new InspectClient(), () => 'fixture-only-key', 0)
    .collect(input);
  assert.equal(result.kind, 'success');
});
