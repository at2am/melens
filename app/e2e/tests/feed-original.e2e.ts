import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { mapItemResponseSchema } from '../../../cloud/shared/src/contracts/map-contract.js';
import { verifyBuild } from './build-check.js';
import { waitForMapSettled, withOwnFeed } from './feed-support.js';

function pattern(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

test('Feed Planning keeps the live original snapshot or its explicit sample empty state', async ({ app, browser, screen }) => {
  const manifest = await verifyBuild(app.baseUrl);
  const sample = manifest.dataMode === 'sample';
  await withOwnFeed({ app, browser, screen, agentUrl: manifest.agentBaseUrl,
    ...(sample ? {} : { mapUrl: manifest.mapBaseUrl }),
  }, { topic: 'planning' }, async (feed) => {
  await expect(screen.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
  if (sample) {
    await expect(screen.getByText('Nothing right now')).toBeVisible();
    await screen.getByRole('tab', 'Settings').tap();
    await expect(screen.getByText(/Sample data for development$/)).toBeVisible();
    await app.screenshot('sample-scoped-feed-planning-explicit-empty');
    return;
  }
  const payload = feed.viewport;
  if (payload === null) throw new Error('The Planning Feed query was not observed.');
  expect(payload.dataMode).toBe('live');
  const layer = payload.layers.find((entry) => entry.layerId === 'planning');
  if (layer === undefined) throw new Error('The real Feed returned no planning layer.');
  expect(layer.state).toBe('available');
  const original = layer.items.find((item) => item.kind === 'planning');
  if (original === undefined) throw new Error('The real Planning Feed needs an original record, not an empty or aggregate-only response.');
  const source = original.sources.find((entry) => entry.url !== null);
  if (source === undefined) throw new Error('The original planning record needs its public source URL.');
  const encodedId = pattern(encodeURIComponent(original.id));
  const literalId = pattern(original.id);
  const detailReply = browser.waitForResponse(new RegExp(`/v1/map/items/(?:${encodedId}|${literalId})(?:\\?|$)`), { timeout: 45_000 });
  const card = screen.getByRole('button', new RegExp(pattern(original.title))).first();
  await expect(card).toBeVisible({ timeout: 45_000 });
  await card.tap();
  const detailResponse = await detailReply;
  expect(detailResponse.status).toBe(200);
  const detail = mapItemResponseSchema.parse(await detailResponse.json());
  expect(detail.dataMode).toBe('live');
  expect(detail.snapshotId).toBe(payload.snapshotId);
  expect(detail.item).toMatchObject({ id: original.id, versionId: original.versionId, kind: 'planning' });
  expect(detail.item.sources).toEqual(expect.arrayContaining([source]));
  await expect(browser).toHaveURL('/discover');
  await expect(screen.getByText(`Record id: ${original.id}`)).toBeVisible();
  await expect(screen.getByText(`Record version: ${original.versionId}`)).toBeVisible();
  await expect(screen.getByText('Loading selected record details')).toHaveCount(0);
  await expect(screen.getByText('Could not retrieve selected record details')).toHaveCount(0);
  const sourceButton = screen.getByRole('button', `Open source: ${source.attribution}`).first();
  await sourceButton.scrollIntoView();
  await expect(sourceButton).toBeEnabled();
  await waitForMapSettled(screen);
  const directory = join('.e2e', 'feed-evidence');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${randomUUID()}-original-snapshot.json`), `${JSON.stringify({ feed, viewport: payload, detail }, null, 2)}\n`);
  await app.screenshot('live-feed-planning-original-snapshot');
  });
});
