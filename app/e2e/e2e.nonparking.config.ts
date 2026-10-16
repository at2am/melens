import type { E2EConfig } from 'e2e';
import base from './e2e.config.js';

// Apply --exclude-tag parking when listing or running this configuration.
export default {
  ...base,
  tests: ['tests/navigation.e2e.ts', 'tests/map.e2e.ts', 'tests/feed-original.e2e.ts'],
} satisfies E2EConfig;
