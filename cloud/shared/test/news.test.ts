import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMapConfig } from '../src/config.js';
import { parseUnlocatedQuery, parseViewportQuery } from '../src/contracts/map-contract.js';
import { MapAdapterError, type PublicSourceReference } from '../src/query/adapter-common.js';
import { adaptNewsRow, adaptNewsRows } from '../src/query/news.js';
import { adaptContext, adaptLayerRows } from '../src/query/layer-adapters.js';
import { preparePublicRecordQuery } from '../src/query/public-record-queries.js';
import type { ViewRow } from '../src/query/query-runner.js';
import { prepareUnlocatedQuery } from '../src/query/unlocated-queries.js';
import { prepareViewQuery } from '../src/query/view-queries.js';

const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-testing' });
const source: PublicSourceReference = { sourceId: 'gdelt.news', url: 'https://www.gdeltproject.org/',
  attribution: 'GDELT metadata', versionRef: null };
const council: PublicSourceReference = { sourceId: 'victoria.council.engagement_news',
  url: 'https://participate.melbourne.vic.gov.au/', attribution: 'City of Melbourne', versionRef: null };
const articleUrl = 'https://example.org/news/original-report';
const window = { from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' };
const request = parseViewportQuery({ requestId: 'news-test', bbox: [144.9, -37.9, 145.1, -37.7],
  zoom: 14, layers: ['news'], mode: 'current', window });
const unlocated = parseUnlocatedQuery({ requestId: 'news-list', layers: ['news'], mode: 'current',
  window, scope: { areaRefs: ['com:municipal'] } });
function newsRow(extra: ViewRow = {}): ViewRow {
  return { geo_record_id: 'news:article1', version_id: 'article-version1', source_id: source.sourceId,
    topic: 'news', assertion_kind: 'report', is_prediction: false, title: 'Published headline',
    summary: JSON.stringify({ news_scope: 'city', gdelt_processed_at: '2026-10-01T01:00:00Z',
      attribution: { name: 'The GDELT Project', url: 'https://www.gdeltproject.org/' },
      article_body: 'private-body-marker' }), original_url: articleUrl, geometry_geojson: null,
    location_role: 'mentioned_place', location_confidence: 'unverified', area_refs: ['com:municipal'],
    observed_at: null, published_at: null, valid_from: null, valid_to: null,
    fetched_at: '2026-10-01T01:01:00Z', record_status: 'active', ...extra };
}

test('GDELT keeps the original link, attribution, unknown clocks, mention precision and unconfirmed grouping', () => {
  const item = adaptNewsRow(newsRow({ centroid_lat: -37.81, centroid_lon: 144.96 }), { source });
  assert.equal(item.geometry, null);
  assert.equal(item.location.role, 'mention');
  assert.equal(item.location.precision, 'unlocated');
  assert.equal(item.time.reportedAt, null);
  assert.equal(item.time.observedAt, null);
  assert.equal(item.details.articleRefs[0]?.reportedAt, null);
  assert.equal(item.details.articleRefs[0]?.url, articleUrl);
  assert.equal(item.sources[0]?.url, articleUrl);
  assert.equal(item.sources[0]?.versionRef, 'article-version1');
  assert.equal(item.sources[0]?.attribution, 'The GDELT Project (https://www.gdeltproject.org/)');
  assert.equal(item.sources[1]?.url, 'https://www.gdeltproject.org/');
  assert.match(item.sources[1]?.attribution ?? '', /The GDELT Project/);
  assert.equal(item.details.dedupStatus, 'unconfirmed');
  assert.equal(item.details.summary, null);
  assert.doesNotMatch(JSON.stringify(item), /private-body-marker|gdelt_processed_at/);
  const batch = adaptNewsRows([newsRow()], { resolveSource: () => source });
  assert.equal(batch.items.length, 0); assert.equal(batch.unlocatedItems.length, 1);
});

test('council news returns only normalized fact text and keeps area association without a point', () => {
  const item = adaptNewsRow(newsRow({ source_id: council.sourceId,
    summary: JSON.stringify({ summary_text: 'Update on "Example park" from City of Melbourne',
      project_description: 'private-council-expression', article_body: 'private-council-body' }),
    location_role: 'area_only', location_confidence: 'resolved_area', published_at: '2026-10-01T00:00:00Z' }), { source: council });
  assert.equal(item.details.summary, 'Update on "Example park" from City of Melbourne');
  assert.equal(item.location.role, 'areaAssociation');
  assert.equal(item.geometry, null); assert.equal(item.time.reportedAt, '2026-10-01T00:00:00Z');
  assert.doesNotMatch(JSON.stringify(item), /private-council-expression|private-council-body/);
});

test('news rejects invented locations, publication clocks, unsafe links and unadmitted sources', () => {
  for (const extra of [{ geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }) },
    { original_url: null }, { original_url: 'javascript:alert(1)' }, { topic: 'planning' },
    { assertion_kind: 'prediction', is_prediction: true }, { published_at: 'yesterday' },
    { record_status: 'withdrawn' }, { summary: 'unstructured council article text' }]) {
    assert.throws(() => adaptNewsRow(newsRow(extra), { source }), MapAdapterError);
  }
  assert.throws(() => adaptNewsRows([newsRow()], { resolveSource: () => null }),
    (error: unknown) => error instanceof MapAdapterError && error.code === 'notPublic');
});

test('news uses fixed published views with source admission, temporal scope, null geometry lists and current rights rechecks', () => {
  const viewport = prepareViewQuery({ queryId: 'news', request, config, pageSize: 10,
    publicSourceIds: [source.sourceId] });
  assert.match(viewport.query, /v_geo_records_current/);
  assert.match(viewport.query, /g.topic IN \(@topic, @crimeTopic\)/);
  assert.match(viewport.query, /ST_INTERSECTSBOX/);
  assert.match(viewport.query, /g.source_id IN UNNEST/);
  const list = prepareUnlocatedQuery({ queryId: 'news', request: unlocated, config, pageSize: 10,
    approvedScope: { sourceIds: [source.sourceId], areaRefs: ['com:municipal'], sourceJurisdiction: null } });
  assert.match(list.query, /g.geometry IS NULL/);
  assert.match(list.query, /COALESCE\(g.published_at, g.observed_at\) >= @from/);
  assert.match(list.query, /COALESCE\(g.published_at, g.observed_at\) IS NULL/);
  assert.doesNotMatch(list.query, /ST_INTERSECTSBOX|gdelt_processed_at|fetched_at >=/);
  const proof = preparePublicRecordQuery({ queryId: 'news', request, config, pageSize: 10,
    recordKeys: [{ id: 'news:article1', versionId: 'article-version1', sourceId: source.sourceId }] });
  assert.match(proof.query, /v_geo_records_current/);
  assert.match(proof.query, /requested\.id = g\.geo_record_id/);
  assert.match(proof.query, /requested\.version_id = g\.version_id/);
  assert.match(proof.query, /requested\.source_id = g\.source_id/);
  assert.match(proof.query, /g.record_status IN \('active', 'planned'\)/);
});

test('restricted Ticketmaster records keep the original event link and reject a missing or unsafe one', () => {
  const eventSource: PublicSourceReference = { sourceId: 'ticketmaster.events',
    url: 'https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/',
    attribution: 'Event information provided by Ticketmaster', versionRef: null };
  const eventRequest = parseViewportQuery({ ...request, layers: ['event'] });
  const context = adaptContext(eventRequest, (id) => id === eventSource.sourceId ? eventSource : null,
    '2026-10-01T02:00:00Z');
  const event = newsRow({ source_id: eventSource.sourceId, topic: 'event',
    summary: null, geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate',
    valid_from: window.from, valid_to: window.to });
  const item = adaptLayerRows('event', [event], context).items[0];
  assert.equal(item?.sources[0]?.url, articleUrl);
  assert.equal(item?.sources[0]?.attribution, eventSource.attribution);
  for (const originalUrl of [null, 'javascript:alert(1)']) {
    assert.throws(() => adaptLayerRows('event', [{ ...event, original_url: originalUrl }], context), MapAdapterError);
  }
});
