import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import type { Content, GenerateContentResponseUsageMetadata, ToolListUnion } from '@google/genai';
import type { LayerId, MapItem } from '@melens/shared/contracts/map-contract';

import type { FeatureReader, LayerFeatures } from '../src/features/reader.js';
import type { RequestContext, TurnRequest } from '../src/protocol/schemas.js';
import { collectingSink } from '../src/protocol/sse.js';
import type { TurnContext } from '../src/server.js';
import type { SessionRecord } from '../src/sessions/store.js';

export interface SeenRequest { readonly contents: Content[]; readonly tools: ToolListUnion | undefined; readonly stream: boolean }

/** A Gemini stand-in that answers each model call from a script and records what it was asked. */
export class ScriptedLlm extends BaseLlm {
  readonly seen: SeenRequest[] = [];
  constructor(private readonly steps: Array<(request: LlmRequest) => LlmResponse[]>) { super({ model: 'gemini-test' }); }
  async *generateContentAsync(request: LlmRequest, stream?: boolean): AsyncGenerator<LlmResponse, void> {
    this.seen.push({ contents: request.contents.map((content) => ({ ...content })), tools: request.config?.tools, stream: stream === true });
    const step = this.steps.shift();
    if (step === undefined) throw new Error(`Unscripted model call ${this.seen.length}`);
    for (const response of step(request)) yield response;
  }
  async connect(): Promise<never> { throw new Error('Live connections are not used'); }
}

export function usage(input: number, output: number, thoughts = 0): GenerateContentResponseUsageMetadata {
  return { promptTokenCount: input, candidatesTokenCount: output, thoughtsTokenCount: thoughts, totalTokenCount: input + output + thoughts };
}

/** Two partial chunks and the aggregated final response, the shape ADK's streaming aggregator produces. */
export function streamedText(text: string, meta: GenerateContentResponseUsageMetadata): LlmResponse[] {
  const cut = Math.min(3, text.length);
  return [
    { content: { role: 'model', parts: [{ text: text.slice(0, cut) }] }, partial: true },
    { content: { role: 'model', parts: [{ text: text.slice(cut) }] }, partial: true },
    { content: { role: 'model', parts: [{ text }] }, partial: false, usageMetadata: meta },
  ];
}

export function functionCall(name: string, args: Record<string, unknown>, meta: GenerateContentResponseUsageMetadata, text?: string): LlmResponse[] {
  return [{ content: { role: 'model', parts: [...(text === undefined ? [] : [{ text }]), { functionCall: { name, args } }] }, partial: false, usageMetadata: meta }];
}

export function eventItem(id: string, title: string, lng: number, lat: number, startAt: string, endAt: string): MapItem {
  return { id, versionId: 'v1', layerId: 'event', kind: 'event', title,
    geometry: { type: 'Point', coordinates: [lng, lat] }, location: { precision: 'point', role: 'eventSite', evidence: null },
    assertionKind: 'plan', lifecycle: 'planned',
    time: { observedAt: null, reportedAt: null, validFrom: startAt, validTo: endAt, periodLabel: null, fetchedAt: null, sourceTimeText: null, sourceTimezone: null },
    sources: [{ sourceId: 'ticketmaster', url: `https://example.org/events/${id}`, attribution: 'Ticketmaster', versionRef: null }],
    details: { summary: 'Live music in the city', venueName: 'Hamer Hall', category: 'music', startAt, endAt, status: 'planned' } };
}

export function fakeReader(items: readonly MapItem[]): FeatureReader & { readonly queries: { layers: readonly LayerId[] }[] } {
  const queries: { layers: readonly LayerId[] }[] = [];
  return { queries, async search(query) {
    queries.push({ layers: query.layers });
    return query.layers.map((layerId): LayerFeatures => {
      const found = items.filter((item) => item.layerId === layerId);
      return { layerId, state: found.length === 0 ? 'noMatching' : 'available', completeness: 'complete', items: found };
    });
  } };
}

export const CONTEXT: RequestContext = { viewport: { north: -37.80, south: -37.83, east: 144.98, west: 144.95 }, zoom: 15,
  userLocation: { lat: -37.8136, lng: 144.9631 }, layers: ['event'], localTime: '2026-10-10T18:40:00+11:00' };

export function turnContext(text: string, options: { pendingQuestion?: SessionRecord['pendingQuestion']; history?: TurnContext['history']; signal?: AbortSignal } = {}): TurnContext {
  const request: TurnRequest = { input: { kind: 'text', text }, context: CONTEXT };
  const session: SessionRecord = { id: 's_test', uid: 'u_test', title: '', createdAt: '2026-10-10T07:00:00.000Z', updatedAt: '2026-10-10T07:00:00.000Z',
    turnCount: 0, pendingQuestion: options.pendingQuestion ?? null, activeTurn: null, expiresAt: '2026-11-09T07:00:00.000Z' };
  return { uid: 'u_test', session, turnId: 't_test', seq: 1, request, history: options.history ?? [], sink: collectingSink('t_test'),
    signal: options.signal ?? new AbortController().signal, startedAt: new Date('2026-10-10T07:40:00Z') };
}
