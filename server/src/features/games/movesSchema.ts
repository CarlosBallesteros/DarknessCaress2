import { z } from "zod";

/**
 * The turn-bundle shape of 06 ep. 13 / 02's Move: one unit's entry. A path is
 * the full walked route (path[0] = the unit's current tile — at least one
 * entry); attack/heal REQUIRE a targetId, wait must not carry one. Used
 * verbatim by POST /moves request validation and by the AI response loop.
 */
const coordinate = z.tuple([z.number(), z.number()]);

export const moveActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attack"), targetId: z.string() }).strict(),
  z.object({ type: z.literal("heal"), targetId: z.string() }).strict(),
  z.object({ type: z.literal("wait") }).strict(),
]);

export const moveSchema = z
  .object({
    unitId: z.string(),
    path: z.array(coordinate).min(1),
    action: moveActionSchema,
  })
  .strict();

export const movesSchema = z.array(moveSchema);

/** The request body of POST /api/games/:id/moves — an empty array is VALID (06). */
export const movesBodySchema = z.object({ moves: movesSchema }).strict();
