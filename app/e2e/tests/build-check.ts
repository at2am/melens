import { execFileSync } from 'node:child_process';
import { expect } from 'e2e';
import { z } from '../../../cloud/node_modules/zod/index.js';
import { localTargets, loopbackOrigin } from './local-targets.mjs';

const manifestSchema = z.object({
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  appSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  dataMode: z.enum(['live', 'sample']),
  agentBaseUrl: z.string().transform((value) => loopbackOrigin(value)),
  mapBaseUrl: z.string().transform((value) => loopbackOrigin(value)),
}).passthrough();

export async function verifyBuild(baseUrl: string | undefined): Promise<z.infer<typeof manifestSchema>> {
  if (baseUrl === undefined) throw new Error('The local application URL is required.');
  const origin = loopbackOrigin(baseUrl, 'Local application URL');
  if (![localTargets.live, localTargets.sample].includes(origin)) throw new Error('Use a configured local application origin.');
  const expected: unknown = JSON.parse(execFileSync('python3', ['provenance.py'], { encoding: 'utf8' }));
  if (typeof expected !== 'object' || expected === null || Array.isArray(expected)) {
    throw new Error('The local source identity must be an object.');
  }
  const response = await fetch(new URL('/build-provenance.json', origin), { redirect: 'error' });
  expect(response.status, 'Serve a build from e2e/build.py, not an old Flutter build.').toBe(200);
  const actual = manifestSchema.parse(await response.json());
  expect(actual).toMatchObject(expected);
  expect(actual).toMatchObject({ agentBaseUrl: localTargets.agent, mapBaseUrl: localTargets.map });
  return actual;
}
