import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { GdeltConnector } from '../../src/connectors/gdelt/index.js';
import { HttpClient, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import { normalizeGdeltNews } from '../../src/normalization/news-runtime.js';
import { verifiedNewsPublicationEvidence, withVerifiedNewsPublicationEvidence }
  from '../../src/normalization/news-publication-evidence.js';

test('reviewed source publication evidence enriches exact URLs and preserves event time and source links', async () => {
  const evidence = verifiedNewsPublicationEvidence.find(item => item.metadataField === 'datePublished');
  assert.ok(evidence);
  const timestamp = '20261001103000';
  const rows = [evidence.articleUrl, 'https://example.com/unreviewed-article'].map((url, index) => {
    const fields = Array<string>(27).fill('');
    fields[0] = `${timestamp}-${index}`; fields[1] = timestamp;
    fields[3] = 'example'; fields[4] = url;
    fields[10] = '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8#144.9#vic#5;';
    return fields.join('\t');
  });
  const bytes = zipSync({ [`${timestamp}.gkg.csv`]: strToU8(rows.join('\n')) });
  class Client extends HttpClient {
    override async getStream(_request: HttpRequest): Promise<HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>> {
      return { body: new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(bytes)); controller.close();
      } }), status: 200, fetchedAt: '2026-10-01T11:00:00Z', etag: null,
      lastModified: null, contentType: 'application/zip' };
    }
  }
  const result = await new GdeltConnector(new Client()).collect({ sourceId: 'gdelt.news',
    runId: 'source-publication-regression', checkpoint: null,
    window: { kind: 'time', from: '2026-10-01T10:30:00Z', to: '2026-10-01T10:45:00Z' } });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') throw new Error('Fixture unexpectedly failed');
  const located = normalizeGdeltNews(result, [{ scheme: 'ASGS_LGA', code: '24600',
    vintage: '2025', name: 'Melbourne', boundaryId: 'ASGS_LGA:24600:2025' }]);
  const enriched = withVerifiedNewsPublicationEvidence(located);
  const source = enriched.sourceRecords.find(item => item.original_url === evidence.articleUrl);
  const geo = enriched.geoRecords.find(item => item.original_url === evidence.articleUrl);
  assert.ok(source); assert.ok(geo);
  assert.equal(source.published_at, '2026-10-01T05:19:07.000Z');
  assert.equal(geo.published_at, source.published_at);
  assert.equal(source.observed_at, null); assert.equal(geo.observed_at, null);
  assert.equal(geo.location_role, 'mentioned_place'); assert.equal(geo.geometry_geojson, null);
  assert.deepEqual(geo.area_refs, ['ASGS_LGA:24600:2025']);
  assert.equal(JSON.parse(geo.summary ?? '{}').logical_event_key, evidence.logicalEventKey);
  const link = enriched.geoRecordSources.find(item => item.geo_record_id === geo.geo_record_id);
  assert.equal(link?.version_id, geo.version_id);
  assert.equal(link?.source_version_id, source.version_id);
  assert.equal(enriched.geoRecords.find(item => item.original_url?.includes('unreviewed'))?.published_at, null);
  assert.deepEqual(withVerifiedNewsPublicationEvidence(located).geoRecords, enriched.geoRecords);
  assert.equal(verifiedNewsPublicationEvidence.length, 10);
  assert.equal(new Set(verifiedNewsPublicationEvidence.map(item => item.logicalEventKey)).size, 10);
  assert.equal(new Set(verifiedNewsPublicationEvidence.map(item => item.sourceTimestamp.slice(0, 10))).size, 3);
});
