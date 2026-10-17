import type { Content, Part } from '@google/genai';

/**
 * Result compaction (agent-design.md, Open questions): a large tool result the model already read in an earlier call of
 * the turn goes to the later calls shortened, its lists cut to the first few rows and its long strings clipped. The
 * newest results stay whole. Card sources are checked against what the tools returned, not against the prompt, so a
 * shortened result never makes a citation invalid.
 */
export const COMPACTION_LIMITS = {
  /** Results smaller than this, as JSON, stay whole. */
  minChars: 6_000,
  keepItems: 5,
  maxString: 400,
} as const;

function compactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length <= COMPACTION_LIMITS.maxString ? value : `${value.slice(0, COMPACTION_LIMITS.maxString)}…`;
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, COMPACTION_LIMITS.keepItems).map(compactValue);
    const omitted = value.length - kept.length;
    return omitted === 0 ? kept : [...kept, `… ${omitted} more not shown again; call the tool again if you need them`];
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactValue(item)]));
  }
  return value;
}

function compactPart(part: Part): Part {
  const response = part.functionResponse?.response;
  if (response === undefined || JSON.stringify(response).length < COMPACTION_LIMITS.minChars) return part;
  return { ...part, functionResponse: { ...part.functionResponse, response: compactValue(response) as Record<string, unknown> } };
}

/**
 * Shortens the large tool results of every content but the last one that carries results, in place of the array's
 * entries; the contents themselves are shared with the session and are never changed. Returns how many were shortened.
 */
export function compactOldToolResults(contents: Content[]): number {
  const latest = contents.findLastIndex((content) => content.parts?.some((part) => part.functionResponse !== undefined) === true);
  let compacted = 0;
  for (let index = 0; index < latest; index += 1) {
    const content = contents[index]!;
    if (content.parts?.some((part) => part.functionResponse !== undefined) !== true) continue;
    const parts = content.parts.map(compactPart);
    const changed = parts.filter((part, at) => part !== content.parts![at]).length;
    if (changed === 0) continue;
    compacted += changed;
    contents[index] = { ...content, parts };
  }
  return compacted;
}
