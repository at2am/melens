import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { loadMapConfig } from '@melens/shared/config';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import type { ViewRow } from '@melens/shared/query/query-runner';
import { createMapService } from '../src/map-service.js';
import { VERIFIED_RECORD_TTL_MS } from '../src/services/public-records.js';

const sourceId = 'rights-copy.planning';
const window = { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' };
const keysSchema = z.array(z.object({ id: z.string(), versionId: z.string(), sourceId: z.string() }));
const row: ViewRow = { geo_record_id: 'planning:one', version_id: 'v1', source_id: sourceId, topic: 'planning',
  assertion_kind: 'plan', is_prediction: false, title: 'Planning record', summary: 'Published plan', original_url: null,
  geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.97, -37.81] }), location_role: 'event_site',
  location_confidence: 'source_coordinate', area_refs: ['com:municipal'], observed_at: null, published_at: null,
  valid_from: window.from, valid_to: null, fetched_at: '2026-10-01T00:30:00Z', freshness_state: 'current',
  record_status: 'active' };

function fixture() {
  const state = { registryBatch: 'batch-1', copyBatch: 'batch-1' };
  const proofs: { view: 'copy' | 'live' }[] = [];
  let now = Date.parse('2026-10-01T00:45:00Z');
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query: PreparedViewQuery) {
      let rows: readonly ViewRow[];
      if (query.query.includes('v_source_coverage')) {
        rows = [{ source_id: sourceId, topic: 'planning', scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'],
          coverage_from: '2026-09-01T00:00:00Z', coverage_to: null, license_status: 'verified_open', access_status: 'active',
          health_state: 'current', latest_published_batch_id: state.registryBatch, latest_published_at: '2026-10-01T00:30:00Z',
          latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
          latest_published_output_count: 1, coverage_evidence_state: 'verified' }];
      } else if (query.query.includes('v_geo_records_current_state')) {
        rows = [{ source_id: sourceId, batch_id: state.copyBatch }];
      } else if (typeof query.params.publicRecordKeysJson === 'string') {
        proofs.push({ view: query.query.includes('v_geo_records_current_served') ? 'copy' : 'live' });
        const keys = keysSchema.parse(JSON.parse(query.params.publicRecordKeysJson));
        rows = keys.some((key) => key.id === row.geo_record_id) ? [row] : [];
      } else rows = [row];
      return { async readPage() { return { rows: rows.map((value) => ({ record: JSON.stringify(value) })),
        complete: true, hasMore: false }; }, async cancel() {} };
    },
  };
  const service = createMapService({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }), adapter,
    currentLayerCache: false, coverageCacheTtlMs: 0, clock: () => new Date(now), resolveArea: () => 'contains',
    publicSources: [{ sourceId, url: 'https://example.org/source', attribution: 'Reviewed source', versionRef: null }] });
  const request = { requestId: 'rights-copy', bbox: [144.95, -37.83, 144.99, -37.8], zoom: 17, layers: ['planning'],
    mode: 'current', window };
  return { service, request, state, proofs, advance(milliseconds: number) { now += milliseconds; } };
}

test('rights read the copy only while it reflects the latest batch, and a proof is reused within its minute', async () => {
  const f = fixture();
  const first = await f.service.queryViewport(f.request);
  assert.deepEqual(f.proofs, [{ view: 'copy' }]);
  const context = { requestId: 'detail', snapshotId: first.snapshotId };
  await f.service.getItem('planning:one', context);
  assert.equal(f.proofs.length, 1, 'the map view proof covers the detail read');

  // The registry published a batch the copy does not reflect yet: the live view proves rights.
  f.state.registryBatch = 'batch-2';
  f.advance(6_000);
  const second = await f.service.queryViewport({ ...f.request, requestId: 'rights-copy-2' });
  assert.deepEqual(f.proofs.at(-1), { view: 'live' }, 'a new batch ends the old proof, and a lagging copy is not used');

  f.state.copyBatch = 'batch-2';
  f.advance(VERIFIED_RECORD_TTL_MS + 1);
  await f.service.getItem('planning:one', { requestId: 'detail-2', snapshotId: second.snapshotId });
  assert.deepEqual(f.proofs.at(-1), { view: 'copy' });
});
