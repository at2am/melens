import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DataSource } from '../../src/core/types.js';
import { computeCoverageStatus, computeSourceHealth } from '../../src/core/health.js';

const source: DataSource = {
  source_id: 'melbourne.pedestrian.minute', legacy_ids: [], provider: 'City of Melbourne',
  dataset_title: 'Pedestrian minute', landing_url: 'https://example.org', topic: 'pedestrian',
  scope: 'city', coverage_area_refs: ['com_municipal:1:2008-07-01'],
  coverage_from: null, coverage_to: null, cadence_seconds: 60,
  check_interval_seconds: 60, connector_owner: 'test',
  admission_evidence: { dataset_url: 'https://example.org', native_record_key: 'sensor_id',
    completeness_rule: 'one minute', quota_requests_per_day: 1000, secret_names: [],
    allowed_fields: ['sensor_id'], raw_retention_days: 1, staging_retention_days: 1,
    license_evidence_url: 'https://example.org', reviewed_at: '2026-09-28T00:00:00Z',
    missing_requirements: [], declared_license_status: 'verified_open' },
  license_status: 'verified_open', access_status: 'active',
  last_checked_at: null, last_success_at: null, last_source_update_at: null,
  record_granularity: 'sensor_minute',
};

const now = '2026-09-28T00:10:00Z';
const recent = { source, now, lastCheckedAt: '2026-09-28T00:09:30Z',
  lastSuccessAt: '2026-09-28T00:09:30Z', latestCheckSucceeded: true,
  latestUpstreamUpdateAt: '2026-09-28T00:08:00Z', consecutiveFailures: 0, knownGapCount: 0 };

test('unchanged upstream data can remain healthy after a successful check', () => {
  const health = computeSourceHealth({ ...recent, latestUpstreamUpdateAt: '2026-09-27T00:00:00Z' });
  assert.equal(health.state, 'current');
  assert.equal(computeCoverageStatus({ coveringSources: [health], matchingRecords: 0, completeWindow: true }),
    'no_matching_records');
});

test('failed or stale sources cannot certify an empty result', () => {
  const failed = computeSourceHealth({ ...recent, latestCheckSucceeded: false, consecutiveFailures: 1 });
  assert.equal(failed.state, 'unknown');
  assert.equal(computeCoverageStatus({ coveringSources: [failed], matchingRecords: 0, completeWindow: true }),
    'unknown');
  const stale = computeSourceHealth({ ...recent, lastSuccessAt: '2026-09-28T00:00:00Z' });
  assert.equal(stale.state, 'stale');
  assert.equal(computeCoverageStatus({ coveringSources: [stale], matchingRecords: 0, completeWindow: true }),
    'source_unavailable');
});
