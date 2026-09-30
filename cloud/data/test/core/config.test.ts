import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ConfigError, loadConfig } from '../../src/core/config.js';

const base = {
  GOOGLE_CLOUD_PROJECT: 'melens-fixture',
  GCP_REGION: 'australia-southeast2',
  GCS_BUCKET: 'melens-fixture',
  BQ_INGEST_DATASET: 'melens_ingest',
  BQ_QUERY_DATASET: 'melens_query',
};

test('BigQuery query cost ceiling accepts a positive Int64 and rejects invalid values', () => {
  assert.equal(loadConfig({ ...base, BQ_MAXIMUM_BYTES_BILLED: '100000000' }).maxBytesBilled,
    '100000000');
  assert.equal(loadConfig(base).maxBytesBilled, null);
  for (const value of ['0', '-1', '1e9', '9223372036854775808']) {
    assert.throws(() => loadConfig({ ...base, BQ_MAXIMUM_BYTES_BILLED: value }),
      (error: unknown) => error instanceof ConfigError
        && error.message.includes('BQ_MAXIMUM_BYTES_BILLED')
        && !error.message.includes(value));
  }
});
