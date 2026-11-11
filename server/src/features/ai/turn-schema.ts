// The AI turn response (docs/04): zod discriminated union — attack/heal
// REQUIRE targetId, wait must not expect one. Schema-fail ⇒ "Your reply was
// not valid JSON matching the schema.", retry. The move shape is the SAME
// schema that validates the player's POST /moves bundle — one contract, two
// call sites. Strict objects keep extras out so the model cannot smuggle
// unvalidated fields past the engine.
import { z } from "zod";
import { moveSchema } from "../games/games.schema";

export const turnResponseSchema = z.strictObject({
  moves: z.array(moveSchema),
});

// The same shape as JSON Schema for Ollama's `format` field (docs/04 — the
// client passes it so the model is forced to emit valid JSON). Kept next to
// the zod schema — the two must stay in lockstep; zod remains the authority.
export const TURN_JSON_SCHEMA: object = {
  type: "object",
  additionalProperties: false,
  required: ["moves"],
  properties: {
    moves: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["unitId", "path", "action"],
        properties: {
          unitId: { type: "string" },
          path: {
            type: "array",
            minItems: 1,
            items: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: { type: "number" },
            },
          },
          action: {
            oneOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "targetId"],
                properties: {
                  type: { type: "string", enum: ["attack"] },
                  targetId: { type: "string" },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type", "targetId"],
                properties: {
                  type: { type: "string", enum: ["heal"] },
                  targetId: { type: "string" },
                },
              },
              {
                type: "object",
                additionalProperties: false,
                required: ["type"],
                properties: { type: { type: "string", enum: ["wait"] } },
              },
            ],
          },
        },
      },
    },
  },
};
