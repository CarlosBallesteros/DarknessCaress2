import type { UserRow } from "../features/users/types";

declare global {
  namespace Express {
    interface Request {
      authUser?: UserRow;
    }
  }
}

export {};
