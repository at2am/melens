import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Gemini } from '@google/adk';
import { sourceReferenceSchema } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import { createVertexContextCache } from './agent/context-cache.js';
import { createMapAgentRunner } from './agent/map-agent.js';
import { RetryingLlm } from './agent/retrying-llm.js';
import { createVertexGrounding } from './agent/grounding.js';
import { createVertexStructuredModel } from './agent/structured.js';
import { createFirestoreCache, createMemoryCache } from './cache.js';
import { createFirebaseVerifier, staticVerifier } from './auth/verifier.js';
import { loadAgentConfig } from './config.js';
import { createFirestoreUserEventStore } from './events/firestore-store.js';
import { EVENT_LIMITS } from './events/schemas.js';
import { UserEventService } from './events/service.js';
import { InMemoryUserEventStore } from './events/store.js';
import { createFirestoreFeedStore } from './feeds/firestore-store.js';
import { FEED_LIMITS } from './feeds/schemas.js';
import { FeedService } from './feeds/service.js';
import { InMemoryFeedStore } from './feeds/store.js';
import { createSharedFeatureReader } from './features/reader.js';
import { createFirestoreMemoryStore } from './memory/firestore-store.js';
import { MEMORY_LIMITS } from './memory/schemas.js';
import { MemoryService } from './memory/service.js';
import { InMemoryMemoryStore } from './memory/store.js';
import { createFirestorePlanStore } from './plans/firestore-store.js';
import { PLAN_LIMITS } from './plans/schemas.js';
import { PlanService } from './plans/service.js';
import { InMemoryPlanStore } from './plans/store.js';
import { createRateLimiter } from './rate-limit.js';
import { createRoutesClient } from './routes/routes-client.js';
import { createAgentHttpServer } from './server.js';
import { createFirestoreSessionStore } from './sessions/firestore-store.js';
import { InMemorySessionStore } from './sessions/store.js';
import type { ToolDependencies } from './tools/catalog.js';
import { refreshStopParking } from './workflows/workflows.js';

const log = (line: Record<string, unknown>) => process.stdout.write(`${JSON.stringify(line)}\n`);

/** Production entry point; imported modules never start a listener. */
export async function startAgentServer(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = loadAgentConfig(env);
  const port = z.coerce.number().int().min(0).max(65_535).parse(env.PORT ?? '8080');
  const publicSources = config.publicSourcesFile === null ? []
    : z.array(sourceReferenceSchema).parse(JSON.parse(await readFile(config.publicSourcesFile, 'utf8')));
  // Local development may keep sessions in memory and trust a fixed token; Cloud Run never does.
  const development = env.AGENT_DEVELOPMENT_MODE === 'true';
  // A model call that fails with a passing 429 or 503 before it streamed anything is made again.
  const model = new RetryingLlm(new Gemini({ model: config.model, vertexai: true, project: config.projectId, location: config.vertexLocation }), { log });
  const tools: ToolDependencies = {
    features: createSharedFeatureReader({ config: config.query, publicSources }),
    grounding: createVertexGrounding({ projectId: config.projectId, location: config.vertexLocation, model: config.model }),
    groundingTimeoutMs: config.groundingTimeoutMs,
    structured: createVertexStructuredModel({ projectId: config.projectId, location: config.vertexLocation, model: config.model }),
    routes: createRoutesClient(env.AGENT_ROUTES_QUOTA_PROJECT === undefined ? {} : { quotaProject: env.AGENT_ROUTES_QUOTA_PROJECT }),
    cache: development ? createMemoryCache() : createFirestoreCache({ projectId: config.projectId, databaseId: config.firestoreDatabase }),
  };
  const contextCache = config.contextCache
    ? createVertexContextCache({ projectId: config.projectId, location: config.vertexLocation, model: config.model, log }) : undefined;
  const runner = createMapAgentRunner({ model, maxModelCalls: config.maxModelCalls, log, tools, ...(contextCache === undefined ? {} : { contextCache }) });
  const store = development ? new InMemorySessionStore()
    : createFirestoreSessionStore({ projectId: config.projectId, databaseId: config.firestoreDatabase });
  const verifier = development && env.AGENT_DEVELOPMENT_TOKEN !== undefined
    ? staticVerifier({ [env.AGENT_DEVELOPMENT_TOKEN]: 'dev-user' }) : createFirebaseVerifier(config.projectId);
  // User events (UC-09) share the database and the development mode of the sessions.
  const events = new UserEventService({ writeLimiter: createRateLimiter(EVENT_LIMITS.writesPerHour),
    store: development ? new InMemoryUserEventStore()
      : createFirestoreUserEventStore({ projectId: config.projectId, databaseId: config.firestoreDatabase }) });
  // Feed subscriptions (UC-14) likewise.
  const feeds = new FeedService({ writeLimiter: createRateLimiter(FEED_LIMITS.writesPerHour),
    store: development ? new InMemoryFeedStore()
      : createFirestoreFeedStore({ projectId: config.projectId, databaseId: config.firestoreDatabase }) });
  // Saved plans (UC-03) likewise; they copy cards out of the session store.
  const plans = new PlanService({ sessions: store, writeLimiter: createRateLimiter(PLAN_LIMITS.writesPerHour),
    refreshParking: (request) => refreshStopParking(tools, request), routes: tools.routes,
    store: development ? new InMemoryPlanStore()
      : createFirestorePlanStore({ projectId: config.projectId, databaseId: config.firestoreDatabase }) });
  // The user's memory (UC-16) likewise; the same model reads each finished exchange for lasting facts.
  const memory = new MemoryService({ writeLimiter: createRateLimiter(MEMORY_LIMITS.writesPerHour), structured: tools.structured ?? null, log,
    store: development ? new InMemoryMemoryStore()
      : createFirestoreMemoryStore({ projectId: config.projectId, databaseId: config.firestoreDatabase }) });
  const server = createAgentHttpServer({ store, verifier, runner, events, feeds, plans, memory, rateLimiter: createRateLimiter(config.turnsPerHour),
    allowedOrigins: config.allowedOrigins, turnTimeoutMs: config.turnTimeoutMs });
  server.on('error', (error: NodeJS.ErrnoException) => {
    log({ severity: 'ERROR', event: 'agentServerFailed', reason: error.code ?? error.message, port });
    process.exitCode = 1;
  });
  const close = () => { server.close(); server.closeAllConnections(); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  server.listen(port, '0.0.0.0', () => {
    const address = server.address();
    if (address !== null && typeof address !== 'string') {
      log({ severity: 'INFO', event: 'agentServerListening', port: address.port, model: config.model, vertexLocation: config.vertexLocation, development });
    }
    // Load the shared map layers now; with one warm instance the first turn then reads them from memory.
    const started = Date.now();
    void tools.features.warm?.().then(() => log({ severity: 'INFO', event: 'agentLayersWarm', durationMs: Date.now() - started }));
  });
  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void startAgentServer().catch((error: unknown) => {
    log({ severity: 'ERROR', event: 'agentServerStartupFailed', reason: error instanceof Error ? error.message : 'unknown' });
    process.exitCode = 1;
  });
}
