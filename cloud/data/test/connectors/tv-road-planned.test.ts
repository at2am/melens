import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure } from '../../src/core/http.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import {
  API_URL,
  classifyPlannedStatus,
  LANDING_URL,
  normalizePlannedRoadSnapshot,
  PAGE_DELAY_MS,
  PAGE_SIZE,
  parsePlannedRoadPage,
  parseVictorianTimestamp,
  PlannedRoadConnector,
  SOURCE_ID,
} from '../../src/connectors/tv_road_planned/index.js';

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
  assert.equal(normalized.sourceRecords.length, 3);
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
  assert.equal(normalized.geoRecordSources.length, 6);
});

test('documented Victorian clocks convert seasons and retain ambiguous or nonexistent DST clocks as null', () => {
  assert.equal(parseVictorianTimestamp('2026-01-20T12:00:00'), '2026-01-20T01:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-07-20T12:00:00'), '2026-07-20T02:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-07-20T12:00:00.123'), '2026-07-20T02:00:00.123Z');
  assert.equal(parseVictorianTimestamp('2026-04-05T02:30:00'), null);
  assert.equal(parseVictorianTimestamp('2026-10-04T02:30:00'), null);
  assert.throws(() => parseVictorianTimestamp('2026-02-30T12:00:00'));
});

test('future provider updates fail while future schedules and five-minute clock skew remain valid', async () => {
  const page = await fixture();
  const first = page.data.features[0];
  assert.ok(first);
  const changed = (lastUpdated: string) => ({ ...first,
    properties: { ...first.properties, lastUpdated } });
  assert.throws(() => normalizePlannedRoadSnapshot([changed('2099-01-01T00:00:00Z')],
    input, fetchedAt), /five minutes after fetch time/);
  const tolerated = normalizePlannedRoadSnapshot([changed('2026-09-28T02:35:00Z')], input, fetchedAt);
  assert.equal(tolerated.latestUpdate, '2026-09-28T02:35:00.000Z');
  assert.equal(tolerated.geoRecords[0]?.valid_from, '2026-10-01T10:00:00.000Z');
  class FutureClient extends HttpClient {
    override async getJson() {
      return { body: { ...page, meta: { ...page.meta, total_records: 1, count: 1 },
        data: { ...page.data, features: [changed('2099-01-01T00:00:00Z')] } },
      status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new PlannedRoadConnector(new FutureClient(), () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('classifyPlannedStatus correctly maps future, pending, active, cancelled, resolved and rejects unknown', () => {
  assert.deepEqual(classifyPlannedStatus('Pending', '2026-10-01T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'active',
    geoRecordStatus: 'planned',
  });
  assert.deepEqual(classifyPlannedStatus('Active', '2026-10-01T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'active',
    geoRecordStatus: 'active',
  });
  assert.deepEqual(classifyPlannedStatus('Active', '2026-09-20T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'active',
    geoRecordStatus: 'active',
  });
  assert.deepEqual(classifyPlannedStatus('Cancelled', '2026-10-01T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'cancelled',
    geoRecordStatus: 'cancelled',
  });
  assert.deepEqual(classifyPlannedStatus('Canceled', '2026-10-01T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'cancelled',
    geoRecordStatus: 'cancelled',
  });
  assert.deepEqual(classifyPlannedStatus('Completed', '2026-09-20T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'active',
    geoRecordStatus: 'resolved',
  });
  assert.deepEqual(classifyPlannedStatus('Resolved', '2026-09-20T00:00:00Z', '2026-09-28T00:00:00Z'), {
    sourceRecordStatus: 'active',
    geoRecordStatus: 'resolved',
  });
  assert.throws(() => classifyPlannedStatus('UnknownStatus', null, '2026-09-28T00:00:00Z'), /Undocumented planned disruption status/);
});

test('cancelled disruption retains schedule, geometry and segment facts with cancelled status', async () => {
  const page = await fixture();
  const cancelledFeature = {
    ...page.data.features[0]!,
    properties: {
      ...page.data.features[0]!.properties,
      id: 'PRD:Cancelled:789',
      status: 'Cancelled',
      description: 'Works cancelled due to bad weather',
    },
  };
  const normalized = normalizePlannedRoadSnapshot([cancelledFeature], input, fetchedAt);
  assert.equal(normalized.sourceRecords.length, 2);
  assert.equal(normalized.geoRecords.length, 2);
  assert.equal(normalized.sourceRecords[0]?.record_status, 'cancelled');
  assert.equal(normalized.geoRecords[0]?.record_status, 'cancelled');
  assert.equal(normalized.geoRecords[1]?.record_status, 'cancelled');
  assert.equal(normalized.geoRecords[0]?.assertion_kind, 'plan');
  assert.equal(normalized.geoRecords[0]?.valid_from, '2026-10-01T10:00:00.000Z');
  assert.equal(normalized.geoRecords[0]?.valid_to, '2026-10-09T18:00:00.000Z');
  normalized.sourceRecords.forEach(row => assert.deepEqual(parseSourceRecord(row), row));
  normalized.geoRecords.forEach(row => assert.equal(validateGeoRecordGeography(row).valid, true));
});

test('numbered snapshot validates totals, uses KeyID header and does not accept missing key', async () => {
  const page = await fixture();
  class FixtureClient extends HttpClient {
    override async getJson(request: Parameters<HttpClient['getJson']>[0]) {
      const url = new URL(request.url);
      assert.equal(url.searchParams.get('page'), '1');
      assert.equal(url.searchParams.get('limit'), '1000');
      assert.equal((request.headers as Record<string, string>).KeyID, 'fixture-key');
      assert.equal(request.redirect, 'error');
      assert.equal(request.maxAttempts, 1);
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

  const emptyKey = await new PlannedRoadConnector(client, () => '   ', 0).collect(input);
  assert.equal(emptyKey.kind, 'failure');
  if (emptyKey.kind === 'failure') assert.equal(emptyKey.code, 'auth_failed');
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

test('rate limiting (HTTP 429) returns rate_limited failure with retryAfterSeconds', async () => {
  class RateLimitedClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('rate_limited', 429, 3, 45000);
    }
  }
  const result = await new PlannedRoadConnector(new RateLimitedClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'rate_limited');
    assert.equal(result.retryAfterSeconds, 45);
    assert.equal(result.completeness.complete, false);
  }
});

test('upstream service failure (HTTP 503) returns upstream_unavailable', async () => {
  class ServiceUnavailableClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('upstream_unavailable', 503, 3, null);
    }
  }
  const result = await new PlannedRoadConnector(new ServiceUnavailableClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'upstream_unavailable');
    assert.equal(result.retryAfterSeconds, null);
  }
});

test('upstream schema error (HTTP 404 or invalid payload) returns schema_changed', async () => {
  class SchemaChangedClient extends HttpClient {
    override async getJson(): Promise<never> {
      throw new HttpFailure('schema_changed', 404, 1, null);
    }
  }
  const result = await new PlannedRoadConnector(new SchemaChangedClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'schema_changed');
  }

  class MalformedPayloadClient extends HttpClient {
    override async getJson() {
      return { body: { unexpected: 'format' }, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const malformedResult = await new PlannedRoadConnector(new MalformedPayloadClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(malformedResult.kind, 'failure');
  if (malformedResult.kind === 'failure') {
    assert.equal(malformedResult.code, 'schema_changed');
  }
});

test('page format switch mid-pagination fails with schema_changed', async () => {
  const page = await fixture();
  const tokenPage = {
    type: 'FeatureCollection',
    features: [page.data.features[1]],
    nextPageDetails: { hasMoreRecords: false, nextPageToken: null },
  };
  class SwitchedFormatClient extends HttpClient {
    calls = 0;
    override async getJson() {
      const body = this.calls++ === 0
        ? { meta: { total_records: 2, total_pages: 2, page: 1, count: 1 },
            data: { type: 'FeatureCollection', features: [page.data.features[0]] } }
        : tokenPage;
      return { body, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new PlannedRoadConnector(new SwitchedFormatClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'schema_changed');
});

test('token pagination loop or missing next token fails with incomplete_window', async () => {
  const page = await fixture();
  class LoopingTokenClient extends HttpClient {
    override async getJson() {
      return {
        body: {
          type: 'FeatureCollection',
          features: [page.data.features[0]],
          nextPageDetails: { hasMoreRecords: true, nextPageToken: 'loop-token' },
        },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json',
      };
    }
  }
  const loopResult = await new PlannedRoadConnector(new LoopingTokenClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(loopResult.kind, 'failure');
  if (loopResult.kind === 'failure') assert.equal(loopResult.code, 'incomplete_window');

  class MissingNextTokenClient extends HttpClient {
    override async getJson() {
      return {
        body: {
          type: 'FeatureCollection',
          features: [page.data.features[0]],
          nextPageDetails: { hasMoreRecords: true, nextPageToken: null },
        },
        status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json',
      };
    }
  }
  const missingTokenResult = await new PlannedRoadConnector(new MissingNextTokenClient(),
    () => 'fixture-key', 0).collect(input);
  assert.equal(missingTokenResult.kind, 'failure');
  if (missingTokenResult.kind === 'failure') assert.equal(missingTokenResult.code, 'incomplete_window');
});

test('mismatched sourceId fails with validation_failed', async () => {
  const badInput = { ...input, sourceId: 'victoria.transport.road_unplanned' };
  const client = new HttpClient();
  const result = await new PlannedRoadConnector(client, () => 'fixture-key', 0).collect(badInput);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') assert.equal(result.code, 'validation_failed');
});

test('source manifest enforces review_required, candidate, and KeyID secret requirement', async () => {
  const bytes = await readFile(new URL('../../src/connectors/tv_road_planned/source.json', import.meta.url), 'utf8');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.source_id, SOURCE_ID);
  assert.equal(manifest.license_status, 'review_required');
  assert.equal(manifest.access_status, 'candidate');
  assert.deepEqual(manifest.admission_evidence.secret_names, ['transport_victoria_key_id']);
  assert.equal(manifest.topic, 'road_disruption');
  assert.equal(manifest.scope, 'victoria');
  assert.equal(manifest.landing_url, LANDING_URL);
  assert.equal(manifest.api_endpoint, API_URL);
});

test('repeated payload replay produces strictly idempotent version and timestamp outputs', async () => {
  const page = await fixture();
  const inputA = parseConnectorInput({
    sourceId: 'victoria.transport.road_planned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:30:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'batch-run-alpha',
  });
  const inputB = parseConnectorInput({
    sourceId: 'victoria.transport.road_planned',
    window: { kind: 'time', from: '2026-09-28T00:00:00Z', to: '2026-09-28T00:30:00Z' },
    checkpoint: '2026-09-28T00:00:00Z',
    runId: 'batch-run-beta',
  });

  const run1 = normalizePlannedRoadSnapshot(page.data.features, inputA, fetchedAt);
  const run2 = normalizePlannedRoadSnapshot(page.data.features, inputB, '2026-09-28T05:00:00.000Z');

  assert.equal(run1.sourceRecords.length, run2.sourceRecords.length);
  assert.equal(run1.geoRecords.length, run2.geoRecords.length);
  assert.equal(run1.latestUpdate, run2.latestUpdate);

  for (let i = 0; i < page.data.features.length; i++) {
    const s1 = run1.sourceRecords[i]!;
    const s2 = run2.sourceRecords[i]!;
    assert.equal(s1.source_record_id, s2.source_record_id);
    assert.equal(s1.version_id, s2.version_id, 'source version_id must be strictly idempotent across runs');
    assert.equal(s1.valid_from, s2.valid_from);
    assert.equal(s1.valid_to, s2.valid_to);
    assert.equal(s1.source_updated_at, s2.source_updated_at);
    assert.equal(s1.record_status, s2.record_status);
    assert.equal(s1.assertion_kind, s2.assertion_kind);
  }

  for (let i = 0; i < run1.geoRecords.length; i++) {
    const g1 = run1.geoRecords[i]!;
    const g2 = run2.geoRecords[i]!;
    assert.equal(g1.geo_record_id, g2.geo_record_id);
    assert.equal(g1.version_id, g2.version_id, 'geo version_id must be strictly idempotent across runs');
    assert.equal(g1.geometry_geojson, g2.geometry_geojson);
    assert.equal(g1.centroid_lat, g2.centroid_lat);
    assert.equal(g1.centroid_lon, g2.centroid_lon);
    assert.equal(g1.valid_from, g2.valid_from);
    assert.equal(g1.valid_to, g2.valid_to);
    assert.equal(g1.source_updated_at, g2.source_updated_at);
    assert.equal(g1.record_status, g2.record_status);
  }

  const businessLinks1 = run1.geoRecordSources.filter(row => row.evidence_role === 'planned_disruption');
  const businessLinks2 = run2.geoRecordSources.filter(row => row.evidence_role === 'planned_disruption');
  for (let i = 0; i < businessLinks1.length; i++) {
    const l1 = businessLinks1[i]!;
    const l2 = businessLinks2[i]!;
    assert.equal(l1.geo_record_id, l2.geo_record_id);
    assert.equal(l1.version_id, l2.version_id);
    assert.equal(l1.source_record_id, l2.source_record_id);
    assert.equal(l1.source_version_id, l2.source_version_id);
    assert.equal(l1.evidence_role, l2.evidence_role);
  }
  assert.notEqual(run1.sourceRevision, run2.sourceRevision, 'each complete observation needs new snapshot proof');
});

test('upstream content changes produce new version_id while maintaining stable source_record_id', async () => {
  const page = await fixture();
  const original = normalizePlannedRoadSnapshot(page.data.features, input, fetchedAt);

  const updatedFeature = {
    ...page.data.features[0]!,
    properties: {
      ...page.data.features[0]!.properties,
      lastUpdated: '2026-09-29T14:00:00',
      description: 'Updated road resurfacing schedule',
    },
  };
  const updated = normalizePlannedRoadSnapshot([updatedFeature], input, '2026-09-29T04:05:00.000Z');

  assert.equal(original.sourceRecords[0]?.source_record_id, updated.sourceRecords[0]?.source_record_id);
  assert.notEqual(original.sourceRecords[0]?.version_id, updated.sourceRecords[0]?.version_id,
    'changed content or timestamp must generate distinct version_id');
  assert.equal(original.geoRecords[0]?.geo_record_id, updated.geoRecords[0]?.geo_record_id);
  assert.notEqual(original.geoRecords[0]?.version_id, updated.geoRecords[0]?.version_id);
});

test('PlannedRoadConnector.collect replay idempotency over identical HTTP responses', async () => {
  const page = await fixture();
  class StaticClient extends HttpClient {
    override async getJson() {
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const connector = new PlannedRoadConnector(new StaticClient(), () => 'fixture-key', 0);
  const result1 = await connector.collect(input);
  const result2 = await connector.collect({ ...input, runId: 'replay-run-2' });

  assert.equal(result1.kind, 'success');
  assert.equal(result2.kind, 'success');
  if (result1.kind === 'success' && result2.kind === 'success') {
    assert.equal(result1.sourceRevision, result2.sourceRevision);
    assert.equal(result1.sourceLatestUpdateAt, result2.sourceLatestUpdateAt);
    assert.equal(result1.outputCount, result2.outputCount);
    assert.deepEqual(
      result1.sourceRecords.map(r => r.version_id),
      result2.sourceRecords.map(r => r.version_id),
    );
    assert.deepEqual(
      result1.geoRecords.map(r => r.version_id),
      result2.geoRecords.map(r => r.version_id),
    );
  }
});

test('explicit offsets remain authoritative alongside documented Victorian local time', () => {
  assert.equal(parseVictorianTimestamp('2026-07-20T12:00:00'), '2026-07-20T02:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-01-20T12:00:00'), '2026-01-20T01:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-09-30T12:00:00Z'), '2026-09-30T12:00:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-09-30T12:00:00+10:00'), '2026-09-30T02:00:00.000Z');
  assert.throws(() => parseVictorianTimestamp('not-a-timestamp'));
});

test('planned provider status and immutable row identity survive crossing the scheduled start instant', async () => {
  const page = await fixture();
  const original = page.data.features[0];
  assert.ok(original);
  const feature = { ...original, properties: { ...original.properties, status: 'Active',
    lastUpdated: '2026-09-28T00:00:00Z', duration: { start: '2026-10-01T00:00:00Z', end: '2026-10-02T00:00:00Z' } } };
  const first = normalizePlannedRoadSnapshot([feature], input, '2026-09-30T00:00:00Z');
  const replay = normalizePlannedRoadSnapshot([feature], { ...input, runId: 'replay' }, '2026-10-01T12:00:00Z');
  const stripAudit = (row: object) => Object.fromEntries(Object.entries(row)
    .filter(([key]) => !['batch_id', 'fetched_at', 'first_accessible_at'].includes(key)));
  assert.deepEqual(first.geoRecords.map(stripAudit), replay.geoRecords.map(stripAudit));
  assert.equal(first.geoRecords[0]?.record_status, 'active');
  assert.notEqual(first.sourceRevision, replay.sourceRevision);
});

test('planning times use the official local convention and retain schedule strings without certifying freshness', async () => {
  const page = await fixture();
  const wallClockFeatures = page.data.features.map(feature => ({ ...feature, properties: {
    ...feature.properties, lastUpdated: '2026-09-28T12:00:00',
  } }));
  const first = normalizePlannedRoadSnapshot(wallClockFeatures, input, fetchedAt);
  assert.equal(first.latestUpdate, '2026-09-28T02:00:00.000Z');
  assert.ok(first.sourceRevision);
  for (const row of first.sourceRecords.filter(row => !row.source_record_id.includes(':snapshot:'))) {
    assert.equal(row.source_updated_at, '2026-09-28T02:00:00.000Z');
    parseSourceRecord(row);
  }
  const detail = JSON.parse(first.geoRecords[0]?.summary ?? '{}');
  assert.equal(detail.timezone_status, 'documented_victorian_local_or_explicit_offset');
  assert.equal(detail.source_timezone, 'Australia/Melbourne');
  assert.ok(detail.duration.start);
  const original = wallClockFeatures[0];
  assert.ok(original);
  const revised = normalizePlannedRoadSnapshot([{ ...original, properties: { ...original.properties,
    description: 'Changed plan with unchanged wall clock' } }, ...wallClockFeatures.slice(1)], input, fetchedAt);
  assert.notEqual(first.sourceRevision, revised.sourceRevision);
  assert.equal(first.sourceRevision,
    normalizePlannedRoadSnapshot([...wallClockFeatures].reverse(), input, fetchedAt).sourceRevision);
});

test('complete snapshot links every geometry version and an empty snapshot does not infer cancellation', async () => {
  const page = await fixture();
  const full = normalizePlannedRoadSnapshot(page.data.features, input, fetchedAt);
  const snapshot = full.sourceRecords.find(row => row.source_record_id === `${SOURCE_ID}:snapshot:${fetchedAt}`);
  assert.ok(snapshot);
  assert.equal(snapshot.source_updated_at, null);
  assert.equal(snapshot.observed_at, null);
  assert.equal(snapshot.published_at, null);
  assert.equal(snapshot.first_accessible_at, fetchedAt);
  assert.equal(snapshot.assertion_kind, 'observation');
  assert.match(snapshot.time_missing_reason ?? '', /not event time/);
  const membership = full.geoRecordSources.filter(row => row.evidence_role === 'road_snapshot_membership');
  assert.equal(membership.length, full.geoRecords.length);
  for (const row of full.geoRecords) {
    assert.equal(membership.filter(link => link.geo_record_id === row.geo_record_id
      && link.version_id === row.version_id && link.source_record_id === snapshot.source_record_id
      && link.source_version_id === snapshot.version_id && link.batch_id === row.batch_id).length, 1);
  }
  const empty = normalizePlannedRoadSnapshot([], input, '2026-09-28T03:00:00.000Z');
  assert.equal(empty.sourceRecords.length, 1);
  assert.equal(empty.geoRecords.length, 0);
  assert.equal(empty.geoRecordSources.length, 0);
  assert.equal(empty.sourceRecords[0]?.record_status, 'active');
  parseSourceRecord(empty.sourceRecords[0]);
  assert.notEqual(empty.sourceRevision, full.sourceRevision);
  assert.notEqual(empty.sourceRecords[0]?.version_id, snapshot.version_id);
});

test('DST repeated and skipped clocks remain visible as original values without false instants', async () => {
  const page = await fixture();
  const original = page.data.features[0];
  assert.ok(original);
  for (const wallClock of ['2026-04-05T02:30:00', '2026-10-04T02:30:00']) {
    const result = normalizePlannedRoadSnapshot([{ ...original, properties: { ...original.properties,
      lastUpdated: wallClock, duration: { start: wallClock, end: wallClock },
    } }], input, fetchedAt);
    assert.equal(result.sourceRecords[0]?.source_updated_at, null);
    assert.equal(result.geoRecords[0]?.valid_from, null);
    assert.equal(result.geoRecords[0]?.valid_to, null);
    assert.equal(result.latestUpdate, null);
    assert.equal(result.geoRecords[0]?.freshness_state, 'unknown');
    assert.match(result.sourceRecords[0]?.time_missing_reason ?? '', /ambiguous or nonexistent/);
    const detail = JSON.parse(result.geoRecords[0]?.summary ?? '{}');
    assert.equal(detail.duration.start, wallClock);
    assert.equal(detail.source_last_updated, wallClock);
    assert.equal(detail.timezone_status, 'ambiguous_or_nonexistent_local_time');
  }
  assert.equal(parseVictorianTimestamp('2026-04-05T02:30:00+11:00'), '2026-04-04T15:30:00.000Z');
  assert.equal(parseVictorianTimestamp('2026-04-05T02:30:00+10:00'), '2026-04-04T16:30:00.000Z');
});

test('inconsistent numbered metadata and empty continuations are incomplete, never successful empty snapshots', async () => {
  const page = await fixture();
  const oneFeature = page.data.features.slice(0, 1);
  const invalidPages: unknown[] = [
    { meta: { total_records: 1, total_pages: 0, page: 1, count: 1 },
      data: { type: 'FeatureCollection', features: oneFeature } },
    { meta: { total_records: 0, total_pages: 2, page: 1, count: 0 },
      data: { type: 'FeatureCollection', features: [] } },
    { meta: { total_records: 1, total_pages: 1, page: 1, count: 0 },
      data: { type: 'FeatureCollection', features: [] } },
    { type: 'FeatureCollection', features: [],
      nextPageDetails: { hasMoreRecords: true, nextPageToken: 'next' } },
    { type: 'FeatureCollection', features: oneFeature,
      nextPageDetails: { hasMoreRecords: true, nextPageToken: '   ' } },
  ];
  for (const body of invalidPages) {
    class InvalidPageClient extends HttpClient {
      override async getJson() {
        return { body, status: 200, fetchedAt, etag: null,
          lastModified: null, contentType: 'application/json' };
      }
    }
    const result = await new PlannedRoadConnector(new InvalidPageClient(), () => 'fixture-key', 0).collect(input);
    assert.equal(result.kind, 'failure');
    if (result.kind === 'failure') assert.equal(result.code, 'incomplete_window');
  }
});

test('complete empty token snapshot still produces auditable snapshot source fact', async () => {
  class EmptyClient extends HttpClient {
    override async getJson() {
      return { body: { type: 'FeatureCollection', features: [],
        nextPageDetails: { hasMoreRecords: false, nextPageToken: null } },
      status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const result = await new PlannedRoadConnector(new EmptyClient(), () => 'fixture-key', 0).collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') {
    assert.equal(result.inputCount, 0);
    assert.equal(result.outputCount, 1);
    assert.equal(result.geoRecords.length, 0);
    assert.equal(result.completeness.complete, true);
    assert.equal(result.sourceRecords[0]?.source_record_id, `${SOURCE_ID}:snapshot:${fetchedAt}`);
  }
});

test('duplicate events across complete pages and a failed later page never yield partial membership proof', async () => {
  const page = await fixture();
  const oneFeature = page.data.features.slice(0, 1);
  class DuplicateClient extends HttpClient {
    calls = 0;
    override async getJson() {
      this.calls += 1;
      return { body: { type: 'FeatureCollection', features: oneFeature,
        nextPageDetails: { hasMoreRecords: this.calls === 1,
          nextPageToken: this.calls === 1 ? 'next' : null } },
      status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const duplicate = await new PlannedRoadConnector(new DuplicateClient(), () => 'fixture-key', 0).collect(input);
  assert.equal(duplicate.kind, 'failure');
  if (duplicate.kind === 'failure') assert.equal(duplicate.code, 'validation_failed');
  class LaterFailureClient extends HttpClient {
    calls = 0;
    override async getJson() {
      this.calls += 1;
      if (this.calls === 2) throw new HttpFailure('rate_limited', 429, 1, 30000);
      return { body: { type: 'FeatureCollection', features: oneFeature,
        nextPageDetails: { hasMoreRecords: true, nextPageToken: 'next' } },
      status: 200, fetchedAt, etag: null, lastModified: null, contentType: 'application/json' };
    }
  }
  const partial = await new PlannedRoadConnector(new LaterFailureClient(), () => 'fixture-key', 0).collect(input);
  assert.equal(partial.kind, 'failure');
  if (partial.kind === 'failure') {
    assert.equal(partial.code, 'rate_limited');
    assert.equal(partial.completeness.complete, false);
    assert.equal(partial.retryAfterSeconds, 30);
    assert.equal('sourceRecords' in partial, false);
  }
});

test('a real HTTP redirect cannot forward the KeyID to a second endpoint', async () => {
  let forwardedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/redirect-target') {
      forwardedRequests += 1;
      response.end('{}');
      return;
    }
    assert.equal(request.headers.keyid, 'fixture-key');
    response.writeHead(302, { Location: '/redirect-target' });
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const localUrl = `http://127.0.0.1:${address.port}/planned`;
  class RedirectClient extends HttpClient {
    override async getJson(request: Parameters<HttpClient['getJson']>[0]) {
      return super.getJson({ ...request, url: localUrl, maxAttempts: 1 });
    }
  }
  try {
    const result = await new PlannedRoadConnector(new RedirectClient(), () => 'fixture-key', 0).collect(input);
    assert.equal(result.kind, 'failure');
    assert.equal(forwardedRequests, 0);
    if (result.kind === 'failure') assert.doesNotMatch(result.message, /fixture-key/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
