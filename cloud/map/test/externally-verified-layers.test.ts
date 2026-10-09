import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMapConfig } from '@melens/shared/config';
import { parseViewportQuery } from '@melens/shared/contracts/map-contract';
import type { BigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createMapService } from '../src/map-service.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const request = parseViewportQuery({ requestId: 'scope', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 14,
  layers: ['planning'], mode: 'current', window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' } });

test('boundary and pedestrian reads fail closed without a trusted supplemental current record-rights verifier', async () => {
  const geoStarts: string[] = [];
  const coverage = ['boundary', 'pedestrian'].map((topic) => ({ source_id: `public.${topic}`, topic,
    scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'], coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current', latest_published_batch_id: 'batch1',
    latest_published_at: '2026-10-01T01:00:00Z', latest_published_window_from: '2026-09-01T00:00:00Z',
    latest_published_window_to: '2026-11-01T00:00:00Z', latest_published_output_count: 1, coverage_evidence_state: 'verified' }));
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      if (!query.query.includes('v_source_coverage')) geoStarts.push(query.query);
      return { async readPage() { return { rows: query.query.includes('v_source_coverage')
        ? coverage.map((row) => ({ record: JSON.stringify(row) })) : [], complete: true, hasMore: false }; }, async cancel() {} };
    } };
  const service = createMapService({ config, adapter, publicSources: coverage.map((source) => ({ sourceId: source.source_id,
    url: 'https://example.org/public', attribution: 'Official published source', versionRef: null })) });
  const reply = await service.queryViewport({ ...request, layers: ['boundary', 'pedestrian'], boundaryFilter: { level: 'LGA', vintage: '2021' } });
  assert.deepEqual(reply.layers.map((layer) => layer.state), ['unavailable', 'unavailable']);
  assert.equal(geoStarts.length, 0);
});
