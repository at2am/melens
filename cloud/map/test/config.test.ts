import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig, MapConfigurationError, validateMapConfig } from '../src/config.js';

test('query configuration requires a project, uses bounded defaults, and never reads credentials', () => {
  assert.throws(() => loadMapConfig({}), MapConfigurationError);
  const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', DATABASE_PASSWORD: 'private-value' });
  assert.equal(config.location, 'australia-southeast2');
  assert.equal(config.queryDataset, 'melens_query');
  assert.equal(config.dynamicScanBytes, 100_000_000);
  assert.equal(config.historicalScanBytes, 500_000_000);
  assert.equal(config.maxPageItems, 1_000);
  assert.equal(config.maxResponseBytes, 2 * 1024 * 1024);
  assert.ok(Object.isFrozen(config));
  assert.ok(!JSON.stringify(config).includes('private-value'));
});

test('unsafe identifiers and alternate raw/ingestion datasets fail closed without echoing values', () => {
  for (const env of [
    { MAP_PROJECT_ID: 'secret-project`; SELECT * FROM private' },
    { MAP_PROJECT_ID: 'melens-testing', MAP_QUERY_DATASET: 'melens_ingest' },
    { MAP_PROJECT_ID: 'melens-testing', MAP_QUERY_DATASET: 'raw' },
    { MAP_PROJECT_ID: 'melens-testing', MAP_BQ_LOCATION: 'australia-southeast2;secret' },
  ]) {
    assert.throws(() => loadMapConfig(env), (error: unknown) => {
      assert.ok(error instanceof MapConfigurationError);
      assert.ok(!error.message.includes('secret'));
      assert.ok(!error.message.includes('melens_ingest'));
      assert.ok(!error.message.includes('SELECT'));
      return true;
    });
  }
  const base = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
  assert.throws(() => validateMapConfig({ ...base, queryDataset: 'staging' }), MapConfigurationError);
});

test('noninteger, zero, unlimited, oversized and ineffective budgets are rejected', () => {
  for (const setting of ['0', '-1', '1.2', 'Infinity', '100MB', '', '9007199254740993']) {
    assert.throws(() => loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_DYNAMIC_SCAN_BYTES: setting }),
      MapConfigurationError);
  }
  for (const env of [
    { MAP_MAX_PAGE_ITEMS: '1001' },
    { MAP_MAX_RESPONSE_BYTES: '2097153' },
    { MAP_QUERY_TIMEOUT_MS: '30001' },
    { MAP_DRY_RUN_TIMEOUT_MS: '30001' },
    { MAP_CANCEL_TIMEOUT_MS: '5001' },
    { MAP_RESPONSE_ENVELOPE_RESERVE_BYTES: '2097152' },
  ]) {
    assert.throws(() => loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', ...env }), MapConfigurationError);
  }
});

test('recorded deployment ceilings can be tightened and invalid direct configuration remains rejected', () => {
  const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_DYNAMIC_SCAN_BYTES: '20000000',
    MAP_QUERY_TIMEOUT_MS: '1500', MAP_MAX_PAGE_ITEMS: '20', MAP_MAX_RESPONSE_BYTES: '1024',
    MAP_RESPONSE_ENVELOPE_RESERVE_BYTES: '128' });
  assert.equal(config.dynamicScanBytes, 20_000_000);
  assert.equal(config.queryTimeoutMs, 1_500);
  assert.equal(config.maxPageItems, 20);
  assert.equal(config.maxResponseBytes - config.responseEnvelopeReserveBytes, 896);
  assert.throws(() => validateMapConfig({ ...config, dynamicScanBytes: Number.NaN }), MapConfigurationError);
  assert.throws(() => validateMapConfig({ ...config, credentials: 'not-accepted' }), MapConfigurationError);
});
