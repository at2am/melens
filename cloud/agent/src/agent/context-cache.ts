import { createHash } from 'node:crypto';

import type { LlmRequest } from '@google/adk';
import { GoogleGenAI, type ContentUnion, type Tool, type ToolConfig } from '@google/genai';

/** What every model call of every turn sends first and the same: the instruction and the tool declarations. */
export interface CachedPrefix {
  readonly systemInstruction: ContentUnion;
  readonly tools: Tool[];
  readonly toolConfig?: ToolConfig;
}

/**
 * Gemini explicit context caching for the static part of the chat prompt: the instruction and the tool declarations
 * go to Vertex AI once an hour instead of with every model call, and are billed at the cached rate.
 */
export interface ContextCache {
  /** The cached content for this prefix, created when needed; null sends the prefix in full (creation failed or is backing off). */
  nameFor(prefix: CachedPrefix, signal?: AbortSignal): Promise<string | null>;
  /** Forgets every cached content, for a call that Vertex refused because one expired or was deleted. */
  invalidate(): void;
}

/** Creates one cached content; returns its resource name and when it expires. */
export type CreateCachedContent = (prefix: CachedPrefix, ttlSeconds: number, signal?: AbortSignal) =>
  Promise<{ readonly name: string; readonly expiresAt: number }>;

export const CONTEXT_CACHE_LIMITS = {
  ttlSeconds: 3_600,
  /** A cache this close to expiry is replaced, so no call reaches Vertex with one that expired on the way. */
  renewBeforeMs: 5 * 60_000,
  /** After a failed creation (too few tokens, quota, permissions) every call sends the prefix in full for this long. */
  backoffMs: 10 * 60_000,
} as const;

function keyOf(prefix: CachedPrefix): string {
  return createHash('sha256').update(JSON.stringify([prefix.systemInstruction, prefix.tools, prefix.toolConfig ?? null])).digest('base64url');
}

export function createContextCache(create: CreateCachedContent, options: {
  readonly clock?: () => number;
  readonly log?: (line: Record<string, unknown>) => void;
} = {}): ContextCache {
  const clock = options.clock ?? Date.now;
  const entries = new Map<string, { readonly name: string; readonly expiresAt: number }>();
  const pending = new Map<string, Promise<string | null>>();
  let backoffUntil = 0;

  return {
    async nameFor(prefix, signal) {
      const now = clock();
      if (now < backoffUntil) return null;
      const key = keyOf(prefix);
      const entry = entries.get(key);
      if (entry !== undefined && entry.expiresAt - now > CONTEXT_CACHE_LIMITS.renewBeforeMs) return entry.name;
      const running = pending.get(key);
      if (running !== undefined) return running;
      const creating = create(prefix, CONTEXT_CACHE_LIMITS.ttlSeconds, signal).then((created) => {
        entries.set(key, created);
        options.log?.({ severity: 'INFO', event: 'contextCacheCreated', name: created.name });
        return created.name;
      }, (error: unknown) => {
        entries.delete(key);
        backoffUntil = clock() + CONTEXT_CACHE_LIMITS.backoffMs;
        options.log?.({ severity: 'WARNING', event: 'contextCacheFailed', reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
        return null;
      }).finally(() => pending.delete(key));
      pending.set(key, creating);
      return creating;
    },
    invalidate() {
      entries.clear();
    },
  };
}

/** Explicit caches on Vertex AI, for the chat model. */
export function createVertexContextCache(options: { readonly projectId: string; readonly location: string; readonly model: string;
  readonly log?: (line: Record<string, unknown>) => void }): ContextCache {
  const client = new GoogleGenAI({ vertexai: true, project: options.projectId, location: options.location });
  return createContextCache(async (prefix, ttlSeconds, signal) => {
    const cached = await client.caches.create({ model: options.model, config: { displayName: 'melens-chat-prefix',
      systemInstruction: prefix.systemInstruction, tools: prefix.tools, ...(prefix.toolConfig === undefined ? {} : { toolConfig: prefix.toolConfig }),
      ttl: `${ttlSeconds}s`, ...(signal === undefined ? {} : { abortSignal: signal }) } });
    if (cached.name === undefined) throw new Error('Vertex AI returned a cached content without a name');
    const expiresAt = cached.expireTime === undefined ? Date.now() + ttlSeconds * 1_000 : Date.parse(cached.expireTime);
    return { name: cached.name, expiresAt };
  }, options.log === undefined ? {} : { log: options.log });
}

/**
 * Points the request at the cached prefix when its instruction and tools are cached: Vertex AI refuses a call that
 * names a cached content and also sends an instruction, tools or a tool config. A request without tools (the last
 * call of a turn) keeps its prefix, since no cache matches it.
 */
export async function useContextCache(cache: ContextCache, request: LlmRequest, signal?: AbortSignal): Promise<boolean> {
  const config = request.config;
  if (config?.systemInstruction === undefined || config.tools === undefined || config.tools.length === 0) return false;
  const name = await cache.nameFor({ systemInstruction: config.systemInstruction, tools: config.tools as Tool[],
    ...(config.toolConfig === undefined ? {} : { toolConfig: config.toolConfig }) }, signal);
  if (name === null) return false;
  config.cachedContent = name;
  delete config.systemInstruction;
  delete config.tools;
  delete config.toolConfig;
  return true;
}

/** Vertex AI's answer to a call naming a cached content that expired or no longer exists. */
export function isCacheMiss(error: unknown): boolean {
  return error instanceof Error && /cached.?content/i.test(error.message);
}
