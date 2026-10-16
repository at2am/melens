import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStatic } from './read-only-transport.mjs';
import { localTargets } from './local-targets.mjs';

const configurations = {
  'e2e.nonparking.config.ts': ['localLive', 'localSample'],
  'e2e.agent.config.ts': ['localLive'],
  'e2e.events.config.ts': ['localLive'],
  'e2e.cloud.config.ts': ['cloudRelease'],
};
const locations = {
  localLive: { origin: localTargets.live, path: '/build-provenance.json', mode: 'live' },
  localSample: { origin: localTargets.sample, path: '/build-provenance.json', mode: 'sample' },
  cloudRelease: { origin: 'https://melens-510012.web.app', path: '/release-provenance.json', mode: 'live' },
};
const hash = (body) => createHash('sha256').update(body).digest('hex');
const timestamp = (value) => {
  assert.equal(typeof value, 'string', 'The build and report timestamps must be strings.');
  const result = Date.parse(value);
  assert.ok(Number.isFinite(result), 'The build and report timestamps must be valid.');
  return result;
};

function option(args, name) {
  const occurrences = args.filter((argument) => argument === name || argument.startsWith(`${name}=`));
  assert.equal(occurrences.length, 1, `Supply ${name} exactly once as a separate argument.`);
  const index = args.indexOf(name);
  assert.ok(index >= 0 && args[index + 1] && !args[index + 1].startsWith('--'), `Supply ${name} and its value.`);
  return args[index + 1];
}

async function capture(manifestName, phase, directory, onFailure) {
  const location = locations[manifestName];
  assert.ok(location, 'The build name must be one of the fixed Melens targets.');
  const nonce = randomUUID();
  const cachePolicy = manifestName === 'cloudRelease' ? /\bno-cache\b/ : /\b(?:no-cache|no-store)\b/;
  const reply = await readStatic(`${location.origin}${location.path}?receipt=${nonce}`, onFailure);
  assert.equal(reply.status, 200, 'The actual served manifest must return HTTP 200.');
  assert.match(reply.headers['cache-control'] ?? '', cachePolicy, 'The actual manifest must disable stale caching.');
  const manifest = JSON.parse(reply.body.toString('utf8'));
  const expected = JSON.parse(execFileSync('python3', ['provenance.py'], { encoding: 'utf8' }));
  assert.equal(manifest.sourceCommit, expected.sourceCommit, 'The served commit must match the current source.');
  assert.equal(manifest.appSourceSha256, expected.appSourceSha256, 'The served app must match the current dirty source.');
  assert.equal(manifest.dataMode, location.mode);
  if (manifestName !== 'cloudRelease') {
    assert.equal(manifest.agentBaseUrl, localTargets.agent);
    assert.equal(manifest.mapBaseUrl, localTargets.map);
  }
  assert.match(manifest.bundleSha256, /^[a-f0-9]{64}$/);
  timestamp(manifest.builtAt);
  if ('backendBoundAt' in manifest) timestamp(manifest.backendBoundAt);
  const bundle = await readStatic(`${location.origin}/main.dart.js?receipt=${nonce}`, onFailure);
  assert.equal(bundle.status, 200, 'The actual served bundle must return HTTP 200.');
  assert.match(bundle.headers['cache-control'] ?? '', cachePolicy, 'The actual bundle must disable stale caching.');
  const actualBundleSha256 = hash(bundle.body);
  assert.equal(actualBundleSha256, manifest.bundleSha256, 'Every successful bundle read must match its manifest hash.');
  const path = resolve(directory, `${manifestName}-${phase}-manifest.json`);
  writeFileSync(path, reply.body);
  const capturedAt = new Date().toISOString();
  writeFileSync(resolve(directory, `${manifestName}-${phase}-bundle-proof.json`), `${JSON.stringify({
    origin: location.origin, capturedAt, sourceCommit: manifest.sourceCommit,
    appSourceSha256: manifest.appSourceSha256, actualBundleSha256,
    manifestCacheControl: reply.headers['cache-control'], bundleCacheControl: bundle.headers['cache-control'],
  }, null, 2)}\n`);
  return { manifest, fileSha256: hash(reply.body), path, capturedAt };
}

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node tests/run-with-receipt.mjs --config e2e.CONFIG.config.ts --output FRESH_DIR [e2e run options]');
    console.log('Writes suite-receipt.json and exact before/after HTTP manifests without editing report.json.');
    return;
  }
  const output = resolve(option(args, '--output'));
  const configPath = resolve(option(args, '--config'));
  const config = basename(configPath);
  const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(resolve('.'), project, 'Run this helper from app/e2e.');
  assert.equal(configPath, resolve(project, config), 'Use the checked-in configuration in app/e2e.');
  let builds = configurations[config];
  assert.ok(builds, 'Use one of the fixed Melens suite configurations.');
  if (config === 'e2e.nonparking.config.ts') {
    assert.equal(option(args, '--exclude-tag'), 'parking', 'The final local UI suite must exclude parking.');
    const targets = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index].startsWith('--target=')) throw new Error('Supply --target and its value as separate arguments.');
      if (args[index] !== '--target') continue;
      assert.ok(args[index + 1] && !args[index + 1].startsWith('--'), 'Supply --target and its value.');
      targets.push(...args[++index].split(','));
    }
    assert.ok(targets.every((target) => ['live', 'sample'].includes(target)), 'Only local live and sample targets are supported.');
    if (targets.length > 0) builds = builds.filter((build) => targets.includes(build === 'localLive' ? 'live' : 'sample'));
    assert.ok(builds.length > 0);
    assert.ok(builds.length === 1 || localTargets.live !== localTargets.sample,
      'When both variants share one origin, run --target live and --target sample in separate suites.');
  }
  assert.ok(!existsSync(output), 'Use a new output directory. Existing evidence must stay unchanged.');
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const directory = resolve(output, 'served-provenance');
  mkdirSync(directory);
  const failures = [];
  const onFailure = (failure) => {
    failures.push(failure);
    writeFileSync(resolve(output, 'read-only-transport-failures.json'), `${JSON.stringify(failures, null, 2)}\n`);
    console.warn('Read-only connection failure', failure);
  };
  try {
    const before = {};
    // Capture both local variants before the runner starts; neither receipt
    // can be borrowed from a prior run that used the same Git HEAD.
    for (const build of builds) before[build] = await capture(build, 'before', directory, onFailure);
    const metadata = JSON.parse(readFileSync('node_modules/e2e/package.json', 'utf8'));
    const cli = resolve('node_modules/e2e', metadata.bin.e2e);
    const childExit = await new Promise((fulfill, reject) => {
      const child = spawn(process.execPath, [cli, 'run', ...args], {
        stdio: 'inherit', env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' },
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => fulfill({ code, signal }));
    });
    const report = JSON.parse(readFileSync(resolve(output, 'report.json'), 'utf8'));
    const suite = report.run;
    assert.equal(typeof suite.id, 'string');
    const start = timestamp(suite.startedAt);
    const finish = timestamp(suite.finishedAt);
    assert.ok(start <= finish);
    const proofs = [];
    for (const build of builds) {
      const after = await capture(build, 'after', directory, onFailure);
      const initial = before[build];
      assert.equal(after.fileSha256, initial.fileSha256, 'The served manifest must remain byte-identical during the suite.');
      assert.ok(timestamp(initial.capturedAt) <= start && finish <= timestamp(after.capturedAt), 'HTTP captures must bracket the generated report.');
      for (const field of ['builtAt', 'backendBoundAt']) {
        if (field in initial.manifest) assert.ok(start >= timestamp(initial.manifest[field]), `The suite must start after ${field}.`);
      }
      proofs.push({
        manifest: build, appSourceSha256: initial.manifest.appSourceSha256,
        bundleSha256: initial.manifest.bundleSha256, servedManifestSha256: initial.fileSha256,
        before: { path: initial.path, capturedAt: initial.capturedAt },
        after: { path: after.path, capturedAt: after.capturedAt },
      });
    }
    const receipt = { runId: suite.id, startedAt: suite.startedAt, finishedAt: suite.finishedAt, builds: proofs };
    const path = resolve(output, 'suite-receipt.json');
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`Verified suite receipt: ${path}`);
    process.exitCode = childExit.code ?? 1;
  } catch (error) {
    writeFileSync(resolve(output, 'receipt-failure.json'), `${JSON.stringify({
      capturedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'Suite receipt verification failed.',
    }, null, 2)}\n`);
    throw error;
  }
}

await run();
