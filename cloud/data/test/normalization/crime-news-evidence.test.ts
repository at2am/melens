import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import type { ConnectorSuccess } from '../../src/core/connector.js';
import { stableBatchId } from '../../src/core/publisher.js';
import type { GeoRecord, GeoRecordSource, SourceRecord } from '../../src/core/types.js';
import { enrichVerifiedCrimeNews, VERIFIED_CRIME_NEWS_EVIDENCE } from '../../src/normalization/crime-news-evidence.js';

function fixture(urls: readonly string[]): ConnectorSuccess {
  const provenance = { batch_id: 'crime-evidence-test', source_id: 'gdelt.news',
    schema_version: 1, fetched_at: '2026-10-01T11:00:00Z' };
  const sourceRecords: SourceRecord[] = urls.map((url, index) => ({
    ...provenance, source_record_id: `source-${index}`, version_id: `source-v1-${index}`,
    original_url: url, raw_uri: null, published_at: null, observed_at: null,
    first_accessible_at: null, time_missing_reason: 'Original publication time is absent from GKG',
    valid_from: null, valid_to: null, source_updated_at: '2026-10-01T10:30:00Z',
    source_version_ordinal: null, record_status: 'active', assertion_kind: 'report',
    rights_status: 'verified_open',
  }));
  const geoRecords: GeoRecord[] = sourceRecords.map((record, index) => ({
    ...provenance, geo_record_id: `geo-${index}`, version_id: `geo-v1-${index}`,
    original_url: record.original_url, topic: 'news', assertion_kind: 'report',
    title: 'GDELT dataset title', summary: '{"themes":["SOC_GENERALCRIME"]}',
    geometry_geojson: null, centroid_lat: null, centroid_lon: null,
    location_role: 'mentioned_place', location_confidence: 'unverified', area_refs: [],
    published_at: null, observed_at: null, valid_from: null, valid_to: null,
    source_updated_at: record.source_updated_at, source_version_ordinal: null,
    freshness_state: 'unknown', record_status: 'active', rights_status: 'verified_open',
    public_query_allowed: true,
  }));
  const geoRecordSources: GeoRecordSource[] = sourceRecords.map((record, index) => ({
    ...provenance, geo_record_id: `geo-${index}`, version_id: `geo-v1-${index}`,
    source_record_id: record.source_record_id, source_version_id: record.version_id,
    evidence_role: 'article_metadata', original_url: record.original_url,
  }));
  return {
    kind: 'success', sourceId: 'gdelt.news', runId: provenance.batch_id,
    fetchedAt: provenance.fetched_at, sourceRevision: null,
    sourceLatestUpdateAt: '2026-10-01T10:30:00Z', checkpointAfter: null,
    completeness: { complete: true, method: 'feed_snapshot', expected_records: urls.length,
      fetched_records: urls.length, expected_pages: 1, fetched_pages: 1, evidence: 'Test fixture' },
    inputCount: urls.length, outputCount: urls.length, rejectedCount: 0,
    sourceRecords, geoRecords, geoRecordSources,
    boundaries: [], areaIndicators: [], parkingBays: [], parkingObservations: [],
    parkingRules: [], sensorLocations: [], pedestrianObservations: [], retainableRawRecords: null,
  };
}

test('verified crime URLs gain original instants while incident precision and GDELT clocks stay unchanged', () => {
  const input = fixture(VERIFIED_CRIME_NEWS_EVIDENCE.map(item => item.originalUrl));
  const result = enrichVerifiedCrimeNews(input);
  for (const [index, evidence] of VERIFIED_CRIME_NEWS_EVIDENCE.entries()) {
    const source = result.sourceRecords[index];
    const geo = result.geoRecords[index];
    assert.ok(source && geo);
    assert.equal(source.published_at, evidence.publishedAt);
    assert.equal(geo.published_at, evidence.publishedAt);
    assert.equal(source.source_updated_at, '2026-10-01T10:30:00Z');
    assert.equal(source.observed_at, null);
    assert.equal(geo.observed_at, null);
    assert.equal(geo.topic, 'crime_news');
    assert.equal(geo.location_role, 'mentioned_place');
    assert.equal(geo.location_confidence, 'unverified');
    assert.equal(geo.geometry_geojson, null);
    assert.equal(geo.centroid_lat, null);
    assert.equal(geo.centroid_lon, null);
    assert.equal(geo.title, 'GDELT dataset title');
    assert.deepEqual(geo.area_refs, []);
    assert.ok(geo.summary?.includes(evidence.legalStatus));
  }
});

test('crime publication enrichment updates both source and geographic versions and every reference', () => {
  const input = fixture(VERIFIED_CRIME_NEWS_EVIDENCE.map(item => item.originalUrl));
  const result = enrichVerifiedCrimeNews(input);
  for (const [index, link] of result.geoRecordSources.entries()) {
    const source = result.sourceRecords[index];
    const geo = result.geoRecords[index];
    const oldSource = input.sourceRecords[index];
    const oldGeo = input.geoRecords[index];
    assert.ok(source && geo && oldSource && oldGeo);
    assert.notEqual(source.version_id, oldSource.version_id);
    assert.notEqual(geo.version_id, oldGeo.version_id);
    assert.equal(link.source_version_id, source.version_id);
    assert.equal(link.version_id, geo.version_id);
  }
  assert.deepEqual(enrichVerifiedCrimeNews(result), result);
});

test('crime evidence never matches an unreviewed URL or a different publisher by a similar slug', () => {
  const evidence = VERIFIED_CRIME_NEWS_EVIDENCE[0];
  assert.ok(evidence);
  const input = fixture(['https://example.org/melbourne-crime', evidence.originalUrl.replace('www.abc.net.au', 'example.org')]);
  assert.deepEqual(enrichVerifiedCrimeNews(input), input);
  const otherSource = { ...input, sourceId: 'another.news' };
  assert.equal(enrichVerifiedCrimeNews(otherSource), otherSource);
});

test('crime evidence fails on conflicting dates, a missing source link, or publication later than fetch', () => {
  const evidence = VERIFIED_CRIME_NEWS_EVIDENCE[0];
  assert.ok(evidence);
  const input = fixture([evidence.originalUrl]);
  assert.throws(() => enrichVerifiedCrimeNews({ ...input,
    sourceRecords: input.sourceRecords.map(record => ({ ...record, published_at: '2026-09-01T00:00:00Z' })),
  }), /timestamp conflicts/);
  assert.throws(() => enrichVerifiedCrimeNews({ ...input, geoRecordSources: [] }), /matching verified source fact/);
  assert.throws(() => enrichVerifiedCrimeNews({ ...input,
    sourceRecords: input.sourceRecords.map(record => ({ ...record, fetched_at: '2026-09-01T00:00:00Z' })),
  }), /later than this record fetch/);
});

function newReport(title: string | null, themes: readonly string[], scope = 'city',
  locationReason = 'official_place_mention', areaRefs: readonly string[] = ['ASGS_LGA:24600:2025']): ConnectorSuccess {
  const input = fixture(['https://example.org/2026/10/melbourne-new-report']);
  return { ...input, geoRecords: input.geoRecords.map(record => ({
    ...record, title, area_refs: [...areaRefs],
    summary: JSON.stringify({ news_scope: scope, location_reason: locationReason,
      themes, publication_time_status: 'not_provided', gdelt_processed_at: '2026-10-01T10:30:00Z' }),
  })) };
}

test('new crime headline plus exact crime theme and an official Melbourne mention becomes an unverified candidate', () => {
  for (const [scope, theme, title] of [
    ['city', 'SOC_GENERALCRIME', 'Man charged with murder following Melbourne investigation'],
    ['greater_melbourne', 'WB_2453_ORGANIZED_CRIME', 'Police investigate arson and drug trafficking'],
  ]) {
    assert.ok(scope && theme && title);
    const input = newReport(title, [theme, 'TAX_FNCACT_POLICE'], scope);
    const result = enrichVerifiedCrimeNews(input);
    const record = result.geoRecords[0];
    const original = input.geoRecords[0];
    assert.ok(record && original && record.summary);
    assert.equal(record.topic, 'crime_news');
    assert.notEqual(record.version_id, original.version_id);
    assert.equal(record.published_at, null);
    assert.equal(record.observed_at, null);
    assert.equal(record.geometry_geojson, null);
    assert.equal(record.centroid_lat, null);
    assert.equal(record.location_role, 'mentioned_place');
    assert.equal(record.location_confidence, 'unverified');
    assert.deepEqual(record.area_refs, original.area_refs);
    assert.deepEqual(result.sourceRecords, input.sourceRecords);
    assert.equal(result.geoRecordSources[0]?.version_id, record.version_id);
    assert.equal(result.geoRecordSources[0]?.source_version_id, input.sourceRecords[0]?.version_id);
    const summary: unknown = JSON.parse(record.summary);
    const marker = z.object({ crime_news_evidence: z.object({ evidence_hash: z.string().regex(/^[a-f0-9]{64}$/) }) }).parse(summary);
    assert.deepEqual(summary, {
      news_scope: scope, location_reason: 'official_place_mention',
      themes: [theme, 'TAX_FNCACT_POLICE'], publication_time_status: 'not_provided',
      gdelt_processed_at: '2026-10-01T10:30:00Z',
      crime_news_evidence: {
        policy: 'gdelt-crime-candidate-v1', status: 'gdelt_theme_candidate',
        local_occurrence: 'unverified', review_required: true, news_scope: scope,
        area_refs: ['ASGS_LGA:24600:2025'], matched_gdelt_themes: [theme],
        headline_evidence: { source: 'gdelt_metadata_title', title,
          matched_terms: title.includes('murder') ? ['murder'] : ['arson', 'drug trafficking'] },
        geographic_precision: 'mentioned_area_only_no_incident_point',
        publication_time_status: 'not_provided', review_method: 'conservative_metadata_filter',
        evidence_hash: marker.crime_news_evidence.evidence_hash,
      },
    });
    assert.deepEqual(enrichVerifiedCrimeNews(result), result);
  }
});

test('police activities, laws and broad police/kill/law themes do not become crime reports', () => {
  for (const input of [
    newReport('Melbourne police attend a community activity', ['SOC_GENERALCRIME', 'TAX_FNCACT_POLICE']),
    newReport('Melbourne murder laws reform announced', ['SOC_GENERALCRIME', 'LEGISLATION']),
    newReport('Melbourne murder investigation discussed overseas', ['KILL', 'TAX_FNCACT_POLICE', 'EPU_POLICY_LAW']),
    newReport('Melbourne minister announces criminal justice reform', ['WB_1014_CRIMINAL_JUSTICE']),
    newReport('Melbourne assault report', ['ARREST', 'TRIAL']),
  ]) assert.deepEqual(enrichVerifiedCrimeNews(input), input);
});

test('crime themes require a crime headline and official Melbourne scope without accepting overseas same names', () => {
  for (const input of [
    newReport(null, ['SOC_GENERALCRIME']),
    newReport('', ['SOC_GENERALCRIME']),
    newReport('Local headlines from Melbourne', ['SOC_GENERALCRIME']),
    newReport('Murder in Melbourne, Florida', ['SOC_GENERALCRIME'], 'unknown', 'overseas_same_name', []),
    newReport('Murder in Melbourne', ['SOC_GENERALCRIME'], 'victoria'),
    newReport('Murder in Melbourne', ['SOC_GENERALCRIME'], 'city', 'unverified_mention', []),
    newReport('Murder in Melbourne', ['SOC_GENERALCRIME'], 'city', 'official_place_mention', []),
    newReport('Murder in Melbourne', ['SOC_GENERALCRIME_UNREVIEWED_SUFFIX']),
  ]) assert.deepEqual(enrichVerifiedCrimeNews(input), input);
});

test('candidate classification retains unknown location and requires intact metadata provenance', () => {
  const input = newReport('Murder trial in Melbourne', ['SOC_GENERALCRIME']);
  const unknown = { ...input, geoRecords: input.geoRecords.map(record => ({
    ...record, location_role: 'unknown' as const,
  })) };
  assert.equal(enrichVerifiedCrimeNews(unknown).geoRecords[0]?.location_role, 'unknown');
  assert.throws(() => enrichVerifiedCrimeNews({ ...input, geoRecordSources: [] }), /matching GDELT source metadata/);
  assert.throws(() => enrichVerifiedCrimeNews({ ...input,
    sourceRecords: input.sourceRecords.map(record => ({ ...record, original_url: 'https://example.org/another-report' })),
  }), /matching GDELT source metadata/);
});

test('the six exact verified reports remain preferred over candidate filters', () => {
  const input = fixture(VERIFIED_CRIME_NEWS_EVIDENCE.map(evidence => evidence.originalUrl));
  const result = enrichVerifiedCrimeNews({ ...input, geoRecords: input.geoRecords.map(record => ({
    ...record, title: null, summary: '{"themes":[],"news_scope":"unknown"}',
  })) });
  for (const record of result.geoRecords) {
    assert.equal(record.topic, 'crime_news');
    assert.ok(record.summary?.includes('"status":"verified_sample_metadata"'));
    assert.ok(!record.summary?.includes('gdelt_theme_candidate'));
    assert.ok(record.published_at);
  }
});

test('replaying a GKG window with new crime classification gets a distinct stable publication batch', () => {
  const input = { ...newReport('Melbourne arson investigation', ['SOC_GENERALCRIME']),
    sourceRevision: 'upstream-news-normalization-revision' };
  const windowFrom = '2026-10-01T10:30:00Z';
  const windowTo = '2026-10-01T10:45:00Z';
  const originalBatch = stableBatchId(input.sourceId, windowFrom, windowTo, input.sourceRevision);
  const result = enrichVerifiedCrimeNews(input);
  const repeated = enrichVerifiedCrimeNews(result);
  const sameInput = enrichVerifiedCrimeNews(input);
  assert.notEqual(result.sourceRevision, input.sourceRevision);
  assert.equal(result.sourceRevision, sameInput.sourceRevision);
  assert.equal(result.sourceRevision, repeated.sourceRevision);
  assert.notEqual(stableBatchId(result.sourceId, windowFrom, windowTo, result.sourceRevision), originalBatch);
  assert.equal(stableBatchId(result.sourceId, windowFrom, windowTo, result.sourceRevision),
    stableBatchId(repeated.sourceId, windowFrom, windowTo, repeated.sourceRevision));
  assert.deepEqual(repeated, result);
});

test('crime revision changes for verified source/geo versions and stays unchanged when classification has no effect', () => {
  const evidence = VERIFIED_CRIME_NEWS_EVIDENCE[0];
  assert.ok(evidence);
  const input = { ...fixture([evidence.originalUrl]), sourceRevision: 'upstream-verified-news-revision' };
  const result = enrichVerifiedCrimeNews(input);
  assert.notEqual(result.sourceRevision, input.sourceRevision);
  assert.deepEqual(enrichVerifiedCrimeNews(input), result);
  assert.deepEqual(enrichVerifiedCrimeNews(result), result);

  const ignored = { ...newReport('Melbourne community activity', ['SOC_GENERALCRIME']),
    sourceRevision: 'upstream-unchanged-news-revision' };
  assert.deepEqual(enrichVerifiedCrimeNews(ignored), ignored);
  const unknownRevision = { ...ignored, sourceRevision: null };
  assert.deepEqual(enrichVerifiedCrimeNews(unknownRevision), unknownRevision);
});
