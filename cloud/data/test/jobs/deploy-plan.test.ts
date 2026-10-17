import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { z } from 'zod';

const script = join(dirname(fileURLToPath(import.meta.url)), '../../../infra/deploy.sh');
const baseArgs = ['--project', 'melens-510012', '--environment', 'dev',
  '--bucket', 'melens-dev-example', '--source', 'gdelt.news'];

test('deployment plan is inert and reports the approved budget plus remaining controls', () => {
  const result = spawnSync(script, baseArgs, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan only\. No cloud resources were changed\./);
  assert.match(result.stdout, /Monthly budget \(AUD\): 100/);
  assert.match(result.stdout, /Run\/data region: australia-southeast2/);
  assert.match(result.stdout, /Scheduler location: australia-southeast1/);
  assert.match(result.stdout, /Budget alerts verified: True/);
  assert.match(result.stdout, /Runtime guards verified:/);
  assert.match(result.stdout, /gdelt\.news \| \*\/15 \* \* \* \* \| time \| enabled \| 160 \| 2000000000/);
});

test('apply refuses a candidate source before cloud access', () => {
  const result = spawnSync(script, [...baseArgs.slice(0, -1), 'melbourne.microclimate',
    '--image', `example.com/melens@sha256:${'a'.repeat(64)}`,
    '--apply', '--confirm-project', 'melens-510012'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source not enabled for deployment: melbourne\.microclimate/);
  assert.doesNotMatch(result.stdout, /Plan only/);
});

test('starting schedules requires an explicit apply', () => {
  const result = spawnSync(script, [...baseArgs, '--start-schedules'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--start-schedules requires --apply/);
});

test('an admitted public source also requires a verified dedicated identity before cloud access', () => {
  const root = mkdtempSync(join(tmpdir(), 'melens-deploy-identity-'));
  try {
    mkdirSync(join(root, 'infra'));
    mkdirSync(join(root, 'src/connectors/com_municipal_boundary'), { recursive: true });
    copyFileSync(script, join(root, 'infra/deploy.sh'));
    const sourceRoot = join(dirname(script), '../src/connectors');
    const manifest = readFileSync(join(sourceRoot, 'com_municipal_boundary/source.json'), 'utf8');
    copyFileSync(join(sourceRoot, 'com_municipal_boundary/source.json'),
      join(root, 'src/connectors/com_municipal_boundary/source.json'));
    const config = z.object({ sources: z.array(z.object({
      source_id: z.string(), enabled: z.boolean(), service_account_email: z.string().nullable(),
      dedicated_identity_permissions_verified: z.boolean(),
    }).passthrough()) }).passthrough().parse(
      JSON.parse(readFileSync(join(dirname(script), 'schedules.json'), 'utf8')));
    const sourceId = z.object({ source_id: z.string() }).parse(JSON.parse(manifest)).source_id;
    const entry = config.sources.find(entry => entry.source_id === sourceId);
    assert.ok(entry);
    entry.enabled = true;
    entry.service_account_email = null;
    entry.dedicated_identity_permissions_verified = false;
    config.sources = [entry];
    writeFileSync(join(root, 'infra/schedules.json'), JSON.stringify(config));
    const result = spawnSync(join(root, 'infra/deploy.sh'), [
      '--project', 'melens-510012', '--environment', 'dev', '--bucket', 'melens-dev-example',
      '--source', sourceId, '--image', `example.com/melens@sha256:${'a'.repeat(64)}`,
      '--apply', '--confirm-project', 'melens-510012',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Verified dedicated service identity required/);
    assert.doesNotMatch(result.stdout, /Project:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
