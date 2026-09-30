import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient } from '../../src/core/http.js';
import { TicketmasterConnector, geohash, normalizeTicketEvents,
  parseTicketPage } from '../../src/connectors/ticketmaster/index.js';

const input = parseConnectorInput({ sourceId: 'ticketmaster.events',
  window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-03T00:00:00Z' },
  checkpoint: null, runId: 'ticketmaster-fixture' });
const fetchedAt = '2026-09-28T00:00:00Z';

async function fixture() {
  return parseTicketPage(JSON.parse(await readFile(
    new URL('../fixtures/ticketmaster.json', import.meta.url), 'utf8')));
}

test('event versions keep venue evidence and postpone without inventing a start time', async () => {
  const page = await fixture();
  const result = normalizeTicketEvents(page._embedded?.events ?? [], input, fetchedAt);
  assert.equal(result.geoRecords.length, 2);
  assert.equal(result.geoRecords[0]?.location_confidence, 'source_coordinate');
  assert.equal(result.geoRecords[0]?.valid_from, '2026-10-01T09:00:00.000Z');
  assert.equal(result.geoRecords[0]?.valid_to, '2026-10-01T09:00:00.000Z');
  assert.equal(result.geoRecords[1]?.valid_from, null);
  assert.equal(result.geoRecords[1]?.summary?.includes('postponed'), true);
  assert.equal(result.geoRecords[0]?.public_query_allowed, false);

  const original = page._embedded?.events?.[0];
  assert.ok(original);
  const cancelled = { ...original, dates: { ...original.dates,
    status: { code: 'canceled' } } };
  const changed = normalizeTicketEvents([cancelled], input, fetchedAt);
  assert.equal(changed.geoRecords[0]?.record_status, 'cancelled');
  assert.notEqual(changed.geoRecords[0]?.version_id, result.geoRecords[0]?.version_id);
});

test('Discovery search uses Melbourne geohash, Australian filter and bounded event window', async () => {
  const page = await fixture();
  const requested: URL[] = [];
  class FixtureClient extends HttpClient {
    override async getJson(request: { url: URL }) {
      requested.push(request.url);
      return { body: page, status: 200, fetchedAt, etag: null,
        lastModified: null, contentType: 'application/json' };
    }
  }
  const connector = new TicketmasterConnector(new FixtureClient(), () => 'fixture-key');
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  assert.equal(requested.length, 1);
  assert.equal(requested[0]?.searchParams.get('countryCode'), 'AU');
  assert.equal(requested[0]?.searchParams.get('stateCode'), 'VIC');
  assert.equal(requested[0]?.searchParams.get('geoPoint'), geohash(-37.8136, 144.9631));
  assert.equal(requested[0]?.searchParams.get('startDateTime'), input.window.kind === 'time'
    ? input.window.from : null);
  const withoutKey = await new TicketmasterConnector(new FixtureClient(), () => undefined)
    .collect(input);
  assert.equal(withoutKey.kind, 'failure');
  if (withoutKey.kind === 'failure') assert.equal(withoutKey.code, 'auth_failed');
});
