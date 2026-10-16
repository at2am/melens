import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { verifyBuild } from './build-check.js';

test.beforeEach(async ({ app, browser, screen }) => {
  await verifyBuild(app.baseUrl);
  await app.open('/discover');
  await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
  await browser.evaluate(() => {
    const activator = document.querySelector('flt-semantics-placeholder');
    if (activator instanceof HTMLElement) activator.click();
    return null;
  });
  await expect(screen.getByRole('tab', 'Discover')).toBeSelected();
  await expect(screen.getByRole('region', 'Map')).toBeVisible();
});

test('Discover has current layer chips and results', async ({ app, screen }) => {
  await expect(screen.getByRole('checkbox', 'Pedestrian counts')).toBeChecked();
  await expect(screen.getByRole('button', 'Results')).toBeVisible();
  await expect(screen.getByRole('button', 'My location')).toBeVisible();
  await screen.getByRole('button', 'Results').tap();
  await expect(screen.getByText('Map objects — keyboard accessible')).toBeVisible();
  await expect(screen.getByRole('button', 'Data status')).toBeVisible();
  await app.screenshot('main-discover-results');
});

test('time menu preserves the explicit current or sample window', async ({ app, screen }) => {
  const sample = (await verifyBuild(app.baseUrl)).dataMode === 'sample';
  await screen.getByRole('button', /^History range/).tap();
  await screen.getByRole('menuitemcheckbox', 'Past hour').tap();
  await expect(screen.getByRole('button', /^History range Past hour/)).toBeVisible();
  await screen.getByRole('button', /^History range/).tap();
  await screen.getByRole('menuitemcheckbox', sample ? 'Sample observation window' : 'Now').tap();
  await expect(screen.getByRole('button', sample ? /^History range Sample observation window/ : /^History range Now/)).toBeVisible();
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 45_000 });
});

test('results select an original record and Escape closes its details', async ({ app, browser, screen }) => {
  const sample = (await verifyBuild(app.baseUrl)).dataMode === 'sample';
  for (const name of ['Pedestrian anomalies', 'Transport disruptions']) {
    await screen.getByRole('checkbox', name).uncheck();
  }
  if (!sample) {
    await screen.getByRole('checkbox', 'Pedestrian counts').uncheck();
    await screen.getByRole('checkbox', 'Development projects').check();
  }
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 45_000 });
  await screen.getByRole('button', 'Results').tap();
  const item = screen.getByRole('button', /Reported point location/).first();
  await expect(item).toBeVisible({ timeout: 45_000 });
  await item.tap();
  await expect(screen.getByText(/^Record id:/)).toBeVisible({ timeout: 45_000 });
  if (sample) {
    await expect(screen.getByText('Record id: sample.sensor.A')).toBeVisible();
    await expect(screen.getByText('Sensor passages: 12')).toBeVisible();
  } else {
    const member = screen.getByRole('button', /.+ Source: City of Melbourne/).first();
    await expect(member).toBeVisible({ timeout: 45_000 });
    const reply = browser.waitForResponse(/\/v1\/map\/items\/melbourne\.development_monitor(?::|%3A)/, { timeout: 45_000 });
    await member.tap();
    expect((await reply).status).toBe(200);
    await expect(screen.getByText(/^Record id: melbourne\.development_monitor:/)).toBeVisible();
    await expect(screen.getByText(/^Record version: [a-f0-9]{64}$/)).toBeVisible();
  }
  await expect(screen.getByText('Loading selected record details')).toHaveCount(0, { timeout: 45_000 });
  await expect(screen.getByText('Could not retrieve selected record details')).toHaveCount(0);
  await app.screenshot('main-original-record');
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('button', 'Close selected record details')).toHaveCount(0);
});

test('manual map search waits for Search this area', async ({ app, browser, screen }) => {
  const sample = (await verifyBuild(app.baseUrl)).dataMode === 'sample';
  await expect(screen.getByRole('button', sample ? 'Sample sensor A' : /^Replay ·/).first()).toBeVisible({ timeout: 45_000 });
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 45_000 });
  const map = await screen.getByRole('region', 'Map').boundingBox();
  if (map === null) throw new Error('The visible map must have a drawable area.');
  const x = map.x + map.width * 0.4;
  const y = map.y + map.height * 0.55;
  // The first real camera region is searched even when auto-search is off.
  // A sample can render its fallback records before that first camera idle.
  await browser.mouse.move(x, y);
  await browser.mouse.down();
  await browser.mouse.move(x + 40, y);
  await browser.mouse.move(x + 80, y);
  await browser.mouse.up();
  await expect(screen.getByText(/^Results use the query service area/)).toHaveCount(0);
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 45_000 });
  let requests = 0;
  await browser.route('**/v1/map/viewport', async (route) => {
    if (route.request.postData?.includes('viewport-')) requests += 1;
    await route.continue();
  });
  const before = requests;
  await browser.mouse.move(x, y);
  await browser.mouse.down();
  await browser.mouse.move(x + 80, y);
  await browser.mouse.move(x + 160, y);
  await browser.mouse.up();
  await expect(screen.getByRole('button', 'Search this area')).toBeVisible();
  expect(requests).toBe(before);
  await screen.getByRole('button', 'Search this area').tap();
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 45_000 });
  if (!sample) expect(requests).toBeGreaterThan(before);
});
