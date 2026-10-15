import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMapLayerCatalog } from '@melens/shared/contracts/map-contract';
import { MapQueryError } from '@melens/shared/query/query-runner';
import { parseSourceCoverage, type SourceCoverageReader } from '@melens/shared/query/source-coverage';
import { createLayerCatalogService } from '../src/services/layer-catalog.js';

const snapshot = parseSourceCoverage({ kind: 'complete', rows: [{
  source_id: 'melbourne.development_monitor', topic: 'planning', scope: 'city',
  coverage_area_refs: ['com_municipal:1:2008-07-01'],
  coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
  license_status: 'verified_open', access_status: 'active', health_state: 'current',
  latest_published_batch_id: 'batch-public', latest_published_at: '2026-10-01T00:59:00Z',
  latest_published_window_from: null, latest_published_window_to: null,
  latest_published_output_count: 326, coverage_evidence_state: 'verified',
}], totalMatching: 1, resultBytes: 2 });
const clock = () => new Date('2026-10-01T01:00:00Z');

test('live catalog registers exact frozen v1 layers without admitting candidates or inventing source coverage', async () => {
  const reader: SourceCoverageReader = async (request) => {
    assert.equal(request.layers[0], 'planning');
    assert.deepEqual(request.bbox, [144, -39, 146.5, -37]);
    return snapshot;
  };
  const catalog = await createLayerCatalogService({ readCoverage: reader, clock }).getCatalog();
  assert.deepEqual(parseMapLayerCatalog(catalog, { production: true }), catalog);
  assert.equal(catalog.dataMode, 'live');
  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.generatedAt, '2026-10-01T01:00:00.000Z');
  assert.deepEqual(catalog.layers.map((layer) => layer.id),
    ['pedestrian', 'anomaly', 'disruption', 'event', 'planning', 'parking', 'boundary', 'news', 'rent', 'census']);
  assert.deepEqual(catalog.layers.filter((layer) => layer.defaultEnabled).map((layer) => layer.id),
    ['pedestrian', 'anomaly', 'disruption']);
  // UC-15: parking is registered but opt-in, and has no historical read.
  const parking = catalog.layers.find((layer) => layer.id === 'parking')!;
  assert.deepEqual(parking.supportedModes, ['current']);
  assert.equal(parking.defaultEnabled, false);
  assert.equal(parking.topic, 'cityActivity');
  const planning = catalog.layers.find((layer) => layer.id === 'planning')!;
  assert.equal(planning.availability, 'available');
  assert.equal(planning.coverage.state, 'verified');
  assert.equal(planning.coverage.window, null);
  assert.deepEqual(planning.sourceIds, ['melbourne.development_monitor']);
  assert.equal(catalog.layers.find((layer) => layer.id === 'pedestrian')?.availability, 'notCovered');
  assert.equal(catalog.layers.find((layer) => layer.id === 'anomaly')?.availability, 'unavailable');
  assert.equal(catalog.layers.some((layer) => (layer.availability as string) === 'noMatching'), false);
});

test('partial registry never advertises absent layers as uncovered or proves full coverage', async () => {
  const catalog = await createLayerCatalogService({ readCoverage: async () => ({ ...snapshot, completeness: 'partial' }), clock }).getCatalog();
  assert.equal(catalog.layers.find((layer) => layer.id === 'event')?.availability, 'unknown');
  assert.equal(catalog.layers.find((layer) => layer.id === 'planning')?.coverage.state, 'unknown');
});

test('catalog refresh reads current admission each time and removes withdrawn sources', async () => {
  let reads = 0;
  const service = createLayerCatalogService({ readCoverage: async () => {
    reads += 1;
    return reads === 1 ? snapshot : { completeness: 'complete', sources: snapshot.sources.map((source) => ({
      ...source, licenseStatus: 'review_required', accessStatus: 'paused', admitted: false,
    })) };
  }, clock });
  assert.equal((await service.getCatalog()).layers.find((layer) => layer.id === 'planning')?.availability, 'available');
  const withdrawn = (await service.getCatalog()).layers.find((layer) => layer.id === 'planning')!;
  assert.deepEqual(withdrawn.sourceIds, []);
  assert.equal(withdrawn.availability, 'notCovered');
  assert.equal(reads, 2);
});

test('catalog cannot leak raw provider exceptions, and preserves bounded runner error codes', async () => {
  const unsafe = createLayerCatalogService({ readCoverage: async () => { throw new Error('SELECT private.project'); }, clock });
  await assert.rejects(unsafe.getCatalog(), (error: unknown) => {
    assert.ok(error instanceof MapQueryError);
    assert.equal(error.code, 'serviceUnavailable');
    assert.doesNotMatch(error.message, /SELECT|private/);
    return true;
  });
  const bounded = createLayerCatalogService({ readCoverage: async () => { throw new MapQueryError('budgetExceeded'); }, clock });
  await assert.rejects(bounded.getCatalog(), (error: unknown) => error instanceof MapQueryError && error.code === 'budgetExceeded');
});
