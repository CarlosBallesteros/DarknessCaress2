import { z } from "zod";

export const riverSchema = z
  .object({
    startRow: z.number().int().min(2).max(5),
    endRow: z.number().int().min(2).max(5),
    bends: z.number().int().min(1).max(3),
  })
  .strict();

export const zoneSchema = (
  centerX: { min: number; max: number },
  centerY: { min: number; max: number },
  radius: { min: number; max: number },
) =>
  z
    .object({
      centerX: z.number().int().min(centerX.min).max(centerX.max),
      centerY: z.number().int().min(centerY.min).max(centerY.max),
      radius: z.number().int().min(radius.min).max(radius.max),
    })
    .strict();

export const boardBriefSchema = z
  .object({
    river: riverSchema.nullable(),
    bridgeTiles: z.union([z.literal(1), z.literal(2)]),
    forestZones: z
      .array(zoneSchema({ min: 2, max: 5 }, { min: 2, max: 4 }, { min: 1, max: 3 }))
      .min(1)
      .max(3),
    hillZones: z
      .array(zoneSchema({ min: 2, max: 5 }, { min: 2, max: 5 }, { min: 1, max: 2 }))
      .min(0)
      .max(2),
    lake: zoneSchema({ min: 2, max: 5 }, { min: 3, max: 4 }, { min: 1, max: 2 }).nullable(),
  })
  .strict();

export type BoardBrief = z.infer<typeof boardBriefSchema>;
