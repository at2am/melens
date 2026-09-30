import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { NewsEvidence } from '../../src/normalization/news-dedup.js';
import {
  buildNewsGeoRecordSources,
  canonicalArticleUrl,
  groupNewsEvidence,
  pairDecision,
} from '../../src/normalization/news-dedup.js';

const melbourneCBD = 'ASGS_LGA:24600:2025';
const geelongLGA = 'ASGS_LGA:22830:2025';
const flindersStationSite = 'site:flinders_st_station:2025';
const southernCrossSite = 'site:southern_cross_station:2025';
const victoriaState = 'ASGS_STE:2:2026';
const nswState = 'ASGS_STE:1:2026';

const baseEvidence: NewsEvidence = {
  sourceId: 'news.the_age',
  sourceRecordId: 'age-001',
  versionId: 'v1',
  nativeEventId: 'event-age-100',
  originalUrl: 'https://theage.com.au/national/victoria/flinders-incident?utm_source=twitter&utm_medium=social#overview',
  eventType: 'robbery',
  occurredAt: '2026-09-28T01:00:00Z',
  incidentAreaRef: melbourneCBD,
  locationPrecision: 'local_area',
  sourceUpdatedAt: '2026-09-28T02:00:00Z',
  sourceVersionOrdinal: 1,
  recordStatus: 'active',
  batchId: 'batch_age_test_01',
  fetchedAt: '2026-09-28T02:00:00Z',
};

test('URL canonicalization strips tracking tags, fragments, and normalizes paths', () => {
  // Strips UTM tags and hashes
  assert.equal(
    canonicalArticleUrl('https://example.com/news/article?utm_source=rss&utm_campaign=daily#comments'),
    'https://example.com/news/article'
  );
  // Strips click identifiers: fbclid, gclid, mc_cid, mc_eid
  assert.equal(
    canonicalArticleUrl('https://example.com/story/?fbclid=abc1234&gclid=xyz5678&mc_cid=99&mc_eid=88'),
    'https://example.com/story'
  );
  // Sorts search params deterministically
  assert.equal(
    canonicalArticleUrl('https://example.com/search?z=3&a=1&m=2'),
    'https://example.com/search?a=1&m=2&z=3'
  );
  // Preserves root path single slash
  assert.equal(canonicalArticleUrl('https://example.com/'), 'https://example.com/');
  // Enforces HTTP/HTTPS protocol
  assert.throws(() => canonicalArticleUrl('ftp://example.com/file'), /HTTP\(S\)/);
  assert.throws(() => canonicalArticleUrl('invalid-url-string'), /Invalid article URL/);
});

test('Multi-source grouping combines 3 independent news feeds into one logical event and preserves GeoRecordSources', () => {
  const sourceA: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.the_age',
    sourceRecordId: 'age-101',
    originalUrl: 'https://theage.com.au/news/incident?utm_source=fb',
    occurredAt: '2026-09-28T01:00:00Z',
  };
  const sourceB: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'herald-202',
    nativeEventId: 'hs-report-202',
    originalUrl: 'https://heraldsun.com.au/vic/incident?fbclid=track',
    occurredAt: '2026-09-28T01:15:00Z', // 15 mins later (<= 1 hour)
  };
  const sourceC: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'vic.police.news',
    sourceRecordId: 'vicpol-303',
    nativeEventId: 'VICPOL-2026-8888',
    originalUrl: 'https://police.vic.gov.au/media-release/flinders-robbery',
    occurredAt: '2026-09-28T01:05:00Z',
  };

  const result = groupNewsEvidence([sourceA, sourceB, sourceC]);
  assert.equal(result.groups.length, 1);
  const group = result.groups[0]!;

  // All 3 sources merged into the single event
  assert.equal(group.allVersions.length, 3);
  assert.equal(group.currentVersions.length, 3);
  assert.equal(group.originalUrls.length, 3);
  assert.ok(group.originalUrls.includes(sourceA.originalUrl));
  assert.ok(group.originalUrls.includes(sourceB.originalUrl));
  assert.ok(group.originalUrls.includes(sourceC.originalUrl));
  assert.equal(group.requiresReview, false);

  // GeoRecordSource records are preserved for every version
  assert.equal(group.geoRecordSources.length, 3);
  for (const src of group.geoRecordSources) {
    assert.equal(src.geo_record_id, group.eventId);
    assert.ok(['age-101', 'herald-202', 'vicpol-303'].includes(src.source_record_id));
    assert.ok(src.original_url !== null);
  }

  // Order invariance: permutation yields the identical deterministic eventId
  const permuted = groupNewsEvidence([sourceC, sourceA, sourceB]);
  assert.equal(permuted.groups[0]?.eventId, group.eventId);
});

test('Two-fact rule: cross-source merge requires two independent matching facts', () => {
  const policeReport: NewsEvidence = {
    sourceId: 'vic.police.news',
    sourceRecordId: 'pol-01',
    versionId: 'v1',
    nativeEventId: 'VICPOL-999',
    originalUrl: 'https://police.vic.gov.au/incident-999',
    eventType: 'assault',
    occurredAt: '2026-09-28T02:00:00Z',
    incidentAreaRef: flindersStationSite,
    locationPrecision: 'site',
    sourceUpdatedAt: '2026-09-28T03:00:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };

  // 1. Time match + Site match (date/time match AND matching incident site) -> merges
  const ageArticle: NewsEvidence = {
    sourceId: 'news.the_age',
    sourceRecordId: 'age-01',
    versionId: 'v1',
    nativeEventId: 'age-story-1',
    originalUrl: 'https://theage.com.au/flinders-assault',
    eventType: null, // eventType unspecified
    occurredAt: '2026-09-28T02:20:00Z', // 20 min difference (within 1 hr window)
    incidentAreaRef: flindersStationSite, // exact same site
    locationPrecision: 'site',
    sourceUpdatedAt: '2026-09-28T04:00:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };
  assert.equal(pairDecision(policeReport, ageArticle), 'merge');
  const groupTimeAndSite = groupNewsEvidence([policeReport, ageArticle]);
  assert.equal(groupTimeAndSite.groups.length, 1);

  // 2. Time match + Event type match -> merges
  const guardianArticle: NewsEvidence = {
    sourceId: 'news.guardian',
    sourceRecordId: 'gn-01',
    versionId: 'v1',
    nativeEventId: null,
    originalUrl: 'https://theguardian.com/australia-news/assault-cbd',
    eventType: 'assault',
    occurredAt: '2026-09-28T02:15:00Z',
    incidentAreaRef: null,
    locationPrecision: 'unknown',
    sourceUpdatedAt: '2026-09-28T03:45:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };
  assert.equal(pairDecision(policeReport, guardianArticle), 'merge');
  const groupTimeAndType = groupNewsEvidence([policeReport, guardianArticle]);
  assert.equal(groupTimeAndType.groups.length, 1);

  // 3. Incident site + Event type match (without time) -> merges
  const datelessCitation: NewsEvidence = {
    ...policeReport,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'hs-citation',
    originalUrl: 'https://heraldsun.com.au/flinders-followup',
    occurredAt: null, // occurrence time missing in this brief
    nativeEventId: 'hs-citation-different-id',
    incidentAreaRef: flindersStationSite,
    eventType: 'assault',
  };
  assert.equal(pairDecision(policeReport, datelessCitation), 'merge');
  const groupSiteAndType = groupNewsEvidence([policeReport, datelessCitation]);
  assert.equal(groupSiteAndType.groups.length, 1);

  // 4. INSUFFICIENT EVIDENCE: Time match only (even if nativeEventId happens to match across sources, G06)
  const abcArticle: NewsEvidence = {
    sourceId: 'news.abc',
    sourceRecordId: 'abc-01',
    versionId: 'v1',
    nativeEventId: 'VICPOL-999', // Independent publisher citing/coinciding on ID
    originalUrl: 'https://abc.net.au/news/vic-incident',
    eventType: null, // no event type match
    occurredAt: '2026-09-28T02:10:00Z', // time matches
    incidentAreaRef: null, // location not verified
    locationPrecision: 'unknown',
    sourceUpdatedAt: '2026-09-28T03:30:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };
  assert.equal(pairDecision(policeReport, abcArticle), 'review');
  const groupTimeAndEntity = groupNewsEvidence([policeReport, abcArticle]);
  assert.equal(groupTimeAndEntity.groups.length, 2);
  assert.equal(groupTimeAndEntity.reviewPairs.length, 1);

  // 5. INSUFFICIENT EVIDENCE: Same location only (broad area or site without occurrence time or entity match)
  const placeOnlyMatch: NewsEvidence = {
    ...policeReport,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'hs-place-only',
    originalUrl: 'https://heraldsun.com.au/general-story',
    nativeEventId: 'hs-different-id',
    eventType: null,
    occurredAt: null, // no occurrence time
  };
  assert.equal(pairDecision(policeReport, placeOnlyMatch), 'review');
  const groupPlaceOnly = groupNewsEvidence([policeReport, placeOnlyMatch]);
  assert.equal(groupPlaceOnly.groups.length, 2);
  assert.equal(groupPlaceOnly.reviewPairs.length, 1);

  // 6. INSUFFICIENT EVIDENCE: Same event type only (without time or place match)
  const typeOnlyMatch: NewsEvidence = {
    ...policeReport,
    sourceId: 'news.sydney_herald',
    sourceRecordId: 'smh-01',
    originalUrl: 'https://smh.com.au/unrelated-assault',
    nativeEventId: 'smh-diff',
    incidentAreaRef: null,
    locationPrecision: 'unknown',
    occurredAt: null,
  };
  assert.equal(pairDecision(policeReport, typeOnlyMatch), 'review');
  assert.equal(groupNewsEvidence([policeReport, typeOnlyMatch]).groups.length, 2);

  // 7. INSUFFICIENT EVIDENCE: Same publication date only without confirmed occurrence time
  const pubDateOnlyMatch: NewsEvidence = {
    ...policeReport,
    sourceId: 'news.the_age',
    sourceRecordId: 'age-pubdate-only',
    originalUrl: 'https://theage.com.au/same-day-story',
    nativeEventId: 'age-different',
    eventType: null,
    occurredAt: null, // missing confirmed time
    incidentAreaRef: null,
    locationPrecision: 'unknown',
    sourceUpdatedAt: '2026-09-28T03:00:00Z', // identical publication timestamp
  };
  assert.equal(pairDecision(policeReport, pubDateOnlyMatch), 'review');
  assert.equal(groupNewsEvidence([policeReport, pubDateOnlyMatch]).groups.length, 2);
});

test('ID collision across different sources without time/location does NOT merge (G06)', () => {
  // Problem G06: Two independent publishers with colliding nativeEventId '123' and same eventType 'theft',
  // but no confirmed occurrence time and no incident location.
  const sourceA: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.the_age',
    sourceRecordId: 'age-rec-123',
    originalUrl: 'https://theage.com.au/theft-story',
    nativeEventId: '123',
    eventType: 'theft',
    occurredAt: null,
    incidentAreaRef: null,
    locationPrecision: 'unknown',
    sourceUpdatedAt: '2026-09-28T06:00:00Z',
  };
  const sourceB: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'hs-rec-123',
    originalUrl: 'https://heraldsun.com.au/theft-story',
    nativeEventId: '123', // Same native ID from independent publisher
    eventType: 'theft',
    occurredAt: null,
    incidentAreaRef: null,
    locationPrecision: 'unknown',
    sourceUpdatedAt: '2026-09-28T06:00:00Z', // Same publication date
  };

  // Cross-source merge requires at least 2 independent facts; native ID across sources is NOT evidence.
  // Here only 1 fact matches (eventType 'theft'). Must NOT merge.
  assert.equal(pairDecision(sourceA, sourceB), 'review');
  const result = groupNewsEvidence([sourceA, sourceB]);
  assert.equal(result.groups.length, 2);
  assert.equal(result.reviewPairs.length, 1);
  assert.deepEqual(result.reviewPairs[0], [
    `${sourceA.sourceId}\u001f${sourceA.sourceRecordId}`,
    `${sourceB.sourceId}\u001f${sourceB.sourceRecordId}`,
  ]);

  // But within the SAME source publisher, nativeEventId DOES merge
  const samePublisherA: NewsEvidence = {
    ...sourceA,
    sourceRecordId: 'age-update-1',
    originalUrl: 'https://theage.com.au/theft-part1',
  };
  const samePublisherB: NewsEvidence = {
    ...sourceA,
    sourceRecordId: 'age-update-2',
    originalUrl: 'https://theage.com.au/theft-part2',
  };
  assert.equal(pairDecision(samePublisherA, samePublisherB), 'merge');
  assert.equal(groupNewsEvidence([samePublisherA, samePublisherB]).groups.length, 1);
});

test('Adding historical versions preserves stable eventId (G07)', () => {
  const v1: NewsEvidence = {
    ...baseEvidence,
    sourceRecordId: 'article-hist-g07',
    versionId: 'v1',
    sourceUpdatedAt: '2026-09-28T02:00:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };
  const v2: NewsEvidence = {
    ...v1,
    versionId: 'v2',
    sourceUpdatedAt: '2026-09-28T03:00:00Z',
    sourceVersionOrdinal: 2,
    recordStatus: 'corrected',
  };
  const v3: NewsEvidence = {
    ...v1,
    versionId: 'v3',
    sourceUpdatedAt: '2026-09-28T04:00:00Z',
    sourceVersionOrdinal: 3,
    recordStatus: 'withdrawn',
  };

  const groupV1 = groupNewsEvidence([v1]).groups[0]!;
  const groupV1V2 = groupNewsEvidence([v1, v2]).groups[0]!;
  const groupV1V2V3 = groupNewsEvidence([v1, v2, v3]).groups[0]!;
  const groupPermuted = groupNewsEvidence([v3, v1, v2]).groups[0]!;
  const groupLatestOnly = groupNewsEvidence([v2]).groups[0]!;

  // Deduplicating source record identity ensures eventId does not change when historical versions are added
  assert.equal(groupV1V2.eventId, groupV1.eventId);
  assert.equal(groupV1V2V3.eventId, groupV1.eventId);
  assert.equal(groupPermuted.eventId, groupV1.eventId);
  assert.equal(groupLatestOnly.eventId, groupV1.eventId);

  // Multi-source grouping stability when adding historical version
  const partnerArticle: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'herald-partner-01',
    versionId: 'v1',
    originalUrl: 'https://heraldsun.com.au/partner-story',
  };
  const multiInitial = groupNewsEvidence([v1, partnerArticle]).groups[0]!;
  const multiWithHistory = groupNewsEvidence([v1, v2, partnerArticle]).groups[0]!;
  assert.equal(multiWithHistory.eventId, multiInitial.eventId);
  assert.equal(multiWithHistory.allVersions.length, 3);
  assert.equal(multiWithHistory.currentVersions.length, 2);
  assert.equal(multiWithHistory.geoRecordSources.length, 3);
});

test('Conflicting signals strictly prevent cross-source merge', () => {
  const itemA: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.the_age',
    sourceRecordId: 'story-a',
    eventType: 'robbery',
    occurredAt: '2026-09-28T01:00:00Z',
    incidentAreaRef: melbourneCBD,
  };

  // 1. Conflicting event type (robbery vs structure_fire)
  const conflictingType: NewsEvidence = {
    ...itemA,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'story-b-type-conflict',
    originalUrl: 'https://heraldsun.com.au/fire-cbd',
    eventType: 'structure_fire',
  };
  assert.equal(pairDecision(itemA, conflictingType), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingType]).groups.length, 2);

  // 2. Conflicting occurrence time (> 1 hour apart)
  const conflictingTime: NewsEvidence = {
    ...itemA,
    sourceId: 'news.abc',
    sourceRecordId: 'story-c-time-conflict',
    originalUrl: 'https://abc.net.au/robbery-later',
    occurredAt: '2026-09-28T04:30:00Z', // 3.5 hours later
  };
  assert.equal(pairDecision(itemA, conflictingTime), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingTime]).groups.length, 2);

  // 3. Conflicting local area / incident site (Melbourne CBD vs Geelong)
  const conflictingPlace: NewsEvidence = {
    ...itemA,
    sourceId: 'news.geelong_advertiser',
    sourceRecordId: 'story-d-place-conflict',
    originalUrl: 'https://geelongadvertiser.com.au/robbery-geelong',
    incidentAreaRef: geelongLGA,
  };
  assert.equal(pairDecision(itemA, conflictingPlace), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingPlace]).groups.length, 2);

  // 4. Conflicting state-level jurisdictions (Victoria vs New South Wales)
  const vicStateItem: NewsEvidence = {
    ...itemA,
    incidentAreaRef: victoriaState,
    locationPrecision: 'state_only',
  };
  const nswStateItem: NewsEvidence = {
    ...itemA,
    sourceId: 'news.daily_telegraph',
    sourceRecordId: 'story-e-nsw',
    originalUrl: 'https://dailytelegraph.com.au/nsw-story',
    incidentAreaRef: nswState,
    locationPrecision: 'state_only',
  };
  assert.equal(pairDecision(vicStateItem, nswStateItem), 'separate');
  assert.equal(groupNewsEvidence([vicStateItem, nswStateItem]).groups.length, 2);

  // 5. Same publisher with different articles cannot merge as separate events
  const samePublisherDifferentArticle: NewsEvidence = {
    ...itemA,
    sourceRecordId: 'story-f-same-pub',
    nativeEventId: 'age-different-event',
    originalUrl: 'https://theage.com.au/another-unrelated-crime',
  };
  assert.equal(pairDecision(itemA, samePublisherDifferentArticle), 'separate');
  assert.equal(groupNewsEvidence([itemA, samePublisherDifferentArticle]).groups.length, 2);

  // 6. Conflicting time even when site and eventType match
  const conflictingTimeWithMatchingSiteAndType: NewsEvidence = {
    ...itemA,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'story-g-time-conflict',
    originalUrl: 'https://heraldsun.com.au/robbery-different-time',
    occurredAt: '2026-09-28T07:00:00Z', // 6 hours later
  };
  assert.equal(pairDecision(itemA, conflictingTimeWithMatchingSiteAndType), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingTimeWithMatchingSiteAndType]).groups.length, 2);

  // 7. Conflicting place even when time and eventType match
  const conflictingPlaceWithMatchingTimeAndType: NewsEvidence = {
    ...itemA,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'story-h-place-conflict',
    originalUrl: 'https://heraldsun.com.au/robbery-geelong-same-time',
    incidentAreaRef: geelongLGA,
  };
  assert.equal(pairDecision(itemA, conflictingPlaceWithMatchingTimeAndType), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingPlaceWithMatchingTimeAndType]).groups.length, 2);

  // 8. Conflicting eventType even when time and site match
  const conflictingTypeWithMatchingTimeAndSite: NewsEvidence = {
    ...itemA,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'story-i-type-conflict',
    originalUrl: 'https://heraldsun.com.au/fire-cbd-same-time',
    eventType: 'structure_fire',
  };
  assert.equal(pairDecision(itemA, conflictingTypeWithMatchingTimeAndSite), 'separate');
  assert.equal(groupNewsEvidence([itemA, conflictingTypeWithMatchingTimeAndSite]).groups.length, 2);
});

test('Transitive conflict prevents merging entire connected component', () => {
  // Source A: Robbery in Melbourne CBD at 01:00
  const itemA: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.the_age',
    sourceRecordId: 'trans-a',
    eventType: 'robbery',
    occurredAt: '2026-09-28T01:00:00Z',
    incidentAreaRef: melbourneCBD,
  };
  // Source B: Robbery at 01:00 with location unknown (matches A on time+type, and matches C on time+type)
  const itemB: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.wire_service',
    sourceRecordId: 'trans-b',
    originalUrl: 'https://wire.example/story',
    eventType: 'robbery',
    occurredAt: '2026-09-28T01:00:00Z',
    incidentAreaRef: null,
    locationPrecision: 'unknown',
  };
  // Source C: Robbery in Geelong at 01:00 (conflicts with A on place!)
  const itemC: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.geelong_advertiser',
    sourceRecordId: 'trans-c',
    originalUrl: 'https://geelongadvertiser.com.au/robbery',
    eventType: 'robbery',
    occurredAt: '2026-09-28T01:00:00Z',
    incidentAreaRef: geelongLGA,
  };

  assert.equal(pairDecision(itemA, itemB), 'merge');
  assert.equal(pairDecision(itemB, itemC), 'merge');
  assert.equal(pairDecision(itemA, itemC), 'separate'); // Direct conflict!

  const result = groupNewsEvidence([itemA, itemB, itemC]);
  // The transitive conflict between A and C must prevent merging them all into one
  assert.equal(result.groups.length, 2);
  assert.ok(result.reviewPairs.length > 0);
});

test('Versioning: updates, corrections, and withdrawals preserve all history and source links', () => {
  // Step 1: Initial published version (v1 active)
  const v1: NewsEvidence = {
    ...baseEvidence,
    sourceRecordId: 'article-hist-01',
    versionId: 'v1',
    sourceUpdatedAt: '2026-09-28T02:00:00Z',
    sourceVersionOrdinal: 1,
    recordStatus: 'active',
  };
  // Step 2: Publisher issues a correction (v2 corrected)
  const v2: NewsEvidence = {
    ...v1,
    versionId: 'v2',
    sourceUpdatedAt: '2026-09-28T03:00:00Z',
    sourceVersionOrdinal: 2,
    recordStatus: 'corrected',
  };
  // Step 3: Publisher withdraws / retracts the article (v3 withdrawn)
  const v3: NewsEvidence = {
    ...v1,
    versionId: 'v3',
    sourceUpdatedAt: '2026-09-28T04:00:00Z',
    sourceVersionOrdinal: 3,
    recordStatus: 'withdrawn',
  };

  // Grouping v1 and v2: latest is v2 (corrected), both versions preserved in allVersions
  const correctedGroup = groupNewsEvidence([v1, v2]).groups[0]!;
  assert.equal(correctedGroup.allVersions.length, 2);
  assert.equal(correctedGroup.currentVersions.length, 1);
  assert.equal(correctedGroup.currentVersions[0]?.versionId, 'v2');
  assert.equal(correctedGroup.currentVersions[0]?.recordStatus, 'corrected');
  assert.equal(correctedGroup.geoRecordSources.length, 2);

  // Grouping v1, v2, v3: latest is v3 (withdrawn) -> currentVersions is empty
  const withdrawnGroup = groupNewsEvidence([v1, v2, v3]).groups[0]!;
  assert.equal(withdrawnGroup.allVersions.length, 3);
  assert.deepEqual(withdrawnGroup.currentVersions, []);
  assert.equal(withdrawnGroup.geoRecordSources.length, 3);
  const versionIdsInSources = withdrawnGroup.geoRecordSources.map(s => s.version_id).sort();
  assert.deepEqual(versionIdsInSources, ['v1', 'v2', 'v3']);

  // Multi-source partial withdrawal:
  // Source A withdraws its story, but Source B remains active
  const sourceBActive: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'herald-hist-02',
    versionId: 'v1',
    originalUrl: 'https://heraldsun.com.au/story',
    sourceUpdatedAt: '2026-09-28T02:30:00Z',
    recordStatus: 'active',
  };

  const multiWithdrawal = groupNewsEvidence([v1, v2, v3, sourceBActive]).groups[0]!;
  assert.equal(multiWithdrawal.allVersions.length, 4);
  // Current only has the active source B
  assert.equal(multiWithdrawal.currentVersions.length, 1);
  assert.equal(multiWithdrawal.currentVersions[0]?.sourceId, 'news.herald_sun');
  // GeoRecordSources contains all 4 versions
  assert.equal(multiWithdrawal.geoRecordSources.length, 4);
  assert.equal(multiWithdrawal.originalUrls.length, 2);
});

test('Ambiguous concurrent versions flag review and are excluded from current views', () => {
  const versionA: NewsEvidence = {
    ...baseEvidence,
    sourceRecordId: 'ambig-rec',
    versionId: 'ver-A',
    sourceUpdatedAt: '2026-09-28T05:00:00Z',
    sourceVersionOrdinal: 2,
    recordStatus: 'active',
  };
  const versionB: NewsEvidence = {
    ...baseEvidence,
    sourceRecordId: 'ambig-rec',
    versionId: 'ver-B',
    sourceUpdatedAt: '2026-09-28T05:00:00Z', // identical updated time
    sourceVersionOrdinal: 2, // identical ordinal
    recordStatus: 'active',
  };

  const group = groupNewsEvidence([versionA, versionB]).groups[0]!;
  assert.equal(group.allVersions.length, 2);
  assert.equal(group.currentVersions.length, 0); // ambiguous cannot resolve latest
  assert.equal(group.requiresReview, true);
});

test('Stable eventId is preserved from previous runs and multi-event joins flag review', () => {
  const itemA: NewsEvidence = {
    ...baseEvidence,
    sourceRecordId: 'run-a',
    originalUrl: 'https://news.example/a',
  };
  const itemB: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.herald_sun',
    sourceRecordId: 'run-b',
    originalUrl: 'https://news.example/b',
  };

  // Run with existing assigned eventId
  const previousMap = new Map([
    [`${itemA.sourceId}\u001f${itemA.sourceRecordId}`, 'event_stable_uuid_999'],
  ]);
  const group = groupNewsEvidence([itemA, itemB], previousMap).groups[0]!;
  assert.equal(group.eventId, 'event_stable_uuid_999');

  // If two previously distinct event IDs merge, requiresReview must be set
  const conflictMap = new Map([
    [`${itemA.sourceId}\u001f${itemA.sourceRecordId}`, 'event_001'],
    [`${itemB.sourceId}\u001f${itemB.sourceRecordId}`, 'event_002'],
  ]);
  const mergedPrevious = groupNewsEvidence([itemA, itemB], conflictMap).groups[0]!;
  assert.equal(mergedPrevious.requiresReview, true);
});

test('buildNewsGeoRecordSources attaches custom provenance and deduplicates links', () => {
  const itemA: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.source_custom',
    sourceRecordId: 'rec_custom_1',
    versionId: 'ver_custom_1',
    originalUrl: 'https://news.example/story',
    batchId: 'batch_20260928_01',
    fetchedAt: '2026-09-28T02:00:00Z',
    schemaVersion: 1,
    evidenceRole: 'lead_article',
  };

  const sources = buildNewsGeoRecordSources({
    eventId: 'event_custom_xyz',
    allVersions: [itemA, itemA], // duplicate input
  });

  assert.equal(sources.length, 1);
  const s = sources[0]!;
  assert.equal(s.geo_record_id, 'event_custom_xyz');
  assert.equal(s.version_id, 'ver_custom_1');
  assert.equal(s.source_record_id, 'rec_custom_1');
  assert.equal(s.source_version_id, 'ver_custom_1');
  assert.equal(s.evidence_role, 'lead_article');
  assert.equal(s.original_url, 'https://news.example/story');
  assert.equal(s.batch_id, 'batch_20260928_01');
  assert.equal(s.fetched_at, '2026-09-28T02:00:00Z');
});

test('G26: missing batchId or fetchedAt does NOT generate fabricated provenance rows', () => {
  // Case 1: Both batchId and fetchedAt missing, with occurredAt and sourceUpdatedAt present
  const { batchId: _b1, fetchedAt: _f1, ...missingProvenanceBase } = baseEvidence;
  const missingProvenance: NewsEvidence = {
    ...missingProvenanceBase,
    occurredAt: '2026-09-28T01:00:00Z',
    sourceUpdatedAt: '2026-09-28T02:00:00Z',
  };

  const sources1 = buildNewsGeoRecordSources({
    eventId: 'event_test_001',
    allVersions: [missingProvenance],
  });
  // Must NOT fabricate 'batch_reconciled' or substitute sourceUpdatedAt / occurredAt as fetched_at
  assert.equal(sources1.length, 0);

  // Grouping calculation still works and preserves groups without fabricating GeoRecordSources
  const groupResult = groupNewsEvidence([missingProvenance]);
  assert.equal(groupResult.groups.length, 1);
  assert.equal(groupResult.groups[0]?.allVersions.length, 1);
  assert.equal(groupResult.groups[0]?.geoRecordSources.length, 0);

  // Case 2: Only batchId missing
  const { batchId: _b2, ...missingBatchIdBase } = baseEvidence;
  const missingBatchId: NewsEvidence = {
    ...missingBatchIdBase,
    fetchedAt: '2026-09-28T02:00:00Z',
  };
  const sources2 = buildNewsGeoRecordSources({
    eventId: 'event_test_002',
    allVersions: [missingBatchId],
  });
  assert.equal(sources2.length, 0);

  // Case 3: Only fetchedAt missing, no occurrence or update time (would previously become 1970-01-01)
  const { fetchedAt: _f3, ...missingFetchedAtBase } = baseEvidence;
  const missingFetchedAtNoTime: NewsEvidence = {
    ...missingFetchedAtBase,
    batchId: 'batch_test_03',
    occurredAt: null,
    sourceUpdatedAt: null,
  };
  const sources3 = buildNewsGeoRecordSources({
    eventId: 'event_test_003',
    allVersions: [missingFetchedAtNoTime],
  });
  assert.equal(sources3.length, 0);
});

test('G26: valid provenance preserves all original articles, versions, and links without loss', () => {
  const version1: NewsEvidence = {
    ...baseEvidence,
    sourceId: 'news.the_age',
    sourceRecordId: 'art-100',
    versionId: 'v1',
    batchId: 'batch_ingest_01',
    fetchedAt: '2026-09-28T02:00:00Z',
    originalUrl: 'https://theage.com.au/story',
    recordStatus: 'active',
  };
  const version2: NewsEvidence = {
    ...version1,
    versionId: 'v2',
    batchId: 'batch_ingest_02',
    fetchedAt: '2026-09-28T03:00:00Z',
    sourceUpdatedAt: '2026-09-28T03:00:00Z',
    recordStatus: 'corrected',
  };
  const version3: NewsEvidence = {
    ...version1,
    versionId: 'v3',
    batchId: 'batch_ingest_03',
    fetchedAt: '2026-09-28T04:00:00Z',
    sourceUpdatedAt: '2026-09-28T04:00:00Z',
    recordStatus: 'withdrawn',
  };

  const groupResult = groupNewsEvidence([version1, version2, version3]);
  assert.equal(groupResult.groups.length, 1);
  const group = groupResult.groups[0]!;

  // Retain all 3 versions in allVersions and geoRecordSources
  assert.equal(group.allVersions.length, 3);
  assert.equal(group.geoRecordSources.length, 3);

  const v1Source = group.geoRecordSources.find(s => s.version_id === 'v1');
  assert.ok(v1Source);
  assert.equal(v1Source.batch_id, 'batch_ingest_01');
  assert.equal(v1Source.fetched_at, '2026-09-28T02:00:00Z');
  assert.equal(v1Source.source_record_id, 'art-100');
  assert.equal(v1Source.source_version_id, 'v1');
  assert.equal(v1Source.geo_record_id, group.eventId);

  const v2Source = group.geoRecordSources.find(s => s.version_id === 'v2');
  assert.ok(v2Source);
  assert.equal(v2Source.batch_id, 'batch_ingest_02');
  assert.equal(v2Source.fetched_at, '2026-09-28T03:00:00Z');

  const v3Source = group.geoRecordSources.find(s => s.version_id === 'v3');
  assert.ok(v3Source);
  assert.equal(v3Source.batch_id, 'batch_ingest_03');
  assert.equal(v3Source.fetched_at, '2026-09-28T04:00:00Z');

  // Verify caller can supply provenanceDefaults
  const { batchId: _b4, fetchedAt: _f4, ...itemWithoutBatch } = baseEvidence;
  const sourcesFromDefaults = buildNewsGeoRecordSources(
    { eventId: 'event_prov_default', allVersions: [itemWithoutBatch] },
    { batch_id: 'batch_default_99', fetched_at: '2026-09-28T10:00:00Z', schema_version: 2 }
  );
  assert.equal(sourcesFromDefaults.length, 1);
  assert.equal(sourcesFromDefaults[0]?.batch_id, 'batch_default_99');
  assert.equal(sourcesFromDefaults[0]?.fetched_at, '2026-09-28T10:00:00Z');
  assert.equal(sourcesFromDefaults[0]?.schema_version, 2);
});

