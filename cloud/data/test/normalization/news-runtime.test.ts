import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';

import { GdeltConnector } from '../../src/connectors/gdelt/index.js';
import { HttpClient, type HttpRequest, type HttpResponse } from '../../src/core/http.js';
import type { AreaRef } from '../../src/normalization/areas.js';
import { normalizeGdeltNews } from '../../src/normalization/news-runtime.js';

const timestamp = '20260930120000';
const areas: readonly AreaRef[] = [
  { scheme: 'ASGS_LGA', code: '24600', vintage: '2025', name: 'Melbourne',
    boundaryId: 'ASGS_LGA:24600:2025' },
  { scheme: 'ASGS_STE', code: '2', vintage: '2026', name: 'Victoria',
    boundaryId: 'ASGS_STE:2:2026' },
];

async function collected(mixed: boolean) {
  const fields = Array<string>(27).fill('');
  fields[0] = `${timestamp}-1`; fields[1] = timestamp;
  fields[3] = 'example.com'; fields[4] = 'https://example.com/story';
  fields[10] = '4#Melbourne, Victoria, Australia#AS#AS07#5430#-37.8#144.9#vic#5;'
    + (mixed ? '4#Melbourne, Florida, United States#US#USFL##28.1#-80.6#fl#9;' : '');
  fields[26] = '<PAGE_TITLE>Metadata headline</PAGE_TITLE>';
  const bytes = zipSync({ [`${timestamp}.gkg.csv`]: strToU8(fields.join('\t')) });
  class Client extends HttpClient {
    override async getStream(_request: HttpRequest): Promise<HttpResponse<ReadableStream<Uint8Array<ArrayBuffer>>>> {
      return { body: new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array(bytes)); controller.close();
      } }), status: 200, fetchedAt: '2026-09-30T12:30:00Z', etag: null,
      lastModified: null, contentType: 'application/zip' };
    }
  }
  const result = await new GdeltConnector(new Client()).collect({ sourceId: 'gdelt.news',
    runId: 'normalization-regression', checkpoint: null,
    window: { kind: 'time', from: '2026-09-30T12:00:00Z', to: '2026-09-30T12:15:00Z' } });
  assert.equal(result.kind, 'success');
  if (result.kind !== 'success') throw new Error('Fixture unexpectedly failed');
  return result;
}

test('default publication normalization keeps mention precision and exact source versions', async () => {
  const result = await collected(false);
  const normalized = normalizeGdeltNews(result, areas);
  const record = normalized.geoRecords[0];
  assert.ok(record);
  assert.equal(record.location_role, 'mentioned_place');
  assert.equal(record.location_confidence, 'unverified');
  assert.equal(record.geometry_geojson, null);
  assert.deepEqual(record.area_refs, ['ASGS_LGA:24600:2025']);
  assert.equal(record.published_at, null);
  assert.equal(record.observed_at, null);
  assert.equal(record.source_updated_at, '2026-09-30T12:00:00Z');
  assert.equal(JSON.parse(record.summary ?? '{}').news_scope, 'city');
  assert.equal(normalized.geoRecordSources[0]?.version_id, record.version_id);
  assert.equal(normalized.geoRecordSources[0]?.source_version_id, result.sourceRecords[0]?.version_id);
  assert.notEqual(record.version_id, result.geoRecords[0]?.version_id);
  assert.equal(record.rights_status, 'verified_open');
  assert.equal(record.public_query_allowed, true);
  assert.deepEqual(normalizeGdeltNews(result, areas).geoRecords, normalized.geoRecords);
});

test('Melbourne Florida ambiguity survives parser and remains unlocated during publication', async () => {
  const normalized = normalizeGdeltNews(await collected(true), areas);
  const record = normalized.geoRecords[0];
  assert.ok(record);
  assert.equal(record.location_role, 'unknown');
  assert.deepEqual(record.area_refs, []);
  assert.equal(record.geometry_geojson, null);
  const summary: unknown = JSON.parse(record.summary ?? '{}');
  assert.equal(typeof summary, 'object');
  assert.equal(JSON.parse(record.summary ?? '{}').location_reason, 'ambiguous_same_name');
});
