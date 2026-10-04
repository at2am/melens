const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createBrowser() {
  const scripts = [];
  const timers = new Map();
  let timerId = 0;
  const browser = {
    Promise,
    URLSearchParams,
    setTimeout(callback, duration) {
      assert.equal(duration, 15000);
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    document: {
      head: { append(script) { scripts.push(script); } },
      createElement(tag) {
        assert.equal(tag, 'script');
        return { remove() { this.removed = true; } };
      },
      querySelector() { return null; },
    },
  };
  browser.window = browser;
  const html = fs.readFileSync(
    path.join(__dirname, '../../../web/index.html'),
    'utf8',
  );
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, browser);
  return { browser, scripts, timers };
}

test('a missing Web key makes no request', async () => {
  const { browser, scripts } = createBrowser();
  await assert.rejects(browser.melensLoadGoogleMapsApi('', ''), /required/);
  assert.equal(scripts.length, 0);
});

test('one Maps SDK request is shared and resolved by its readiness callback', async () => {
  const { browser, scripts, timers } = createBrowser();
  const first = browser.melensLoadGoogleMapsApi('test-configured-key', 'test-map-id');
  const second = browser.melensLoadGoogleMapsApi('test-configured-key', 'test-map-id');
  assert.equal(first, second);
  assert.equal(scripts.length, 1);
  browser.melensGoogleMapsApiReady();
  await first;
  assert.equal(timers.size, 0);
  await browser.melensLoadGoogleMapsApi('test-configured-key', 'test-map-id');
  assert.equal(scripts.length, 1);
});

test('request parameters include async loading and encode configured values', async () => {
  const { browser, scripts } = createBrowser();
  const pending = browser.melensLoadGoogleMapsApi('test key &=', 'test map &=');
  const url = new URL(scripts[0].src);
  assert.equal(url.origin, 'https://maps.googleapis.com');
  assert.equal(url.pathname, '/maps/api/js');
  assert.equal(url.searchParams.get('key'), 'test key &=');
  assert.equal(url.searchParams.get('map_ids'), 'test map &=');
  assert.equal(url.searchParams.get('loading'), 'async');
  assert.equal(url.searchParams.get('libraries'), 'marker');
  browser.melensGoogleMapsApiReady();
  await pending;
});

test('configuration changes cannot create a second Maps SDK', async () => {
  const { browser, scripts } = createBrowser();
  const first = browser.melensLoadGoogleMapsApi('test-configured-key', 'first-map');
  await assert.rejects(
    browser.melensLoadGoogleMapsApi('other-test-key', 'second-map'),
    /cannot change/,
  );
  assert.equal(scripts.length, 1);
  browser.melensGoogleMapsApiReady();
  await first;
});

test('network failures remove the failed request and allow explicit retry', async () => {
  const { browser, scripts, timers } = createBrowser();
  const first = browser.melensLoadGoogleMapsApi('test-configured-key', '');
  scripts[0].onerror();
  await assert.rejects(first, /could not be reached/);
  assert.equal(scripts[0].removed, true);
  assert.equal(timers.size, 0);
  const retry = browser.melensLoadGoogleMapsApi('test-configured-key', '');
  assert.equal(scripts.length, 2);
  browser.melensGoogleMapsApiReady();
  await retry;
});

test('SDK readiness has a bounded timeout', async () => {
  const { browser, timers, scripts } = createBrowser();
  const pending = browser.melensLoadGoogleMapsApi('test-configured-key', '');
  const timeout = [...timers.values()][0];
  timeout();
  await assert.rejects(pending, /15 seconds/);
  assert.equal(timers.size, 0);
  assert.equal(scripts[0].removed, true);
});

test('initial provider authorization failures remain explicit', async () => {
  const { browser, timers } = createBrowser();
  let previousCalls = 0;
  const previous = () => { previousCalls++; };
  browser.gm_authFailure = previous;
  const pending = browser.melensLoadGoogleMapsApi('test-configured-key', '');
  browser.gm_authFailure();
  await assert.rejects(pending, /authorization failed/);
  assert.equal(previousCalls, 1);
  assert.equal(browser.gm_authFailure, previous);
  assert.equal(timers.size, 0);
});
