import { z } from 'zod';

import { loadMapConfig, type MapConfig } from '@melens/shared/config';

const positiveInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const origin = z.string().regex(/^https?:\/\/[^/\s]+$/);

const configSchema = z.strictObject({
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/),
  /** Where Gemini and the grounding tools are served; `global` or a region, decided at deployment. */
  vertexLocation: z.string().regex(/^(global|[a-z]+(?:-[a-z0-9]+)*)$/),
  model: z.string().regex(/^gemini-[a-z0-9.-]+$/),
  /** Firestore database id; `(default)` is the project default database. */
  firestoreDatabase: z.string().min(1).max(64),
  allowedOrigins: z.array(origin),
  publicSourcesFile: z.string().min(1).nullable(),
  maxModelCalls: positiveInteger.max(64),
  turnTimeoutMs: positiveInteger.max(300_000),
  /** How long one grounding call may take before the tool gives up and the model answers from the map data. */
  groundingTimeoutMs: positiveInteger.max(300_000),
  turnsPerHour: positiveInteger.max(10_000),
  /** Serve the chat instruction and tool declarations from a Gemini context cache (`AGENT_CONTEXT_CACHE=false` turns it off). */
  contextCache: z.boolean(),
});

export type AgentConfig = Readonly<z.infer<typeof configSchema>> & { readonly query: MapConfig };

export class AgentConfigurationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Invalid agent configuration: ${fields.join(', ')}`);
    this.name = 'AgentConfigurationError';
  }
}

function integerSetting(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** Credentials come from ADC; the Maps Platform key arrives through Secret Manager, never here. */
export function loadAgentConfig(env: Readonly<Record<string, string | undefined>> = process.env): AgentConfig {
  const projectId = env.AGENT_PROJECT_ID ?? env.MAP_PROJECT_ID;
  const parsed = configSchema.safeParse({
    projectId,
    vertexLocation: env.AGENT_VERTEX_LOCATION,
    model: env.AGENT_MODEL ?? 'gemini-3.8-flash',
    firestoreDatabase: env.AGENT_FIRESTORE_DATABASE ?? '(default)',
    allowedOrigins: (env.AGENT_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
    publicSourcesFile: env.AGENT_PUBLIC_SOURCES_FILE ?? env.MAP_PUBLIC_SOURCES_FILE ?? null,
    maxModelCalls: integerSetting(env.AGENT_MAX_MODEL_CALLS, 16),
    turnTimeoutMs: integerSetting(env.AGENT_TURN_TIMEOUT_MS, 300_000),
    groundingTimeoutMs: integerSetting(env.AGENT_GROUNDING_TIMEOUT_MS, 40_000),
    turnsPerHour: integerSetting(env.AGENT_TURNS_PER_HOUR, 120),
    contextCache: env.AGENT_CONTEXT_CACHE === undefined ? true : env.AGENT_CONTEXT_CACHE === 'true' ? true
      : env.AGENT_CONTEXT_CACHE === 'false' ? false : 'invalid',
  });
  if (!parsed.success) {
    throw new AgentConfigurationError([...new Set(parsed.error.issues.map((issue) =>
      issue.path.join('.') || 'configuration'))]);
  }
  // The data tools read the same views under the same ceilings as the map service.
  const query = loadMapConfig({ ...env, MAP_PROJECT_ID: env.MAP_PROJECT_ID ?? projectId });
  return Object.freeze({ ...parsed.data, query });
}
