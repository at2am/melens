// Times map requests against the live BigQuery views, query by query.
//
//   npm run build --workspace map
//   node map/scripts/profile-requests.mjs [layer,layer...] [west,south,east,north] [zoom]
//
// Runs in this process with Application Default Credentials and the deployed settings. It
// times each viewport request twice (a fresh service, then the same view again) and a
// detail read of its first item, and prints each BigQuery job's start and read time, so a
// slow request shows which query it waited on. Job history with execution time, bytes and
// slots is in `region-australia-southeast2`.INFORMATION_SCHEMA.JOBS_BY_PROJECT.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMapConfig } from '@melens/shared/config';
import { createBigQueryViewAdapter } from '@melens/shared/query/bigquery-adapter';
import { createMapService } from '../dist/src/map-service.js';

const [layersArg = 'event', bboxArg = '144.9,-37.86,145.0,-37.78', zoomArg = '14'] = process.argv.slice(2);
const layers = layersArg.split(',');
const bbox = bboxArg.split(',').map(Number);
const config = loadMapConfig({ MAP_PROJECT_ID: 'melens-510012', MAP_BQ_LOCATION: 'australia-southeast2',
  MAP_DYNAMIC_SCAN_BYTES: '1000000000', ...process.env });
const real = createBigQueryViewAdapter(config);

let log = [];
let started = 0;
const view = (sql) => (sql.match(/FROM `[^`]+\.(\w+)`/) ?? [])[1] ?? 'query';
const label = (sql) => sql.includes('@publicRecordKeysJson') ? `rights proof (${view(sql)})`
  : sql.includes('v_source_coverage') ? 'source registry'
    : sql.includes('v_geo_records_current_state') ? 'served copy state' : `rows (${view(sql)})`;
const adapter = {
  dryRun: (query) => real.dryRun(query),
  async startQuery(query) {
    const at = performance.now();
    const job = await real.startQuery(query);
    const startMs = performance.now() - at;
    return {
      async readPage(options) {
        const readAt = performance.now();
        const page = await job.readPage(options);
        log.push({ what: label(query.query), at: at - started, startMs, readMs: performance.now() - readAt, rows: page.rows.length });
        return page;
      },
      cancel: () => job.cancel(),
    };
  },
};
const sources = JSON.parse(readFileSync(fileURLToPath(new URL('../infra/dev-public-sources.json', import.meta.url)), 'utf8'));
const service = createMapService({ config, adapter, publicSources: sources });

async function timed(name, read) {
  log = [];
  started = performance.now();
  let note;
  try { note = await read(); } catch (error) { note = `failed: ${error?.code ?? error?.message}`; }
  console.log(`\n${name}: ${Math.round(performance.now() - started)} ms, ${note}`);
  for (const entry of log.sort((a, b) => a.at - b.at)) {
    console.log(`  +${String(Math.round(entry.at)).padStart(6)} ms  ${entry.what.padEnd(44)} start ${String(Math.round(entry.startMs)).padStart(5)} ms`
      + `  read ${String(Math.round(entry.readMs)).padStart(5)} ms  ${entry.rows} rows`);
  }
}

const end = new Date();
end.setUTCSeconds(0, 0);
const iso = (date) => date.toISOString().replace('.000', '');
const request = { requestId: 'profile', bbox, zoom: Number(zoomArg), layers, mode: 'current',
  window: { from: iso(new Date(end.getTime() - 15 * 60_000)), to: iso(end) } };
if (layers.includes('boundary')) request.boundaryFilter = { level: 'LGA', vintage: '2025' };
let response;
const count = () => response.layers.map((layer) => `${layer.layerId} ${layer.state} ${layer.items.length}`).join(', ');
await timed('viewport', async () => { response = await service.queryViewport(request); return count(); });
await timed('same view again', async () => { response = await service.queryViewport({ ...request, requestId: 'profile-2' }); return count(); });
const first = response.layers.flatMap((layer) => layer.items)[0];
if (first !== undefined) {
  await timed(`details of ${first.id}`, async () => {
    await service.getItem(first.id, { requestId: 'profile-detail', snapshotId: response.snapshotId });
    return first.kind;
  });
}
