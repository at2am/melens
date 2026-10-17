import { InMemorySessionService, LlmAgent, Runner, StreamingMode, createEvent, type BaseLlm, type LlmRequest, type LlmResponse, type RunConfig } from '@google/adk';
import type { Part } from '@google/genai';

import { attachmentRefOf } from '../protocol/attachments.js';
import type { StopReason, StoredTurn, TurnFailure } from '../protocol/schemas.js';
import type { TurnContext, TurnRunner } from '../server.js';
import { TurnRegistry, buildTool, isToolError, runTool } from '../tools/define.js';
import { analyseAnomalyTool, areaBriefTool } from '../workflows/workflows.js';
import { toolSpecs, type ToolDependencies } from '../tools/catalog.js';
import { compactOldToolResults } from './compaction.js';
import { isCacheMiss, useContextCache, type ContextCache } from './context-cache.js';
import { AGENT_NAME, BUDGET_NOTES, INSTRUCTION, historyContents, questionsOf, turnMessage } from './prompts.js';
import { hasUsage } from './usage.js';

const APP_NAME = 'melens';
/**
 * Text that reaches the loop without partial chunks: ADK's streaming aggregator holds back text that arrives in the same
 * chunk as a function call, and hands it over whole. It goes to the app in pieces of about this many characters, over
 * at most `FALLBACK_STREAM.totalMs`, so it reads as streamed rather than appearing in one jump. The pieces are awaited
 * so the step that follows still comes after its text. (ADK's experimental progressive streaming would stream it, but
 * ADK runs the function calls of partial events too, so each call would run twice.)
 */
export const FALLBACK_STREAM = { minChars: 120, pieceChars: 40, totalMs: 300 } as const;

/** Splits `text` at spaces into pieces of about `size` characters; joined, they are `text`. */
export function textPieces(text: string, size: number): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const space = text.indexOf(' ', end);
      end = space === -1 ? text.length : space + 1;
    }
    pieces.push(text.slice(start, end));
    start = end;
  }
  return pieces;
}

/** Vertex AI's 400 for an attached file it cannot decode. */
const UNREADABLE_FILE = /could not be decoded|malformed or corrupted/i;

/** ADK reports a failed model call (credentials, quota, a blocked response) as an event with `errorCode` or `errorMessage` and no content. */
export class ModelCallError extends Error {
  constructor(readonly code: string | undefined, message: string | undefined) {
    super(message ?? 'The model call failed');
    this.name = 'ModelCallError';
  }
}

export interface MapAgentOptions {
  /** A Gemini instance for Vertex AI, or any BaseLlm (tests inject a scripted one). */
  readonly model: BaseLlm;
  readonly tools: ToolDependencies;
  readonly maxModelCalls: number;
  /** Serves the instruction and the tool declarations from a Gemini context cache; without it they go with every call. */
  readonly contextCache?: ContextCache;
  /** How long held-back text takes to reach the app in pieces; tests pass 0. Defaults to `FALLBACK_STREAM.totalMs`. */
  readonly fallbackStreamMs?: number;
  readonly clock?: () => Date;
  readonly log?: (line: Record<string, unknown>) => void;
}

function stripTools(request: LlmRequest): void {
  if (request.config !== undefined) delete request.config.tools;
  request.toolsDict = {};
}

function textOf(parts: readonly Part[]): string {
  return parts.filter((part) => typeof part.text === 'string' && part.thought !== true).map((part) => part.text).join('');
}

/**
 * The chat agent as a turn runner: one ADK LlmAgent per turn, bound to that turn's registry, with the
 * call budget, usage accounting and the ask_user stop implemented as model callbacks.
 */
export function createMapAgentRunner(options: MapAgentOptions): TurnRunner {
  const clock = options.clock ?? (() => new Date());
  const modelName = options.model.model;

  return {
    async run(turn: TurnContext): Promise<StoredTurn> {
      const registry = new TurnRegistry({ turnId: turn.turnId, uid: turn.uid, request: turn.request, sink: turn.sink,
        signal: turn.signal, clock, ...(options.log === undefined ? {} : { log: options.log }) });
      if (turn.planCard !== undefined) {
        registry.rememberCard(turn.planCard);
        registry.basePlan = turn.planCard;
      }
      const tools = toolSpecs(options.tools).map((spec) => buildTool(spec, registry));
      let streamedText = false;
      let answer = '';
      // ADK runs afterModelCallback for every response of a streamed call: the flushed function-call
      // response, whose chunk carries no usage, and the trailing aggregated one that carries it. One
      // request is one call, so a call stays open until a response brings usage or the next request starts.
      let openCall: { startedAt: number; finishedAt: number | null } | null = null;
      const closeCall = (metadata?: LlmResponse['usageMetadata']): void => {
        if (openCall === null) return;
        const usage = registry.usage.record(metadata, { agent: AGENT_NAME, model: modelName,
          durationMs: (openCall.finishedAt ?? clock().getTime()) - openCall.startedAt });
        openCall = null;
        turn.sink.emit({ event: 'usage', call: usage, turn: registry.usage.turn });
      };

      let failure: TurnFailure | undefined;
      const emitInPieces = async (text: string): Promise<void> => {
        const pieces = text.length < FALLBACK_STREAM.minChars ? [text] : textPieces(text, FALLBACK_STREAM.pieceChars);
        const pause = (options.fallbackStreamMs ?? FALLBACK_STREAM.totalMs) / pieces.length;
        for (const [index, piece] of pieces.entries()) {
          if (index > 0 && pause > 0 && !turn.signal.aborted) await new Promise((resolve) => setTimeout(resolve, pause));
          turn.sink.emit({ event: 'text', delta: piece });
        }
      };
      // The map's own entry points already say what to do, so code, not the model, picks the workflow (agent-design.md, Entry routing).
      // A workflow that produces no card (nothing found, a model or data failure) falls through to the loop with the explicit prompt.
      let handledByWorkflow = false;
      const input = turn.request.input;
      if (input.kind === 'area' || input.kind === 'analyse') {
        try {
          const outcome = input.kind === 'area'
            ? await runTool(areaBriefTool(options.tools), registry, { point: { lat: input.lat, lng: input.lng } })
            : await runTool(analyseAnomalyTool(options.tools), registry, { feature_id: input.featureId });
          handledByWorkflow = !isToolError(outcome) && registry.cards.length > 0;
        } catch (error) {
          if (!turn.signal.aborted) options.log?.({ severity: 'WARNING', event: 'workflowFailed', turnId: turn.turnId, reason: error instanceof Error ? error.name : 'unknown' });
        }
      }

      if (!handledByWorkflow && !turn.signal.aborted) {
        const agent = new LlmAgent({
          name: AGENT_NAME,
          model: options.model,
          instruction: INSTRUCTION,
          tools,
          beforeModelCallback: async ({ request }): Promise<LlmResponse | undefined> => {
            closeCall();
            streamedText = false;
            // ask_user ends the turn: the step after its answer gets an empty final response instead of a model call.
            if (registry.asked !== null) return { content: { role: 'model', parts: [{ text: '' }] }, partial: false };
            const call: { startedAt: number; finishedAt: number | null } = { startedAt: clock().getTime(), finishedAt: null };
            openCall = call;
            const index = registry.usage.calls + 1;
            if (registry.toolsDisabled || index >= options.maxModelCalls) {
              stripTools(request);
              if (index >= options.maxModelCalls) registry.budgetForced = true;
              request.contents.push({ role: 'user', parts: [{ text: BUDGET_NOTES.noTools }] });
            } else if (index === options.maxModelCalls - 1) {
              request.contents.push({ role: 'user', parts: [{ text: BUDGET_NOTES.wrapUp }] });
            }
            const compacted = compactOldToolResults(request.contents);
            if (compacted > 0) options.log?.({ severity: 'INFO', event: 'toolResultsCompacted', turnId: turn.turnId, call: index, results: compacted });
            if (options.contextCache !== undefined) {
              await useContextCache(options.contextCache, request, turn.signal);
              // The call starts once the cache is ready, so its duration is the model's own.
              call.startedAt = clock().getTime();
            }
            return undefined;
          },
          afterModelCallback: ({ response }): LlmResponse | undefined => {
            if (response.partial === true || openCall === null) return undefined;
            // The first complete response ends the model's work; tools run before the trailing usage arrives.
            openCall.finishedAt ??= clock().getTime();
            if (hasUsage(response.usageMetadata)) closeCall(response.usageMetadata);
            return undefined;
          },
        });

        const sessionService = new InMemorySessionService();
        const session = await sessionService.createSession({ appName: APP_NAME, userId: turn.uid, sessionId: turn.session.id });
        for (const content of historyContents(turn.history, turn.historyImages)) {
          await sessionService.appendEvent({ session, event: createEvent({ invocationId: 'history',
            author: content.role === 'user' ? 'user' : AGENT_NAME, content }) });
        }
        const runner = new Runner({ appName: APP_NAME, agent, sessionService });
        const runConfig: RunConfig = { streamingMode: StreamingMode.SSE, maxLlmCalls: options.maxModelCalls };

        try {
          const events = runner.runAsync({ userId: turn.uid, sessionId: session.id,
            newMessage: turnMessage(turn.request.input, turn.request.context, turn.images, turn.planCard, questionsOf(turn.history),
              turn.session.pendingQuestion, turn.memory ?? null),
            runConfig, abortSignal: turn.signal });
          for await (const event of events) {
            if (event.errorCode !== undefined || event.errorMessage !== undefined) throw new ModelCallError(event.errorCode, event.errorMessage);
            if (event.author !== AGENT_NAME || event.content?.parts === undefined) continue;
            const parts = event.content.parts;
            if (parts.some((part) => part.functionResponse !== undefined)) continue;
            const text = textOf(parts);
            if (event.partial === true) {
              if (text !== '') { streamedText = true; answer += text; turn.sink.emit({ event: 'text', delta: text }); }
            } else if (!streamedText && text.trim() !== '') {
              answer += text;
              await emitInPieces(text);
            }
          }
          closeCall();
        } catch (error) {
          openCall = null; // a failed call reports no usage of its own; the error event carries the totals
          if (!turn.signal.aborted) {
            options.log?.({ severity: 'ERROR', event: 'modelLoopFailed', turnId: turn.turnId, reason: error instanceof Error ? error.name : 'unknown',
              detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
            // A cache that expired or was deleted under the call is made again by the next turn.
            if (isCacheMiss(error)) options.contextCache?.invalidate();
            // Gemini refuses a photo it cannot decode; sending the same turn again cannot help.
            const unreadablePhoto = error instanceof ModelCallError && turn.images.length > 0 && UNREADABLE_FILE.test(error.message);
            failure = { message: unreadablePhoto ? 'A photo could not be read. Send a different one.' : 'The agent could not finish this turn',
              retryable: !unreadablePhoto };
          }
        }

      }

      const stop: StopReason = failure !== undefined ? 'end' : registry.asked !== null ? 'asked' : turn.signal.aborted ? 'cancelled'
        : registry.budgetForced ? 'budget' : 'end';
      const usage = registry.usage.final(!turn.signal.aborted && failure === undefined);
      // A failed turn ends with `error` and is stored with what it produced, so the conversation and the model keep it.
      if (failure === undefined) turn.sink.emit({ event: 'done', stop, usage });
      else turn.sink.emit({ event: 'error', ...failure, usage });
      const asked = failure === undefined ? registry.asked : null;
      return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input,
        attachments: turn.images.map(attachmentRefOf), text: answer, cards: registry.cards, uiActions: registry.uiActions,
        question: asked, questions: asked === null ? [] : registry.questions, stop, ...(failure === undefined ? {} : { failure }),
        trace: registry.trace.slice(0, 200),
        usage: { ...usage, perCall: registry.usage.perCall.slice(0, 64) } };
    },
  };
}
