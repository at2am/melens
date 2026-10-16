import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { verifyBuild } from './build-check.js';
import { localTargets } from './local-targets.mjs';
import { activateFeed, withOwnFeed } from './feed-support.js';

test.beforeEach(async ({ app, browser, screen }) => {
  await verifyBuild(app.baseUrl);
  await app.open();
  await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
  await browser.evaluate(() => {
    const activator = document.querySelector('flt-semantics-placeholder');
    if (activator instanceof HTMLElement) activator.click();
    return null;
  });
  await expect(screen.getByRole('tab', 'Feed')).toBeSelected();
});

test('current main opens Feed and all three tabs navigate', async ({ app, browser, screen }) => {
  await expect(screen.getByText('Melbourne', { exact: true })).toBeVisible();
  await expect(screen.getByRole('button', 'Host an event')).toBeVisible();
  await expect(screen.getByRole('button', 'New feed', { exact: true })).toBeVisible();
  await screen.getByRole('tab', 'Discover').tap();
  await expect(browser).toHaveURL('/discover');
  await expect(screen.getByRole('button', 'Results')).toBeVisible();
  await screen.getByRole('tab', 'Settings').tap();
  await expect(browser).toHaveURL('/settings');
  await expect(screen.getByRole('switch', /^Search as the map moves/)).toBeVisible();
  await screen.getByRole('tab', 'Feed').tap();
  await expect(screen.getByText('Melbourne', { exact: true })).toBeVisible();
  await app.screenshot('main-feed');
});

test('saved scoped Feed subscriptions survive tabs and a browser reload', async ({ app, browser, screen }) => {
  await withOwnFeed({ app, browser, screen, agentUrl: localTargets.agent }, { topic: 'planning' }, async (feed) => {
    await screen.getByRole('tab', 'Settings').tap();
    const savedFeed = screen.getByRole('button', new RegExp(`^${feed.name}\\s`));
    await savedFeed.scrollIntoView();
    await expect(savedFeed).toBeVisible();
    await screen.getByRole('tab', 'Feed').tap();
    await expect(screen.getByRole('checkbox', feed.name, { exact: true })).toBeChecked();
    await app.open('/');
    await activateFeed(browser, screen);
    await screen.getByRole('checkbox', feed.name, { exact: true }).tap();
    await expect(screen.getByRole('checkbox', feed.name, { exact: true })).toBeChecked();
    await app.screenshot('main-scoped-feed-restored');
  });
});

test('settings profile and map search preferences persist within the app', async ({ screen }) => {
  await screen.getByRole('tab', 'Settings').tap();
  await screen.getByRole('button', /^Add your name/).tap();
  await screen.getByRole('textbox').fill('Local E2E');
  await screen.getByRole('button', 'Save', { exact: true }).tap();
  await expect(screen.getByRole('button', /Local E2E/)).toBeVisible();
  await screen.getByRole('switch', /^Search as the map moves/).check();
  await screen.getByRole('tab', 'Discover').tap();
  await screen.getByRole('tab', 'Settings').tap();
  await expect(screen.getByRole('switch', /^Search as the map moves/)).toBeChecked();
  await screen.getByRole('switch', /^Search as the map moves/).uncheck();
});

test('cold chat typing survives tooltips and tab changes', async ({ app, browser, screen }) => {
  // Deliberately start typing before the Google map finishes its first load.
  await screen.getByRole('tab', 'Discover').tap();
  await screen.getByRole('button', 'Open the agent chat').tap();
  const input = screen.getByRole('textbox');
  await expect(input).toBeEnabled();
  await input.tap();
  await browser.keyboard.type('Cold start draft ');
  await expect(input).toHaveValue('Cold start draft ');

  const tooltipText = screen.getByText('Conversations', { exact: true });
  const baseline = await tooltipText.count();
  const conversations = await screen.getByRole('button', 'Conversations').boundingBox();
  if (conversations === null) throw new Error('The Conversations tooltip must have a visible button.');
  await browser.mouse.move(conversations.x + conversations.width / 2, conversations.y + conversations.height / 2);
  await expect(tooltipText).toHaveCount(baseline + 1);
  await expect(tooltipText.last()).toBeVisible();
  // Keep the original editing focus across Tooltip OverlayPortal changes.
  await browser.keyboard.type('with tooltip ');
  await expect(input).toHaveValue('Cold start draft with tooltip ');
  await app.screenshot('main-cold-chat-tooltip-open');
  const field = await input.boundingBox();
  if (field === null) throw new Error('The original chat input must remain visible.');
  await browser.mouse.move(field.x + field.width / 2, field.y + field.height / 2);
  await expect(tooltipText).toHaveCount(baseline);
  await browser.keyboard.type('after tooltip closes.');
  const text = 'Cold start draft with tooltip after tooltip closes.';
  await expect(input).toHaveValue(text);
  await app.screenshot('main-cold-chat-tooltip-closed');

  for (const tab of ['Feed', 'Settings', 'Discover']) {
    await screen.getByRole('tab', tab).tap();
    await input.tap();
    await expect(input).toHaveValue(text);
  }
  await screen.getByRole('button', 'Close the agent chat').last().tap();
  await expect(input).toHaveCount(0);
  await screen.getByRole('button', 'Open the agent chat').tap();
  await input.tap();
  await expect(input).toHaveValue(text);
  await screen.getByRole('button', 'Close the agent chat').last().tap();
});

test('phone layout keeps navigation, results and chat usable', async ({ app, browser, screen }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await screen.getByRole('tab', 'Discover').tap();
  await screen.getByRole('button', 'Results').tap();
  await expect(screen.getByText('Map objects — keyboard accessible')).toBeVisible();
  await browser.keyboard.press('Escape');
  await screen.getByRole('button', 'Open the agent chat').tap();
  await expect(screen.getByRole('textbox')).toBeVisible();
  await expect(screen.getByRole('button', 'Send', { exact: true })).toBeVisible();
  await app.screenshot('main-phone-chat');
  await screen.getByRole('button', 'Close the agent chat').tap();
  await expect(screen.getByRole('tab', 'Settings')).toBeVisible();
});

test('unknown routes return to the current Feed home', async ({ app, browser, screen }) => {
  await app.open('/no-such-page');
  await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
  await browser.evaluate(() => {
    const activator = document.querySelector('flt-semantics-placeholder');
    if (activator instanceof HTMLElement) activator.click();
    return null;
  });
  await expect(screen.getByText('Page not found')).toBeVisible();
  await screen.getByRole('button', 'Back to the feed').tap();
  await expect(screen.getByText('Melbourne', { exact: true })).toBeVisible();
});
