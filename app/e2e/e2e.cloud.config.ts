import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  tests: 'tests/cloud-*.e2e.ts',
  workers: 1,
  timeout: 240_000,
  actionTimeout: 30_000,
  assertionTimeout: 30_000,
  retries: 0,
  cache: 'off',
  trace: 'off',
  video: 'off',
  targets: [{
    name: 'cloud',
    engine: web({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Australia/Melbourne' }),
    app: { url: 'https://melens-510012.web.app' },
  }],
} satisfies E2EConfig;
