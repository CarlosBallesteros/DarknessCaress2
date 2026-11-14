import type { UserRow } from "./userRepo";

declare module "express-serve-static-core" {
  interface Request {
    user?: UserRow;
  }
}

export {};
