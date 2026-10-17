import { z } from 'zod';

import { describeInput, type QuestionLookup } from '../agent/prompts.js';
import type { TurnInput } from '../protocol/schemas.js';
import { memoryKindSchema, type BrowsingSummary, type MemoryFact, type MemoryView } from './schemas.js';

/** What the user said in a turn, in their own words; null for the map's own entry points and photos without a message. */
export function userWords(input: TurnInput, questions: QuestionLookup): string | null {
  if (input.kind === 'area' || input.kind === 'analyse' || (input.kind === 'text' && input.text === '')) return null;
  return describeInput(input, 0, questions);
}

function browsingLine(browsing: BrowsingSummary): string | null {
  if (browsing.layers.length === 0 && browsing.categories.length === 0) return null;
  const layers = browsing.layers.map(({ layer, share }) => `${layer} (${Math.round(share * 100)}%)`).join(', ');
  const categories = browsing.categories.length === 0 ? '' : `${layers === '' ? '' : '; '}event categories: ${browsing.categories.join(', ')}`;
  return `Often browses: ${layers}${categories}`;
}

/**
 * The user memory for the new message, or null when there is nothing to tell. It goes with the message, not the
 * instruction, so the instruction stays the same for every user and Gemini serves it from the context cache.
 */
export function memoryBlock(view: MemoryView): string | null {
  if (!view.enabled) return null;
  const lines = [...view.facts.map((fact) => `- ${fact.text} (${fact.kind})`)];
  const browsing = browsingLine(view.browsing);
  if (browsing !== null) lines.push(browsing);
  if (lines.length === 0) return null;
  return `User memory (from earlier conversations and what they browse; use it, do not recite it)\n${lines.join('\n')}`;
}

/** What the memory model returns: usually nothing. Code checks the ids and the limits. */
export const memoryChangesSchema = z.object({
  add: z.array(z.object({ kind: memoryKindSchema, text: z.string() })),
  update: z.array(z.object({ id: z.string(), kind: memoryKindSchema, text: z.string() })),
  remove: z.array(z.string()),
});
export type MemoryChanges = z.infer<typeof memoryChangesSchema>;

export const LEARN_SYSTEM = `You keep a short memory about one user of Melens, a map of Melbourne with a chat assistant. The assistant reads it to personalise later answers. From the latest exchange, decide whether the memory should change.

Remember lasting things the user said or chose about themselves:
- travel: how they get around (drives, has a car, cycles, takes trams, walks).
- interest: what they enjoy or follow (live music, coffee, galleries, footy, markets, history).
- routine: when they usually go out or what they usually do (Friday nights out, weekend markets, lunch in the CBD on weekdays).
- preference: how they like places or answers (quiet places, cheap eats, short answers, out with kids, with a dog).
- other: anything else lasting that would change a recommendation.

Rules
1. Only the user's own words and choices count, including their answers to the assistant's questions. What the assistant suggested or found is not a fact about the user.
2. Keep what lasts, not one request: "find parking near the MCG" shows they drive at least sometimes; "what's on tonight" says nothing lasting.
3. Never record exact addresses, where they live or work, coordinates, names, contact details, health or disability, religion, ethnicity, sexuality, politics, finances, or anything about another person.
4. When the user asks you to remember something, add it. When they ask you to forget something, or say a remembered fact is wrong, remove or update it.
5. When something new refines or contradicts a remembered fact, update that fact (same id) instead of adding another. Do not add what the memory already says, and do not restate the browsing summary.
6. Each fact is one short sentence in English without a subject, under 100 characters: "Drives into the city", "Enjoys live jazz", "Prefers quiet cafés".
7. Most exchanges change nothing: then return empty lists.`;

export function learnPrompt(facts: readonly MemoryFact[], browsing: BrowsingSummary, said: string, answer: string): string {
  const memory = facts.length === 0 ? '(nothing yet)' : facts.map((fact) => `- ${fact.id} [${fact.kind}] ${fact.text}`).join('\n');
  const reply = answer.trim() === '' ? '(no text)' : answer.trim().length > 600 ? `${answer.trim().slice(0, 600)}…` : answer.trim();
  return [`Current memory\n${memory}`, `Browsing summary\n${browsingLine(browsing) ?? '(nothing yet)'}`,
    `Latest exchange\nUser: ${said}\nAssistant: ${reply}`].join('\n\n');
}
