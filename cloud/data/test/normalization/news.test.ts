import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import type { GdeltLocationMention } from '../../src/connectors/gdelt/index.js';
import { parseLocationMentions } from '../../src/connectors/gdelt/index.js';
import type { NewsEvidence } from '../../src/normalization/news-dedup.js';
import { canonicalArticleUrl, groupNewsEvidence } from '../../src/normalization/news-dedup.js';
import {
  classifyGdeltMentions,
  classifyReportedIncidentSite,
  isOverseasSameName,
  resolveAreaScope,
  resolveNewsScope,
} from '../../src/normalization/news-location.js';

const melbourne = {
  scheme: 'ASGS_LGA',
  code: '24600',
  vintage: '2025',
  boundaryId: 'ASGS_LGA:24600:2025',
  name: 'Melbourne',
};
const comMunicipal = {
  scheme: 'com_municipal',
  code: '1',
  vintage: '2025',
  boundaryId: 'com_municipal:1:2025',
  name: 'City of Melbourne',
};
const greaterMelbourne = {
  scheme: 'ASGS_GCCSA',
  code: '2GMEL',
  vintage: '2026',
  boundaryId: 'ASGS_GCCSA:2GMEL:2026',
  name: 'Greater Melbourne',
};
const victoria = {
  scheme: 'ASGS_STE',
  code: '2',
  vintage: '2026',
  boundaryId: 'ASGS_STE:2:2026',
  name: 'Victoria',
};

test('GDELT place mentions never become an incident point and resolve official scopes', () => {
  const vicMention = { name: 'Melbourne', countryCode: 'AS', adm1Code: 'AS07', featureId: null };
  const classified = classifyGdeltMentions([vicMention], [melbourne, victoria]);
  assert.equal(classified.locationRole, 'mentioned_place');
  assert.equal(classified.locationConfidence, 'unverified');
  assert.equal(classified.geometryGeojson, null);
  assert.deepEqual(classified.areaRefs, [melbourne.boundaryId]);
  assert.equal(classified.scope, 'city');
  assert.equal(classified.reason, 'official_place_mention');

  // Ambiguous overseas same-name collision (Melbourne FL vs Melbourne VIC)
  const ambiguous = classifyGdeltMentions(
    [
      vicMention,
      { name: 'Melbourne', countryCode: 'US', adm1Code: 'USFL', featureId: null },
    ],
    [melbourne]
  );
  assert.equal(ambiguous.locationRole, 'unknown');
  assert.equal(ambiguous.locationConfidence, 'unverified');
  assert.equal(ambiguous.geometryGeojson, null);
  assert.deepEqual(ambiguous.areaRefs, []);
  assert.equal(ambiguous.scope, 'unknown');
  assert.equal(ambiguous.reason, 'ambiguous_same_name');
});

test('identifies City of Melbourne, Greater Melbourne, Victoria, and overseas same-name places', () => {
  const allOfficialAreas = [melbourne, comMunicipal, greaterMelbourne, victoria];

  // 1. City of Melbourne
  const cityMention = {
    name: 'City of Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const cityResult = classifyGdeltMentions([cityMention], allOfficialAreas);
  assert.equal(cityResult.locationRole, 'mentioned_place');
  assert.equal(cityResult.geometryGeojson, null);
  assert.equal(cityResult.scope, 'city');
  assert.ok(cityResult.areaRefs.length > 0);

  // 2. Greater Melbourne
  const greaterMention = {
    name: 'Greater Melbourne, Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const greaterResult = classifyGdeltMentions([greaterMention], [greaterMelbourne, victoria]);
  assert.equal(greaterResult.locationRole, 'mentioned_place');
  assert.equal(greaterResult.geometryGeojson, null);
  assert.equal(greaterResult.scope, 'greater_melbourne');
  assert.deepEqual(greaterResult.areaRefs, [greaterMelbourne.boundaryId]);

  // 3. Victoria State
  const stateMention = {
    name: 'Victoria, Australia',
    countryCode: 'AS',
    adm1Code: 'AS07',
    featureId: null,
  };
  const stateResult = classifyGdeltMentions([stateMention], [greaterMelbourne, victoria]);
  assert.equal(stateResult.locationRole, 'mentioned_place');
  assert.equal(stateResult.geometryGeojson, null);
  assert.equal(stateResult.scope, 'victoria');
  assert.deepEqual(stateResult.areaRefs, [victoria.boundaryId]);

  // 4. Overseas same-name alone (Melbourne, Florida)
  const floridaMention = {
    name: 'Melbourne, Florida, United States',
    countryCode: 'US',
    adm1Code: 'USFL',
    featureId: null,
  };
  const overseasResult = classifyGdeltMentions([floridaMention], allOfficialAreas);
  assert.equal(overseasResult.locationRole, 'unknown');
  assert.equal(overseasResult.geometryGeojson, null);
  assert.deepEqual(overseasResult.areaRefs, []);
  assert.equal(overseasResult.scope, 'unknown');
  assert.equal(overseasResult.reason, 'overseas_same_name');

  // 5. Co-occurrence with non-conflicting overseas city (e.g. Melbourne VIC + London UK)
  const londonMention = {
    name: 'London, United Kingdom',
    countryCode: 'UK',
    adm1Code: 'UKGL',
    featureId: null,
  };
  const coOccurResult = classifyGdeltMentions([cityMention, londonMention], [melbourne]);
  assert.equal(coOccurResult.locationRole, 'mentioned_place');
  assert.equal(coOccurResult.geometryGeojson, null);
  assert.equal(coOccurResult.scope, 'city');
  assert.deepEqual(coOccurResult.areaRefs, [melbourne.boundaryId]);
  assert.equal(coOccurResult.reason, 'official_place_mention');

  // 6. Multi-location mentions in Victoria: Melbourne + Victoria
  const multiResult = classifyGdeltMentions(
    [
      { name: 'Melbourne, Victoria, Australia', countryCode: 'AS', adm1Code: 'AS07', featureId: null },
      { name: 'Victoria, Australia', countryCode: 'AS', adm1Code: 'AS07', featureId: null },
    ],
    [melbourne, victoria]
  );
  assert.equal(multiResult.locationRole, 'mentioned_place');
  assert.equal(multiResult.geometryGeojson, null);
  assert.deepEqual(multiResult.areaRefs, [melbourne.boundaryId, victoria.boundaryId]);
  assert.equal(multiResult.scope, 'city');
});

test('explicit occurrence area stays coarse and an invalid or unverified point is quarantined', () => {
  const base = {
    sourceExplicitlySaysIncidentSite: true,
    officialArea: melbourne,
    sourceCoordinate: null,
    coordinateVerifiedInsideArea: false,
  };

  // Coarse area only: no point invented, no polygon centroid
  const coarse = classifyReportedIncidentSite(base);
  assert.equal(coarse.locationRole, 'area_only');
  assert.equal(coarse.locationConfidence, 'resolved_area');
  assert.equal(coarse.geometryGeojson, null);
  assert.deepEqual(coarse.areaRefs, [melbourne.boundaryId]);
  assert.equal(coarse.scope, 'city');
  assert.equal(coarse.reason, 'source_event_area');

  // Invalid coordinates: out of range or non-finite quarantined
  assert.equal(
    classifyReportedIncidentSite({ ...base, sourceCoordinate: [190, -37] }).reason,
    'invalid_event_point'
  );
  assert.equal(
    classifyReportedIncidentSite({ ...base, sourceCoordinate: [-190, -37] }).locationRole,
    'unknown'
  );
  assert.equal(
    classifyReportedIncidentSite({ ...base, sourceCoordinate: [144.96, 95] }).reason,
    'invalid_event_point'
  );
  assert.equal(
    classifyReportedIncidentSite({ ...base, sourceCoordinate: [Number.NaN, -37] }).reason,
    'invalid_event_point'
  );

  // Coordinate not verified inside area: quarantined
  const unverifiedPoint = classifyReportedIncidentSite({
    ...base,
    sourceCoordinate: [144.96, -37.81],
  });
  assert.equal(unverifiedPoint.locationRole, 'unknown');
  assert.equal(unverifiedPoint.geometryGeojson, null);
  assert.equal(unverifiedPoint.reason, 'coordinate_outside_area');

  // Verified point inside official boundary vintage
  const point = classifyReportedIncidentSite({
    ...base,
    sourceCoordinate: [144.96, -37.81],
    coordinateVerifiedInsideArea: true,
  });
  assert.equal(point.locationRole, 'event_site');
  assert.equal(point.locationConfidence, 'source_coordinate');
  assert.equal(point.scope, 'city');
  assert.equal(point.reason, 'source_event_point');
  assert.equal(JSON.parse(point.geometryGeojson ?? '{}').type, 'Point');
  assert.deepEqual(JSON.parse(point.geometryGeojson ?? '{}').coordinates, [144.96, -37.81]);

  // Non-incident or missing official area remains unknown
  assert.equal(
    classifyReportedIncidentSite({
      ...base,
      sourceExplicitlySaysIncidentSite: false,
    }).locationRole,
    'unknown'
  );
  assert.equal(
    classifyReportedIncidentSite({
      ...base,
      officialArea: null,
    }).locationRole,
    'unknown'
  );
});

test('verifies GDELT fixture rows against overseas disambiguation and mention rules', async () => {
  const fixtureUrl = new URL('../fixtures/gdelt.json', import.meta.url);
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as {
    rows: Array<{ gkg_record_id: string; v2_locations: string }>;
  };

  // Row 1: 20260928184500-101 has both Melbourne VIC and Melbourne FL
  const row1Mentions = parseLocationMentions(fixture.rows[0]!.v2_locations);
  const row1Result = classifyGdeltMentions(row1Mentions, [melbourne, victoria]);
  assert.equal(row1Result.locationRole, 'unknown');
  assert.equal(row1Result.reason, 'ambiguous_same_name');
  assert.equal(row1Result.geometryGeojson, null);
  assert.deepEqual(row1Result.areaRefs, []);

  // Row 2: 20260928184500-102 has only Melbourne FL
  const row2Mentions = parseLocationMentions(fixture.rows[1]!.v2_locations);
  const row2Result = classifyGdeltMentions(row2Mentions, [melbourne, victoria]);
  assert.equal(row2Result.locationRole, 'unknown');
  assert.equal(row2Result.reason, 'overseas_same_name');
  assert.equal(row2Result.geometryGeojson, null);
  assert.deepEqual(row2Result.areaRefs, []);
});

test('helper functions resolveAreaScope and isOverseasSameName operate correctly', () => {
  assert.equal(resolveAreaScope(melbourne), 'city');
  assert.equal(resolveAreaScope(comMunicipal), 'city');
  assert.equal(resolveAreaScope(greaterMelbourne), 'greater_melbourne');
  assert.equal(resolveAreaScope(victoria), 'victoria');
  assert.equal(
    resolveNewsScope([melbourne, greaterMelbourne, victoria]),
    'city'
  );
  assert.equal(resolveNewsScope([greaterMelbourne, victoria]), 'greater_melbourne');
  assert.equal(resolveNewsScope([victoria]), 'victoria');
  assert.equal(resolveNewsScope([]), 'unknown');

  assert.equal(
    isOverseasSameName({ name: 'Melbourne, Florida', countryCode: 'US', adm1Code: 'USFL', featureId: null }),
    true
  );
  assert.equal(
    isOverseasSameName({ name: 'Melbourne', countryCode: 'AS', adm1Code: 'AS07', featureId: null }),
    false
  );
  assert.equal(
    isOverseasSameName({ name: 'London', countryCode: 'UK', adm1Code: 'UKGL', featureId: null }),
    false
  );
});

const first: NewsEvidence = {
  sourceId: 'news.a', sourceRecordId: 'a1', versionId: 'v1', nativeEventId: 'native-a',
  originalUrl: 'https://news.example/a?utm_source=x', eventType: 'robbery',
  occurredAt: '2026-09-28T01:00:00Z', incidentAreaRef: melbourne.boundaryId,
  locationPrecision: 'local_area', sourceUpdatedAt: '2026-09-28T02:00:00Z',
  sourceVersionOrdinal: null, recordStatus: 'active',
};
const second: NewsEvidence = {
  ...first, sourceId: 'news.b', sourceRecordId: 'b1', nativeEventId: 'native-b',
  originalUrl: 'https://other.example/2', occurredAt: '2026-09-28T01:30:00Z',
};

test('cross-source merge needs two independent occurrence signals and retains all links', () => {
  const groups = groupNewsEvidence([first, second]);
  assert.equal(groups.groups.length, 1);
  assert.equal(groups.groups[0]?.allVersions.length, 2);
  assert.equal(groups.groups[0]?.originalUrls.length, 2);
  assert.equal(canonicalArticleUrl(first.originalUrl), 'https://news.example/a');
  assert.equal(groupNewsEvidence([second, first]).groups[0]?.eventId, groups.groups[0]?.eventId);
  const uncertain = groupNewsEvidence([first, { ...second, occurredAt: null, eventType: null }]);
  assert.equal(uncertain.groups.length, 2);
  assert.equal(uncertain.reviewPairs.length, 1);
});

test('conflicting occurrence evidence remains separate; correction keeps history', () => {
  assert.equal(groupNewsEvidence([first, { ...second, eventType: 'fire' }]).groups.length, 2);
  const corrected: NewsEvidence = { ...first, versionId: 'v2',
    sourceUpdatedAt: '2026-09-28T03:00:00Z', recordStatus: 'withdrawn' };
  const group = groupNewsEvidence([first, corrected]).groups[0];
  assert.equal(group?.allVersions.length, 2);
  assert.deepEqual(group?.currentVersions, []);
});
