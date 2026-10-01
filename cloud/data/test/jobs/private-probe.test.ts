import assert from 'node:assert/strict';
import test from 'node:test';

import { privateProbeConfig } from '../../src/jobs/private-probe.js';

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
