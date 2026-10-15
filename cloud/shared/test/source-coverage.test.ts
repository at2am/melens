import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMapConfig } from '../src/config.js';
import { parseViewportQuery } from '../src/contracts/map-contract.js';
import type { BigQueryViewAdapter, PreparedViewQuery } from '../src/query/bigquery-adapter.js';
import { createViewQueryRunner, MapQueryError, type ViewQueryResult, type ViewRow } from '../src/query/query-runner.js';
import {
  assessLayerCoverage, cacheSourceCoverage, compareSourceInstants, createSourceCoverageReader, finalizeLayerResult,
  findPublicSource, parseSourceCoverage, sourceBelongsToLayer, type LayerCoverageAssessment,
  type SourceCoverageSnapshot,
} from '../src/query/source-coverage.js';

const request = parseViewportQuery({
  requestId: 'coverage-test', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 14,
  layers: ['planning'], mode: 'current',
  window: { from: '2026-10-01T00:00:00Z', to: '2026-10-01T01:00:00Z' },
});

function sourceRow(overrides: ViewRow = {}): ViewRow {
  return {
    source_id: 'melbourne.development_monitor', topic: 'planning', scope: 'city',
    coverage_area_refs: ['com_municipal:1:2008-07-01'],
    coverage_from: '2026-09-01T00:00:00Z', coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch-public', latest_published_at: '2026-10-01T00:59:00.000001Z',
    latest_published_window_from: '2026-10-01T00:00:00Z',
    latest_published_window_to: '2026-10-01T01:00:00Z', latest_published_output_count: 0,
    coverage_evidence_state: 'verified', ...overrides,
  };
}

function result(...rows: ViewRow[]): ViewQueryResult {
  return { kind: 'complete', rows, totalMatching: rows.length, resultBytes: 2 };
}

function empty(assessment: LayerCoverageAssessment,
  overrides: Partial<Parameters<typeof finalizeLayerResult>[0]> = {}) {
  return finalizeLayerResult({ layerId: 'planning', assessment, items: [], completeness: 'complete',
    unresolvedCount: 0, totalMatching: 0, ...overrides });
}

function proved() {
  return assessLayerCoverage({ snapshot: parseSourceCoverage(result(sourceRow())), layerId: 'planning',
    request, resolveArea: () => 'contains' });
}

test('public source parsing carries effective admission/publication, drops private fields and preserves zero', () => {
  const snapshot = parseSourceCoverage(result(sourceRow({ admission_evidence: 'private', secret: 'private' })));
  const source = findPublicSource(snapshot, 'melbourne.development_monitor');
  assert.ok(source);
  assert.equal(source.admitted, true);
  assert.equal(source.publishedOutputCount, 0);
  assert.equal(source.publishedAt, '2026-10-01T00:59:00.000001Z');
  assert.doesNotMatch(JSON.stringify(snapshot), /private|admission_evidence|secret/);
  for (const row of [
    sourceRow({ license_status: 'review_required' }),
    sourceRow({ access_status: 'paused' }),
    sourceRow({ latest_published_batch_id: null }),
    sourceRow({ latest_published_at: null }),
  ]) assert.equal(findPublicSource(parseSourceCoverage(result(row)), 'melbourne.development_monitor'), null);
  assert.equal(findPublicSource(snapshot, 'unregistered.provider'), null);
});

test('missing admission, malformed microseconds/intervals and duplicate source metadata fail with safe errors', () => {
  const missingAdmission = sourceRow();
  delete missingAdmission.license_status;
  for (const rows of [
    [missingAdmission], [sourceRow({ latest_published_at: '2026-10-01T00:59:00.0000001Z' })],
    [sourceRow({ latest_published_window_to: '2026-09-01T00:00:00Z' })],
    [sourceRow(), sourceRow()],
  ]) assert.throws(() => parseSourceCoverage(result(...rows)), (error: unknown) => {
    assert.ok(error instanceof MapQueryError);
    assert.equal(error.code, 'serviceUnavailable');
    assert.doesNotMatch(error.message, /license_status|melbourne|2026/);
    return true;
  });
});

test('complete admitted registry absence differs from partial registry absence and missing anomaly producer', () => {
  const snapshot = parseSourceCoverage(result());
  const absent = assessLayerCoverage({ snapshot, layerId: 'event', request });
  assert.equal(absent.availability, 'notCovered');
  assert.equal(absent.coverage.state, 'notCovered');
  assert.equal(assessLayerCoverage({ snapshot: { ...snapshot, completeness: 'partial' },
    layerId: 'event', request }).availability, 'unknown');
  assert.equal(assessLayerCoverage({ snapshot, layerId: 'anomaly' }).availability, 'unavailable');
});

test('declared source summary is distinct from query-specific spatial and temporal coverage', () => {
  const snapshot = parseSourceCoverage(result(sourceRow()));
  const catalog = assessLayerCoverage({ snapshot, layerId: 'planning' });
  assert.equal(catalog.coverage.state, 'verified');
  assert.equal(catalog.queryCoverageVerified, false);
  assert.equal(empty(catalog).state, 'unknown');
  const noGeometryProof = assessLayerCoverage({ snapshot, layerId: 'planning', request });
  assert.equal(noGeometryProof.coverage.state, 'unknown');
  assert.equal(empty(noGeometryProof).state, 'unknown');
  assert.equal(noGeometryProof.availability, 'available');
});

test('successful complete exact empty query becomes noMatching only with requested bbox/window and zero unresolved proof', () => {
  const assessment = proved();
  const layer = empty(assessment, { observedWindow: request.window });
  assert.equal(assessment.queryCoverageVerified, true);
  assert.equal(layer.state, 'noMatching');
  assert.equal(layer.totalMatching, 0);
  assert.equal(layer.unresolvedCount, 0);
  assert.deepEqual(layer.coverage.evidenceSourceIds, ['melbourne.development_monitor']);
  for (const overrides of [
    { unresolvedCount: null }, { unresolvedCount: 1 }, { totalMatching: null },
    { completeness: 'partial' as const },
    { completeness: 'partial' as const, nextCursor: 'opaque-next' },
  ]) {
    const incomplete = empty(assessment, overrides);
    assert.equal(incomplete.state, 'unknown');
    assert.equal(incomplete.totalMatching, null);
  }
  const failed = empty(assessment, { querySucceeded: false });
  assert.equal(failed.state, 'unavailable');
  assert.equal(failed.completeness, 'partial');
  assert.equal(failed.totalMatching, null);
});

test('mixed failures, partial registry, late source, unknown evidence and short published windows never prove an empty area', () => {
  const good = sourceRow();
  for (const snapshot of [
    { ...parseSourceCoverage(result(good)), completeness: 'partial' as const },
    parseSourceCoverage(result(good, sourceRow({ source_id: 'planning.other', health_state: 'source_unavailable' }))),
    parseSourceCoverage(result(sourceRow({ health_state: 'late' }))),
    parseSourceCoverage(result(sourceRow({ coverage_evidence_state: 'unknown' }))),
    parseSourceCoverage(result(sourceRow({ latest_published_window_from: '2026-10-01T00:30:00Z' }))),
    parseSourceCoverage(result(sourceRow({ latest_published_window_from: null, latest_published_window_to: null }))),
  ]) {
    const assessment = assessLayerCoverage({ snapshot, layerId: 'planning', request, resolveArea: () => 'contains' });
    assert.equal(assessment.coverage.state, 'unknown');
    assert.equal(empty(assessment).state, 'unknown');
  }
  const failed = assessLayerCoverage({ snapshot: parseSourceCoverage(result(sourceRow({ health_state: 'source_unavailable' }))),
    layerId: 'planning', request, resolveArea: () => 'contains' });
  assert.equal(empty(failed).state, 'unavailable');
});

test('microsecond coverage gaps are preserved rather than rounded into noMatching proof', () => {
  assert.equal(compareSourceInstants('2026-10-01T00:00:00.000001Z', '2026-10-01T00:00:00Z'), 1);
  assert.equal(compareSourceInstants('2026-10-01T00:00:00.100000Z', '2026-10-01T00:00:00.1Z'), 0);
  const snapshot = parseSourceCoverage(result(sourceRow({ latest_published_window_from: '2026-10-01T00:00:00.000001Z' })));
  const assessment = assessLayerCoverage({ snapshot, layerId: 'planning', request, resolveArea: () => 'contains' });
  assert.equal(empty(assessment).state, 'unknown');
});

test('disjoint verified boundaries support notCovered while unknown relationships remain unknown', () => {
  const snapshot = parseSourceCoverage(result(sourceRow()));
  const outside = assessLayerCoverage({ snapshot, layerId: 'planning', request, resolveArea: () => 'disjoint' });
  assert.equal(empty(outside).state, 'notCovered');
  const unknown = assessLayerCoverage({ snapshot, layerId: 'planning', request, resolveArea: () => 'unknown' });
  assert.equal(empty(unknown).state, 'unknown');
  const unresolved = parseSourceCoverage(result(sourceRow({ coverage_evidence_state: 'unknown', coverage_area_refs: null })));
  assert.equal(assessLayerCoverage({ snapshot: unresolved, layerId: 'planning', request,
    resolveArea: () => 'disjoint' }).coverage.state, 'unknown');
});

test('freshness/publication/coverage remain independent and reference-only sources do not advertise data layers', () => {
  const stale = assessLayerCoverage({ snapshot: parseSourceCoverage(result(sourceRow({ health_state: 'stale' }))), layerId: 'planning' });
  assert.equal(stale.availability, 'available');
  assert.equal(stale.freshness, 'stale');
  assert.equal(stale.coverage.state, 'unknown');
  const snapshot = parseSourceCoverage(result(sourceRow({ source_id: 'melbourne.pedestrian.locations', topic: 'pedestrian' }),
    sourceRow({ source_id: 'victoria.transport.gtfs_static', topic: 'transport' })));
  assert.equal(sourceBelongsToLayer(snapshot.sources[0]!, 'pedestrian'), false);
  assert.equal(sourceBelongsToLayer(snapshot.sources[1]!, 'disruption'), false);
});

test('coverage reader uses approved fixed view, current admission, 1000-source budget and fresh access independent of cursors', async () => {
  const queries: PreparedViewQuery[] = [];
  const adapter: BigQueryViewAdapter = {
    async dryRun(query) { queries.push(query); return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      return { async readPage() { return { rows: [{ record: JSON.stringify(sourceRow()) }], complete: true, hasMore: false }; },
        async cancel() {} };
    },
  };
  const runner = createViewQueryRunner({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_DRY_RUN_PREFLIGHT: 'true' }), adapter });
  const reader = createSourceCoverageReader({ runner });
  const snapshot = await reader.read({ ...request, pageSize: 1, cursor: 'opaque', snapshotId: 'old-snapshot' });
  assert.equal(snapshot.completeness, 'complete');
  assert.equal(snapshot.sources.length, 1);
  assert.equal(queries[1]?.params.resultLimit, 1_001);
  assert.match(queries[1]!.query, /melens_query\.v_source_coverage/);
  assert.match(queries[1]!.query, /s\.license_status, s\.access_status/);
  assert.match(queries[1]!.query, /s\.access_status = 'active'/);
  assert.doesNotMatch(queries[1]!.query, /melens_ingest|admission_evidence|secret/);
  assert.equal(queries[1]?.maximumBytesBilled, '100000000');
});

test('partial rows from the real bounded runner retain partial source completeness', async () => {
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery() { return {
      async readPage() { return { rows: [sourceRow(), sourceRow({ source_id: 'planning.second' })]
        .map((row) => ({ record: JSON.stringify(row) })), complete: true, hasMore: false }; },
      async cancel() {},
    }; },
  };
  const runner = createViewQueryRunner({ config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_MAX_PAGE_ITEMS: '1' }), adapter });
  const snapshot = await createSourceCoverageReader({ runner }).read(request);
  assert.equal(snapshot.completeness, 'partial');
  assert.equal(snapshot.sources.length, 1);
  assert.equal(empty(assessLayerCoverage({ snapshot, layerId: 'planning', request,
    resolveArea: () => 'contains' })).state, 'unknown');
});

test('scan rejection and provider exceptions remain bounded safe query errors', async () => {
  let starts = 0;
  const adapter: BigQueryViewAdapter = {
    async dryRun() { return { bytesProcessed: 383_847_461n }; },
    async startQuery() { starts += 1; throw new Error('private SDK project SQL'); },
  };
  const reader = createSourceCoverageReader({ runner: createViewQueryRunner({
    config: loadMapConfig({ MAP_PROJECT_ID: 'melens-testing', MAP_DRY_RUN_PREFLIGHT: 'true' }), adapter }) });
  await assert.rejects(reader.read(request), (error: unknown) => error instanceof MapQueryError && error.code === 'budgetExceeded');
  assert.equal(starts, 0);
  const unsafe = createSourceCoverageReader({ runner: { async run() { throw new Error('private SDK project SQL'); } } });
  await assert.rejects(unsafe.read(request), (error: unknown) => {
    assert.ok(error instanceof MapQueryError);
    assert.equal(error.code, 'serviceUnavailable');
    assert.doesNotMatch(error.message, /private|SDK|SQL/);
    return true;
  });
});

test('the coverage cache shares one read per window and keeps no failure', async () => {
  let now = 0; let reads = 0; let fail = false;
  const snapshot: SourceCoverageSnapshot = { sources: [], completeness: 'complete' };
  const read = cacheSourceCoverage(async () => {
    reads += 1; await Promise.resolve();
    if (fail) throw new MapQueryError('serviceUnavailable');
    return snapshot;
  }, { ttlMs: 1000, clock: () => new Date(now) });

  assert.deepEqual(await Promise.all([read(request), read(request)]), [snapshot, snapshot]);
  now = 999; await read(request);
  assert.equal(reads, 1);

  now = 1000; fail = true;
  await assert.rejects(read(request), MapQueryError);
  fail = false; assert.equal(await read(request), snapshot);
  assert.equal(reads, 3);
});

test('a caller that gives up does not fail the shared coverage read', async () => {
  let release!: () => void;
  const snapshot: SourceCoverageSnapshot = { sources: [], completeness: 'complete' };
  const read = cacheSourceCoverage(() => new Promise((resolve) => { release = () => resolve(snapshot); }), { ttlMs: 1000 });
  const controller = new AbortController();
  const abandoned = read(request, { signal: controller.signal });
  const waiting = read(request);
  controller.abort();
  await assert.rejects(abandoned, (error: unknown) => error instanceof MapQueryError);
  release();
  assert.equal(await waiting, snapshot);
});
