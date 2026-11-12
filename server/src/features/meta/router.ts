import { Router } from "express";
import config from "../../config/config.json";

type ClassConfig = {
  label: string;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  role: string;
  count: number;
  healAmount?: number;
};

type PersonalityConfig = {
  label: string;
  temperature?: number;
};

const metaResponse = {
  boardSize: config.boardSize,
  maxActiveGames: config.maxActiveGames,
  classes: Object.fromEntries(
    Object.entries(config.classes as Record<string, ClassConfig>).map(([key, value]) => [
      key,
      {
        label: value.label,
        hp: value.hp,
        atk: value.atk,
        def: value.def,
        mov: value.mov,
        range: value.range,
        role: value.role,
        count: value.count,
        ...(value.healAmount !== undefined ? { healAmount: value.healAmount } : {}),
      },
    ]),
  ),
  personalities: Object.fromEntries(
    Object.entries(config.personalities as Record<string, PersonalityConfig>).map(
      ([key, value]) => [key, { label: value.label }],
    ),
  ),
  themes: config.themes,
  lore: config.lore,
};

export const metaRouter = Router();

metaRouter.get("/meta", (_req, res) => {
  res.json(metaResponse);
});
