import assert from 'node:assert/strict';
import test from 'node:test';

import { parseViewportQuery } from '../src/contracts/map-contract.js';
import { latestPublishedRequest } from '../src/query/layer-loaders.js';
import type { SourceCoverageSnapshot } from '../src/query/source-coverage.js';

const now = parseViewportQuery({ requestId: 'late-layer', bbox: [144.9, -37.9, 145.1, -37.7], zoom: 15,
  layers: ['pedestrian'], mode: 'current', window: { from: '2026-10-17T03:00:00Z', to: '2026-10-17T03:15:00Z' } });

function coverage(sources: { sourceId: string; topic: string; to: string | null; admitted?: boolean }[]): SourceCoverageSnapshot {
  return { completeness: 'complete', sources: sources.map((source) => ({
    sourceId: source.sourceId, topic: source.topic, admitted: source.admitted ?? true,
    publishedWindow: source.to === null ? null : { from: '2026-10-17T02:00:00Z', to: source.to },
  })) } as unknown as SourceCoverageSnapshot;
}

test('a current pedestrian read shows the latest published window of the same length', () => {
  const shifted = latestPublishedRequest(now, 'pedestrian', coverage([
    { sourceId: 'melbourne.pedestrian.minute', topic: 'pedestrian', to: '2026-10-17T02:15:00Z' },
    // Sensor locations are pedestrian-topic but not a count source of the layer.
    { sourceId: 'melbourne.pedestrian.locations', topic: 'pedestrian', to: '2026-10-17T03:10:00Z' },
  ]));
  assert.deepEqual(shifted.window, { from: '2026-10-17T02:00:00Z', to: '2026-10-17T02:15:00Z' });
  assert.equal(shifted.bbox, now.bbox);
});

test('a current read is kept when the source is up to date, has no window, or the layer is not late', () => {
  assert.equal(latestPublishedRequest(now, 'pedestrian', coverage([
    { sourceId: 'melbourne.pedestrian.minute', topic: 'pedestrian', to: '2026-10-17T03:15:00Z' }])), now);
  assert.equal(latestPublishedRequest(now, 'pedestrian', coverage([
    { sourceId: 'melbourne.pedestrian.minute', topic: 'pedestrian', to: null }])), now);
  assert.equal(latestPublishedRequest(now, 'pedestrian', coverage([
    { sourceId: 'melbourne.pedestrian.minute', topic: 'pedestrian', to: '2026-10-17T02:15:00Z', admitted: false }])), now);
  assert.equal(latestPublishedRequest(now, 'event', coverage([
    { sourceId: 'ticketmaster.events', topic: 'event', to: '2026-10-17T02:15:00Z' }])), now);
  const historical = { ...now, mode: 'historical' as const };
  assert.equal(latestPublishedRequest(historical, 'pedestrian', coverage([
    { sourceId: 'melbourne.pedestrian.minute', topic: 'pedestrian', to: '2026-10-17T02:15:00Z' }])), historical);
});
