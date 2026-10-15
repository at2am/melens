import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput } from '../../src/core/connector.js';
import { parseSourceManifest } from '../../src/core/registry.js';
import { ATTRIBUTION, SOURCE_ID, UserEventsConnector, normalizeUserEvents, userEventDocumentSchema,
  type UserEventReader } from '../../src/connectors/user_events/index.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';

const input = parseConnectorInput({
  sourceId: SOURCE_ID,
  window: { kind: 'time', from: '2026-10-10T02:00:00Z', to: '2026-10-10T02:05:00Z' },
  checkpoint: null,
  runId: 'user-events-fixture',
});
const fetchedAt = '2026-10-10T02:05:10.000Z';

/** A Firestore document as the agent service writes it, owner and attendee uids included. */
const document = {
  id: 'ue_k3QmX9aB2cD4eF6g', ownerUid: 'firebase-uid-owner', title: 'Sunset run along the Yarra',
  description: 'Easy 5 km, all paces welcome.', point: { lat: -37.8206, lng: 144.9775 }, placeName: 'Boathouse Drive steps',
  startAt: '2026-10-12T07:00:00.000Z', endAt: '2026-10-12T08:00:00.000Z', timezone: 'Australia/Melbourne',
  anonymousAttendance: true, capacity: 20, status: 'published', visibility: 'visible',
  attendeeUids: ['firebase-uid-sam', 'firebase-uid-kim'], createdAt: '2026-10-10T02:01:00.000Z',
  updatedAt: '2026-10-10T02:03:00.000Z', version: 3, activeUntil: '2026-10-12T08:00:00.000Z',
  expiresAtTs: { seconds: 1776000000, nanoseconds: 0 },
};

test('a user event becomes one planned event version with a JSON summary and no uid anywhere', () => {
  const result = normalizeUserEvents([document], input, fetchedAt);
  assert.equal(result.rejected, 0);
  assert.equal(result.latestUpdateAt, document.updatedAt);
  assert.equal(result.geoRecords.length, 1);
  const geo = result.geoRecords[0]!;
  assert.equal(geo.geo_record_id, 'user.events:ue_k3QmX9aB2cD4eF6g');
  assert.equal(geo.topic, 'event');
  assert.equal(geo.assertion_kind, 'plan');
  assert.equal(geo.record_status, 'planned');
  assert.equal(geo.location_role, 'event_site');
  assert.equal(geo.location_confidence, 'source_coordinate', 'the publisher placed the pin');
  assert.equal(geo.original_url, 'https://melens-510012.web.app/events/ue_k3QmX9aB2cD4eF6g', 'the app page is the provenance');
  assert.equal(result.sourceRecords[0]?.original_url, geo.original_url);
  assert.equal(normalizeUserEvents([document], input, fetchedAt, { appBaseUrl: 'https://example.test/' }).geoRecords[0]?.original_url,
    'https://example.test/events/ue_k3QmX9aB2cD4eF6g');
  assert.equal(geo.valid_from, document.startAt);
  assert.equal(geo.valid_to, document.endAt);
  assert.equal(geo.published_at, document.createdAt);
  assert.equal(geo.source_version_ordinal, 3);
  assert.equal(geo.public_query_allowed, true);
  assert.equal(geo.rights_status, 'restricted');
  assert.deepEqual(JSON.parse(geo.summary!), { description: document.description, placeName: document.placeName, attendeeCount: 2, anonymousAttendance: true });
  assert.deepEqual(JSON.parse(geo.geometry_geojson!), { type: 'Point', coordinates: [144.9775, -37.8206] });
  const everything = JSON.stringify(result);
  assert.ok(!everything.includes('firebase-uid'), 'no owner or attendee uid leaves Firestore');
  assert.ok(!everything.includes('ownerUid'));
  result.sourceRecords.forEach((row) => assert.deepEqual(parseSourceRecord(row), row));
  result.geoRecords.forEach((row) => assert.equal(validateGeoRecordGeography(row).valid, true));
  assert.equal(result.geoRecordSources[0]?.evidence_role, 'user_event');
  assert.equal(result.geoRecordSources[0]?.version_id, geo.version_id);
});

test('status and visibility map to the record status; a change of attendance is a new version', () => {
  const base = normalizeUserEvents([document], input, fetchedAt).geoRecords[0]!;
  const started = normalizeUserEvents([document], input, '2026-10-12T07:30:00.000Z').geoRecords[0]!;
  assert.equal(started.record_status, 'active');
  assert.equal(started.version_id, base.version_id, 'the clock does not change the content version');
  const cancelled = normalizeUserEvents([{ ...document, status: 'cancelled', version: 4, updatedAt: '2026-10-10T02:04:00.000Z' }], input, fetchedAt);
  assert.equal(cancelled.geoRecords[0]?.record_status, 'cancelled');
  assert.equal(cancelled.sourceRecords[0]?.record_status, 'cancelled');
  assert.notEqual(cancelled.geoRecords[0]?.version_id, base.version_id);
  const removed = normalizeUserEvents([{ ...document, status: 'removed', version: 5 }], input, fetchedAt);
  assert.equal(removed.geoRecords[0]?.record_status, 'withdrawn');
  assert.equal(removed.sourceRecords[0]?.record_status, 'withdrawn');
  const hidden = normalizeUserEvents([{ ...document, visibility: 'hidden' }], input, fetchedAt);
  assert.equal(hidden.geoRecords[0]?.record_status, 'withdrawn');
  const joined = normalizeUserEvents([{ ...document, attendeeUids: [...document.attendeeUids, 'firebase-uid-lee'], version: 4 }], input, fetchedAt);
  assert.notEqual(joined.geoRecords[0]?.version_id, base.version_id);
  assert.equal(JSON.parse(joined.geoRecords[0]!.summary!).attendeeCount, 3);
  const open = normalizeUserEvents([{ ...document, endAt: null, placeName: null, capacity: null, attendeeUids: [] }], input, fetchedAt);
  assert.equal(open.geoRecords[0]?.valid_to, null);
  assert.deepEqual(JSON.parse(open.geoRecords[0]!.summary!), { description: document.description, placeName: null, attendeeCount: 0, anonymousAttendance: true });
});

test('malformed, duplicate, out-of-area and reversed documents are rejected, never published', () => {
  const result = normalizeUserEvents([
    document,
    document,
    { ...document, id: 'ue_outside', point: { lat: 51.5, lng: -0.12 } },
    { ...document, id: 'ue_reversed', endAt: '2026-10-12T06:00:00.000Z' },
    { ...document, id: 'not-an-event-id' },
    { ...document, id: 'ue_notime', startAt: 'tomorrow' },
    { ...document, id: 'ue_zone', timezone: 'Europe/London' },
    'garbage',
  ], input, fetchedAt);
  assert.equal(result.geoRecords.length, 1);
  assert.equal(result.rejected, 7);
  const parsed = userEventDocumentSchema.parse(document);
  assert.ok(!('ownerUid' in parsed));
  assert.ok(!('attendeeUids' in parsed));
  assert.equal(parsed.attendeeCount, 2);
});

test('the connector exports a time window from its reader, checkpoints at the window end and refuses snapshots', async () => {
  const windows: { from: string; to: string }[] = [];
  const reader: UserEventReader = { async listUpdated(window) { windows.push({ from: window.from, to: window.to }); return [document, 'garbage']; } };
  const connector = new UserEventsConnector(() => reader, () => fetchedAt);
  const result = await connector.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;
  assert.deepEqual(windows, [{ from: '2026-10-10T02:00:00Z', to: '2026-10-10T02:05:00Z' }]);
  assert.equal(result.checkpointAfter, '2026-10-10T02:05:00Z');
  assert.equal(result.sourceLatestUpdateAt, document.updatedAt);
  assert.deepEqual([result.inputCount, result.outputCount, result.rejectedCount], [2, 1, 1]);
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.method, 'export_count');
  assert.equal(result.retainableRawRecords, null);
  assert.equal(result.fetchedAt, fetchedAt);
  const again = await connector.collect(input);
  assert.equal(again.kind === 'success' && again.sourceRevision, result.sourceRevision, 'the same window yields the same revision');

  const snapshot = await connector.collect(parseConnectorInput({ ...input, window: { kind: 'snapshot', revision: 'latest' } }));
  assert.equal(snapshot.kind === 'failure' && snapshot.code, 'validation_failed');
  const wrong = await connector.collect(parseConnectorInput({ ...input, sourceId: 'ticketmaster.events' }));
  assert.equal(wrong.kind === 'failure' && wrong.code, 'validation_failed');
  const unconfigured = await new UserEventsConnector(() => null, () => fetchedAt).collect(input);
  assert.equal(unconfigured.kind === 'failure' && unconfigured.code, 'auth_failed');
  const broken: UserEventReader = { async listUpdated() { throw new Error('offline'); } };
  const down = await new UserEventsConnector(() => broken, () => fetchedAt).collect(input);
  assert.equal(down.kind === 'failure' && down.code, 'upstream_unavailable');
  assert.ok(down.kind === 'failure' && !down.message.includes('offline'));
});

test('the manifest is complete, restricted and not yet active, with no secret', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../src/connectors/user_events/source.json', import.meta.url), 'utf8'));
  const source = parseSourceManifest(manifest);
  assert.equal(source.source_id, SOURCE_ID);
  assert.equal(source.topic, 'event');
  assert.deepEqual(source.admission_evidence.missing_requirements, []);
  assert.equal(source.license_status, 'restricted');
  assert.equal(source.access_status, 'ready');
  assert.deepEqual(source.admission_evidence.secret_names, []);
  assert.equal(manifest.retention_policy.attribution, ATTRIBUTION);
});
