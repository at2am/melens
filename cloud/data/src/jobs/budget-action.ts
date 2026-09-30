import { createServer } from 'node:http';

import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';

const budgetName = /^billingAccounts\/([A-Za-z0-9-]+)\/budgets\/([A-Za-z0-9-]+)$/;
const projectId = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const jobId = /^[a-z][a-z0-9-]{0,62}$/;
const protectedSources = [
  'melbourne-pedestrian-minute',
  'melbourne-pedestrian-hourly',
  'melbourne-pedestrian-locations',
  'victoria-transport-road-unplanned',
  'victoria-transport-gtfs-realtime',
  'victoria-transport-gtfs-static',
];

const envelopeSchema = z.object({
  message: z.object({
    data: z.string(),
    attributes: z.object({
      billingAccountId: z.string(),
      budgetId: z.string(),
      schemaVersion: z.literal('1.0'),
    }),
  }),
});

const alertSchema = z.object({
  costAmount: z.number().finite().nonnegative(),
  costIntervalStart: z.string(),
  budgetAmount: z.number().finite().positive(),
  budgetAmountType: z.literal('SPECIFIED_AMOUNT'),
  alertThresholdExceeded: z.number().finite().nonnegative().optional(),
  currencyCode: z.literal('AUD'),
});

export interface BudgetActionConfig {
  budgetResourceName: string;
  projectId: string;
  schedulerLocation: string;
  amountAud: number;
  pausableJobs: readonly string[];
}

export interface SchedulerClient {
  get(name: string): Promise<'ENABLED' | 'PAUSED' | 'DISABLED'>;
  pause(name: string): Promise<void>;
}

function month(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value;
  const monthNumber = parts.find(part => part.type === 'month')?.value;
  if (!year || !monthNumber) throw new Error('Cannot determine budget month');
  return `${year}-${monthNumber}`;
}

export function validateBudgetActionConfig(config: BudgetActionConfig): void {
  if (!budgetName.test(config.budgetResourceName) || !projectId.test(config.projectId)
    || config.schedulerLocation !== 'australia-southeast1' || config.amountAud !== 100) {
    throw new Error('Invalid reviewed budget action configuration');
  }
  if (new Set(config.pausableJobs).size !== config.pausableJobs.length) {
    throw new Error('Duplicate scheduler job in budget allowlist');
  }
  const prefix = `projects/${config.projectId}/locations/${config.schedulerLocation}/jobs/`;
  for (const name of config.pausableJobs) {
    if (!name.startsWith(prefix) || !jobId.test(name.slice(prefix.length))) {
      throw new Error('Budget action job is outside the reviewed project and region');
    }
    if (!name.slice(prefix.length).startsWith('melens-dev-')
      || protectedSources.some(source => name.endsWith(`/melens-dev-${source}-schedule`))) {
      throw new Error('Budget action allowlist includes an unapproved or P0 job');
    }
  }
}

/** Returns false for a malformed, unrelated, forecast-only or stale notification. */
export function shouldPauseForBudget(
  body: unknown, config: BudgetActionConfig, now: Date = new Date(),
): boolean {
  validateBudgetActionConfig(config);
  if (!Number.isFinite(now.getTime())) throw new Error('Invalid budget clock');
  const envelope = envelopeSchema.safeParse(body);
  const identity = budgetName.exec(config.budgetResourceName);
  if (!envelope.success || !identity) return false;
  const { attributes, data } = envelope.data.message;
  if (attributes.billingAccountId !== identity[1] || attributes.budgetId !== identity[2]) {
    return false;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return false;
  }
  const alert = alertSchema.safeParse(payload);
  if (!alert.success) return false;
  const value = alert.data;
  const start = new Date(value.costIntervalStart);
  if (!Number.isFinite(start.getTime()) || start.getTime() > now.getTime()
    || month(start) !== month(now)) return false;
  return Math.abs(value.budgetAmount - config.amountAud) < 0.000_001
    && value.alertThresholdExceeded !== undefined
    && value.alertThresholdExceeded >= 1
    && value.costAmount >= config.amountAud;
}

export async function handleBudgetAction(
  body: unknown, config: BudgetActionConfig, scheduler: SchedulerClient, now = new Date(),
): Promise<{ paused: string[]; ignored: boolean }> {
  if (!shouldPauseForBudget(body, config, now)) return { paused: [], ignored: true };
  const paused: string[] = [];
  for (const name of config.pausableJobs) {
    const state = await scheduler.get(name);
    if (state !== 'ENABLED') continue;
    await scheduler.pause(name);
    paused.push(name);
  }
  return { paused, ignored: false };
}

export function configFromEnv(env: NodeJS.ProcessEnv): BudgetActionConfig {
  const config: BudgetActionConfig = {
    budgetResourceName: env.MELENS_BUDGET_RESOURCE_NAME ?? '',
    projectId: env.GOOGLE_CLOUD_PROJECT ?? '',
    schedulerLocation: env.MELENS_SCHEDULER_LOCATION ?? '',
    amountAud: Number(env.MELENS_BUDGET_AMOUNT_AUD),
    pausableJobs: (env.MELENS_PAUSABLE_SCHEDULER_JOBS ?? '')
      .split(',').filter(Boolean),
  };
  validateBudgetActionConfig(config);
  return config;
}

export class GoogleSchedulerClient implements SchedulerClient {
  private readonly auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  private async request(name: string, method: 'GET' | 'POST'): Promise<Response> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error('Scheduler access token unavailable');
    const path = method === 'POST' ? `${name}:pause` : name;
    const response = await fetch(`https://cloudscheduler.googleapis.com/v1/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Scheduler ${method} failed with HTTP ${response.status}`);
    return response;
  }

  async get(name: string): Promise<'ENABLED' | 'PAUSED' | 'DISABLED'> {
    const response = await this.request(name, 'GET');
    const result = z.object({ state: z.enum(['ENABLED', 'PAUSED', 'DISABLED']) })
      .parse(await response.json());
    return result.state;
  }

  async pause(name: string): Promise<void> {
    await this.request(name, 'POST');
  }
}

export function startBudgetActionServer(env: NodeJS.ProcessEnv = process.env): void {
  const config = configFromEnv(env);
  const scheduler = new GoogleSchedulerClient();
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/') {
      response.writeHead(404).end();
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 32_768) throw new Error('Budget notification too large');
        chunks.push(bytes);
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        process.stdout.write(JSON.stringify({ action: 'ignored_invalid_json', paused_jobs: 0 }) + '\n');
        response.writeHead(204).end();
        return;
      }
      const result = await handleBudgetAction(body, config, scheduler);
      process.stdout.write(JSON.stringify({ action: result.ignored ? 'ignored' : 'checked',
        paused_jobs: result.paused.length }) + '\n');
      response.writeHead(204).end();
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'Budget action failed'}\n`);
      response.writeHead(503).end();
    }
  });
  server.listen(port);
}

if (process.argv[1]?.endsWith('/budget-action.js')) startBudgetActionServer();
