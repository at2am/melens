import { InMemorySessionService, LlmAgent, Runner, StreamingMode, createEvent, type BaseLlm, type LlmRequest, type LlmResponse, type RunConfig } from '@google/adk';
import type { Part } from '@google/genai';

import { attachmentRefOf } from '../protocol/attachments.js';
import type { StopReason, StoredTurn } from '../protocol/schemas.js';
import type { TurnContext, TurnRunner } from '../server.js';
import { TurnRegistry, buildTool } from '../tools/define.js';
import { toolSpecs, type ToolDependencies } from '../tools/catalog.js';
import { AGENT_NAME, BUDGET_NOTES, historyContents, instructionFor, turnMessage } from './prompts.js';
import { hasUsage } from './usage.js';

const APP_NAME = 'melens';
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

      const agent = new LlmAgent({
        name: AGENT_NAME,
        model: options.model,
        instruction: instructionFor(turn.session.pendingQuestion),
        tools,
        beforeModelCallback: ({ request }): LlmResponse | undefined => {
          closeCall();
          streamedText = false;
          // ask_user ends the turn: the step after its answer gets an empty final response instead of a model call.
          if (registry.asked !== null) return { content: { role: 'model', parts: [{ text: '' }] }, partial: false };
          openCall = { startedAt: clock().getTime(), finishedAt: null };
          const index = registry.usage.calls + 1;
          if (registry.toolsDisabled || index >= options.maxModelCalls) {
            stripTools(request);
            if (index >= options.maxModelCalls) registry.budgetForced = true;
            request.contents.push({ role: 'user', parts: [{ text: BUDGET_NOTES.noTools }] });
          } else if (index === options.maxModelCalls - 1) {
            request.contents.push({ role: 'user', parts: [{ text: BUDGET_NOTES.wrapUp }] });
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

      let failed = false;
      try {
        const events = runner.runAsync({ userId: turn.uid, sessionId: session.id,
          newMessage: turnMessage(turn.request.input, turn.request.context, turn.images), runConfig, abortSignal: turn.signal });
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
            turn.sink.emit({ event: 'text', delta: text });
          }
        }
        closeCall();
      } catch (error) {
        openCall = null; // a failed call reports no usage of its own; the error event carries the totals
        if (!turn.signal.aborted) {
          failed = true;
          options.log?.({ severity: 'ERROR', event: 'modelLoopFailed', turnId: turn.turnId, reason: error instanceof Error ? error.name : 'unknown',
            detail: error instanceof Error ? error.message.slice(0, 300) : undefined });
          // Gemini refuses a photo it cannot decode; sending the same turn again cannot help.
          const unreadablePhoto = error instanceof ModelCallError && turn.images.length > 0 && UNREADABLE_FILE.test(error.message);
          turn.sink.emit({ event: 'error', message: unreadablePhoto ? 'A photo could not be read. Send a different one.' : 'The agent could not finish this turn',
            retryable: !unreadablePhoto, usage: registry.usage.final(false) });
          throw error;
        }
      }

      const stop: StopReason = registry.asked !== null ? 'asked' : turn.signal.aborted ? 'cancelled' : registry.budgetForced ? 'budget' : 'end';
      const usage = registry.usage.final(!turn.signal.aborted && !failed);
      turn.sink.emit({ event: 'done', stop, usage });
      return { id: turn.turnId, seq: turn.seq, createdAt: turn.startedAt.toISOString(), input: turn.request.input,
        attachments: turn.images.map(attachmentRefOf), text: answer,
        cards: registry.cards, uiActions: registry.uiActions, question: registry.asked, stop, trace: registry.trace.slice(0, 200),
        usage: { ...usage, perCall: registry.usage.perCall.slice(0, 64) } };
    },
  };
}
