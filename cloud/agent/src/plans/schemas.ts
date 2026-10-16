import { z } from 'zod';

import { identifierSchema } from '@melens/shared/contracts/map-contract';

import { cardSchema } from '../protocol/schemas.js';

/** Wire schemas and limits of the saved plan routes (agent-protocol.md, Saved plans). */

export const PLAN_LIMITS = {
  maxPlans: 30,
  writesPerHour: 120,
} as const;

/**
 * A plan card the user kept: a copy of the stored card, so it outlives the 30-day chat session. Its id is the
 * card's id, which makes saving the same card twice one plan. `route` is the `draw_route` action of the same
 * turn, when the agent drew one, so the app can draw it again.
 */
export const savedPlanSchema = z.strictObject({
  id: identifierSchema,
  sessionId: identifierSchema,
  turnId: identifierSchema,
  savedAt: z.iso.datetime(),
  card: cardSchema,
  route: z.record(z.string(), z.unknown()).optional(),
});
export type SavedPlan = z.infer<typeof savedPlanSchema>;

/** The body of `POST /v1/plans`: which stored card to keep. The service copies the card itself, never the client's. */
export const savePlanBodySchema = z.strictObject({ sessionId: identifierSchema, cardId: identifierSchema });

/** The body of `POST /v1/plans/{planId}/stops/{index}/refresh`: which live part of the stop to read again. */
export const refreshStopBodySchema = z.strictObject({ part: z.enum(['parking']) });

/** Card ids are `c_{turnId}_{n}` (TurnRegistry.nextCardId); the turn id is everything between. */
export function turnIdOfCard(cardId: string): string | null {
  return /^c_(.+)_\d+$/.exec(cardId)?.[1] ?? null;
}
