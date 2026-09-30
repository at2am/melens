import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addCompletedWindow, type CheckpointManifest } from '../../src/core/gcs.js';

const initial: CheckpointManifest = {
  sourceId: 'melbourne.pedestrian.minute',
  checkpoint: '2026-09-28T00:00:00Z',
  completedWindows: [],
};

test('a later successful window cannot skip a failed earlier window', () => {
  const later = addCompletedWindow(initial, {
    from: '2026-09-28T01:00:00Z', to: '2026-09-28T02:00:00Z', batchId: 'later',
  });
  assert.equal(later.checkpoint, initial.checkpoint);
  assert.equal(later.completedWindows.length, 1);
  const recovered = addCompletedWindow(later, {
    from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z', batchId: 'earlier',
  });
  assert.equal(recovered.checkpoint, '2026-09-28T02:00:00Z');
  assert.deepEqual(recovered.completedWindows, []);
});

test('replayed published windows leave the checkpoint unchanged', () => {
  const window = { from: '2026-09-28T00:00:00Z', to: '2026-09-28T01:00:00Z', batchId: 'batch' };
  const once = addCompletedWindow(initial, window);
  assert.deepEqual(addCompletedWindow(once, window), once);
});
