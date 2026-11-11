// Request schemas for the games endpoints (docs/06). Phase 4: creation.
// Phase 5: the player's turn bundle (endpoint 13).
import { z } from "zod";

export const createGameSchema = z.object({
  difficulty: z.string().min(1),
});

// The player's move bundle — exactly the API contract's shape. Shape
// failures produce the generic first-issue 400 body (docs/06 conventions);
// everything semantic (legality, occupancy, ranges, duplicates) is the
// engine's judgement, surfaced as "move N: <engine message>".
const coordinateSchema = z.tuple([z.number().int(), z.number().int()]);

const moveActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attack"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("heal"), targetId: z.string().min(1) }),
  z.object({ type: z.literal("wait") }),
]);

export const moveSchema = z.object({
  unitId: z.string().min(1),
  path: z.array(coordinateSchema).min(1),
  action: moveActionSchema,
});

export const movesRequestSchema = z.object({
  moves: z.array(moveSchema),
});
