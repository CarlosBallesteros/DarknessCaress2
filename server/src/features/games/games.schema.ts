// Request schemas for the games feature (docs/06 endpoint 10).
import { z } from "zod";

export const createGameSchema = z.strictObject({
  difficulty: z.string(),
});
