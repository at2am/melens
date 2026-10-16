import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { eventViewSchema, type EventView } from '../../../cloud/agent/src/events/schemas.js';
import { verifyBuild } from './build-check.js';
import { localTargets, loopbackOrigin } from './local-targets.mjs';

const localAgent = localTargets.agent;
const developmentAuth = { Authorization: 'Bearer dev' };

function eventBody(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || !('event' in value)) {
    throw new Error('The local event service returned no event.');
  }
  return value.event;
}

const parseEvent = (value: unknown): EventView => eventViewSchema.parse(eventBody(value));

async function localRequest(path: string, method = 'GET'): Promise<Response> {
  return fetch(`${localAgent}${path}`, {
    method, headers: developmentAuth, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
}

async function requireDevelopmentService(): Promise<void> {
  const response = await localRequest('/v1/events/mine');
  // main.ts selects both the static dev-token verifier and the memory event
  // store from the same development flag. A production Firebase verifier rejects dev.
  expect(response.status, 'The local memory service must accept its development token.').toBe(200);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('owned' in body)) {
    throw new Error('The local event service returned no owned-event list.');
  }
  eventViewSchema.array().parse(body.owned);
}

function evidence(runId: string, name: string, value: unknown): void {
  const directory = join('.e2e', 'events-evidence');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${runId}-${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}

test('Feed hosts a real local event, shows its published details and cancels it', {
  timeout: 180_000, tags: ['live-events'],
}, async ({ app, browser, screen }) => {
  const manifest = await verifyBuild(app.baseUrl);
  expect(loopbackOrigin(app.baseUrl ?? '')).toBe(localTargets.live);
  expect(manifest).toMatchObject({ dataMode: 'live', agentBaseUrl: localAgent });
  await requireDevelopmentService();

  const runId = randomUUID();
  const title = `Melens local E2E ${runId}`;
  const description = 'Local browser verification. This event is removed after the test.';
  const placeName = 'Melbourne CBD local E2E';
  let created: EventView | null = null;
  let ownId: string | null = null;
  evidence(runId, 'build', manifest);
  try {
    await app.open('/');
    await expect(browser.locator('flt-semantics-placeholder')).toBeAttached();
    await browser.evaluate(() => {
      const activator = document.querySelector('flt-semantics-placeholder');
      if (activator instanceof HTMLElement) activator.click();
    return null;
    });
    await expect(screen.getByRole('tab', 'Feed')).toBeSelected();
    await screen.getByRole('button', 'Host an event').tap();
    await expect(screen.getByRole('tab', 'Discover')).toBeSelected();
    await expect(screen.getByText('Publish an event')).toBeVisible();

    for (const { label, value } of [{ label: 'Title', value: title },
      { label: 'Description', value: description }, { label: 'Place name (optional)', value: placeName }]) {
      const field = screen.getByRole('textbox', label);
      await field.tap();
      await field.pressSequentially(value);
      await expect(field).toHaveValue(value);
    }
    await screen.getByRole('button', 'Use map centre').scrollIntoView();
    await screen.getByRole('button', 'Use map centre').tap();
    const pin = screen.getByText(/^Pinned at -?\d+\.\d+, -?\d+\.\d+$/);
    await expect(pin).toBeVisible();
    const coordinates = /^Pinned at (-?\d+\.\d+), (-?\d+\.\d+)$/.exec(await pin.textContent() ?? '');
    if (coordinates === null) throw new Error('The event form does not show its selected coordinates.');
    await screen.getByRole('button', 'Publish', { exact: true }).scrollIntoView();
    const publication = browser.waitForResponse(`${localAgent}/v1/events`, { timeout: 30_000 });
    await screen.getByRole('button', 'Publish', { exact: true }).tap();
    const response = await publication;
    expect(response.status).toBe(201);
    const publishedBody: unknown = await response.json();
    const identity = eventViewSchema.pick({ id: true, title: true, viewer: true }).strip().parse(eventBody(publishedBody));
    expect(identity).toMatchObject({ title, viewer: { isOwner: true } });
    ownId = identity.id;
    created = parseEvent(publishedBody);
    expect(created).toMatchObject({ title, description, placeName, status: 'published',
      viewer: { isOwner: true, joined: false }, attendeeCount: 0, timezone: 'Australia/Melbourne' });
    expect(created.point.lat).toBeCloseTo(Number(coordinates[1]), 5);
    expect(created.point.lng).toBeCloseTo(Number(coordinates[2]), 5);
    evidence(runId, 'published', { responseUrl: response.url, status: response.status, event: created });

    await expect(screen.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(screen.getByRole('checkbox', 'Yours', { exact: true })).toBeVisible();
    await expect(screen.getByText(placeName, { exact: true })).toBeVisible();
    await expect(screen.getByText(description, { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', 'Edit', { exact: true })).toBeVisible();
    await app.screenshot('local-user-event-published-details');

    await screen.getByRole('button', 'Cancel event', { exact: true }).scrollIntoView();
    await screen.getByRole('button', 'Cancel event', { exact: true }).tap();
    const dialog = screen.getByRole('alertdialog');
    await expect(dialog.getByText('Cancel this event?')).toBeVisible();
    const cancellation = browser.waitForResponse(`${localAgent}/v1/events/${created.id}/cancel`, { timeout: 30_000 });
    await dialog.getByRole('button', 'Cancel event', { exact: true }).tap();
    const cancelledResponse = await cancellation;
    expect(cancelledResponse.status).toBe(200);
    const cancelled = parseEvent(await cancelledResponse.json());
    expect(cancelled).toMatchObject({ id: created.id, title, status: 'cancelled', viewer: { isOwner: true } });
    evidence(runId, 'cancelled', cancelled);
    await expect(screen.getByRole('checkbox', 'Cancelled', { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', 'Cancel event', { exact: true })).toHaveCount(0);
    await app.screenshot('local-user-event-cancelled-details');
  } finally {
    if (ownId !== null) {
      const path = `/v1/events/${encodeURIComponent(ownId)}`;
      let cancelledStatus: number | null = null;
      try {
        const cancelled = await localRequest(`${path}/cancel`, 'POST');
        cancelledStatus = cancelled.status;
        expect(cancelled.status).toBe(200);
        expect(parseEvent(await cancelled.json())).toMatchObject({ id: ownId, title, status: 'cancelled',
          viewer: { isOwner: true } });
      } finally {
        const removed = await localRequest(path, 'DELETE');
        expect(removed.status).toBe(204);
        const absent = await localRequest(path);
        expect(absent.status).toBe(404);
        evidence(runId, 'cleanup', { id: ownId, title, cancelledStatus,
          removedStatus: removed.status, readAfterRemovalStatus: absent.status });
      }
    }
  }
});
