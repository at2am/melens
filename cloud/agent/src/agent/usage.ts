import type { GenerateContentResponseUsageMetadata } from '@google/genai';

import type { CallUsage, FinalUsage, TurnUsage } from '../protocol/schemas.js';
import { zeroUsage } from '../protocol/schemas.js';

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** A streamed chunk's usage block may exist with no counts; only the trailing aggregated response carries them. */
export function hasUsage(metadata: GenerateContentResponseUsageMetadata | undefined): boolean {
  if (metadata === undefined) return false;
  return [metadata.promptTokenCount, metadata.candidatesTokenCount, metadata.thoughtsTokenCount, metadata.totalTokenCount]
    .some((value) => typeof value === 'number' && value > 0);
}

/** Token accounting for one turn: every model call reported once, copied from Gemini, never estimated. */
export class UsageLedger {
  readonly perCall: CallUsage[] = [];
  private totals: TurnUsage = zeroUsage();
  constructor(private readonly options: { readonly turnId: string; readonly log?: (line: Record<string, unknown>) => void }) {}

  get turn(): TurnUsage { return { ...this.totals }; }
  get calls(): number { return this.totals.calls; }

  /** Records one finished model call and returns the call usage to stream. */
  record(metadata: GenerateContentResponseUsageMetadata | undefined, call: { readonly agent: string; readonly model: string; readonly durationMs: number }): CallUsage {
    const usage: CallUsage = {
      index: this.perCall.length + 1, agent: call.agent, model: call.model,
      input: count(metadata?.promptTokenCount), cachedInput: count(metadata?.cachedContentTokenCount),
      output: count(metadata?.candidatesTokenCount), thoughts: count(metadata?.thoughtsTokenCount),
      toolUseInput: count(metadata?.toolUsePromptTokenCount), total: count(metadata?.totalTokenCount),
      durationMs: count(call.durationMs),
    };
    this.perCall.push(usage);
    this.totals = { calls: this.totals.calls + 1, input: this.totals.input + usage.input, cachedInput: this.totals.cachedInput + usage.cachedInput,
      output: this.totals.output + usage.output, thoughts: this.totals.thoughts + usage.thoughts,
      toolUseInput: this.totals.toolUseInput + usage.toolUseInput, total: this.totals.total + usage.total };
    const line: Record<string, unknown> = { severity: 'INFO', event: 'modelCall', turnId: this.options.turnId, ...usage };
    // Gemini documents the total as prompt + thoughts + candidates; tool-use prompt tokens may or may not be inside it.
    if (Math.abs(usage.total - (usage.input + usage.output + usage.thoughts)) > usage.toolUseInput) {
      line.severity = 'WARNING'; line.warning = 'totalDoesNotAddUp';
    } else if (metadata === undefined) {
      line.severity = 'WARNING'; line.warning = 'noUsageMetadata';
    }
    this.options.log?.(line);
    return usage;
  }

  final(complete: boolean): FinalUsage { return { ...this.totals, complete }; }
}
