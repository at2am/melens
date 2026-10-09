import type { GenerateContentResponseUsageMetadata } from '@google/genai';

import type { LatLng } from '../protocol/schemas.js';

export interface GroundingSource { readonly title: string; readonly url: string }
export interface GroundingPlace { readonly title: string; readonly place_id: string; readonly maps_uri: string }

export interface GroundingResult {
  readonly answer: string;
  readonly sources: readonly GroundingSource[];
  readonly places: readonly GroundingPlace[];
  /** Google's rendered search suggestions; the app shows them with grounded results. */
  readonly searchEntryPoint: string | null;
  readonly usage: GenerateContentResponseUsageMetadata | undefined;
  readonly model: string;
}

/** One-shot grounded Gemini calls, separate from the loop so the loop keeps function tools. */
export interface GroundingModel {
  ground(request: { readonly kind: 'search' | 'maps'; readonly question: string; readonly location: LatLng | null;
    readonly signal: AbortSignal }): Promise<GroundingResult>;
}

const INSTRUCTION = 'You answer in English for a Melbourne, Australia map assistant. Answer the question directly in at most 120 words, '
  + 'using the grounding tool. Name the places, times and facts the sources support and nothing else.';

/** Gemini through Vertex AI with the service identity; the client loads lazily so tests never touch it. */
export function createVertexGrounding(options: { readonly projectId: string; readonly location: string; readonly model: string }): GroundingModel {
  let client: Promise<import('@google/genai').GoogleGenAI> | null = null;
  const load = () => client ??= import('@google/genai').then(({ GoogleGenAI }) =>
    new GoogleGenAI({ vertexai: true, project: options.projectId, location: options.location }));
  return {
    async ground(request) {
      const ai = await load();
      const response = await ai.models.generateContent({ model: options.model, contents: request.question, config: {
        systemInstruction: INSTRUCTION, abortSignal: request.signal,
        tools: [request.kind === 'search' ? { googleSearch: {} } : { googleMaps: {} }],
        ...(request.kind === 'maps' && request.location !== null
          ? { toolConfig: { retrievalConfig: { latLng: { latitude: request.location.lat, longitude: request.location.lng } } } } : {}),
      } });
      const grounding = response.candidates?.[0]?.groundingMetadata;
      const sources: GroundingSource[] = [];
      const places: GroundingPlace[] = [];
      for (const chunk of grounding?.groundingChunks ?? []) {
        if (chunk.web?.uri) sources.push({ title: chunk.web.title ?? chunk.web.uri, url: chunk.web.uri });
        if (chunk.maps?.uri) places.push({ title: chunk.maps.title ?? 'Place', place_id: chunk.maps.placeId ?? '', maps_uri: chunk.maps.uri });
      }
      return { answer: response.text ?? '', sources, places, searchEntryPoint: grounding?.searchEntryPoint?.renderedContent ?? null,
        usage: response.usageMetadata, model: options.model };
    },
  };
}
