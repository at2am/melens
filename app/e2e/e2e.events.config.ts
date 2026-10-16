import type { E2EConfig } from 'e2e';
import base from './e2e.config.js';

export default {
  ...base,
  tests: 'tests/events.e2e.ts',
  targets: base.targets.filter((target) => target.name === 'live'),
  output: '.e2e/events-live',
  timeout: 180_000,
} satisfies E2EConfig;
