import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

import {
  GdeltConnector,
  SOURCE_ID,
  articleUrl,
  connector,
  parseGkgArchive,
  parseLocationMentions,
} from '../../src/connectors/gdelt/index.js';
import { parseConnectorInput } from '../../src/core/connector.js';
import { HttpClient, HttpFailure, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { parseSourceManifest } from '../../src/core/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '../../src/connectors/gdelt/source.json');

function createGkgLine(fields: Partial<Record<number, string>>): string {
  const row = new Array(27).fill('');
  for (const [idx, val] of Object.entries(fields)) {
    row[Number(idx)] = val;
  }
  return row.join('\t');
}

function createZipArchive(entryName: string, content: string): Uint8Array {
  return zipSync({
    [entryName]: strToU8(content),
  });
}

test('Source manifest parses successfully and stays review_required and candidate', async () => {
  const manifestRaw = JSON.parse(await readFile(manifestPath, 'utf8'));
  const dataSource = parseSourceManifest(manifestRaw);

  assert.equal(dataSource.source_id, SOURCE_ID);
  assert.equal(dataSource.topic, 'news');
  assert.equal(dataSource.scope, 'global');
  assert.equal(dataSource.license_status, 'review_required');
  assert.equal(dataSource.access_status, 'candidate');
  assert.equal(
    dataSource.admission_evidence.license_evidence_url,
    'https://www.gdeltproject.org/about.html#termsofuse'
  );
  assert.equal(connector.sourceId, SOURCE_ID);
});

test('articleUrl correctly strips multiple tracking parameters, trailing slashes, and invalid protocols', () => {
  // Test multiple consecutive tracking parameters (regression test for iterator deletion bug)
  const multiParam = 'https://example.com/news/melbourne-story?utm_source=twitter&utm_medium=social&utm_campaign=winter&id=42';
  assert.equal(articleUrl(multiParam), 'https://example.com/news/melbourne-story?id=42');

  // Test trailing slash removal
  const trailingSlash = 'https://example.com/news/melbourne-story/?utm_source=feed';
  assert.equal(articleUrl(trailingSlash), 'https://example.com/news/melbourne-story');

  // Test root trailing slash remains intact
  assert.equal(articleUrl('https://example.com/'), 'https://example.com/');

  // Test fbclid, gclid, mc_cid, mc_eid removal
  const adParams = 'https://example.com/article?fbclid=123&gclid=456&mc_cid=789&mc_eid=abc&ref=real';
  assert.equal(articleUrl(adParams), 'https://example.com/article?ref=real');

  // Test fragment removal
  assert.equal(articleUrl('https://example.com/story#section1'), 'https://example.com/story');

  // Test non-HTTP protocols
  assert.equal(articleUrl('ftp://example.com/file'), null);
  assert.equal(articleUrl('javascript:void(0)'), null);
  assert.equal(articleUrl('not-a-url'), null);

  // Test whitespace trimming
  assert.equal(articleUrl('  https://example.com/story  '), 'https://example.com/story');
});

test('parseLocationMentions parses and deduplicates repeated mentions within the same record', () => {
  // Real GDELT records repeat the place name for each character offset in the article
  const raw = '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#76;4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#1054;4#Sydney, New South Wales, Australia#AS#AS02#154637#-33.8833#151.217#-1603135#204;';
  const mentions = parseLocationMentions(raw);

  // Duplicate Melbourne mention is collapsed
  assert.equal(mentions.length, 2);
  assert.equal(mentions[0]?.name, 'Melbourne, Victoria, Australia');
  assert.equal(mentions[0]?.countryCode, 'AS');
  assert.equal(mentions[0]?.adm1Code, 'AS07');
  assert.equal(mentions[0]?.featureId, '-1586844');

  assert.equal(mentions[1]?.name, 'Sydney, New South Wales, Australia');
  assert.equal(mentions[1]?.countryCode, 'AS');
  assert.equal(mentions[1]?.adm1Code, 'AS02');

  // Handles empty or malformed strings gracefully
  assert.deepEqual(parseLocationMentions(''), []);
  assert.deepEqual(parseLocationMentions(';;;'), []);
});

test('parseGkgArchive extracts Victoria candidates and excludes non-Victoria rows', () => {
  const ts = '20260930120000';
  const lineVic = createGkgLine({
    0: '20260930120000-1',
    1: '20260930120000',
    3: 'theage.com.au',
    4: 'https://theage.com.au/melbourne-update?utm_source=twitter&utm_medium=feed',
    7: 'TAX_FNCACT;ENV_MET;TAX_FNCACT;',
    10: '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#76;4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#120;',
  });
  const lineNonVic = createGkgLine({
    0: '20260930120000-2',
    1: '20260930120000',
    3: 'usatoday.com',
    4: 'https://usatoday.com/florida-story',
    7: 'TAX_FNCACT;',
    10: '3#Melbourne, Florida, United States#US#USFL##28.0836#-80.6081#12345#45;',
  });

  const zipBytes = createZipArchive(`${ts}.gkg.csv`, `${lineVic}\n${lineNonVic}\n`);
  const candidates = parseGkgArchive(zipBytes, ts);

  assert.equal(candidates.length, 1);
  const cand = candidates[0]!;
  assert.equal(cand.gkgRecordId, '20260930120000-1');
  assert.equal(cand.articleUrl, 'https://theage.com.au/melbourne-update');
  assert.equal(cand.gkgProcessedAt, '2026-09-30T12:00:00Z');
  assert.equal(cand.sourceName, 'theage.com.au');
  assert.deepEqual(cand.rawLocationNames, ['Melbourne, Victoria, Australia']);
  assert.equal(cand.victoriaMentions.length, 1);
  assert.deepEqual(cand.themes, ['TAX_FNCACT', 'ENV_MET']);

  // Throws on corrupt zip
  assert.throws(() => parseGkgArchive(new Uint8Array([1, 2, 3, 4]), ts), /GDELT archive is invalid/);

  // Throws on missing expected entry
  const wrongZip = createZipArchive('other.csv', 'data');
  assert.throws(() => parseGkgArchive(wrongZip, ts), /GDELT archive lacks the expected bounded GKG CSV entry/);
});

test('GdeltConnector rejects invalid time window or mismatched sourceId', async () => {
  const conn = new GdeltConnector();

  // Mismatched sourceId
  const wrongSource = await conn.collect(
    parseConnectorInput({
      sourceId: 'wrong.source',
      window: { kind: 'time', from: '2026-09-30T12:00:00Z', to: '2026-09-30T12:15:00Z' },
      checkpoint: null,
      runId: 'test-run-1',
    })
  );
  assert.equal(wrongSource.kind, 'failure');
  if (wrongSource.kind === 'failure') assert.equal(wrongSource.code, 'validation_failed');

  // Non-aligned window
  const unaligned = await conn.collect(
    parseConnectorInput({
      sourceId: SOURCE_ID,
      window: { kind: 'time', from: '2026-09-30T12:05:00Z', to: '2026-09-30T12:20:00Z' },
      checkpoint: null,
      runId: 'test-run-2',
    })
  );
  assert.equal(unaligned.kind, 'failure');
  if (unaligned.kind === 'failure') assert.equal(unaligned.code, 'validation_failed');

  // Window exceeding 16 intervals
  const tooLong = await conn.collect(
    parseConnectorInput({
      sourceId: SOURCE_ID,
      window: { kind: 'time', from: '2026-09-30T00:00:00Z', to: '2026-09-30T05:00:00Z' },
      checkpoint: null,
      runId: 'test-run-3',
    })
  );
  assert.equal(tooLong.kind, 'failure');
  if (tooLong.kind === 'failure') assert.equal(tooLong.code, 'validation_failed');
});

test('GdeltConnector.collect successfully reads multi-interval window and deduplicates within window', async () => {
  const ts1 = '20260930120000';
  const ts2 = '20260930121500';

  // Article 1 appears in ts1 with twitter tracking
  const art1Line1 = createGkgLine({
    0: `${ts1}-101`,
    1: ts1,
    3: 'abc.net.au',
    4: 'https://www.abc.net.au/news/melbourne-cbd-story?utm_source=twitter&utm_medium=social',
    7: 'CRIME;TAX_FNCACT;',
    10: '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#100;',
  });

  // Article 2 appears only in ts1
  const art2Line = createGkgLine({
    0: `${ts1}-102`,
    1: ts1,
    3: 'theage.com.au',
    4: 'https://www.theage.com.au/geelong-event',
    7: 'GENERAL_GOVERNMENT;',
    10: '4#Geelong, Victoria, Australia#AS#AS07#5430#-38.15#144.35#-1574900#50;',
  });

  // Article 1 re-appears in ts2 with facebook tracking and an additional Carlton location mention
  const art1Line2 = createGkgLine({
    0: `${ts2}-205`,
    1: ts2,
    3: 'abc.net.au',
    4: 'https://www.abc.net.au/news/melbourne-cbd-story/?utm_source=facebook',
    7: 'CRIME;POLITICS;',
    10: '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#200;4#Carlton, Victoria, Australia#AS#AS07#5430#-37.8#144.967#-1564344#400;',
  });

  const zip1 = createZipArchive(`${ts1}.gkg.csv`, `${art1Line1}\n${art2Line}\n`);
  const zip2 = createZipArchive(`${ts2}.gkg.csv`, `${art1Line2}\n`);

  class MockGdeltClient extends HttpClient {
    override async getBytes(request: any): Promise<any> {
      const urlStr = String(request.url);
      if (urlStr.includes(ts1)) {
        return {
          body: Buffer.from(zip1),
          status: 200,
          fetchedAt: '2026-09-30T12:30:00Z',
          etag: null,
          lastModified: '2026-09-30T12:05:00Z',
          contentType: 'application/zip',
        };
      }
      if (urlStr.includes(ts2)) {
        return {
          body: Buffer.from(zip2),
          status: 200,
          fetchedAt: '2026-09-30T12:30:00Z',
          etag: null,
          lastModified: '2026-09-30T12:20:00Z',
          contentType: 'application/zip',
        };
      }
      throw new HttpFailure('upstream_unavailable', 404, 1);
    }
  }

  const conn = new GdeltConnector(new MockGdeltClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T12:00:00Z', to: '2026-09-30T12:30:00Z' },
    checkpoint: null,
    runId: 'gdelt-window-test',
  });

  const result = await conn.collect(input);
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') return;

  // Total raw candidates across the two files was 3 (art1, art2, art1-dup)
  assert.equal(result.inputCount, 3);
  // Exactly 2 distinct logical articles in output (art1 and art2)
  assert.equal(result.outputCount, 2);
  // 1 duplicate rejected/merged
  assert.equal(result.rejectedCount, 1);
  assert.equal(result.sourceRecords.length, 2);
  assert.equal(result.geoRecords.length, 2);
  assert.equal(result.geoRecordSources.length, 2);
  assert.equal(result.articleCandidates.length, 2);

  // Check that art1 merged cleanly
  const art1Record = result.sourceRecords.find((r) =>
    r.original_url === 'https://www.abc.net.au/news/melbourne-cbd-story'
  );
  assert.ok(art1Record);
  assert.equal(art1Record.rights_status, 'review_required');
  assert.equal(art1Record.source_updated_at, '2026-09-30T12:15:00Z');
  assert.equal(
    art1Record.time_missing_reason,
    'GKG DATE is processing time, not the original article publication or incident time'
  );

  const art1Geo = result.geoRecords.find((r) =>
    r.original_url === 'https://www.abc.net.au/news/melbourne-cbd-story'
  );
  assert.ok(art1Geo);
  assert.equal(art1Geo.topic, 'news');
  assert.equal(art1Geo.location_role, 'mentioned_place');
  assert.equal(art1Geo.location_confidence, 'unverified');
  assert.equal(art1Geo.public_query_allowed, false);

  const summaryObj = JSON.parse(art1Geo.summary ?? '{}');
  // Locations from both intervals are merged
  assert.deepEqual(summaryObj.gdelt_location_mentions, [
    'Carlton, Victoria, Australia',
    'Melbourne, Victoria, Australia',
  ]);
  // Themes from both intervals are merged
  assert.deepEqual(summaryObj.themes, ['CRIME', 'POLITICS', 'TAX_FNCACT']);
});

test('GdeltConnector handles 404 with incomplete_window code', async () => {
  class NotFoundClient extends HttpClient {
    override async getBytes(_request: any): Promise<any> {
      throw new HttpFailure('upstream_unavailable', 404, 1);
    }
  }

  const conn = new GdeltConnector(new NotFoundClient());
  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T12:00:00Z', to: '2026-09-30T12:15:00Z' },
    checkpoint: null,
    runId: 'gdelt-404-test',
  });

  const result = await conn.collect(input);
  assert.equal(result.kind, 'failure');
  if (result.kind === 'failure') {
    assert.equal(result.code, 'incomplete_window');
    assert.equal(result.completeness.complete, false);
    assert.equal(result.completeness.expected_pages, 1);
    assert.equal(result.completeness.fetched_pages, 0);
  }
});

test('R05 regression: deduplication and tie-break are 100% deterministic under input order permutation', async () => {
  const ts = '20260930120000';
  // Row A: processed at ts, record ID ending with -001, theme THEME_A, location Melbourne
  const rowA = createGkgLine({
    0: `${ts}-001`,
    1: ts,
    3: 'theage.com.au',
    4: 'https://theage.com.au/melbourne-invariant-test',
    7: 'THEME_A;',
    10: '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8167#144.967#-1586844#100;',
  });

  // Row B: processed at exact same timestamp ts, record ID ending with -002, theme THEME_B, location Carlton
  const rowB = createGkgLine({
    0: `${ts}-002`,
    1: ts,
    3: 'theage.com.au',
    4: 'https://theage.com.au/melbourne-invariant-test',
    7: 'THEME_B;',
    10: '4#Carlton, Victoria, Australia#AS#AS07#5430#-37.8#144.967#-1564344#200;',
  });

  // Second distinct article to verify cross-record ordering stability
  const rowC = createGkgLine({
    0: `${ts}-003`,
    1: ts,
    3: 'abc.net.au',
    4: 'https://abc.net.au/victoria-secondary-test',
    7: 'POLITICS;',
    10: '4#Ballarat, Victoria, Australia#AS#AS07#5430#-37.56#143.85#-1557344#50;',
  });

  // Permutation 1: order [rowA, rowB, rowC]
  const zipPerm1 = createZipArchive(`${ts}.gkg.csv`, `${rowA}\n${rowB}\n${rowC}\n`);
  // Permutation 2: order [rowC, rowB, rowA] (fully reversed)
  const zipPerm2 = createZipArchive(`${ts}.gkg.csv`, `${rowC}\n${rowB}\n${rowA}\n`);

  class PermutationClient extends HttpClient {
    constructor(private readonly zipBytes: Uint8Array) {
      super();
    }
    override async getBytes(_request: any): Promise<any> {
      return {
        body: Buffer.from(this.zipBytes),
        status: 200,
        fetchedAt: '2026-09-30T12:30:00Z',
        etag: null,
        lastModified: '2026-09-30T12:05:00Z',
        contentType: 'application/zip',
      };
    }
  }

  const input = parseConnectorInput({
    sourceId: SOURCE_ID,
    window: { kind: 'time', from: '2026-09-30T12:00:00Z', to: '2026-09-30T12:15:00Z' },
    checkpoint: null,
    runId: 'gdelt-permutation-test',
  });

  const res1 = await new GdeltConnector(new PermutationClient(zipPerm1)).collect(input);
  const res2 = await new GdeltConnector(new PermutationClient(zipPerm2)).collect(input);

  assert.equal(res1.kind, 'success');
  assert.equal(res2.kind, 'success');
  if (res1.kind !== 'success' || res2.kind !== 'success') return;

  assert.equal(res1.outputCount, 2);
  assert.equal(res2.outputCount, 2);
  assert.equal(res1.rejectedCount, 1);
  assert.equal(res2.rejectedCount, 1);

  // Both runs must have exactly matching sourceRecords and version_ids
  assert.equal(res1.sourceRecords.length, res2.sourceRecords.length);
  res1.sourceRecords.forEach((r1, i) => {
    const r2 = res2.sourceRecords[i];
    assert.ok(r2);
    assert.equal(r1.source_record_id, r2.source_record_id);
    assert.equal(r1.version_id, r2.version_id);
    assert.equal(r1.original_url, r2.original_url);
    assert.equal(r1.source_updated_at, r2.source_updated_at);
  });

  // Both runs must have exactly matching geoRecords and summary payloads
  assert.equal(res1.geoRecords.length, res2.geoRecords.length);
  res1.geoRecords.forEach((g1, i) => {
    const g2 = res2.geoRecords[i];
    assert.ok(g2);
    assert.equal(g1.geo_record_id, g2.geo_record_id);
    assert.equal(g1.version_id, g2.version_id);
    assert.equal(g1.summary, g2.summary);
  });

  // Verify the tie-break explicitly chose the deterministically preferred gkgRecordId (higher string: rowB over rowA)
  const mergedArticle = res1.articleCandidates.find(
    (a) => a.articleUrl === 'https://theage.com.au/melbourne-invariant-test'
  );
  assert.ok(mergedArticle);
  assert.equal(mergedArticle.gkgRecordId, `${ts}-002`);
  assert.deepEqual(mergedArticle.rawLocationNames, [
    'Carlton, Victoria, Australia',
    'Melbourne, Victoria, Australia',
  ]);
  assert.deepEqual(mergedArticle.themes, ['THEME_A', 'THEME_B']);
});
