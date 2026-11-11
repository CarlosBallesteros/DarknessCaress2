import type { Request, Response } from "express";
import { config } from "../../config/load";

// Public config subset per docs/06 endpoint 7 / docs/01 "served subset".
// Deliberately PUBLIC (docs/06 auth-coverage note): the landing page needs the
// default theme and the data revealed is harmless game metadata.
export function metaBody(): {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, unknown>;
  personalities: Record<string, unknown>;
  themes: typeof config.themes;
  lore: typeof config.lore;
} {
  const classes = Object.fromEntries(
    Object.entries(config.classes).map(([id, c]) => {
      // Field set exactly per docs/06: healAmount appears only where applicable.
      const entry: Record<string, unknown> = {
        label: c.label,
        hp: c.hp,
        atk: c.atk,
        def: c.def,
        mov: c.mov,
        range: c.range,
        role: c.role,
        count: c.count,
      };
      if (c.healAmount !== undefined) {
        entry.healAmount = c.healAmount;
      }
      return [id, entry];
    }),
  );
  const personalities = Object.fromEntries(
    Object.entries(config.personalities).map(([id, p]) => [id, { label: p.label }]),
  );
  return {
    boardSize: config.boardSize,
    maxActiveGames: config.maxActiveGames,
    classes,
    personalities,
    themes: config.themes,
    lore: config.lore,
  };
}

// GET /api/meta — 200, no auth, no zod (docs/06 endpoint 7).
export function meta(_req: Request, res: Response): void {
  res.status(200).json(metaBody());
}
