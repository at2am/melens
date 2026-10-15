import type { GenerateContentResponseUsageMetadata } from '@google/genai';
import { z } from 'zod';

export interface StructuredResult<T> {
  readonly value: T;
  readonly usage: GenerateContentResponseUsageMetadata | undefined;
  readonly model: string;
}

/** One-shot Gemini generation with a JSON schema, for the workflows: code decides the steps, the model fills one structure. */
export interface StructuredModel {
  generate<S extends z.ZodType>(request: { readonly system: string; readonly prompt: string; readonly schema: S; readonly signal: AbortSignal }): Promise<StructuredResult<z.output<S>>>;
}

/** Gemini through Vertex AI with the service identity; the client loads lazily so tests never touch it. */
export function createVertexStructuredModel(options: { readonly projectId: string; readonly location: string; readonly model: string }): StructuredModel {
  let client: Promise<import('@google/genai').GoogleGenAI> | null = null;
  const load = () => client ??= import('@google/genai').then(({ GoogleGenAI }) =>
    new GoogleGenAI({ vertexai: true, project: options.projectId, location: options.location }));
  return {
    async generate(request) {
      const ai = await load();
      const response = await ai.models.generateContent({ model: options.model, contents: request.prompt, config: {
        systemInstruction: request.system, abortSignal: request.signal, responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(request.schema) } });
      const value = request.schema.parse(JSON.parse(response.text ?? ''));
      return { value, usage: response.usageMetadata, model: options.model };
    },
  };
}
