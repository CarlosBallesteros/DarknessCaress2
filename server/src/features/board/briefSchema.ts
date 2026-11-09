import { z } from "zod";

/** The layout brief the LLM returns for a board (03) — validated, never trusted. */
export interface Brief {
  river: { startRow: number; endRow: number; bends: number } | null;
  bridgeTiles: number;
  forestZones: Array<{ centerX: number; centerY: number; radius: number }>;
  hillZones: Array<{ centerX: number; centerY: number; radius: number }>;
  lake: { centerX: number; centerY: number; radius: number } | null;
}

/**
 * zod schema for a brief response (03: "extras rejected, ranges enforced").
 * Grid-dependent bounds derive from boardSize so schema and prompt can never
 * drift apart (04's hygiene rule); at boardSize 15 they read exactly as 03's
 * table: rows 2-12, zone centers 2-11 / 2-12 / 3-11.
 */
export function makeBriefSchema(boardSize: number) {
  // Clear of the reserved row pairs (0-1, size-2..size-1); zone/lake centers
  // sit one row further in than river rows, as 03's ranges encode at baseline.
  const riverBound = boardSize - 3;
  const zoneBound = boardSize - 4;
  const coord = (min: number, max: number) =>
    z.number().int().min(min).max(max);
  return z
    .object({
      river: z
        .object({
          startRow: coord(2, riverBound),
          endRow: coord(2, riverBound),
          bends: coord(1, 3),
        })
        .strict()
        .nullable(),
      bridgeTiles: coord(1, 2),
      forestZones: z
        .array(
          z
            .object({
              centerX: coord(2, riverBound),
              centerY: coord(2, zoneBound),
              radius: coord(1, 3),
            })
            .strict(),
        )
        .min(1)
        .max(3),
      hillZones: z
        .array(
          z
            .object({
              centerX: coord(2, riverBound),
              centerY: coord(2, riverBound),
              radius: coord(1, 2),
            })
            .strict(),
        )
        .max(2),
      lake: z
        .object({
          centerX: coord(2, riverBound),
          centerY: coord(3, zoneBound),
          radius: coord(1, 2),
        })
        .strict()
        .nullable(),
    })
    .strict();
}

/**
 * The same shape as JSON Schema for Ollama's `format` field (04: the client
 * passes it so the model is forced to emit valid JSON). Kept next to the zod
 * schema — the two must stay in lockstep.
 */
export function makeBriefJsonSchema(boardSize: number): object {
  const riverBound = boardSize - 3;
  const zoneBound = boardSize - 4;
  const coord = (min: number, max: number) => ({
    type: "integer",
    minimum: min,
    maximum: max,
  });
  const zone = (centerMin: number, centerMax: number, radiusMax: number) => ({
    type: "object",
    additionalProperties: false,
    required: ["centerX", "centerY", "radius"],
    properties: {
      centerX: coord(2, riverBound),
      centerY: coord(centerMin, centerMax),
      radius: coord(1, radiusMax),
    },
  });
  return {
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
              startRow: coord(2, riverBound),
              endRow: coord(2, riverBound),
              bends: coord(1, 3),
            },
          },
        ],
      },
      bridgeTiles: coord(1, 2),
      forestZones: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: zone(2, zoneBound, 3),
      },
      hillZones: {
        type: "array",
        maxItems: 2,
        items: zone(2, riverBound, 2),
      },
      lake: {
        anyOf: [{ type: "null" }, zone(3, zoneBound, 2)],
      },
    },
  };
}
