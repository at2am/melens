import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
  assert.match(result.stdout, /gdelt\.news \| \*\/15 \* \* \* \* \| time \| candidate/);
});

test('apply refuses a candidate source before cloud access', () => {
  const result = spawnSync(script, [...baseArgs,
    '--image', `example.com/melens@sha256:${'a'.repeat(64)}`,
    '--apply', '--confirm-project', 'melens-510012'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Source not enabled for deployment: gdelt\.news/);
  assert.doesNotMatch(result.stdout, /Plan only/);
});
