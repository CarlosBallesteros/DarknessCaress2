import { Router } from "express";
import { getConfig } from "../../config/index.js";

export const metaRouter = Router();

metaRouter.get("/", (_req, res) => {
  const config = getConfig();
  const classes: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(
    config.classes as Record<string, Record<string, unknown>>,
  )) {
    const cls: Record<string, unknown> = {
      label: value.label,
      hp: value.hp,
      atk: value.atk,
      def: value.def,
      mov: value.mov,
      range: value.range,
      role: value.role,
      count: value.count,
    };
    if ("healAmount" in value) {
      cls.healAmount = value.healAmount;
    }
    classes[key] = cls;
  }

  const personalities: Record<string, { label: string }> = {};
  for (const [id, p] of Object.entries(config.personalities)) {
    personalities[id] = { label: p.label };
  }

  res.status(200).json({
    boardSize: config.boardSize,
    maxActiveGames: config.maxActiveGames,
    classes,
    personalities,
    themes: config.themes,
    lore: config.lore,
  });
});
