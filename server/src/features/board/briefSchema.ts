import { z } from "zod";

export interface BoardBrief {
  river: { startRow: number; endRow: number; bends: number } | null;
  bridgeTiles: 1 | 2;
  forestZones: Array<{ centerX: number; centerY: number; radius: number }>;
  hillZones: Array<{ centerX: number; centerY: number; radius: number }>;
  lake: { centerX: number; centerY: number; radius: number } | null;
}

export function createBriefSchema(boardSize: number) {
  const min = 2;
  const max = boardSize - 3;
  const centerMaxYForest = Math.max(min, max - 1);
  const lakeMinY = Math.min(max, min + 1);
  const lakeMaxY = Math.max(lakeMinY, max - 1);

  const river = z
    .object({
      startRow: z.number().int().min(min).max(max),
      endRow: z.number().int().min(min).max(max),
      bends: z.number().int().min(1).max(3),
    })
    .strict()
    .nullable();

  const zone = (radiusMax: number, yMin = min, yMax = max) =>
    z
      .object({
        centerX: z.number().int().min(min).max(max),
        centerY: z.number().int().min(yMin).max(yMax),
        radius: z.number().int().min(1).max(radiusMax),
      })
      .strict();

  return z
    .object({
      river,
      bridgeTiles: z.union([z.literal(1), z.literal(2)]),
      forestZones: z
        .array(zone(3, min, centerMaxYForest))
        .min(1)
        .max(3),
      hillZones: z
        .array(zone(2, min, max))
        .min(0)
        .max(2),
      lake: zone(2, lakeMinY, lakeMaxY).nullable(),
    })
    .strict();
}

export function parseBrief(raw: unknown, boardSize: number): BoardBrief {
  const schema = createBriefSchema(boardSize);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid board brief");
  }
  return parsed.data as BoardBrief;
}
