import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, type Browser, type WebResponse } from '@e2e-dev/web';
import { expect, type App, type Screen } from 'e2e';

import {
  agentEventSchema,
  sessionSummarySchema,
  storedTurnSchema,
  type AgentEvent,
} from '../../../cloud/agent/src/protocol/schemas.js';
import {
  viewportQuerySchema,
  type ViewportQuery,
} from '../../../cloud/shared/src/contracts/map-contract.js';
import { verifyBuild } from './build-check.js';
import { waitForMapSettled } from './feed-support.js';
import { settleFlutterFocus } from './flutter-focus.js';
import { localTargets } from './local-targets.mjs';

const localAgent = localTargets.agent;
const developmentAuth = { Authorization: 'Bearer dev' };
const scenarioTimeout = 240_000;

function parseEvents(body: string): AgentEvent[] {
  return body.split(/\r?\n\r?\n/).flatMap((block) => {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n');
    return data === '' ? [] : [agentEventSchema.parse(JSON.parse(data))];
  });
}

function evidence(sessionId: string, name: string, value: unknown): void {
  const directory = join('.e2e', 'agent-evidence');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${sessionId}-${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

const agentTest = test.extend<{ localSession: string }>({
  localSession: async ({ app, browser, screen }, use) => {
    const manifest = await verifyBuild(app.baseUrl);
    expect(manifest).toMatchObject({ dataMode: 'live', agentBaseUrl: localAgent });
    await app.open();
    await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
    await browser.evaluate(() => {
      const activator = document.querySelector('flt-semantics-placeholder');
      if (activator instanceof HTMLElement) activator.click();
      return null;
    });
    await expect(screen.getByRole('tab', 'Discover')).toBeVisible();
    await screen.getByRole('tab', 'Discover').tap();
    await expect(screen.getByRole('button', /^Replay ·/).first()).toBeVisible({ timeout: 60_000 });
    await waitForMapSettled(screen);
    const initialList = browser.waitForResponse(`${localAgent}/v1/sessions`, { timeout: 60_000 });
    await screen.getByRole('button', 'Open the agent chat').tap();
    const listed = await initialList;
    expect(listed.status).toBe(200);
    await expect(screen.getByRole('button', 'New conversation')).toBeEnabled();
    await expect(screen.getByText('Restoring the conversation…')).toHaveCount(0);

    const creation = browser.waitForResponse(`${localAgent}/v1/sessions`);
    await screen.getByRole('button', 'New conversation').tap();
    const response = await creation;
    expect(response.status).toBe(201);
    const body = await response.json();
    if (typeof body !== 'object' || body === null || !('session' in body)) {
      throw new Error('The local agent did not return the newly created session.');
    }
    const session = sessionSummarySchema.parse(body.session);
    evidence(session.id, 'build', manifest);
    try {
      await expect(screen.getByText('Restoring the conversation…')).toHaveCount(0);
      await expect(screen.getByRole('textbox', 'Ask about the map…')).toBeEnabled();
      await use(session.id);
    } finally {
      const removed = await fetch(`${localAgent}/v1/sessions/${encodeURIComponent(session.id)}`, {
        method: 'DELETE', headers: developmentAuth, redirect: 'error',
      });
      expect(removed.status).toBe(204);
    }
  },
});

async function readCompletedTurn({
  app, browser, screen, sessionId, response,
}: {
  app: App;
  browser: Browser;
  screen: Screen;
  sessionId: string;
  response: WebResponse;
}) {
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toContain('text/event-stream');
  await expect(screen.getByRole('button', 'Stop this turn')).toBeVisible();
  await expect(screen.getByRole('button', 'Stop this turn')).toHaveCount(0, { timeout: 200_000 });
  const events = parseEvents(await response.text());
  evidence(sessionId, 'stream', { responseUrl: response.url, events });
  expect(events.filter((event) => event.event === 'error')).toEqual([]);
  const doneEvents = events.filter((event) => event.event === 'done');
  expect(doneEvents).toHaveLength(1);
  const done = doneEvents[0];
  if (done === undefined) throw new Error('The real agent stream has no done event.');
  expect(events.at(-1)).toEqual(done);
  expect(done.stop).toBe('end');
  expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  for (const event of events) expect(event.turnId).toBe(done.turnId);
  const usages = events.filter((event) => event.event === 'usage');
  expect(usages.length).toBeGreaterThan(0);
  const lastUsage = usages.at(-1);
  if (lastUsage === undefined) throw new Error('The real model returned no usage.');
  expect(done.usage).toMatchObject({ ...lastUsage.turn, complete: true, calls: usages.length });
  expect(done.usage.total).toBeGreaterThan(0);

  const savedResponse = await fetch(`${localAgent}/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: developmentAuth, redirect: 'error',
  });
  expect(savedResponse.status).toBe(200);
  const saved: unknown = await savedResponse.json();
  if (typeof saved !== 'object' || saved === null || !('turns' in saved)) {
    throw new Error('The local agent did not return the stored turn.');
  }
  const storedTurns = storedTurnSchema.array().parse(saved.turns);
  expect(storedTurns).toHaveLength(1);
  const stored = storedTurns[0];
  if (stored === undefined) throw new Error('The real agent did not store its turn.');
  expect(stored.id).toBe(done.turnId);
  expect(stored.usage).toMatchObject(done.usage);
  expect(stored.usage.perCall).toEqual(usages.map((event) => event.call));
  evidence(sessionId, 'stored', stored);
  evidence(sessionId, 'rendered-text', await browser.evaluate(() =>
    Array.from(document.querySelectorAll('textarea')).map((field) => ({
      label: field.getAttribute('aria-label'), value: field.value, disabled: field.disabled,
    })),
  ));
  await expect(screen.getByRole('textbox', /calls · ↑/, { disabled: true }).first()).toBeVisible();
  await expect(screen.getByText('Thinking…')).toHaveCount(0);
  await expect(screen.getByText('Writing…')).toHaveCount(0);
  await app.screenshot('real-agent-completed-turn');
  return { events, stored, done };
}

async function sendText({
  app, browser, screen, sessionId, text,
}: {
  app: App;
  browser: Browser;
  screen: Screen;
  sessionId: string;
  text: string;
}) {
  const input = screen.getByRole('textbox', 'Ask about the map…');
  await input.tap();
  await settleFlutterFocus(browser);
  await browser.keyboard.type(text);
  await expect(input).toHaveValue(text);
  const turnResponse = browser.waitForResponse(`${localAgent}/v1/sessions/${sessionId}/turns`, {
    timeout: 60_000,
  });
  await screen.getByRole('button', 'Send').tap();
  return readCompletedTurn({ app, browser, screen, sessionId, response: await turnResponse });
}

agentTest('real agent streams a greeting and preserves its conversation across tabs', {
  timeout: scenarioTimeout, tags: ['live-agent'],
}, async ({ app, browser, screen, localSession }) => {
  const { events, stored } = await sendText({
    app, browser, screen, sessionId: localSession, text: 'Hello!',
  });
  expect(events.filter((event) => ['status', 'card', 'question', 'ui_action'].includes(event.event))).toEqual([]);
  expect(stored.text.trim().length).toBeGreaterThan(0);
  expect(stored.text.length).toBeLessThan(500);
  const renderedTurn = screen.getByRole('textbox', /^Hello![\s\S]*calls · ↑/, { disabled: true }).first();
  await expect(renderedTurn).toBeVisible();
  await screen.getByRole('tab', 'Feed').tap();
  await expect(renderedTurn).toBeVisible();
  await screen.getByRole('tab', 'Settings').tap();
  await expect(renderedTurn).toBeVisible();
  await screen.getByRole('button', 'Close the agent chat').last().tap();
  await screen.getByRole('button', 'Open the agent chat').tap();
  await expect(renderedTurn).toBeVisible();
  await app.screenshot('real-agent-greeting-across-tabs');
});

agentTest('real show_layers action changes the visible map and its live query', {
  timeout: scenarioTimeout, tags: ['live-agent'],
}, async ({ app, browser, screen, localSession }) => {
  const viewportQueries: ViewportQuery[] = [];
  await browser.route('**/v1/map/viewport', async (route) => {
    if (route.request.method === 'POST' && route.request.postData !== undefined) {
      viewportQueries.push(viewportQuerySchema.parse(JSON.parse(route.request.postData)));
    }
    await route.continue();
  });
  const { events, stored } = await sendText({
    app, browser, screen, sessionId: localSession,
    text: 'Only show development projects on the map. Hide every other map layer.',
  });
  const actions = events.filter((event) => event.event === 'ui_action' && event.action === 'show_layers');
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ action: 'show_layers', args: { layers: ['planning'], mode: 'only' } });
  expect(stored.trace).toEqual(expect.arrayContaining([
    expect.objectContaining({ tool: 'show_layers', error: null }),
  ]));
  await expect(screen.getByRole('textbox', /\bapplied ·/, { disabled: true }).first()).toBeVisible();
  await waitForMapSettled(screen);
  await screen.getByRole('button', 'Close the agent chat').last().tap();
  await expect(screen.getByRole('checkbox', 'Development projects')).toBeChecked();
  for (const label of ['Pedestrian counts', 'Pedestrian anomalies', 'Transport disruptions', 'Events']) {
    await expect(screen.getByRole('checkbox', label)).not.toBeChecked();
  }
  await expect.poll(() => viewportQueries.some((query) => query.layers.length === 1 && query.layers[0] === 'planning'), {
    timeout: 30_000,
  }).toBe(true);
  await waitForMapSettled(screen);
  evidence(localSession, 'map-queries', viewportQueries);
  await app.screenshot('real-agent-planning-layer-applied');
});

agentTest('real area brief runs Gemini and renders recommendations with their sources', {
  timeout: scenarioTimeout, tags: ['live-agent'],
}, async ({ app, browser, screen, localSession }) => {
  const radius = 601 + Date.now() % 899;
  const { events, stored } = await sendText({
    app, browser, screen, sessionId: localSession,
    text: `Brief the area within ${radius} metres of latitude -37.8179, longitude 144.9690 in Melbourne. Use area_brief for this exact point and radius.`,
  });
  expect(events.filter((event) => event.event === 'usage' && event.call.agent === 'area_brief').length).toBeGreaterThan(0);
  expect(stored.trace).toEqual(expect.arrayContaining([
    expect.objectContaining({ tool: 'area_brief', error: null }),
  ]));
  const cardEvent = events.find((event) => event.event === 'card' && event.card.type === 'area_brief');
  if (cardEvent === undefined || cardEvent.event !== 'card') {
    throw new Error('The real area_brief workflow produced no sourced area card.');
  }
  expect(cardEvent.card.items.length).toBeGreaterThan(0);
  expect(stored.cards).toEqual(expect.arrayContaining([cardEvent.card]));
  await browser.setViewport({ width: 1440, height: 2200 });
  const item = cardEvent.card.items.at(-1);
  if (item === undefined) throw new Error('The area brief has no recommendation.');
  const sourceLabel = 'feature_id' in item.source
    ? `Source: map feature ${item.source.feature_id}`
    : `Source: ${item.source.title ?? new URL(item.source.url).host}`;
  const titlePattern = item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sourcePattern = sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const recommendation = screen.getByRole('button', new RegExp(`^${titlePattern}[\\s\\S]*${sourcePattern}`)).first();
  await recommendation.scrollIntoView();
  await expect(recommendation).toBeVisible();
  await expect(recommendation).toHaveAccessibleName(new RegExp(sourcePattern));
  await app.screenshot('real-agent-area-brief-with-source');
});
