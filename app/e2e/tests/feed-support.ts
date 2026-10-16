import { randomUUID } from 'node:crypto';
import type { Browser } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import { settleFlutterFocus } from './flutter-focus.js';
import { z } from '../../../cloud/node_modules/zod/index.js';
import { feedListSchema, feedsBodySchema, type FeedSubscription, type FeedTopic } from '../../../cloud/agent/src/feeds/schemas.js';
import { viewportResponseSchema, type ViewportResponse } from '../../../cloud/shared/src/contracts/map-contract.js';

const loadedFeedsSchema = z.object({ feeds: feedListSchema.nullable() });
const topicLabels: Record<FeedTopic, string> = {
  community: 'Community events', events: 'Events', disruptions: 'Disruptions',
  news: 'Local news', anomalies: 'Crowd anomalies', planning: 'Planning',
};

export async function activateFeed(browser: Browser, screen: Screen): Promise<void> {
  await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
  await browser.evaluate(() => {
    const activator = document.querySelector('flt-semantics-placeholder');
    if (activator instanceof HTMLElement) activator.click();
    return null;
  });
  await expect(screen.getByRole('tab', 'Feed')).toBeSelected();
}

export async function waitForMapSettled(screen: Screen): Promise<void> {
  await expect(screen.getByText(/^Results use the query service area/)).toHaveCount(0, { timeout: 60_000 });
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 60_000 });
  await expect(screen.getByText('Loading map data')).toHaveCount(0, { timeout: 60_000 });
  await expect(screen.getByText('Oops! Something went wrong.')).toHaveCount(0);
}

type FeedContext = { app: App; browser: Browser; screen: Screen; agentUrl: string; mapUrl?: string };
type OwnFeed = { id: string; name: string; originalFeeds: FeedSubscription[] | null; savedFeeds: FeedSubscription[]; viewport: ViewportResponse | null };
type FeedOptions = { topic: FeedTopic; checkAuthorization?: (header: string) => void };

// The Feed API replaces a whole account list. Each cloud test uses its own
// fresh anonymous browser account; local tests run serially under the dev uid.
export async function withOwnFeed<T>(
  context: FeedContext, options: FeedOptions, use: (feed: OwnFeed) => Promise<T>,
): Promise<T> {
  const { app, browser, screen, agentUrl, mapUrl } = context;
  const endpoint = `${agentUrl}/v1/feeds`;
  const viewportEndpoint = mapUrl === undefined ? null : `${mapUrl}/v1/map/viewport`;
  const name = `E2E ${options.topic} ${randomUUID().slice(0, 8)}`;
  let authorization: string | null = null;
  let ownId: string | null = null;
  let originalIds: Set<string> | null = null;
  await browser.route(endpoint, async (route) => {
    const observed = route.request.headers.authorization;
    if (observed !== undefined) {
      options.checkAuthorization?.(observed);
      authorization = observed;
    }
    if (route.request.method === 'PUT' && route.request.postData !== undefined) {
      const outgoing = feedsBodySchema.parse(JSON.parse(route.request.postData));
      const own = outgoing.feeds.find((feed) => feed.name === name);
      if (own !== undefined) {
        if (originalIds === null || originalIds.has(own.id)) throw new Error('The test Feed ID must be new to this account.');
        ownId = own.id;
      }
    }
    await route.continue();
  });
  if (viewportEndpoint !== null) {
    await browser.addInitScript(({ endpoint, requestPrefix }) => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const reply = await realFetch(...args);
        if (reply.url === endpoint) {
          // Observe a clone of the public map response. The app receives the
          // original response; no request, status, body or header is changed.
          void reply.clone().json().then((body: unknown) => {
            if (typeof body !== 'object' || body === null || !('requestId' in body)
              || typeof body.requestId !== 'string' || !body.requestId.startsWith(requestPrefix)) return;
            const record = document.createElement('script');
            record.type = 'application/json';
            record.id = 'e2e-public-feed-viewport';
            record.textContent = JSON.stringify({ status: reply.status, body });
            document.getElementById(record.id)?.remove();
            document.documentElement.append(record);
          }).catch(() => undefined);
        }
        return reply;
      };
    }, { endpoint: viewportEndpoint, requestPrefix: `feed-${options.topic}-` });
  }
  const request = async (method = 'GET', body?: unknown): Promise<Response> => {
    if (authorization === null) throw new Error('The Feed browser sent no account authorization.');
    return fetch(endpoint, {
      method, headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
  };
  try {
    await browser.goto('about:blank');
    const loading = browser.waitForResponse(endpoint, { timeout: 60_000 });
    await app.open('/');
    await activateFeed(browser, screen);
    const initial = await loading;
    expect(initial.status).toBe(200);
    const originalFeeds = loadedFeedsSchema.parse(await initial.json()).feeds;
    originalIds = new Set((originalFeeds ?? []).map((feed) => feed.id));
    await expect(screen.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
    await screen.getByRole('button', 'New feed', { exact: true }).tap();
    await expect(screen.getByRole('heading', 'New feed', { exact: true })).toBeVisible();
    const input = screen.getByRole('textbox');
    await expect(input).toHaveCount(1);
    await input.tap();
    await settleFlutterFocus(browser);
    await browser.keyboard.type(name);
    await expect(input).toHaveValue(name);
    for (const [topic, label] of Object.entries(topicLabels)) {
      const chip = screen.getByRole('checkbox', new RegExp(`^${label}(?:\\s|$)`));
      if (topic === options.topic) await chip.check();
      else await chip.uncheck();
    }
    await expect(screen.getByRole('checkbox', 'Melbourne CBD', { exact: true })).toBeChecked();
    const saving = browser.waitForResponse(endpoint, { timeout: 60_000 });
    await screen.getByRole('button', 'Save', { exact: true }).tap();
    const saved = await saving;
    expect(saved.status).toBe(200);
    const savedFeeds = feedsBodySchema.parse(await saved.json()).feeds;
    const own = savedFeeds.find((feed) => feed.id === ownId && feed.name === name);
    if (own === undefined) throw new Error('The Feed service did not save the test subscription.');
    expect(own).toMatchObject({ topics: [options.topic], scope: { kind: 'area', areaId: 'cbd' }, enabled: true, includeUnlocated: false });
    for (const original of originalFeeds ?? []) expect(savedFeeds).toEqual(expect.arrayContaining([original]));
    const readback = await request();
    expect(readback.status).toBe(200);
    expect(loadedFeedsSchema.parse(await readback.json()).feeds).toEqual(savedFeeds);
    await expect(browser).toHaveURL('/');
    await screen.getByRole('checkbox', name, { exact: true }).tap();
    await expect(screen.getByRole('checkbox', name, { exact: true })).toBeChecked();
    let viewport: ViewportResponse | null = null;
    if (viewportEndpoint !== null) {
      const observed = () => browser.evaluate(() => document.getElementById('e2e-public-feed-viewport')?.textContent ?? null);
      await expect.poll(observed, { timeout: 60_000 }).not.toBeNull();
      const text = await observed();
      if (text === null) throw new Error('The browser received no response for this Feed layer.');
      const captured = z.object({ status: z.literal(200), body: viewportResponseSchema }).parse(JSON.parse(text));
      viewport = captured.body;
      expect(viewport.layers.map((layer) => layer.layerId)).toEqual([options.topic]);
    }
    return await use({ id: own.id, name, originalFeeds, savedFeeds, viewport });
  } finally {
    try {
      if (ownId !== null) {
        const current = await request();
        expect(current.status).toBe(200);
        const currentFeeds = loadedFeedsSchema.parse(await current.json()).feeds;
        if (currentFeeds?.some((feed) => feed.id === ownId) === true) {
          const remaining = currentFeeds.filter((feed) => feed.id !== ownId);
          const cleaned = await request('PUT', { feeds: remaining });
          expect(cleaned.status).toBe(200);
          expect(feedsBodySchema.parse(await cleaned.json()).feeds).toEqual(remaining);
          const readback = await request();
          expect(readback.status).toBe(200);
          expect(loadedFeedsSchema.parse(await readback.json()).feeds).toEqual(remaining);
        }
      }
    } finally {
      authorization = null;
      await browser.unroute(endpoint);
    }
  }
}
