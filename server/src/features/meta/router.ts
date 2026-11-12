import { Router } from "express";
import type { AppConfig } from "../../config/index.js";
import { wrapAsync } from "../wrapAsync.js";

export function createMetaRouter(config: AppConfig): Router {
  const router = Router();

  const classes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config.classes)) {
    const cls = value as Record<string, unknown>;
    const entry: Record<string, unknown> = {
      label: cls.label,
      hp: cls.hp,
      atk: cls.atk,
      def: cls.def,
      mov: cls.mov,
      range: cls.range,
      role: cls.role,
      count: cls.count,
    };
    if (cls.healAmount !== undefined) {
      entry.healAmount = cls.healAmount;
    }
    classes[key] = entry;
  }

  const personalities: Record<string, { label: string }> = {};
  for (const [key, value] of Object.entries(config.personalities)) {
    const p = value as { label: string };
    personalities[key] = { label: p.label };
  }

  const body = {
    boardSize: config.boardSize,
    maxActiveGames: config.maxActiveGames,
    classes,
    personalities,
    themes: config.themes,
    lore: config.lore,
  };

  router.get(
    "/meta",
    wrapAsync((_req, res) => {
      res.status(200).json(body);
    }),
  );

  return router;
}
