import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseConnectorInput, type ConnectorSuccess } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { parseSourceManifest } from '../../src/core/registry.js';
import { validateGeoRecordGeography } from '../../src/validation/geography.js';
import { parseSourceRecord } from '../../src/validation/record.js';
import { ENGAGEMENT_COUNCILS, LGA_VINTAGE, type EngagementCouncil }
  from '../../src/connectors/council_engagement/councils.js';
import {
  CouncilEngagementConnector, discoverListRoutes, listedSuburbs, melbourneDateStart,
  normalizeProjects, SOURCE_ID, USER_AGENT, type EngagementProject,
} from '../../src/connectors/council_engagement/index.js';

const HOST = 'yoursay.example.vic.gov.au';
const ROUTE = `https://${HOST}/ccm/the_hive_projects/tools/the_hive_projects_list/load_more`;
const council: EngagementCouncil = { id: 'example', name: 'Example City Council', lgaCode: '21890',
  host: HOST, listingPaths: ['/', '/projects'] };
const input = parseConnectorInput({ sourceId: SOURCE_ID,
  window: { kind: 'snapshot', revision: 'latest' }, checkpoint: null, runId: 'engagement-fixture' });

interface Fixture { listingHtml: string; pages: Record<string, unknown> }

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(new URL('../fixtures/council_engagement.json', import.meta.url), 'utf8')) as Fixture;
}

function response<T>(body: T): HttpResponse<T> {
  return { body, status: 200, fetchedAt: '2026-10-04T00:00:00.000Z', etag: null,
    lastModified: null, contentType: null };
}

/** Serves fixture listing pages and project-list pages; records every request. */
class FixtureClient extends HttpClient {
  readonly requests: { url: string; headers: HeadersInit | undefined }[] = [];
  constructor(private readonly html: Record<string, string>, private readonly pages: Record<string, unknown>) {
    super();
  }
  override async getText(request: HttpRequest): Promise<HttpResponse<string>> {
    const url = String(request.url);
    this.requests.push({ url, headers: request.headers });
    const body = this.html[url];
    if (body === undefined) throw new HttpFailure('schema_changed', 404, 1);
    return response(body);
  }
  override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const url = new URL(request.url);
    this.requests.push({ url: url.toString(), headers: request.headers });
    const block = url.pathname.split('/').at(-1);
    const body = this.pages[`${block}:${url.searchParams.get('page')}`];
    if (body === undefined) throw new HttpFailure('schema_changed', 404, 1);
    return response(body);
  }
}

async function fixtureClient(): Promise<FixtureClient> {
  const data = await fixture();
  return new FixtureClient({ [`https://${HOST}/`]: '<html></html>', [`https://${HOST}/projects`]: data.listingHtml },
    data.pages);
}

test('only same-host project-list blocks are discovered', async () => {
  const { listingHtml } = await fixture();
  assert.deepEqual(discoverListRoutes(listingHtml, HOST), [`${ROUTE}/12`, `${ROUTE}/13`]);
  assert.deepEqual(discoverListRoutes(listingHtml, 'other.example.vic.gov.au'), []);
});

test('Melbourne local dates become UTC midnights across daylight saving', () => {
  assert.equal(melbourneDateStart('2026-10-04'), '2026-10-03T13:00:00.000Z');
  assert.equal(melbourneDateStart('2026-07-01'), '2026-06-30T14:00:00.000Z');
  assert.throws(() => melbourneDateStart('2026-02-30'));
});

test('neighbourhood pairs split into separate suburbs', () => {
  const project = { projectLocationArray: ['Albert Park/ Middle Park', 'Middle Park', ' '] } as EngagementProject;
  assert.deepEqual(listedSuburbs(project), ['Albert Park', 'Middle Park']);
});

test('a full snapshot pages every block, merges duplicates and keeps only listed facts', async () => {
  const client = await fixtureClient();
  const result = await new CouncilEngagementConnector(client, [council], 0, []).collect(input);
  assert.equal(result.kind, 'success');
  const success = result as ConnectorSuccess;
  assert.equal(success.completeness.complete, true);
  assert.equal(success.completeness.fetched_pages, 5);
  assert.deepEqual(success.geoRecords.map(row => row.geo_record_id),
    [`${SOURCE_ID}:example:900`, `${SOURCE_ID}:example:1100`, `${SOURCE_ID}:example:1204`]);
  for (const request of client.requests) {
    assert.equal(new Headers(request.headers).get('user-agent'), USER_AGENT);
  }

  const [closed, budget, local] = success.geoRecords;
  const lga = `ASGS_LGA:21890:${LGA_VINTAGE}`;
  assert.deepEqual(local?.area_refs, [lga, 'suburb:reservoir']);
  assert.equal(local?.record_status, 'active');
  assert.equal(local?.published_at, '2026-10-01T14:00:00.000Z');
  assert.equal(local?.original_url, `https://${HOST}/NRTMP`);
  // Seven listed suburbs read as council-wide rather than seven local projects.
  assert.deepEqual(budget?.area_refs, [lga]);
  assert.match(budget?.summary ?? '', /area: council-wide/);
  assert.match(budget?.summary ?? '', /categories: Budget, Strategy;/);
  assert.deepEqual(closed?.area_refs, [lga, 'suburb:albert_park', 'suburb:middle_park']);
  assert.equal(closed?.record_status, 'resolved');

  for (const row of success.geoRecords) {
    assert.equal(row.rights_status, 'restricted');
    assert.equal(row.geometry_geojson, null);
    assert.equal(validateGeoRecordGeography(row).valid, true);
    assert.doesNotMatch(row.summary ?? '', /description/i);
  }
  success.sourceRecords.forEach(row => assert.deepEqual(parseSourceRecord(row), row));
  assert.equal(new Set(success.geoRecords.map(row => row.fetched_at)).size, 1);
  assert.equal(success.geoRecordSources.length, 3);
});

test('versions ignore description and image changes but follow status changes', async () => {
  const data = await fixture();
  const project = (data.pages['12:0'] as { result: EngagementProject[] }).result[0] as EngagementProject;
  const base = normalizeProjects(council, [project], input, '2026-10-04T00:00:00.000Z');
  const cosmetic = normalizeProjects(council, [{ ...project, projectDescription: 'Rewritten',
    projectImageSrc: 'https://files.example.com/new.jpg' }], input, '2026-10-05T00:00:00.000Z');
  const closed = normalizeProjects(council, [{ ...project, projectStatus: 'Closed' }], input,
    '2026-10-05T00:00:00.000Z');
  assert.equal(cosmetic.geoRecords[0]?.version_id, base.geoRecords[0]?.version_id);
  assert.notEqual(closed.geoRecords[0]?.version_id, base.geoRecords[0]?.version_id);
  assert.equal(closed.geoRecords[0]?.geo_record_id, base.geoRecords[0]?.geo_record_id);
});

test('a single malformed card is skipped and counted, not published', async () => {
  const data = await fixture();
  const page = data.pages['13:0'] as { result: unknown[]; moreToLoad: boolean };
  const client = new FixtureClient({ [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml },
    { ...data.pages, '13:0': { ...page, result: [...page.result, { projectID: 498, projectName: ' ',
      projectStatus: 'Active', projectPath: `https://${HOST}/blank`, projectDateNum: '2026-01-01' }] } });
  const result = await new CouncilEngagementConnector(client, [council], 0, []).collect(input);
  assert.equal(result.kind, 'success');
  const success = result as ConnectorSuccess;
  assert.equal(success.rejectedCount, 1);
  assert.equal(success.inputCount, 4);
  assert.equal(success.geoRecords.some(row => row.geo_record_id.endsWith(':498')), false);
});

test('a project link to another host stops the snapshot', async () => {
  const data = await fixture();
  const project = (data.pages['12:0'] as { result: EngagementProject[] }).result[0] as EngagementProject;
  assert.throws(() => normalizeProjects(council, [{ ...project, projectPath: 'https://evil.example.com/x' }],
    input, '2026-10-04T00:00:00.000Z'));
});

test('missing lists, empty councils, bad pages and time windows fail closed', async () => {
  const data = await fixture();
  const empty = { result: [], moreToLoad: false };
  const cases: [string, FixtureClient, string][] = [
    ['no list', new FixtureClient({ [`https://${HOST}/`]: '<p></p>', [`https://${HOST}/projects`]: '<p></p>' }, {}),
      'schema_changed'],
    ['empty council', new FixtureClient({ [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml },
      { '12:0': empty, '13:0': empty }), 'incomplete_window'],
    ['malformed format', new FixtureClient({ [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml },
      { ...data.pages, '13:0': { result: [1, 2, 3].map(id => ({ projectID: id, projectName: '',
        projectStatus: 'Draft', projectPath: `https://${HOST}/x`, projectDateNum: null })),
        moreToLoad: false } }), 'schema_changed'],
    ['missing page', new FixtureClient({ [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml },
      { '12:0': data.pages['12:0'], '13:0': data.pages['13:0'] }), 'schema_changed'],
  ];
  for (const [name, client, code] of cases) {
    const result = await new CouncilEngagementConnector(client, [council], 0, []).collect(input);
    assert.equal(result.kind, 'failure', name);
    assert.equal(result.kind === 'failure' && result.code, code, name);
  }
  const timeInput = parseConnectorInput({ sourceId: SOURCE_ID, checkpoint: null, runId: 'time',
    window: { kind: 'time', from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' } });
  const time = await new CouncilEngagementConnector(await fixtureClient(), [council], 0, []).collect(timeInput);
  assert.equal(time.kind === 'failure' && time.code, 'validation_failed');
});

test('councils are fetched in parallel, ordered by configuration, and any failure fails the snapshot', async () => {
  const data = await fixture();
  const second: EngagementCouncil = { ...council, id: 'second', host: 'second.example.vic.gov.au' };
  const secondHtml = data.listingHtml.replaceAll(HOST, second.host);
  const secondPages = JSON.parse(JSON.stringify(data.pages).replaceAll(HOST, second.host)) as Record<string, unknown>;
  const html = { [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml,
    [`https://${second.host}/`]: '', [`https://${second.host}/projects`]: secondHtml };
  class TwoHostClient extends FixtureClient {
    override async getJson(request: HttpRequest): Promise<HttpResponse<unknown>> {
      const url = new URL(request.url);
      const pages = url.host === HOST ? data.pages : secondPages;
      const body = pages[`${url.pathname.split('/').at(-1)}:${url.searchParams.get('page')}`];
      if (body === undefined) throw new HttpFailure('schema_changed', 404, 1);
      return response(body);
    }
  }
  const ok = await new CouncilEngagementConnector(new TwoHostClient(html, {}), [second, council], 0, []).collect(input);
  assert.equal(ok.kind, 'success');
  assert.deepEqual((ok as ConnectorSuccess).geoRecords.map(row => row.geo_record_id.split(':')[1]),
    ['second', 'second', 'second', 'example', 'example', 'example']);

  const broken = { ...html, [`https://${second.host}/projects`]: '<p></p>' };
  const failed = await new CouncilEngagementConnector(new TwoHostClient(broken, {}), [council, second], 0, []).collect(input);
  assert.equal(failed.kind, 'failure');
  assert.match(failed.kind === 'failure' ? failed.message : '', /second/);
});

test('a transient HTTP failure retries the whole council; a persistent one still fails', async () => {
  class FlakyClient extends FixtureClient {
    failures: number;
    constructor(html: Record<string, string>, pages: Record<string, unknown>, failures: number) {
      super(html, pages);
      this.failures = failures;
    }
    override async getText(request: HttpRequest): Promise<HttpResponse<string>> {
      if (this.failures > 0) {
        this.failures -= 1;
        throw new HttpFailure('schema_changed', 404, 1);
      }
      return super.getText(request);
    }
  }
  const data = await fixture();
  const html = { [`https://${HOST}/`]: '', [`https://${HOST}/projects`]: data.listingHtml };
  const recovered = await new CouncilEngagementConnector(new FlakyClient(html, data.pages, 1), [council], 0, [0, 0])
    .collect(input);
  assert.equal(recovered.kind, 'success');
  assert.equal((recovered as ConnectorSuccess).geoRecords.length, 3);
  const persistent = await new CouncilEngagementConnector(new FlakyClient(html, data.pages, 3), [council], 0, [0, 0])
    .collect(input);
  assert.equal(persistent.kind === 'failure' && persistent.code, 'schema_changed');
});

test('the manifest admits a restricted source that covers every configured council', async () => {
  const manifest = JSON.parse(await readFile(
    new URL('../../src/connectors/council_engagement/source.json', import.meta.url), 'utf8')) as unknown;
  const source = parseSourceManifest(manifest);
  assert.equal(source.source_id, SOURCE_ID);
  assert.equal(source.license_status, 'restricted');
  assert.deepEqual(source.admission_evidence.missing_requirements, []);
  assert.equal(source.admission_evidence.raw_retention_days, 0);
  assert.deepEqual([...source.coverage_area_refs].sort(),
    ENGAGEMENT_COUNCILS.map(entry => `ASGS_LGA:${entry.lgaCode}:${LGA_VINTAGE}`).sort());
  assert.equal(new Set(ENGAGEMENT_COUNCILS.map(entry => entry.id)).size, ENGAGEMENT_COUNCILS.length);
  assert.equal(new Set(ENGAGEMENT_COUNCILS.map(entry => entry.host)).size, ENGAGEMENT_COUNCILS.length);
});
