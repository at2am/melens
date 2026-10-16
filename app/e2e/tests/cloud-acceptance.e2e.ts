import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, type Browser, type WebResponse } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';
import { z } from '../../../cloud/node_modules/zod/index.js';
import {
  agentEventSchema, sessionSummarySchema, storedTurnSchema,
  type AgentEvent, type StoredTurn,
} from '../../../cloud/agent/src/protocol/schemas.js';
import {
  mapItemPageSchema, mapItemResponseSchema, unlocatedQuerySchema,
  viewportQuerySchema, viewportResponseSchema, type ViewportQuery, type ViewportResponse,
} from '../../../cloud/shared/src/contracts/map-contract.js';
import { waitForMapSettled, withOwnFeed } from './feed-support.js';
import { settleFlutterFocus } from './flutter-focus.js';
import { readRunMetadata, readStatic, type TransportFailure } from './read-only-transport.mjs';
import type { FeedTopic } from '../../../cloud/agent/src/feeds/schemas.js';

const origin = 'https://melens-510012.web.app';
const project = 'melens-510012';
const mapUrl = 'https://melens-dev-map-saepk4k6hq-km.a.run.app';
const agentUrl = 'https://melens-dev-agent-saepk4k6hq-km.a.run.app';
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const sourceStampSchema = z.object({ sourceCommit: z.string().regex(/^[a-f0-9]{40}$/), appSourceSha256: sha256 });
const releaseSchema = sourceStampSchema.extend({
  builtAt: z.iso.datetime({ offset: true }),
  backendBoundAt: z.iso.datetime({ offset: true }).optional(),
  bundleSha256: sha256,
  dataMode: z.literal('live'),
  mapBaseUrl: z.literal(mapUrl),
  agentBaseUrl: z.literal(agentUrl),
  mapRevision: z.string().startsWith('melens-dev-map-'),
  agentRevision: z.string().startsWith('melens-dev-agent-'),
  mapImageDigest: z.string().regex(/@sha256:[a-f0-9]{64}$/),
  agentImageDigest: z.string().regex(/@sha256:[a-f0-9]{64}$/),
});
const runServiceSchema = z.object({
  status: z.object({
    url: z.url(), latestReadyRevisionName: z.string(),
    traffic: z.array(z.object({ revisionName: z.string().optional(), percent: z.number().optional() })),
  }),
  spec: z.object({ template: z.object({ spec: z.object({
    serviceAccountName: z.email(),
    containers: z.array(z.object({
      image: z.string(),
      env: z.array(z.object({ name: z.string(), value: z.string().optional() })).default([]),
    })).min(1),
  }) }) }),
});
const firebaseClaimsSchema = z.object({
  aud: z.literal(project), iss: z.literal(`https://securetoken.google.com/${project}`),
  sub: z.string().min(1).max(128), exp: z.number(),
  firebase: z.object({ sign_in_provider: z.literal('anonymous') }),
});
type CloudRelease = z.infer<typeof releaseSchema>;
type CloudContext = {
  release: CloudRelease;
  serviceProof: Awaited<ReturnType<typeof verifyServingServices>>;
  mapQueries: ViewportQuery[];
};
type FirebaseProof = { audience: string; issuer: string; provider: 'anonymous'; uidSha256: string };
type OwnCloudSession = {
  id: string;
  identity(): FirebaseProof;
  read(): Promise<StoredTurn[]>;
};

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function pattern(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function evidence(id: string, name: string, value: unknown): void {
  const directory = join('.e2e', 'cloud-evidence');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}-${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

function recordTransportFailure(failure: TransportFailure): void {
  evidence(randomUUID(), 'read-only-transport-failure', failure);
  console.warn('Read-only connection failure', failure);
}

async function servingService(name: string, url: string, revision: string, expectedImage: string, expectedIdentity: string) {
  let raw: unknown;
  let imageDigest: string;
  try {
    raw = JSON.parse(await readRunMetadata([
      'run', 'services', 'describe', name, `--project=${project}`, '--region=australia-southeast2',
      '--format=json(status.url,status.latestReadyRevisionName,status.traffic,spec.template.spec.serviceAccountName,spec.template.spec.containers)',
    ], recordTransportFailure));
    imageDigest = (await readRunMetadata([
      'run', 'revisions', 'describe', revision, `--project=${project}`, '--region=australia-southeast2',
      '--format=value(status.imageDigest)',
    ], recordTransportFailure)).trim();
  } catch {
    throw new Error(`Cannot verify the serving Cloud Run revision for ${name}.`);
  }
  const service = runServiceSchema.parse(raw);
  expect(service.status.url).toBe(url);
  expect(service.status.latestReadyRevisionName).toBe(revision);
  expect(service.status.traffic.filter((entry) => (entry.percent ?? 0) > 0)).toEqual([
    { revisionName: revision, percent: 100 },
  ]);
  expect(imageDigest).toMatch(/@sha256:[a-f0-9]{64}$/);
  expect(imageDigest).toBe(expectedImage);
  expect(service.spec.template.spec.serviceAccountName).toBe(expectedIdentity);
  const developmentMode = service.spec.template.spec.containers
    .flatMap((container) => container.env).find((entry) => entry.name === 'AGENT_DEVELOPMENT_MODE');
  expect(developmentMode === undefined || developmentMode.value === 'false').toBe(true);
  return { name, url, revision, imageDigest, identity: service.spec.template.spec.serviceAccountName, trafficPercent: 100, developmentMode: false };
}

async function verifyServingServices(release: CloudRelease) {
  const [map, agent] = await Promise.allSettled([
    servingService('melens-dev-map', mapUrl, release.mapRevision, release.mapImageDigest, 'melens-dev-query@melens-510012.iam.gserviceaccount.com'),
    servingService('melens-dev-agent', agentUrl, release.agentRevision, release.agentImageDigest, 'melens-dev-agent@melens-510012.iam.gserviceaccount.com'),
  ]);
  if (map.status === 'rejected' || agent.status === 'rejected') {
    throw new AggregateError([map, agent].filter((result) => result.status === 'rejected').map((result) => result.reason), 'The serving Cloud Run proofs failed.');
  }
  return { map: map.value, agent: agent.value };
}

let verifiedRelease: Promise<Omit<CloudContext, 'mapQueries'>> | undefined;
async function verifyRelease() {
  const current = sourceStampSchema.parse(JSON.parse(execFileSync('python3', ['provenance.py'], { encoding: 'utf8' })));
  const reply = await readStatic(`${origin}/release-provenance.json?acceptance=${randomUUID()}`, recordTransportFailure);
  expect(reply.status).toBe(200);
  expect(reply.headers['cache-control']).toMatch(/\bno-cache\b/);
  const release = releaseSchema.parse(JSON.parse(reply.body.toString('utf8')));
  expect(release).toMatchObject(current);
  const bundle = await readStatic(`${origin}/main.dart.js?acceptance=${release.bundleSha256}`, recordTransportFailure);
  expect(bundle.status).toBe(200);
  expect(bundle.headers['cache-control']).toMatch(/\bno-cache\b/);
  expect(createHash('sha256').update(bundle.body).digest('hex')).toBe(release.bundleSha256);
  return { release, serviceProof: await verifyServingServices(release) };
}

async function activateFlutter(browser: Browser, screen: Screen) {
  await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
  await browser.evaluate(() => {
    const activator = document.querySelector('flt-semantics-placeholder');
    if (activator instanceof HTMLElement) activator.click();
    return null;
  });
  await expect(screen.getByRole('tab', 'Feed')).toBeVisible();
}

const cloudTest = test.extend<{ cloud: CloudContext }>({
  cloud: async ({ app, browser, screen }, use) => {
    expect(new URL(app.baseUrl ?? '').origin).toBe(origin);
    verifiedRelease ??= verifyRelease();
    const release = await verifiedRelease;
    const mapQueries: ViewportQuery[] = [];
    let forbiddenParkingRequests = 0;
    await browser.route(`${mapUrl}/v1/map/viewport*`, async (route) => {
      if (route.request.method === 'POST' && route.request.postData !== undefined) {
        const query = viewportQuerySchema.parse(JSON.parse(route.request.postData));
        if (query.layers.includes('parking')) {
          forbiddenParkingRequests += 1;
          await route.abort();
          return;
        }
        mapQueries.push(query);
      }
      await route.continue();
    });
    await browser.goto('about:blank');
    const servedBundle = browser.waitForResponse(new RegExp(`^${pattern(origin)}/main\\.dart\\.js(?:\\?.*)?$`));
    await app.open();
    await activateFlutter(browser, screen);
    const actualBundle = await servedBundle;
    expect(actualBundle.status).toBe(200);
    expect(actualBundle.headers['cache-control']).toMatch(/\bno-cache\b/);
    expect(digest(await actualBundle.text())).toBe(release.release.bundleSha256);
    evidence(randomUUID(), 'release', { cloudUrl: origin, ...release });
    try {
      await use({ ...release, mapQueries });
    } finally {
      expect(forbiddenParkingRequests).toBe(0);
    }
  },
});

test.afterAll(async () => {
  if (verifiedRelease === undefined) return;
  const initial = await verifiedRelease.catch(() => null);
  if (initial === null) return;
  const final = await verifyRelease();
  expect(final).toEqual(initial);
  evidence(randomUUID(), 'release-after-acceptance', { cloudUrl: origin, ...final });
});

function firebaseProof(header: string): FirebaseProof {
  try {
    if (!header.startsWith('Bearer ')) throw new Error();
    const parts = header.slice(7).split('.');
    if (parts.length !== 3 || parts[1] === undefined) throw new Error();
    const parsed = firebaseClaimsSchema.safeParse(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.exp * 1000 <= Date.now()) throw new Error();
    return {
      audience: parsed.data.aud, issuer: parsed.data.iss, provider: 'anonymous', uidSha256: digest(parsed.data.sub),
    };
  } catch {
    throw new Error('The browser did not send a valid Firebase anonymous ID token for this project.');
  }
}

const modelTest = cloudTest.extend<{ cloudSession: OwnCloudSession }>({
  cloudSession: async ({ browser, screen, cloud }, use) => {
    let authorization: string | null = null;
    let nativeIdentity: FirebaseProof | null = null;
    let ownSessionId: string | null = null;
    const routePattern = `${agentUrl}/v1/**`;
    await browser.route(routePattern, async (route) => {
      const observed = route.request.headers.authorization;
      if (observed !== undefined) {
        nativeIdentity = firebaseProof(observed);
        authorization = observed;
      }
      await route.continue();
    });
    const headers = () => {
      if (authorization === null) throw new Error('No browser Firebase authorization was observed.');
      return { Authorization: authorization };
    };
    const identity = () => {
      if (nativeIdentity === null) throw new Error('Firebase anonymous authentication has not completed.');
      return nativeIdentity;
    };
    try {
      await screen.getByRole('tab', 'Discover').tap();
      await expect(screen.getByRole('button', /^Replay ·/).first()).toBeVisible({ timeout: 60_000 });
      await waitForMapSettled(screen);
      const initialList = browser.waitForResponse(`${agentUrl}/v1/sessions`, { timeout: 60_000 });
      await screen.getByRole('button', 'Open the agent chat').tap();
      const listed = await initialList;
      expect(listed.status).toBe(200);
      z.object({ sessions: sessionSummarySchema.array() }).parse(await listed.json());
      await expect(screen.getByRole('button', 'New conversation')).toBeEnabled();
      const creation = browser.waitForResponse(`${agentUrl}/v1/sessions`, { timeout: 60_000 });
      await screen.getByRole('button', 'New conversation').tap();
      const reply = await creation;
      expect(reply.status).toBe(201);
      const body: unknown = await reply.json();
      ownSessionId = z.object({ session: sessionSummarySchema.pick({ id: true }).strip() }).parse(body).session.id;
      const session = z.object({ session: sessionSummarySchema }).parse(body).session;
      evidence(session.id, 'release-auth', { cloudUrl: origin, ...cloud, mapQueries: undefined, identity: identity() });
      await expect(screen.getByRole('textbox', 'Ask about the map…')).toBeEnabled();
      await use({
        id: session.id, identity,
        async read() {
          const saved = await fetch(`${agentUrl}/v1/sessions/${encodeURIComponent(session.id)}`, { headers: headers() });
          expect(saved.status).toBe(200);
          return z.object({ turns: storedTurnSchema.array() }).parse(await saved.json()).turns;
        },
      });
    } finally {
      try {
        if (ownSessionId !== null) {
          const removed = await fetch(`${agentUrl}/v1/sessions/${encodeURIComponent(ownSessionId)}`, {
            method: 'DELETE', headers: headers(),
          });
          expect(removed.status).toBe(204);
          const absent = await fetch(`${agentUrl}/v1/sessions/${encodeURIComponent(ownSessionId)}`, { headers: headers() });
          expect(absent.status).toBe(404);
          evidence(ownSessionId, 'cleanup', { deletedOwnSession: ownSessionId, deleteStatus: removed.status, readAfterDeleteStatus: absent.status });
        }
      } finally {
        authorization = null;
        nativeIdentity = null;
        await browser.unroute(routePattern);
      }
    }
  },
});

function parseEvents(body: string): AgentEvent[] {
  return body.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    return data === '' ? [] : [agentEventSchema.parse(JSON.parse(data))];
  });
}

async function completedTurn(app: App, screen: Screen, session: OwnCloudSession, response: WebResponse) {
  expect(response.url.startsWith(agentUrl)).toBe(true);
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/event-stream');
  await expect(screen.getByRole('button', 'Stop this turn')).toBeVisible();
  await expect(screen.getByRole('button', 'Stop this turn')).toHaveCount(0, { timeout: 200_000 });
  const events = parseEvents(await response.text());
  evidence(session.id, 'stream', { cloudUrl: origin, responseUrl: response.url, events });
  expect(events.filter((event) => event.event === 'error')).toEqual([]);
  const endings = events.filter((event) => event.event === 'done');
  expect(endings).toHaveLength(1);
  const done = endings[0];
  if (done === undefined) throw new Error('The deployed agent returned no done event.');
  expect(done.stop).toBe('end');
  expect(events.at(-1)).toEqual(done);
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  for (const event of events) expect(event.turnId).toBe(done.turnId);
  const usages = events.filter((event) => event.event === 'usage');
  const lastUsage = usages.at(-1);
  if (lastUsage === undefined) throw new Error('The deployed model returned no usage.');
  expect(done.usage).toMatchObject({ ...lastUsage.turn, complete: true, calls: usages.length });
  expect(done.usage.total).toBeGreaterThan(0);
  const turns = await session.read();
  expect(turns).toHaveLength(1);
  const stored = turns[0];
  if (stored === undefined) throw new Error('The deployed agent did not store its completed turn.');
  expect(stored.id).toBe(done.turnId);
  expect(stored.usage).toMatchObject(done.usage);
  expect(stored.usage.perCall).toEqual(usages.map((event) => event.call));
  expect(stored.trace.some((step) => Array.isArray(step.args.layers) && step.args.layers.includes('parking'))).toBe(false);
  evidence(session.id, 'stored', stored);
  await expect(screen.getByRole('textbox', /calls · ↑/, { disabled: true }).first()).toBeVisible();
  await app.screenshot('cloud-real-agent-completed-turn');
  return { events, stored };
}

async function send(app: App, browser: Browser, screen: Screen, session: OwnCloudSession, text: string) {
  const input = screen.getByRole('textbox', 'Ask about the map…');
  await input.tap();
  await settleFlutterFocus(browser);
  await browser.keyboard.type(text);
  await expect(input).toHaveValue(text);
  const reply = browser.waitForResponse(`${agentUrl}/v1/sessions/${session.id}/turns`, { timeout: 60_000 });
  await screen.getByRole('button', 'Send').tap();
  return completedTurn(app, screen, session, await reply);
}

async function usingCloudFeed<T>(
  app: App, browser: Browser, screen: Screen, topic: FeedTopic,
  use: (payload: ViewportResponse) => Promise<T>,
): Promise<T> {
  return withOwnFeed({ app, browser, screen, agentUrl, mapUrl }, {
    topic,
    checkAuthorization: (header) => { firebaseProof(header); },
  }, async (feed) => {
    const payload = feed.viewport;
    if (payload === null) throw new Error('The scoped Feed query was not observed.');
    expect(payload.dataMode).toBe('live');
    return use(payload);
  });
}

cloudTest('cloud release opens Feed Discover and Settings with the served bundle', { tags: ['cloud-ui'] }, async ({ app, browser, screen, cloud }) => {
  expect(cloud.release.dataMode).toBe('live');
  await expect(screen.getByText('Melbourne', { exact: true })).toBeVisible();
  await screen.getByRole('tab', 'Discover').tap();
  await expect(browser).toHaveURL('/discover');
  await expect(screen.getByRole('region', 'Map')).toBeVisible();
  await expect(screen.getByRole('button', 'Results')).toBeVisible();
  await expect(screen.getByRole('button', /^Replay ·/).first()).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText('Oops! Something went wrong.')).toHaveCount(0);
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 60_000 });
  const map = await screen.getByRole('region', 'Map').boundingBox();
  if (map === null) throw new Error('The cloud Google map must have a drawable area.');
  const x = map.x + map.width * 0.4;
  const y = map.y + map.height * 0.55;
  await browser.mouse.move(x, y);
  await browser.mouse.down();
  await browser.mouse.move(x + 40, y);
  await browser.mouse.move(x + 80, y);
  await browser.mouse.up();
  await expect(screen.getByText(/^Results use the query service area/)).toHaveCount(0);
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 60_000 });
  const mapQueryCount = () => cloud.mapQueries.filter((query) => query.requestId.startsWith('viewport-')).length;
  const before = mapQueryCount();
  await browser.mouse.move(x, y);
  await browser.mouse.down();
  await browser.mouse.move(x + 80, y);
  await browser.mouse.move(x + 160, y);
  await browser.mouse.up();
  await expect(screen.getByRole('button', 'Search this area')).toBeVisible();
  expect(mapQueryCount()).toBe(before);
  await screen.getByRole('button', 'Search this area').tap();
  await expect.poll(mapQueryCount, { timeout: 60_000 }).toBeGreaterThan(before);
  await expect(screen.getByRole('button', /^Refresh records/)).toBeEnabled({ timeout: 60_000 });
  await app.screenshot('cloud-real-map-camera-and-query');
  await screen.getByRole('tab', 'Settings').tap();
  await expect(browser).toHaveURL('/settings');
  await expect(screen.getByText(/Live City of Melbourne data$/)).toBeVisible();
  await expect(screen.getByRole('switch', /^Search as the map moves/)).toBeVisible();
  await app.screenshot('cloud-settings-release');
  await screen.getByRole('tab', 'Feed').tap();
  await expect(screen.getByText('Melbourne', { exact: true })).toBeVisible();
});

cloudTest('cloud Planning Feed opens the original snapshot record and its source', { tags: ['cloud-ui'] }, async ({ app, browser, screen, cloud }) => {
  await usingCloudFeed(app, browser, screen, 'planning', async (payload) => {
  const layer = payload.layers.find((entry) => entry.layerId === 'planning');
  if (layer === undefined) throw new Error('The deployed Feed returned no planning layer.');
  expect(layer.state).toBe('available');
  const original = layer.items.find((item) => item.kind === 'planning');
  if (original === undefined) throw new Error('Planning needs a real original record; an empty or aggregate-only Feed is not positive acceptance.');
  const source = original.sources.find((entry) => entry.url !== null);
  if (source === undefined) throw new Error('The original planning record has no public source URL.');
  const encodedId = pattern(encodeURIComponent(original.id));
  const literalId = pattern(original.id);
  const detailReply = browser.waitForResponse(new RegExp(`/v1/map/items/(?:${encodedId}|${literalId})(?:\\?|$)`), { timeout: 60_000 });
  await screen.getByRole('button', new RegExp(pattern(original.title))).first().tap();
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
  await expect(screen.getByRole('button', `Open source: ${source.attribution}`).first()).toBeEnabled();
  await waitForMapSettled(screen);
  evidence(randomUUID(), 'planning-original', { release: cloud.release, viewport: payload, detail });
  await app.screenshot('cloud-planning-original-source');
  });
});

cloudTest('cloud unlocated news preserves original article URLs and an explicit Feed state', { tags: ['cloud-ui'] }, async ({ app, browser, screen, cloud }) => {
  await usingCloudFeed(app, browser, screen, 'news', async () => {
  await expect(screen.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
  const empty = await screen.getByText('Nothing right now').isVisible();
  const failed = await screen.getByText(/^Could not load:/).isVisible();
  const failedWholeFeed = await screen.getByText('The feed could not load').isVisible();
  const locatedCards = await screen.getByRole('button', /^Local news\s/).count();
  expect(empty || failed || failedWholeFeed || locatedCards > 0).toBe(true);
  const to = new Date();
  const query = unlocatedQuerySchema.parse({
    requestId: `cloud-news-${randomUUID()}`, layers: ['news'], mode: 'historical',
    window: { from: new Date(to.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(), to: to.toISOString() },
    scope: { sourceJurisdiction: 'global' }, pageSize: 100,
  });
  const url = new URL(`${mapUrl}/v1/map/unlocated`);
  url.searchParams.set('query', JSON.stringify(query));
  const result = await browser.evaluate(async (address) => {
    const reply = await fetch(address);
    return { status: reply.status, body: await reply.json() };
  }, url.toString());
  expect(result.status).toBe(200);
  const page = mapItemPageSchema.parse(result.body);
  expect(page.dataMode).toBe('live');
  expect(page.scope).toMatchObject({ kind: 'unlocated', sourceJurisdiction: 'global' });
  expect(page.items.length).toBeGreaterThan(0);
  const articles: string[] = [];
  let gdeltAttribution = false;
  for (const item of page.items) {
    expect(item.kind).toBe('news');
    expect(item.geometry).toBeNull();
    expect(item.location.precision).toBe('unlocated');
    if (item.kind !== 'news') throw new Error('The news-only scoped API returned another record kind.');
    for (const article of item.details.articleRefs) {
      expect(article.url).not.toBeNull();
      if (article.url === null) throw new Error('A published news article lost its original URL.');
      expect(new URL(article.url).protocol).toMatch(/^https?:$/);
      articles.push(article.url);
    }
    gdeltAttribution ||= item.sources.some((source) => /GDELT/i.test(source.attribution) && source.url !== null);
  }
  expect(gdeltAttribution).toBe(true);
  const first = page.items[0];
  if (first === undefined) throw new Error('No original unlocated news record can be read.');
  const detailUrl = new URL(`${mapUrl}/v1/map/items/${encodeURIComponent(first.id)}`);
  detailUrl.searchParams.set('requestId', `cloud-news-detail-${randomUUID()}`);
  detailUrl.searchParams.set('snapshotId', page.snapshotId);
  const readback = await browser.evaluate(async (address) => {
    const reply = await fetch(address);
    return { status: reply.status, body: await reply.json() };
  }, detailUrl.toString());
  expect(readback.status).toBe(200);
  const detail = mapItemResponseSchema.parse(readback.body);
  expect(detail.item).toEqual(first);
  evidence(randomUUID(), 'news-unlocated', { release: cloud.release, feedState: { empty, failed, failedWholeFeed, locatedCards }, page, detail, articleUrls: articles });
  await app.screenshot('cloud-news-feed-explicit-state');
  });
});

modelTest('cloud Firebase greeting streams real usage and survives a browser reload', { tags: ['cloud-model'] }, async ({ app, browser, screen, cloudSession }) => {
  const { events, stored } = await send(app, browser, screen, cloudSession, 'Hello!');
  expect(events.filter((event) => ['status', 'card', 'question', 'ui_action'].includes(event.event))).toEqual([]);
  expect(stored.text.trim().length).toBeGreaterThan(0);
  expect(stored.text.length).toBeLessThan(500);
  const originalIdentity = cloudSession.identity();
  await app.open('/settings');
  await activateFlutter(browser, screen);
  await screen.getByRole('button', 'Open the agent chat').tap();
  await expect(screen.getByRole('textbox', /^Hello![\s\S]*calls · ↑/, { disabled: true }).first()).toBeVisible({ timeout: 60_000 });
  expect(cloudSession.identity()).toEqual(originalIdentity);
  expect((await cloudSession.read())[0]).toMatchObject({ id: stored.id, text: stored.text });
  await app.screenshot('cloud-firebase-restored-real-greeting');
});

modelTest('cloud nonparking show_layers applies to Discover and its real query', { tags: ['cloud-model'] }, async ({ app, browser, screen, cloudSession, cloud }) => {
  const { events, stored } = await send(app, browser, screen, cloudSession, 'Only show development projects on the map. Hide every other map layer.');
  const actions = events.filter((event) => event.event === 'ui_action' && event.action === 'show_layers');
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ args: { layers: ['planning'], mode: 'only' } });
  expect(stored.trace).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'show_layers', error: null })]));
  await expect(screen.getByRole('textbox', /\bapplied ·/, { disabled: true }).first()).toBeVisible();
  await waitForMapSettled(screen);
  await screen.getByRole('button', 'Close the agent chat').last().tap();
  await expect(screen.getByRole('checkbox', 'Development projects')).toBeChecked();
  for (const name of ['Pedestrian counts', 'Pedestrian anomalies', 'Transport disruptions', 'Events']) {
    await expect(screen.getByRole('checkbox', name)).not.toBeChecked();
  }
  await expect.poll(() => cloud.mapQueries.some((query) => query.layers.length === 1 && query.layers[0] === 'planning'), { timeout: 60_000 }).toBe(true);
  await waitForMapSettled(screen);
  evidence(cloudSession.id, 'map-action', { queries: cloud.mapQueries });
  await app.screenshot('cloud-nonparking-layers-applied');
});

modelTest('cloud area brief uses real Gemini and displays source-backed cards', { tags: ['cloud-model'] }, async ({ app, browser, screen, cloudSession }) => {
  const radius = 601 + Date.now() % 899;
  const { events, stored } = await send(app, browser, screen, cloudSession,
    `Brief the area within ${radius} metres of latitude -37.8179, longitude 144.9690 in Melbourne. Use area_brief for this exact point and radius.`);
  expect(events.filter((event) => event.event === 'usage' && event.call.agent === 'area_brief').length).toBeGreaterThan(0);
  expect(stored.trace).toEqual(expect.arrayContaining([expect.objectContaining({ tool: 'area_brief', error: null })]));
  const card = events.find((event) => event.event === 'card' && event.card.type === 'area_brief');
  if (card === undefined || card.event !== 'card') throw new Error('The real cloud workflow produced no sourced area card.');
  expect(stored.cards).toEqual(expect.arrayContaining([card.card]));
  await browser.setViewport({ width: 1440, height: 2200 });
  await expect(screen.getByRole('group', new RegExp(`^Area brief\\s+${pattern(card.card.title)}`))).toBeVisible();
  const item = card.card.items.at(-1);
  if (item === undefined) throw new Error('The real area brief returned no recommendation.');
  const label = 'feature_id' in item.source ? `Source: map feature ${item.source.feature_id}` : `Source: ${item.source.title ?? new URL(item.source.url).host}`;
  await expect(screen.getByRole('button', new RegExp(`^${pattern(item.title)}[\\s\\S]*${pattern(label)}`)).first()).toBeVisible();
  await app.screenshot('cloud-full-area-brief-real-reply-and-sources');
});
