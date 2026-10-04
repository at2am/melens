import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { parseSourceManifest } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import type { EngagementCouncil } from '../../src/connectors/council_engagement/councils.js';
import {
  CouncilEngagementNewsConnector, lookbackDays, parseNewsPage, parseSitemap, SOURCE_ID,
} from '../../src/connectors/council_engagement_news/index.js';

const HOST = 'yoursay.example.vic.gov.au';
const NOW = Date.parse('2026-10-04T00:00:00Z');
const council: EngagementCouncil = { id: 'example', name: 'Example City Council', lgaCode: '21890',
  host: HOST, listingPaths: ['/projects'] };
const input = parseConnectorInput({ sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null, runId: 'news-fixture' });

interface Fixture { sitemap: string; pages: Record<string, string>; projects: unknown; projectListing: string }

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(new URL('../fixtures/council_engagement_news.json', import.meta.url), 'utf8')) as Fixture;
}

function response<T>(body: T): HttpResponse<T> {
  return { body, status: 200, fetchedAt: '2026-10-04T00:00:00.000Z', etag: null, lastModified: null,
    contentType: null };
}

class SiteClient extends HttpClient {
  readonly requested: string[] = [];
  constructor(private readonly text: Record<string, string>, private readonly json: unknown,
    private readonly failing: ReadonlySet<string> = new Set()) { super(); }
  override async getText(request: HttpRequest): Promise<HttpResponse<string>> {
    const url = String(request.url);
    this.requested.push(url);
    const body = this.text[url];
    if (body === undefined || this.failing.has(url)) throw new HttpFailure('upstream_unavailable', 503, 1);
    return response(body);
  }
  override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    this.requested.push(String(request.url));
    return response(this.json);
  }
}

async function siteClient(failing: ReadonlySet<string> = new Set()): Promise<SiteClient> {
  const data = await fixture();
  return new SiteClient({ [`https://${HOST}/sitemap.xml`]: data.sitemap,
    [`https://${HOST}/projects`]: data.projectListing, ...data.pages }, data.projects, failing);
}

function connector(client: HttpClient): CouncilEngagementNewsConnector {
  return new CouncilEngagementNewsConnector(client, [council], 0, [], () => NOW);
}

test('sitemaps yield recent same-host pages two segments deep', async () => {
  const { sitemap } = await fixture();
  const since = NOW - 14 * 86_400_000;
  assert.deepEqual(parseSitemap(sitemap, HOST, since).map(page => page.url), [
    `https://${HOST}/NRTMP/council-adopts-truck-routes`,
    `https://${HOST}/NRTMP/project-overview`,
    `https://${HOST}/other-news-and-updates/library-reopens`,
  ]);
  assert.equal(parseSitemap(sitemap, HOST, since)[0]?.lastmod, '2026-10-02T00:19:14.000Z');
  assert.throws(() => parseSitemap('<sitemapindex></sitemapindex>', HOST, since));
});

test('only news pages are kept, with headline, project and shown date', async () => {
  const { pages } = await fixture();
  assert.deepEqual(parseNewsPage(pages[`https://${HOST}/NRTMP/council-adopts-truck-routes`] as string), {
    title: 'Council adopts truck routes & signage',
    projectName: 'Northern Reservoir Truck Management Plan', date: '2026-10-02' });
  assert.equal(parseNewsPage(pages[`https://${HOST}/NRTMP/project-overview`] as string), null);
  assert.deepEqual(parseNewsPage(pages[`https://${HOST}/other-news-and-updates/library-reopens`] as string),
    { title: 'Library reopens', projectName: null, date: null });
});

test('lookback revisions are bounded', () => {
  assert.equal(lookbackDays('latest'), 14);
  assert.equal(lookbackDays('lookback-90d'), 90);
  assert.throws(() => lookbackDays('lookback-0d'));
  assert.throws(() => lookbackDays('lookback-400d'));
  assert.throws(() => lookbackDays('all'));
});

test('news inherits its project suburbs and stores facts, never article text', async () => {
  const client = await siteClient();
  const result = await connector(client).collect(input);
  assert.equal(result.kind, 'success');
  const success = result as ConnectorSuccess;
  assert.equal(success.geoRecords.length, 2);
  const [adopted, library] = success.geoRecords;
  assert.equal(adopted?.title, 'Council adopts truck routes & signage');
  assert.equal(adopted?.topic, 'news');
  assert.equal(adopted?.assertion_kind, 'report');
  assert.deepEqual(adopted?.area_refs, ['ASGS_LGA:21890:2025', 'suburb:reservoir']);
  assert.equal(adopted?.published_at, '2026-10-01T14:00:00.000Z');
  assert.equal(adopted?.source_updated_at, '2026-10-02T00:19:14.000Z');
  const summary = JSON.parse(adopted?.summary ?? '{}') as Record<string, unknown>;
  assert.equal(summary.news_scope, 'greater_melbourne');
  assert.equal(summary.project_url, `https://${HOST}/NRTMP`);
  assert.equal(summary.location_reason, 'parent_project');
  // A page outside any listed project stays at council level without a date.
  assert.deepEqual(library?.area_refs, ['ASGS_LGA:21890:2025']);
  assert.equal(library?.published_at, null);
  for (const row of success.geoRecords) {
    assert.doesNotMatch(row.summary ?? '', /article text|11 August/);
    assert.equal(row.rights_status, 'restricted');
    assert.equal(validateGeoRecordGeography(row).valid, true);
  }
  success.sourceRecords.forEach(row => assert.deepEqual(parseSourceRecord(row), row));
  assert.equal(success.sourceLatestUpdateAt, '2026-10-02T00:19:14.000Z');
  // The project list is read because news was found; the old page is never fetched.
  assert.ok(client.requested.includes(`https://${HOST}/projects`));
  assert.ok(!client.requested.some(url => url.includes('old-project')));
});

test('a revised page gets a later-ordered version; a re-read keeps the same one', async () => {
  const first = await connector(await siteClient()).collect(input) as ConnectorSuccess;
  const again = await connector(await siteClient()).collect(input) as ConnectorSuccess;
  assert.deepEqual(again.geoRecords.map(row => row.version_id), first.geoRecords.map(row => row.version_id));
  const data = await fixture();
  const revised = new SiteClient({ [`https://${HOST}/sitemap.xml`]: data.sitemap.replace('2026-10-02T10:19:14', '2026-10-03T08:00:00'),
    [`https://${HOST}/projects`]: data.projectListing, ...data.pages }, data.projects);
  const later = await connector(revised).collect(input) as ConnectorSuccess;
  assert.equal(later.geoRecords[0]?.geo_record_id, first.geoRecords[0]?.geo_record_id);
  assert.notEqual(later.geoRecords[0]?.version_id, first.geoRecords[0]?.version_id);
  assert.ok((later.geoRecords[0]?.source_updated_at ?? '') > (first.geoRecords[0]?.source_updated_at ?? ''));
});

test('an unreadable page is skipped and counted; an unreadable sitemap fails the run', async () => {
  const skipped = await connector(await siteClient(new Set([`https://${HOST}/other-news-and-updates/library-reopens`])))
    .collect(input) as ConnectorSuccess;
  assert.equal(skipped.kind, 'success');
  assert.equal(skipped.rejectedCount, 1);
  assert.equal(skipped.geoRecords.length, 1);
  const noSitemap = await connector(await siteClient(new Set([`https://${HOST}/sitemap.xml`]))).collect(input);
  assert.equal(noSitemap.kind === 'failure' && noSitemap.code, 'upstream_unavailable');
  const time = await connector(await siteClient()).collect(parseConnectorInput({ sourceId: SOURCE_ID,
    checkpoint: null, runId: 't', window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' } }));
  assert.equal(time.kind === 'failure' && time.code, 'validation_failed');
});

test('the manifest admits a restricted news source', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../src/connectors/council_engagement_news/source.json', import.meta.url), 'utf8')) as unknown;
  const source = parseSourceManifest(manifest);
  assert.equal(source.source_id, SOURCE_ID);
  assert.equal(source.topic, 'news');
  assert.equal(source.license_status, 'restricted');
  assert.deepEqual(source.admission_evidence.missing_requirements, []);
});
