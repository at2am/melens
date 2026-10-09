import type { Schema } from '@google/genai';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

function typeName(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * The declaration Gemini sees for a tool: a genai Schema built from the Zod schema the server
 * validates with. Only the keywords Gemini function declarations accept are carried over.
 */
export function toGenaiSchema(schema: z.ZodType): Schema {
  return convert(z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as JsonSchema);
}

function convert(node: JsonSchema): Schema {
  const out: Record<string, unknown> = {};
  if (typeof node.description === 'string') out.description = node.description;
  let type = typeName(node.type);
  if (Array.isArray(node.type)) {
    const types = node.type.filter((item): item is string => typeof item === 'string' && item !== 'null');
    if (types.length !== node.type.length) out.nullable = true;
    type = types[0] ?? null;
  }
  if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const variants = ((node.anyOf ?? node.oneOf) as JsonSchema[]);
    const nonNull = variants.filter((variant) => typeName(variant.type) !== 'null');
    if (nonNull.length !== variants.length) out.nullable = true;
    if (nonNull.length === 1) return { ...convert(nonNull[0]!), ...out };
    out.anyOf = nonNull.map(convert);
    return out as Schema;
  }
  if (node.const !== undefined) { out.type = 'STRING'; out.enum = [String(node.const)]; return out as Schema; }
  if (Array.isArray(node.enum)) { out.type = 'STRING'; out.enum = node.enum.map(String); return out as Schema; }
  switch (type) {
    case 'object': {
      out.type = 'OBJECT';
      const properties = (node.properties ?? {}) as Record<string, JsonSchema>;
      out.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, convert(value)]));
      if (Array.isArray(node.required) && node.required.length > 0) out.required = node.required;
      break;
    }
    case 'array':
      out.type = 'ARRAY';
      if (node.items !== undefined && typeof node.items === 'object') out.items = convert(node.items as JsonSchema);
      if (typeof node.minItems === 'number') out.minItems = String(node.minItems);
      if (typeof node.maxItems === 'number') out.maxItems = String(node.maxItems);
      break;
    case 'integer': case 'number':
      out.type = type === 'integer' ? 'INTEGER' : 'NUMBER';
      if (typeof node.minimum === 'number') out.minimum = node.minimum;
      if (typeof node.maximum === 'number') out.maximum = node.maximum;
      break;
    case 'boolean': out.type = 'BOOLEAN'; break;
    case 'string': default: out.type = 'STRING'; break;
  }
  return out as Schema;
}
