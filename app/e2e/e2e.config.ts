import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { localTargets } from './tests/local-targets.mjs';

export default {
  tests: ['tests/navigation.e2e.ts', 'tests/map.e2e.ts'],
  workers: 1,
  timeout: 120_000,
  actionTimeout: 30_000,
  assertionTimeout: 20_000,
  retries: 0,
  cache: 'off',
  targets: [
    {
      name: 'live',
      engine: web({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Australia/Melbourne', headers: { 'Cache-Control': 'no-cache' } }),
      app: {
        url: localTargets.live,
        command: { executable: 'python3', args: ['serve.py', '--mode', 'live', '--port', '{port}'], reuseExisting: true },
      },
    },
    {
      name: 'sample',
      engine: web({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Australia/Melbourne', headers: { 'Cache-Control': 'no-cache' } }),
      app: {
        url: localTargets.sample,
        command: { executable: 'python3', args: ['serve.py', '--mode', 'sample', '--port', '{port}'], reuseExisting: true },
      },
    },
  ],
} satisfies E2EConfig;
