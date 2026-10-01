import assert from 'node:assert/strict';
import test from 'node:test';

import type { ConnectorSuccess } from '../../src/core/connector.js';
import { privateProbeConfig, privateProbeSummary } from '../../src/jobs/private-probe.js';

const env = {
  GOOGLE_CLOUD_PROJECT: 'melens-510012', GCS_BUCKET: 'melens-510012-dev-ingest',
  MELENS_SOURCE_ID: 'victoria.transport.road_unplanned',
  CLOUD_RUN_JOB: 'melens-dev-transport-probe', TRANSPORT_VICTORIA_KEY_ID: 'test-only-secret',
};

test('private probe accepts only the reviewed cloud job and Transport sources', () => {
  assert.equal(privateProbeConfig(env).sourceId, env.MELENS_SOURCE_ID);
  for (const overrides of [
    { CLOUD_RUN_JOB: undefined }, { GOOGLE_CLOUD_PROJECT: 'another-project' },
    { GCS_BUCKET: 'another-bucket' }, { MELENS_SOURCE_ID: 'ticketmaster.events' },
    { TRANSPORT_VICTORIA_KEY_ID: undefined },
  ]) assert.throws(() => privateProbeConfig({ ...env, ...overrides }),
    /requires the reviewed Cloud Run job/);
});

test('private probe config and errors exclude secret values and supplied invalid values', () => {
  assert.equal(JSON.stringify(privateProbeConfig(env)).includes(env.TRANSPORT_VICTORIA_KEY_ID), false);
  try {
    privateProbeConfig({ ...env, MELENS_SOURCE_ID: env.TRANSPORT_VICTORIA_KEY_ID });
    assert.fail('Invalid source should fail');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes(env.TRANSPORT_VICTORIA_KEY_ID), false);
  }
});

test('private probe distinguishes missing clocks and snapshot proofs without exposing source content', () => {
  const fetchedAt = '2026-10-01T00:00:00.000Z';
  const sourceId = 'victoria.transport.road_unplanned';
  const fact = {
    batch_id: 'probe', source_id: sourceId, schema_version: 1, fetched_at: fetchedAt,
    source_record_id: `${sourceId}:incident:test`, version_id: 'test-version',
    original_url: `https://example.invalid/${env.TRANSPORT_VICTORIA_KEY_ID}`,
    raw_uri: null, published_at: null, observed_at: null, first_accessible_at: fetchedAt,
    time_missing_reason: env.TRANSPORT_VICTORIA_KEY_ID, valid_from: null, valid_to: null,
    source_updated_at: null, source_version_ordinal: null,
    record_status: 'active', assertion_kind: 'report', rights_status: 'review_required',
  } satisfies ConnectorSuccess['sourceRecords'][number];
  const result: ConnectorSuccess = {
    kind: 'success', sourceId, runId: 'probe', fetchedAt, sourceRevision: 'snapshot',
    sourceLatestUpdateAt: null, checkpointAfter: null,
    completeness: { complete: true, method: 'feed_snapshot', expected_records: 1,
      fetched_records: 1, expected_pages: 1, fetched_pages: 1, evidence: 'Complete test snapshot' },
    inputCount: 1, outputCount: 2, rejectedCount: 0,
    sourceRecords: [fact, { ...fact, source_record_id: `${sourceId}:snapshot:${fetchedAt}` }],
    geoRecords: [], geoRecordSources: [], boundaries: [], areaIndicators: [],
    parkingBays: [], parkingObservations: [], parkingRules: [], sensorLocations: [],
    pedestrianObservations: [], retainableRawRecords: [{ private: env.TRANSPORT_VICTORIA_KEY_ID }],
  };
  const summary = privateProbeSummary(result);
  assert.equal(JSON.stringify(summary).includes(env.TRANSPORT_VICTORIA_KEY_ID), false);
  assert.equal('source_time_missing_count' in summary && summary.source_time_missing_count, 2);
  assert.equal('absolute_source_update_count' in summary && summary.absolute_source_update_count, 0);
  assert.equal('road_snapshot_count' in summary && summary.road_snapshot_count, 1);
  assert.equal('future_source_timestamp_count' in summary && summary.future_source_timestamp_count, 0);
});
