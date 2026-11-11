// Response validation schemas for the AI turn (docs/04). zod is the
// authority; the JSON Schema handed to Ollama's `format` field stays in
// lockstep with it. THE BOUNDS ARE PART OF THE SCHEMA (grammar-forced
// generation — learned from the 7B/3B spin incident): `moves` carries
// maxItems = the acting side's unit count (from the game state at call
// time), and each `path` carries maxItems = boardSize² (from config). With
// maxItems the decoding grammar physically closes the array, so the model
// CANNOT spin to the context ceiling; the `num_predict` cap is the second
// belt.
import { z } from "zod";

const coordinateSchema = z.tuple([z.number().int(), z.number().int()]);

// attack/heal REQUIRE targetId; wait must not expect one — strict objects
// reject a wait that carries a target.
const turnActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("attack"), targetId: z.string() }),
  z.strictObject({ type: z.literal("heal"), targetId: z.string() }),
  z.strictObject({ type: z.literal("wait") }),
]);

export function turnMovesSchema(maxMoves: number, maxPathEntries: number) {
  return z.object({
    moves: z
      .array(
        z.object({
          unitId: z.string(),
          path: z.array(coordinateSchema).max(maxPathEntries),
          action: turnActionSchema,
        }),
      )
      .max(maxMoves),
  });
}

export type TurnMoves = z.infer<ReturnType<typeof turnMovesSchema>>["moves"];

// Mirrors turnMovesSchema for Ollama's `format` field (keep in sync).
// THE UNION MUST BE `oneOf`, NEVER `anyOf` (real-play evidence, ollama 0.40.16):
// the grammar converter mishandles `anyOf` — with `anyOf` present, required
// sibling properties inside the same items (e.g. `path`) silently become
// optional, so both 7B and 3B emitted moves WITHOUT `path`, which fails zod
// every time ("Your reply was not valid JSON matching the schema." — an
// unresolvable retry loop). `oneOf` (the correct construct for a CLOSED
// discriminated union) compiles to a grammar that enforces every required
// field — verified: identical prompt+model, anyOf → path missing; oneOf →
// complete legal moves.
export function turnJsonSchema(maxMoves: number, maxPathEntries: number): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["moves"],
    properties: {
      moves: {
        type: "array",
        maxItems: maxMoves,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["unitId", "path", "action"],
          properties: {
            unitId: { type: "string" },
            path: {
              type: "array",
              maxItems: maxPathEntries,
              items: { type: "array", minItems: 2, maxItems: 2, items: { type: "integer" } },
            },
            action: {
              oneOf: [
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "targetId"],
                  properties: { type: { const: "attack" }, targetId: { type: "string" } },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type", "targetId"],
                  properties: { type: { const: "heal" }, targetId: { type: "string" } },
                },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["type"],
                  properties: { type: { const: "wait" } },
                },
              ],
            },
          },
        },
      },
    },
  };
}
