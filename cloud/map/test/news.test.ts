import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMapConfig } from '@melens/shared/config';
import { parseUnlocatedQuery, parseViewportQuery } from '@melens/shared/contracts/map-contract';
import type { PublicSourceReference } from '@melens/shared/query/adapter-common';
import type { BigQueryViewAdapter, PreparedViewQuery } from '@melens/shared/query/bigquery-adapter';
import type { ViewRow } from '@melens/shared/query/query-runner';
import { createMapService } from '../src/map-service.js';
import { VERIFIED_RECORD_TTL_MS } from '../src/services/public-records.js';

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

test('restricted council planning retains the original project link in scoped results', async () => {
  const sourceId = 'victoria.council.engagement';
  const coverage = { source_id: sourceId, topic: 'planning', scope: 'greater_melbourne',
    coverage_area_refs: ['com:municipal'], coverage_from: window.from, coverage_to: null,
    license_status: 'restricted', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch1', latest_published_at: '2026-10-01T01:01:00Z',
    latest_published_window_from: window.from, latest_published_window_to: window.to,
    latest_published_output_count: 1, coverage_evidence_state: 'verified' };
  const row = newsRow({ source_id: sourceId, topic: 'planning', assertion_kind: 'plan',
    summary: 'Community consultation by City of Melbourne; status: Open; categories: Parks',
    location_role: 'area_only', location_confidence: 'resolved_area' });
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) { return { async readPage() { return {
      rows: [{ record: JSON.stringify(query.query.includes('v_source_coverage') ? coverage : row) }],
      complete: true, hasMore: false }; }, async cancel() {} }; } };
  const service = createMapService({ config, adapter, currentLayerCache: false,
    publicSources: [{ ...council, sourceId, url: 'https://yoursay.darebin.vic.gov.au/projects' }],
    clock: () => new Date('2026-10-01T02:00:00Z') });
  const page = await service.queryUnlocated({ ...unlocated, layers: ['planning'] });
  assert.equal(page.items[0]?.sources[0]?.url, articleUrl);
});

test('Ticketmaster viewport and detail preserve the original event link and reviewed attribution', async () => {
  const sourceId = 'ticketmaster.events';
  const eventUrl = 'https://www.ticketmaster.com.au/event/example-event';
  const coverage = { source_id: sourceId, topic: 'event', scope: 'greater_melbourne',
    coverage_area_refs: ['com:municipal'], coverage_from: window.from, coverage_to: null,
    license_status: 'restricted', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch1', latest_published_at: '2026-10-01T01:01:00Z',
    latest_published_window_from: window.from, latest_published_window_to: window.to,
    latest_published_output_count: 1, coverage_evidence_state: 'verified' };
  const row = newsRow({ source_id: sourceId, topic: 'event', summary: null, original_url: eventUrl,
    geometry_geojson: JSON.stringify({ type: 'Point', coordinates: [144.96, -37.81] }),
    location_role: 'event_site', location_confidence: 'source_coordinate',
    valid_from: window.from, valid_to: window.to });
  const reference = { sourceId, url: 'https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/',
    attribution: 'Event information provided by Ticketmaster', versionRef: null };
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) { return { async readPage() { return {
      rows: [{ record: JSON.stringify(query.query.includes('v_source_coverage') ? coverage : row) }],
      complete: true, hasMore: false }; }, async cancel() {} }; } };
  const service = createMapService({ config, adapter, currentLayerCache: false, publicSources: [reference],
    clock: () => new Date('2026-10-01T02:00:00Z') });
  const viewport = await service.queryViewport({ ...request, layers: ['event'] });
  assert.equal(viewport.layers[0]?.items[0]?.sources[0]?.url, eventUrl);
  const detail = await service.getItem('news:article1', { requestId: 'event-detail', snapshotId: viewport.snapshotId });
  assert.equal(detail.item.sources[0]?.url, eventUrl);
  assert.equal(detail.item.sources[0]?.attribution, reference.attribution);
});

test('map service serves scoped news and rechecks it without an external verifier or replacing the article link', async () => {
  const queries: PreparedViewQuery[] = [];
  let publicRecord = true;
  let now = Date.parse('2026-10-01T02:00:00Z');
  const coverage = { source_id: source.sourceId, topic: 'news', scope: 'city-of-melbourne',
    coverage_area_refs: ['com:municipal'], coverage_from: window.from, coverage_to: null,
    license_status: 'verified_open', access_status: 'active', health_state: 'current',
    latest_published_batch_id: 'batch1', latest_published_at: '2026-10-01T01:01:00Z',
    latest_published_window_from: window.from, latest_published_window_to: window.to,
    latest_published_output_count: 1, coverage_evidence_state: 'verified' };
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query);
      const rows = query.query.includes('v_source_coverage') ? [coverage]
        : query.query.includes('@publicRecordKeysJson') ? publicRecord ? [newsRow()] : []
          : query.query.includes('g.geometry IS NULL') ? [newsRow()] : [];
      return { async readPage() { return { rows: rows.map((row) => ({ record: JSON.stringify(row) })),
        complete: true, hasMore: false }; }, async cancel() {} };
    } };
  const service = createMapService({ config, adapter, currentLayerCache: false,
    publicSources: [source], clock: () => new Date(now) });
  const viewport = await service.queryViewport(request);
  assert.notEqual(viewport.layers[0]?.state, 'unavailable');
  const page = await service.queryUnlocated(unlocated);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.sources[0]?.url, articleUrl);
  assert.equal(page.items[0]?.geometry, null);
  assert.ok(queries.some((query) => query.query.includes('@publicRecordKeysJson')));
  const item = await service.getItem('news:article1', { requestId: 'details', snapshotId: page.snapshotId });
  assert.equal(item.item.id, 'news:article1');
  publicRecord = false;
  // The proof stands for one minute within the same publication.
  assert.equal((await service.getItem('news:article1', { requestId: 'cached', snapshotId: page.snapshotId })).item.id, 'news:article1');
  now += VERIFIED_RECORD_TTL_MS + 1;
  await assert.rejects(service.getItem('news:article1', { requestId: 'withdrawn', snapshotId: page.snapshotId }),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === 'notAvailable');
});

function areaFixture(options: { prewarmNewsAreas?: boolean } = {}) {
  const queries: string[] = [];
  const boundarySource: PublicSourceReference = { sourceId: 'abs.asgs', url: 'https://www.abs.gov.au/',
    attribution: 'Australian Bureau of Statistics', versionRef: null };
  const registry = (sourceId: string, topic: string) => ({ source_id: sourceId, topic, scope: 'victoria',
    coverage_area_refs: [], coverage_from: null, coverage_to: null, license_status: 'verified_open', access_status: 'active',
    health_state: 'current', latest_published_batch_id: 'batch1', latest_published_at: '2026-10-01T01:01:00Z',
    latest_published_window_from: null, latest_published_window_to: null, latest_published_output_count: 1,
    coverage_evidence_state: 'unknown' });
  const area = 'ASGS_LGA:24600:2025';
  const articles = ['news:a', 'news:b'].map((id, index) => newsRow({ geo_record_id: id, version_id: `${id}-v1`,
    title: `Headline ${id}`, summary: null, area_refs: [area], source_updated_at: `2026-10-01T0${index}:00:00Z` }));
  const boundary = { boundary_id: area, version_id: 'boundary-v1', name: 'Melbourne', source_id: boundarySource.sourceId,
    geometry_geojson: JSON.stringify({ type: 'Polygon', coordinates: [[[144.9, -37.9], [145.0, -37.9], [145.0, -37.8],
      [144.9, -37.8], [144.9, -37.9]]] }) };
  const adapter: BigQueryViewAdapter = { async dryRun() { return { bytesProcessed: 1n }; },
    async startQuery(query) {
      queries.push(query.query);
      const rows = query.query.includes('v_source_coverage') ? [registry(source.sourceId, 'news'), registry('abs.asgs', 'boundary')]
        : query.query.includes('v_geo_records_current_state') ? [{ source_id: source.sourceId, batch_id: 'batch1' }]
          : query.query.includes('v_boundaries') ? [boundary]
            : query.query.includes('ARRAY_LENGTH(g.area_refs)') || query.query.includes('@publicRecordKeysJson') ? articles : [];
      return { async readPage() { return { rows: rows.map((row) => ({ record: JSON.stringify(row) })),
        complete: true, hasMore: false }; }, async cancel() {} };
    } };
  const service = createMapService({ config, adapter, currentLayerCache: false, publicSources: [source, boundarySource],
    clock: () => new Date('2026-10-01T02:00:00Z'), ...options });
  return { service, queries, area };
}

test('current news reaches the map as the areas the articles name, with their articles as members', async () => {
  const { service, area } = areaFixture();
  const viewport = await service.queryViewport(request);
  const [item] = viewport.layers[0]?.items ?? [];
  assert.equal(item?.kind, 'aggregate');
  if (item?.kind !== 'aggregate') return;
  assert.equal(item.id, `aggregate.news.area.${area}`);
  assert.equal(item.details.representation, 'areaMentions');
  assert.equal(item.details.metric.value, 2);
  assert.equal(item.location.role, 'areaAssociation');
  const members = await service.getMembers(item.id, { requestId: 'area-members', snapshotId: viewport.snapshotId });
  assert.deepEqual(members.items.map((member) => member.id), ['news:a', 'news:b']);
  assert.ok(members.items.every((member) => member.geometry === null && member.sources[0]?.url === articleUrl));
  assert.equal(members.totalMatching, 2);
  const detail = await service.getItem(item.id, { requestId: 'area-detail', snapshotId: viewport.snapshotId });
  assert.equal(detail.item.id, item.id);
});

test('with prewarming, any request loads the news area copy so a news view does not wait for it', async () => {
  const { service, queries } = areaFixture({ prewarmNewsAreas: true });
  await service.getCatalog();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const loads = queries.filter((query) => query.includes('ARRAY_LENGTH(g.area_refs)')).length;
  assert.equal(loads, 1, 'the catalog request started the load');
  const viewport = await service.queryViewport(request);
  assert.equal(viewport.layers[0]?.items[0]?.kind, 'aggregate');
  assert.equal(queries.filter((query) => query.includes('ARRAY_LENGTH(g.area_refs)')).length, loads);
});
