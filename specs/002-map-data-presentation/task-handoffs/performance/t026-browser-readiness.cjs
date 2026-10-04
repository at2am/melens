#!/usr/bin/env node
'use strict';

// This probe verifies the reference viewport and prerequisites. It deliberately
// produces no SC-002 latency pass from startup, spinners, fixtures or HTTP alone.
const { mkdirSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');

const url = new URL(process.argv[2] || 'http://localhost:8000');
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
  throw new Error('Use the preview base URL without credentials, query or fragment.');
}
const output = resolve(process.argv[3] || __dirname);
mkdirSync(output, { recursive: true });

async function probe(browser, name, viewport) {
  const context = await browser.newContext({ viewport, screen: viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const viewportResponses = [];
  let failedMapRequests = 0;
  const pendingReads = new Set();
  page.on('requestfailed', (request) => {
    if (new URL(request.url()).pathname.endsWith('/v1/map/viewport')) failedMapRequests++;
  });
  page.on('response', (response) => {
    if (!new URL(response.url()).pathname.endsWith('/v1/map/viewport')) return;
    const read = (async () => {
      if (!response.ok()) {
        viewportResponses.push({ httpStatus: response.status(), confirmedCompletion: false });
        return;
      }
      try {
        const body = await response.json();
        const layers = Array.isArray(body.layers) ? body.layers : [];
        viewportResponses.push({
          httpStatus: response.status(), dataMode: body.dataMode,
          confirmedCompletion: layers.length > 0 && layers.every((layer) =>
            layer.completeness === 'complete' && ['available', 'noMatching', 'notCovered'].includes(layer.state)),
          layers: layers.map((layer) => ({ layerId: layer.layerId, state: layer.state,
            completeness: layer.completeness, returnedObjects: Array.isArray(layer.items) ? layer.items.length : 0 })),
        });
      } catch (_) {
        viewportResponses.push({ httpStatus: response.status(), confirmedCompletion: false, invalidEnvelope: true });
      }
    })();
    pendingReads.add(read);
    read.finally(() => pendingReads.delete(read));
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('flt-glass-pane').waitFor({ state: 'attached', timeout: 30000 });
  const semantics = page.locator('flt-semantics-placeholder');
  if (await semantics.count()) await semantics.first().dispatchEvent('click');
  // Wait only for diagnostic readiness, never report this delay as update time.
  await page.waitForFunction(() =>
    !!document.querySelector('.gm-style') ||
    [...document.querySelectorAll('flt-semantics')].some((element) =>
      /Base map unavailable|Could not load the base map|Google Maps.*key/i.test(element.textContent || '')),
  null, { timeout: 20000 }).catch(() => {});
  await Promise.allSettled([...pendingReads]);
  const state = await page.evaluate(() => {
    const text = document.body.innerText + ' ' + [...document.querySelectorAll('flt-semantics')]
      .map((element) => `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`).join(' ');
    return {
      actualViewport: { width: innerWidth, height: innerHeight },
      userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio, mapSurfacePresent: !!document.querySelector('.gm-style'),
      mapProviderErrorVisible: !!document.querySelector('.gm-err-container,.gm-err-content') ||
        /Oops! Something went wrong|didn.t load Google Maps correctly|For development purposes only/.test(text),
      missingMapsKeyVisible: /Base map unavailable: configure an authorized Google Maps Web API key/.test(text),
      mapLoadFailureVisible: /Could not load the base map|Base map could not be loaded/.test(text),
      sampleDataVisible: /Sample data.*illustrative only/.test(text),
      loadingOnlyVisible: /Loading.*map|Loading map data|Loading results/i.test(text),
    };
  });
  const missing = [];
  if (state.actualViewport.width !== viewport.width || state.actualViewport.height !== viewport.height) missing.push('Reference viewport dimensions differ');
  if (!state.mapSurfacePresent) missing.push(state.missingMapsKeyVisible ? 'Authorized Maps Web key is missing' : 'Actual Google Maps surface did not render');
  if (state.mapProviderErrorVisible) missing.push('Google Maps provider error or authorization warning is visible');
  if (state.sampleDataVisible || viewportResponses.some((response) => response.dataMode === 'sample')) missing.push('Build uses synthetic sample data');
  if (!viewportResponses.some((response) => response.dataMode === 'live' && response.confirmedCompletion)) missing.push('No confirmed completed live viewport response');
  const report = {
    reference: name, expectedViewport: viewport, ...state,
    browserVersion: browser.version(), host: { platform: os.platform(), release: os.release(), arch: os.arch(),
      cpuModel: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: Math.round(os.totalmem() / 2 ** 30) },
    mode: 'Chrome headless, no artificial network throttle, actual viewport checked',
    generatedAt: new Date().toISOString(), viewportResponses, failedMapRequests,
    prerequisiteStatus: missing.length ? 'blocked' : 'ready-for-measurement', missing,
    sc002: { status: 'open', toggleP95Ms: null, completedViewportP95Ms: null,
      reason: missing.length ? 'Required rendering/live-response evidence absent; no latency claim' : 'Measure repeated real toggles and completed viewport rendering separately' },
  };
  await page.screenshot({ path: join(output, `t026-${name}.png`), fullPage: false });
  writeFileSync(join(output, `t026-${name}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await context.close();
  return report;
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.T026_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['narrow', { width: 390, height: 844 }]]) {
      const report = await probe(browser, name, viewport);
      console.log(JSON.stringify({ reference: name, actualViewport: report.actualViewport,
        prerequisiteStatus: report.prerequisiteStatus, missing: report.missing, sc002: report.sc002.status }));
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  const diagnostic = String(error.message).replace(/https?:\/\/[^\s)]+/g, '[URL omitted]');
  console.error(`T026 browser readiness probe failed (${error.name}): ${diagnostic}`);
  console.error('SC-002 remains open.');
  process.exitCode = 1;
});
