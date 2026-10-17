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
 * turn, when the agent drew one, so the app can draw it again. `updatedAt` is the last edit or replacement;
 * `savedAt` stays the first save, so the plan keeps its place in the list.
 */
export const savedPlanSchema = z.strictObject({
  id: identifierSchema,
  sessionId: identifierSchema,
  turnId: identifierSchema,
  savedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime().optional(),
  card: cardSchema,
  route: z.record(z.string(), z.unknown()).optional(),
});
export type SavedPlan = z.infer<typeof savedPlanSchema>;

/**
 * The body of `POST /v1/plans`: which stored card to keep. The service copies the card itself, never the client's.
 * `replaces` names a saved plan the card takes the place of, such as the plan it revises.
 */
export const savePlanBodySchema = z.strictObject({ sessionId: identifierSchema, cardId: identifierSchema, replaces: identifierSchema.optional() });

/**
 * The body of `PATCH /v1/plans/{planId}`: the user's own edits. `stops` lists the indices (from 0) of the stops to keep,
 * in their new order; at least one field.
 */
export const editPlanBodySchema = z.strictObject({
  title: z.string().trim().min(1).max(80).optional(),
  stops: z.array(z.number().int().min(0).max(12)).min(1).max(13)
    .refine((stops) => new Set(stops).size === stops.length, 'Each stop once').optional(),
}).refine((body) => body.title !== undefined || body.stops !== undefined, 'Nothing to change');

/** The body of `POST /v1/plans/{planId}/stops/{index}/refresh`: which live part of the stop to read again. */
export const refreshStopBodySchema = z.strictObject({ part: z.enum(['parking']) });

/** Card ids are `c_{turnId}_{n}` (TurnRegistry.nextCardId); the turn id is everything between. */
export function turnIdOfCard(cardId: string): string | null {
  return /^c_(.+)_\d+$/.exec(cardId)?.[1] ?? null;
}
