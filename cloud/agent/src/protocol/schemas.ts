import { z } from 'zod';

import { identifierSchema, layerIdSchema } from '@melens/shared/contracts/map-contract';

/** Wire schemas for the agent protocol (system-design/agent-protocol.md). The Zod schemas are the source of truth. */

export const latLngSchema = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
export type LatLng = z.infer<typeof latLngSchema>;

export const viewportSchema = z.strictObject({
  north: z.number().min(-90).max(90), south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180), west: z.number().min(-180).max(180),
}).refine((viewport) => viewport.north > viewport.south && viewport.east > viewport.west, 'Viewport must have north > south and east > west');

const localTime = z.iso.datetime({ offset: true });

export const requestContextSchema = z.strictObject({
  viewport: viewportSchema,
  zoom: z.number().min(0).max(22),
  userLocation: latLngSchema.nullable().optional(),
  selected: z.strictObject({ featureId: identifierSchema.nullable(), point: latLngSchema.nullable() }).optional(),
  layers: z.array(layerIdSchema).max(9).default([]),
  openCardId: identifierSchema.nullable().optional(),
  localTime,
});
export type RequestContext = z.infer<typeof requestContextSchema>;

export const turnInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), text: z.string().trim().min(1).max(2_000) }),
  z.strictObject({ kind: z.literal('area'), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  z.strictObject({ kind: z.literal('analyse'), featureId: identifierSchema }),
  z.strictObject({ kind: z.literal('answer'), questionId: identifierSchema, value: z.string().trim().min(1).max(200) }),
]);
export type TurnInput = z.infer<typeof turnInputSchema>;

export const turnRequestSchema = z.strictObject({ input: turnInputSchema, context: requestContextSchema });
export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const timeWindowSchema = z.strictObject({ from: localTime.optional(), to: localTime.optional() });
export type TimeWindow = z.infer<typeof timeWindowSchema>;

/** A card item cites one feature id or one URL that a tool returned in the same turn. */
export const cardSourceSchema = z.union([
  z.strictObject({ feature_id: identifierSchema }),
  z.strictObject({ url: z.url({ protocol: /^https?$/ }), title: z.string().min(1).max(200).optional() }),
]);
export type CardSource = z.infer<typeof cardSourceSchema>;

export const cardItemSchema = z.strictObject({
  title: z.string().min(1).max(80),
  summary: z.string().max(240).optional(),
  source: cardSourceSchema,
  time: timeWindowSchema.optional(),
  location: latLngSchema.optional(),
  place_id: z.string().min(1).max(200).optional(),
  cost: z.string().max(40).optional(),
  getting_there: z.string().max(80).optional(),
});
export type CardItem = z.infer<typeof cardItemSchema>;

export const cardTypeSchema = z.enum(['area_brief', 'anomaly_analysis', 'plan', 'history', 'list']);
export const cardSchema = z.strictObject({
  id: identifierSchema,
  type: cardTypeSchema,
  title: z.string().min(1).max(80),
  intro: z.string().max(300).optional(),
  items: z.array(cardItemSchema).min(1).max(13),
  attribution: z.record(z.string(), z.unknown()).optional(),
});
export type Card = z.infer<typeof cardSchema>;

export const uiActionNameSchema = z.enum(['show_layers', 'focus_map', 'draw_route', 'highlight_features']);

const count = z.number().int().nonnegative();
/** One model call's usage, copied from Gemini's usageMetadata; a field Gemini did not return is 0. */
export const callUsageSchema = z.strictObject({
  index: z.number().int().positive(),
  agent: z.string().min(1),
  model: z.string().min(1),
  input: count, cachedInput: count, output: count, thoughts: count, toolUseInput: count, total: count,
  durationMs: count,
});
export type CallUsage = z.infer<typeof callUsageSchema>;
export const turnUsageSchema = z.strictObject({
  calls: count, input: count, cachedInput: count, output: count, thoughts: count, toolUseInput: count, total: count,
});
export type TurnUsage = z.infer<typeof turnUsageSchema>;
export const finalUsageSchema = turnUsageSchema.extend({ complete: z.boolean() });
export type FinalUsage = z.infer<typeof finalUsageSchema>;

export const stopReasonSchema = z.enum(['end', 'asked', 'budget', 'cancelled']);
export type StopReason = z.infer<typeof stopReasonSchema>;

export const questionSchema = z.strictObject({
  id: identifierSchema, text: z.string().min(1).max(200),
  options: z.array(z.string().min(1).max(40)).min(2).max(4), allowFreeText: z.boolean(),
});
export type Question = z.infer<typeof questionSchema>;

/** Where a tool call is: `running` when it starts, then `done` or `failed` (a tool error) when it ends. */
export const stepStateSchema = z.enum(['running', 'done', 'failed']);
export type StepState = z.infer<typeof stepStateSchema>;

const envelope = { turnId: identifierSchema, seq: count };
/** Every tool call is one step; the events it produces carry the same `stepId`. */
const step = { stepId: identifierSchema };
export const agentEventSchema = z.discriminatedUnion('event', [
  z.strictObject({ ...envelope, ...step, event: z.literal('status'), state: stepStateSchema, tool: z.string().min(1).max(60),
    text: z.string().min(1).max(200), detail: z.string().min(1).max(200).optional(), rows: count.optional(),
    error: z.string().min(1).max(80).optional(), durationMs: count.optional(), memo: z.boolean().optional() }),
  z.strictObject({ ...envelope, event: z.literal('text'), delta: z.string().min(1) }),
  z.strictObject({ ...envelope, ...step, event: z.literal('ui_action'), action: uiActionNameSchema, args: z.record(z.string(), z.unknown()) }),
  z.strictObject({ ...envelope, ...step, event: z.literal('card'), card: cardSchema }),
  z.strictObject({ ...envelope, ...step, event: z.literal('question'), question: questionSchema }),
  z.strictObject({ ...envelope, event: z.literal('usage'), call: callUsageSchema, turn: turnUsageSchema }),
  z.strictObject({ ...envelope, event: z.literal('done'), stop: stopReasonSchema, usage: finalUsageSchema }),
  z.strictObject({ ...envelope, event: z.literal('error'), message: z.string().min(1).max(300), retryable: z.boolean(), usage: finalUsageSchema }),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
/** What a producer hands the stream; the stream adds the envelope. */
export type AgentEventBody = AgentEvent extends infer E ? E extends AgentEvent ? Omit<E, 'turnId' | 'seq'> : never : never;

/**
 * One line of the compact tool trace stored with a turn and shown in the eval: the tool, its arguments, the
 * status line and argument summary the app showed, the row count, the error code and the duration. `memo`
 * marks a read-only call answered from an earlier identical call. `detail` and `memo` default for turns
 * stored before they existed.
 */
export const traceEntrySchema = z.strictObject({
  tool: z.string().min(1), args: z.record(z.string(), z.unknown()), status: z.string().max(200).nullable(),
  detail: z.string().max(200).nullable().default(null), rows: count.nullable(), error: z.string().max(80).nullable(),
  durationMs: count, memo: z.boolean().default(false),
});
export type TraceEntry = z.infer<typeof traceEntrySchema>;

/** The turn document: what the app needs to redraw and what the model needs next time. */
export const storedTurnSchema = z.strictObject({
  id: identifierSchema,
  seq: count,
  createdAt: z.iso.datetime(),
  input: turnInputSchema,
  text: z.string(),
  cards: z.array(cardSchema),
  uiActions: z.array(z.strictObject({ action: uiActionNameSchema, args: z.record(z.string(), z.unknown()) })),
  question: questionSchema.nullable(),
  stop: stopReasonSchema,
  trace: z.array(traceEntrySchema).max(200),
  usage: finalUsageSchema.extend({ perCall: z.array(callUsageSchema).max(64) }),
});
export type StoredTurn = z.infer<typeof storedTurnSchema>;

export const sessionSummarySchema = z.strictObject({
  id: identifierSchema, title: z.string().max(80), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), turnCount: count,
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const AGENT_ERROR_CODES = {
  invalidRequest: { status: 400, retryable: false },
  unauthorized: { status: 401, retryable: false },
  notFound: { status: 404, retryable: false },
  turnInProgress: { status: 409, retryable: true },
  rateLimited: { status: 429, retryable: true },
  serviceUnavailable: { status: 503, retryable: true },
  timeout: { status: 504, retryable: true },
} as const satisfies Record<string, { status: number; retryable: boolean }>;
export type AgentErrorCode = keyof typeof AGENT_ERROR_CODES;

export class AgentServiceError extends Error {
  constructor(readonly code: AgentErrorCode) {
    super(`Agent request failed: ${code}`);
    this.name = 'AgentServiceError';
  }
}

export const errorResponseSchema = z.strictObject({
  schemaVersion: z.literal(1),
  error: z.strictObject({ code: z.enum(Object.keys(AGENT_ERROR_CODES) as [AgentErrorCode, ...AgentErrorCode[]]),
    messageKey: z.string(), retryable: z.boolean() }),
});

export function zeroUsage(): TurnUsage {
  return { calls: 0, input: 0, cachedInput: 0, output: 0, thoughts: 0, toolUseInput: 0, total: 0 };
}
