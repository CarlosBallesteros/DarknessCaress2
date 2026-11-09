import { Router } from "express";
import { getConfig } from "../../config/config.js";
import { wrapAsync } from "../../wrap-async.js";

export const metaRouter = Router();

// Public config subset served exactly as 06's meta example (01: the landing
// page needs the default theme; the data revealed is harmless).
metaRouter.get(
  "/meta",
  wrapAsync(async (_req, res) => {
    const config = getConfig();
    const personalities = Object.fromEntries(
      Object.entries(config.personalities).map(([id, persona]) => [
        id,
        { label: persona.label },
      ]),
    );
    res.status(200).json({
      boardSize: config.boardSize,
      maxActiveGames: config.maxActiveGames,
      classes: config.classes,
      personalities,
      themes: config.themes,
      lore: config.lore,
    });
  }),
);
