import { FunctionTool } from '@google/adk';
import type { MapItem } from '@melens/shared/contracts/map-contract';
import { z } from 'zod';

import type { GroundingPlace } from '../agent/grounding.js';
import { UsageLedger } from '../agent/usage.js';
import type { Card, Question, StepState, StoredTurn, TraceEntry, TurnRequest } from '../protocol/schemas.js';
import type { EventSink } from '../protocol/sse.js';
import { toGenaiSchema } from './schema.js';

export const TOOL_ERROR_CODES = {
  invalid_arguments: false, not_found: false, not_an_anomaly: false, unverified_sources: false,
  route_not_found: false, upstream_unavailable: true,
} as const;
export type ToolErrorCode = keyof typeof TOOL_ERROR_CODES;

export interface ToolError {
  readonly error: { readonly code: ToolErrorCode; readonly message: string; readonly retryable: boolean; readonly details: Record<string, unknown> };
}

/** A failed call returns an error object to the model instead of raising, so the model can correct itself. */
export function toolError(code: ToolErrorCode, message: string, details: Record<string, unknown> = {}): ToolError {
  return { error: { code, message, retryable: TOOL_ERROR_CODES[code], details } };
}

export function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/** After this many invalid calls in a row the rest of the turn runs without tools. */
export const MAX_INVALID_CALLS = 2;

/** Everything one turn accumulates while the loop runs; a new registry per turn, nothing shared between users. */
export class TurnRegistry {
  readonly featureIds = new Set<string>();
  readonly urls = new Set<string>();
  readonly places = new Map<string, GroundingPlace>();
  readonly features = new Map<string, MapItem>();
  readonly cards: Card[] = [];
  readonly uiActions: StoredTurn['uiActions'][number][] = [];
  readonly trace: TraceEntry[] = [];
  readonly usage: UsageLedger;
  private readonly memo = new Map<string, unknown>();
  invalidCalls = 0;
  toolsDisabled = false;
  budgetForced = false;
  asked: Question | null = null;
  private questions = 0;
  private steps = 0;

  constructor(readonly turn: {
    readonly turnId: string; readonly uid: string; readonly request: TurnRequest; readonly sink: EventSink;
    readonly signal: AbortSignal; readonly clock: () => Date; readonly log?: (line: Record<string, unknown>) => void;
  }) {
    this.usage = new UsageLedger({ turnId: turn.turnId, ...(turn.log === undefined ? {} : { log: turn.log }) });
  }

  get sink(): EventSink { return this.turn.sink; }
  get signal(): AbortSignal { return this.turn.signal; }
  now(): Date { return this.turn.clock(); }

  rememberFeatures(items: readonly MapItem[]): void {
    for (const item of items) {
      this.features.set(item.id, item);
      this.featureIds.add(item.id);
      for (const source of item.sources) if (source.url !== null) this.urls.add(source.url);
    }
  }

  nextQuestionId(): string { this.questions += 1; return `q_${this.turn.turnId}_${this.questions}`; }
  nextStepId(): string { this.steps += 1; return `s_${this.turn.turnId}_${this.steps}`; }
  nextCardId(): string { return `c_${this.turn.turnId}_${this.cards.length + 1}`; }

  memoGet(key: string): unknown { return this.memo.get(key); }
  memoSet(key: string, value: unknown): void { this.memo.set(key, value); }
}

/** The step a tool call runs as; the events the call emits carry its id so the app shows them under the step. */
export interface ToolStep { readonly id: string }

export interface ToolSpec<S extends z.ZodObject> {
  readonly name: string;
  readonly description: string;
  /** The status line of the call's step, for example "Searching the map"; the app shows it while the call runs and afterwards. */
  readonly status: string;
  /** Identical read-only calls within a turn return the earlier result. */
  readonly readOnly: boolean;
  readonly schema: S;
  /** A short, user-facing summary of the validated arguments, shown after the status line; at most 200 characters are sent. */
  detail?(args: z.output<S>, turn: TurnRegistry): string;
  run(args: z.output<S>, turn: TurnRegistry, step: ToolStep): Promise<unknown>;
}

export function defineTool<S extends z.ZodObject>(spec: ToolSpec<S>): ToolSpec<S> { return spec; }

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** How many rows a result carries: a list's total, or the length of its items, places or sources, or the sum of its totals. */
function rowsOf(result: unknown): number | null {
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  if (typeof record.total === 'number') return record.total;
  if (Array.isArray(record.items)) return record.items.length;
  if (typeof record.totals === 'object' && record.totals !== null) {
    return Object.values(record.totals as Record<string, unknown>).reduce<number>((sum, value) => typeof value === 'number' ? sum + value : sum, 0);
  }
  if (Array.isArray(record.places)) return record.places.length;
  if (Array.isArray(record.sources)) return record.sources.length;
  return null;
}

const MAX_DETAIL = 200;

function clipDetail(detail: string | undefined): string | undefined {
  const trimmed = detail?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  return trimmed.length > MAX_DETAIL ? `${trimmed.slice(0, MAX_DETAIL - 1)}…` : trimmed;
}

/**
 * One tool call as a step of the turn: validation, memo, `status` events, the run and the trace entry. The ADK tool
 * and the workflow entry points (a map tap or Analyse, which skip the model loop) both go through here.
 *
 * Every call is one step of the turn's trace: a `status` event with state `running` when it starts
 * and one with `done` or `failed` when it ends, carrying the row count, the error code and the
 * duration. A memoised or invalid call is instant and sends only the final event. The server
 * validates the arguments itself so an invalid call returns the error object (and counts) instead of throwing.
 */
export async function runTool<S extends z.ZodObject>(spec: ToolSpec<S>, turn: TurnRegistry, rawArgs: unknown): Promise<unknown> {
  const startedAt = turn.now().getTime();
  const stepId = turn.nextStepId();
  const finish = (fields: { state: Exclude<StepState, 'running'>; detail?: string | undefined; rows: number | null; error: string | null; durationMs: number; memo?: boolean }): void => {
    turn.sink.emit({ event: 'status', stepId, state: fields.state, tool: spec.name, text: spec.status,
      ...(fields.detail === undefined ? {} : { detail: fields.detail }), ...(fields.rows === null ? {} : { rows: fields.rows }),
      ...(fields.error === null ? {} : { error: fields.error }), durationMs: fields.durationMs, ...(fields.memo === true ? { memo: true } : {}) });
  };
  const parsed = spec.schema.safeParse(rawArgs ?? {});
  const argsForTrace = typeof rawArgs === 'object' && rawArgs !== null ? rawArgs as Record<string, unknown> : {};
  if (!parsed.success) {
    turn.invalidCalls += 1;
    if (turn.invalidCalls >= MAX_INVALID_CALLS) turn.toolsDisabled = true;
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`).join('; ');
    turn.trace.push({ tool: spec.name, args: argsForTrace, status: spec.status, detail: null, rows: null, error: 'invalid_arguments', durationMs: 0, memo: false });
    finish({ state: 'failed', rows: null, error: 'invalid_arguments', durationMs: 0 });
    return toolError('invalid_arguments', message, { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  }
  turn.invalidCalls = 0;
  const args = parsed.data;
  const detail = clipDetail(spec.detail?.(args, turn));
  const key = `${spec.name}:${stableJson(args)}`;
  if (spec.readOnly) {
    const memo = turn.memoGet(key);
    if (memo !== undefined) {
      const rows = rowsOf(memo);
      turn.trace.push({ tool: spec.name, args: args as Record<string, unknown>, status: spec.status, detail: detail ?? null, rows, error: null, durationMs: 0, memo: true });
      finish({ state: 'done', detail, rows, error: null, durationMs: 0, memo: true });
      return memo;
    }
  }
  turn.sink.emit({ event: 'status', stepId, state: 'running', tool: spec.name, text: spec.status, ...(detail === undefined ? {} : { detail }) });
  let result: unknown;
  try {
    result = await spec.run(args, turn, { id: stepId });
  } catch (error) {
    turn.turn.log?.({ severity: 'WARNING', event: 'toolFailed', turnId: turn.turn.turnId, tool: spec.name, reason: error instanceof Error ? error.name : 'unknown' });
    result = toolError('upstream_unavailable', 'The data source or Google API did not answer; answer with what you have and say what is missing.');
  }
  const durationMs = Math.max(0, turn.now().getTime() - startedAt);
  const rows = rowsOf(result);
  const error = isToolError(result) ? result.error.code : null;
  turn.trace.push({ tool: spec.name, args: args as Record<string, unknown>, status: spec.status, detail: detail ?? null, rows, error, durationMs, memo: false });
  finish({ state: error === null ? 'done' : 'failed', detail, rows, error, durationMs });
  if (spec.readOnly && error === null) turn.memoSet(key, result);
  return result;
}

/**
 * The ADK tool for one spec. Gemini sees the schema as a declaration; the server validates the
 * arguments itself so an invalid call returns the error object (and counts) instead of throwing.
 */
export function buildTool<S extends z.ZodObject>(spec: ToolSpec<S>, turn: TurnRegistry): FunctionTool<import('@google/genai').Schema> {
  return new FunctionTool({
    name: spec.name,
    description: spec.description,
    parameters: toGenaiSchema(spec.schema),
    async execute(rawArgs: unknown) { return runTool(spec, turn, rawArgs); },
  });
}
