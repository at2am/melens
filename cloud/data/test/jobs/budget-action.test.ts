import assert from 'node:assert/strict';
import test from 'node:test';

import { configFromEnv, handleBudgetAction, shouldPauseForBudget, validateBudgetActionConfig,
  type BudgetActionConfig, type SchedulerClient } from '../../src/jobs/budget-action.js';

const job = 'projects/melens-510012/locations/australia-southeast1/jobs/melens-dev-homes-victoria-rents-schedule';
const config: BudgetActionConfig = {
  budgetResourceName: 'billingAccounts/0140DD-73B885-08505F/budgets/f98ae7d1-5f8f-4f92-a493-738ba9cc2c8f',
  projectId: 'melens-510012', schedulerLocation: 'australia-southeast1', amountAud: 100,
  pausableJobs: [job],
};
const now = new Date('2026-09-29T23:00:00Z');

function notification(overrides: Record<string, unknown> = {},
  attributes: Record<string, string> = {}) {
  const payload = {
    costAmount: 100.25,
    costIntervalStart: '2026-09-01T07:00:00Z',
    budgetAmount: 100,
    budgetAmountType: 'SPECIFIED_AMOUNT',
    alertThresholdExceeded: 1,
    currencyCode: 'AUD',
    ...overrides,
  };
  return { message: {
    data: Buffer.from(JSON.stringify(payload)).toString('base64'),
    attributes: {
      billingAccountId: '0140DD-73B885-08505F',
      budgetId: 'f98ae7d1-5f8f-4f92-a493-738ba9cc2c8f',
      schemaVersion: '1.0',
      ...attributes,
    },
  } };
}

test('only this month actual AUD 100 budget at the 100% threshold triggers', () => {
  assert.equal(shouldPauseForBudget(notification(), config, now), true);
  for (const alert of [
    notification({ costAmount: 99.99 }),
    notification({ alertThresholdExceeded: 0.8 }),
    notification({ alertThresholdExceeded: undefined, forecastThresholdExceeded: 1 }),
    notification({ budgetAmount: 200 }),
    notification({ currencyCode: 'USD' }),
    notification({ costIntervalStart: '2026-07-31T14:00:00Z' }),
    notification({}, { budgetId: 'another-budget' }),
    notification({}, { schemaVersion: '2.0' }),
  ]) assert.equal(shouldPauseForBudget(alert, config, now), false);
});

test('budget action pauses only enabled allowlisted jobs and handles duplicate delivery', async () => {
  let state: 'ENABLED' | 'PAUSED' = 'ENABLED';
  const calls: string[] = [];
  const scheduler: SchedulerClient = {
    async get(name) { calls.push(`get:${name}`); return state; },
    async pause(name) { calls.push(`pause:${name}`); state = 'PAUSED'; },
  };
  assert.deepEqual(await handleBudgetAction(notification(), config, scheduler, now),
    { paused: [job], ignored: false });
  assert.deepEqual(await handleBudgetAction(notification(), config, scheduler, now),
    { paused: [], ignored: false });
  assert.deepEqual(calls, [`get:${job}`, `pause:${job}`, `get:${job}`]);
  assert.deepEqual(await handleBudgetAction(notification({ costAmount: 50 }), config, scheduler, now),
    { paused: [], ignored: true });
  assert.equal(calls.length, 3);
});

test('monthly budgets follow Pacific billing time across Melbourne month changes', () => {
  assert.equal(shouldPauseForBudget(notification(), config,
    new Date('2026-09-30T14:30:00Z')), true);
  assert.equal(shouldPauseForBudget(notification(), config,
    new Date('2026-10-01T06:59:59Z')), true);
  assert.equal(shouldPauseForBudget(notification(), config,
    new Date('2026-10-01T07:00:00Z')), false);
  assert.equal(shouldPauseForBudget(notification({ costIntervalStart: '2026-10-01T07:00:00Z' }),
    config, new Date('2026-10-01T07:00:00Z')), true);
});

test('Pacific winter budgets retain the January period until February 1 at 08:00 UTC', () => {
  const january = notification({ costIntervalStart: '2027-01-01T08:00:00Z' });
  assert.equal(shouldPauseForBudget(january, config, new Date('2027-02-01T00:00:00Z')), true);
  assert.equal(shouldPauseForBudget(january, config, new Date('2027-02-01T08:00:00Z')), false);
  assert.equal(shouldPauseForBudget(notification({ costIntervalStart: '2027-02-01T08:00:00Z' }),
    config, new Date('2027-02-01T08:00:00Z')), true);
});

test('budget action fails closed on cross-project, duplicate and P0 jobs', () => {
  assert.throws(() => validateBudgetActionConfig({ ...config, pausableJobs: [job, job] }), /Duplicate/);
  assert.throws(() => validateBudgetActionConfig({ ...config, pausableJobs: [job.replace('melens-510012', 'another-project')] }), /outside/);
  assert.throws(() => validateBudgetActionConfig({ ...config,
    schedulerLocation: 'australia-southeast2' }), /Invalid reviewed/);
  assert.throws(() => validateBudgetActionConfig({ ...config, pausableJobs: [
    'projects/melens-510012/locations/australia-southeast1/jobs/melens-dev-melbourne-pedestrian-minute-schedule',
  ] }), /P0/);
});

test('budget action reads Scheduler location separately from the Run region', () => {
  const env = {
    MELENS_BUDGET_RESOURCE_NAME: config.budgetResourceName,
    GOOGLE_CLOUD_PROJECT: config.projectId,
    GCP_REGION: 'australia-southeast2',
    MELENS_SCHEDULER_LOCATION: config.schedulerLocation,
    MELENS_BUDGET_AMOUNT_AUD: String(config.amountAud),
    MELENS_PAUSABLE_SCHEDULER_JOBS: job,
  };
  assert.deepEqual(configFromEnv(env), config);
  assert.throws(() => configFromEnv({ ...env, MELENS_SCHEDULER_LOCATION: undefined }), /Invalid reviewed/);
});

test('scheduler failures propagate for Pub/Sub retry', async () => {
  const scheduler: SchedulerClient = {
    async get() { throw new Error('Scheduler unavailable'); },
    async pause() { throw new Error('should not be called'); },
  };
  await assert.rejects(handleBudgetAction(notification(), config, scheduler, now), /Scheduler unavailable/);
});
