// Request schemas for the games endpoints (docs/06). Phase 4: creation only.
import { z } from "zod";

export const createGameSchema = z.object({
  difficulty: z.string().min(1),
});
