import { Router } from "express";
import { config } from "../../config";
import { wrapAsync } from "../wrapAsync";

export const metaRouter = Router();

function buildMeta() {
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
    if ("healAmount" in cls) {
      entry.healAmount = cls.healAmount;
    }
    classes[key] = entry;
  }

  const personalities: Record<string, { label: string }> = {};
  for (const [key, value] of Object.entries(config.personalities)) {
    personalities[key] = { label: (value as { label: string }).label };
  }

  return {
    boardSize: config.boardSize,
    maxActiveGames: config.maxActiveGames,
    classes,
    personalities,
    themes: config.themes,
    lore: config.lore,
  };
}

metaRouter.get(
  "/api/meta",
  wrapAsync(async (_req, res) => {
    res.status(200).json(buildMeta());
  }),
);
