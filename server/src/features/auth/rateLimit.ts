import { rateLimit } from "express-rate-limit";

// docs/01: max 10 login requests/min/IP, in-memory store.
export const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests, please try again later" });
  },
});
