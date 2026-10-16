import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { loadMapConfig } from '@melens/shared/config';
import type { MapItem, ViewportResponse } from '@melens/shared/contracts/map-contract';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import type { ViewRow } from '@melens/shared/query/query-runner';
import { createMapService } from '../src/map-service.js';
import { MapServiceError } from '../src/services/snapshot-store.js';
import { VERIFIED_RECORD_TTL_MS } from '../src/services/public-records.js';

const publishedAt = '2026-10-01T01:00:01.000Z';
const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T01:00:00.000Z' };
const recordKeysSchema = z.array(z.object({ id: z.string(), versionId: z.string(), sourceId: z.string() }));

function fixture(layer: 'anomaly' | 'planning') {
  const sourceId = `cache-rights.${layer}`;
  const publication = {
    source_id: sourceId, topic: layer, scope: 'city-of-melbourne', coverage_area_refs: ['com:municipal'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'unchanged-batch', latest_published_at: publishedAt,
    latest_published_window_from: '2026-09-01T00:00:00Z', latest_published_window_to: '2026-11-01T00:00:00Z',
    latest_published_output_count: 2, coverage_evidence_state: 'verified',
  };
  const rows: ViewRow[] = [1, 2].map((index) => layer === 'anomaly' ? {
    result_id: `result-${index}`, source_id: sourceId, batch_id: 'unchanged-batch', sensor_id: `sensor-${index}`,
    sensor_name: `Sensor ${index}`, lat: -37.81, lon: 144.97,
    window_from: window.from, window_to: window.to, observation_id: `observation-${index}`,
    baseline_definition_id: 'same-hour-past-seven-days', baseline_value: 10, observed_value: 30, delta: 20,
    direction: 'higher', classification: 'anomalous', is_replay: false, replay_label: null,
    location_evidence: 'Published sensor coordinates valid for the count window', published_at: publishedAt,
  } : {
    geo_record_id: `planning:result-${index}`, version_id: `version-${index}`, source_id: sourceId, topic: 'planning',
    assertion_kind: 'plan', is_prediction: false, title: `Planning record ${index}`, summary: 'Published plan',
    original_url: null, geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.97, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate', area_refs: ['com:municipal'],
    observed_at: null, published_at: null, valid_from: window.from, valid_to: null,
    fetched_at: publishedAt, freshness_state: 'current', record_status: 'active',
  });
  const withdrawn = new Set<string>();
  const queries: PreparedViewQuery[] = [];
  let sourcePublic = true;
  let now = Date.parse(publishedAt);
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const currentRows = rows.filter((row) => !withdrawn.has(String(row.result_id ?? row.geo_record_id)));
      let selected: readonly ViewRow[];
      if (query.query.includes('v_source_coverage')) {
        selected = [{ ...publication, access_status: sourcePublic ? 'active' : 'paused' }];
      } else if (query.query.includes('v_geo_records_current_state')) {
        selected = [{ source_id: sourceId, batch_id: publication.latest_published_batch_id }];
      } else if (typeof query.params.publicRecordKeysJson === 'string') {
        const keys = recordKeysSchema.parse(JSON.parse(query.params.publicRecordKeysJson));
        selected = currentRows.filter((row) => keys.some((key) => key.id === row.geo_record_id
          && key.versionId === row.version_id && key.sourceId === row.source_id));
      } else selected = currentRows;
      return {
        async readPage({ maxRows }) {
          const limit = Math.min(maxRows, Number(query.params.resultLimit));
          return { rows: selected.slice(0, limit).map((row) => ({ record: JSON.stringify(row) })),
            complete: true, hasMore: selected.length > limit };
        },
        async cancel() {},
      };
    },
  };
  const service = createMapService({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' }), adapter,
    currentLayerCache: true, clock: () => new Date(now), resolveArea: () => 'contains',
    publicSources: [{ sourceId, url: 'https://example.org/published-source', attribution: 'Reviewed source', versionRef: null }] });
  const request = { requestId: `cached-${layer}`, bbox: [144.95, -37.83, 144.99, -37.8],
    zoom: 14, layers: [layer], mode: 'current', window, pageSize: 1000 };
  return { service, request, queries, publication, withdraw(id: string) { withdrawn.add(id); },
    revokeSource() { sourcePublic = false; }, advance(milliseconds: number) { now += milliseconds; } };
}

function aggregate(response: ViewportResponse): Extract<MapItem, { kind: 'aggregate' }> {
  assert.equal(response.layers[0]?.state, 'available');
  assert.equal(response.layers[0]?.items.length, 1);
  const item = response.layers[0]?.items[0];
  assert.ok(item?.kind === 'aggregate');
  assert.equal(item.details.memberIds.length, 2);
  return item;
}

const unavailable = (error: unknown) => error instanceof MapServiceError && error.code === 'notAvailable';

test('cached anomaly loads reuse their publication, while stored details and members check live record rights', async () => {
  const f = fixture('anomaly');
  const first = await f.service.queryViewport(f.request);
  const group = aggregate(first);
  aggregate(await f.service.queryViewport({ ...f.request, requestId: 'cached-anomaly-again' }));
  assert.equal(f.queries.filter((query) => query.query.includes('v_anomaly_current')
    && query.params.west === undefined).length, 1, 'Normal viewport loads must share the cached layer');
  const rightsReadsBeforeDetails = f.queries.filter((query) => query.query.includes('v_anomaly_current')
    && query.params.west !== undefined).length;
  const context = { requestId: 'anomaly-detail', snapshotId: first.snapshotId };
  assert.equal((await f.service.getItem('anomaly:result-1', context)).item.kind, 'anomaly');
  assert.equal((await f.service.getMembers(group.id, context)).items.length, 2);

  f.withdraw('result-1');
  assert.equal(f.publication.latest_published_batch_id, 'unchanged-batch');
  await assert.rejects(f.service.getItem('anomaly:result-1', context), unavailable);
  await assert.rejects(f.service.getItem(group.id, context), unavailable);
  await assert.rejects(f.service.getMembers(group.id, context), unavailable);
  assert.equal((await f.service.getItem('anomaly:result-2', context)).item.id, 'anomaly:result-2');
  assert.equal(f.queries.filter((query) => query.query.includes('v_anomaly_current')
    && query.params.west !== undefined).length - rightsReadsBeforeDetails, 6,
    'Every stored access must read current anomaly rights');
});

test('cached planning loads cannot authorize a withdrawn stored detail or aggregate member', async () => {
  const f = fixture('planning');
  const first = await f.service.queryViewport(f.request);
  const group = aggregate(first);
  aggregate(await f.service.queryViewport({ ...f.request, requestId: 'cached-planning-again' }));
  assert.equal(f.queries.filter((query) => query.query.includes('v_geo_records_current_served')
    && typeof query.params.publicRecordKeysJson !== 'string').length, 1);
  // Rights proofs read the copy while it reflects the source's latest batch.
  assert.ok(f.queries.filter((query) => typeof query.params.publicRecordKeysJson === 'string')
    .every((query) => query.query.includes('v_geo_records_current_served')));
  const rightsReadsBeforeDetails = f.queries.filter((query) => typeof query.params.publicRecordKeysJson === 'string').length;
  const context = { requestId: 'planning-detail', snapshotId: first.snapshotId };
  assert.equal((await f.service.getItem('planning:result-1', context)).item.kind, 'planning');

  f.withdraw('planning:result-1');
  // A proof stands for one minute within the same publication, then the record's rights are read again.
  assert.equal((await f.service.getItem('planning:result-1', context)).item.kind, 'planning');
  f.advance(VERIFIED_RECORD_TTL_MS + 1);
  await assert.rejects(f.service.getItem('planning:result-1', context), unavailable);
  await assert.rejects(f.service.getMembers(group.id, context), unavailable);
  assert.equal((await f.service.getItem('planning:result-2', context)).item.id, 'planning:result-2');
  assert.equal(f.publication.latest_published_batch_id, 'unchanged-batch');
  // The first detail and the one inside the minute use the map view's proof; after it, the withdrawn
  // detail, the members and the remaining detail each read current rights again.
  assert.equal(f.queries.filter((query) => typeof query.params.publicRecordKeysJson === 'string').length - rightsReadsBeforeDetails, 3,
    'Stored geo access must query current record rights once its proof has expired');
});

test('default source coverage stops authorizing a revoked source after its 30 second cache window', async () => {
  const f = fixture('planning');
  const planningLayer = (response: Awaited<ReturnType<typeof f.service.getCatalog>>) =>
    response.layers.find((layer) => layer.id === 'planning');
  assert.equal(planningLayer(await f.service.getCatalog())?.availability, 'available');
  f.revokeSource();
  f.advance(30_001);
  assert.equal(planningLayer(await f.service.getCatalog())?.availability, 'notCovered');
  assert.equal(f.queries.filter((query) => query.query.includes('v_source_coverage')).length, 2);
});
