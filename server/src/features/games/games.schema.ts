// Request schemas for the games feature (docs/06 endpoints 10 and 13).
import { z } from "zod";

export const createGameSchema = z.strictObject({
  difficulty: z.string(),
});

// The turn-bundle shape of docs/06 endpoint 13 / docs/02's Move: one unit's
// entry. A path is the full walked route (path[0] = the unit's current tile —
// at least one entry); attack/heal REQUIRE a targetId, wait must not carry
// one. Used verbatim by POST /moves request validation and by the AI response
// loop (docs/04's discriminated union).
const coordinate = z.tuple([z.number(), z.number()]);

export const moveActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("attack"), targetId: z.string() }),
  z.strictObject({ type: z.literal("heal"), targetId: z.string() }),
  z.strictObject({ type: z.literal("wait") }),
]);

export const moveSchema = z.strictObject({
  unitId: z.string(),
  path: z.array(coordinate).min(1),
  action: moveActionSchema,
});

export const movesSchema = z.array(moveSchema);

// The request body of POST /api/games/:id/moves — an empty array is VALID
// (docs/06 endpoint 13: applies nothing, consumes the round's budget).
export const movesBodySchema = z.strictObject({ moves: movesSchema });
