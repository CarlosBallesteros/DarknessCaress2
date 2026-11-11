// Stage 1 of board generation (docs/03): the zod schema the LLM's design brief
// must satisfy — extras rejected, ranges enforced. Range bounds are rendered
// from config.boardSize (docs/04 prompt hygiene: no board-size literals);
// the formulas reproduce the documented 15×15 baseline exactly.
import { z } from "zod";
import { config } from "../../config/load";

const size = config.boardSize;

const rowBounds = { min: 2, max: size - 3 }; // river startRow/endRow: 2-12 at baseline
const colBounds = { min: 2, max: size - 3 }; // zone centerX: 2-12 at baseline
// centerY bounds differ per feature in the docs: forest 2-11, hill 2-12,
// lake 3-11 at baseline.
const forestRowBounds = { min: 2, max: size - 4 };
const lakeRowBounds = { min: 3, max: size - 4 };

const riverSchema = z.strictObject({
  startRow: z.number().int().min(rowBounds.min).max(rowBounds.max),
  endRow: z.number().int().min(rowBounds.min).max(rowBounds.max),
  bends: z.number().int().min(1).max(3),
});

const forestZoneSchema = z.strictObject({
  centerX: z.number().int().min(colBounds.min).max(colBounds.max),
  centerY: z.number().int().min(forestRowBounds.min).max(forestRowBounds.max),
  radius: z.number().int().min(1).max(3),
});

const hillZoneSchema = z.strictObject({
  centerX: z.number().int().min(colBounds.min).max(colBounds.max),
  centerY: z.number().int().min(rowBounds.min).max(rowBounds.max),
  radius: z.number().int().min(1).max(2),
});

const lakeSchema = z.strictObject({
  centerX: z.number().int().min(colBounds.min).max(colBounds.max),
  centerY: z.number().int().min(lakeRowBounds.min).max(lakeRowBounds.max),
  radius: z.number().int().min(1).max(2),
});

export const briefSchema = z.strictObject({
  river: riverSchema.nullable(),
  bridgeTiles: z.number().int().min(1).max(2), // ignored when river is null
  forestZones: z.array(forestZoneSchema).min(1).max(3),
  hillZones: z.array(hillZoneSchema).min(0).max(2),
  lake: lakeSchema.nullable(),
});

export type Brief = z.infer<typeof briefSchema>;

// JSON Schema handed to Ollama's `format` field so the model's reply is valid
// JSON of exactly this shape before zod ever sees it (docs/04). Mirrors
// briefSchema — keep the two in sync.
export const briefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["river", "bridgeTiles", "forestZones", "hillZones", "lake"],
  properties: {
    river: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["startRow", "endRow", "bends"],
          properties: {
            startRow: {
              type: "integer",
              minimum: rowBounds.min,
              maximum: rowBounds.max,
            },
            endRow: {
              type: "integer",
              minimum: rowBounds.min,
              maximum: rowBounds.max,
            },
            bends: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
      ],
    },
    bridgeTiles: { type: "integer", minimum: 1, maximum: 2 },
    forestZones: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: zoneJsonSchema(forestRowBounds, 1, 3),
    },
    hillZones: {
      type: "array",
      minItems: 0,
      maxItems: 2,
      items: zoneJsonSchema(rowBounds, 1, 2),
    },
    lake: {
      anyOf: [{ type: "null" }, zoneJsonSchema(lakeRowBounds, 1, 2)],
    },
  },
};

function zoneJsonSchema(
  rowBounds: { min: number; max: number },
  minRadius: number,
  maxRadius: number,
): object {
  return {
    type: "object",
    additionalProperties: false,
    required: ["centerX", "centerY", "radius"],
    properties: {
      centerX: {
        type: "integer",
        minimum: colBounds.min,
        maximum: colBounds.max,
      },
      centerY: {
        type: "integer",
        minimum: rowBounds.min,
        maximum: rowBounds.max,
      },
      radius: { type: "integer", minimum: minRadius, maximum: maxRadius },
    },
  };
}
