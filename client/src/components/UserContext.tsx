import { createContext, useContext } from "react";
import type { User } from "../types/api";

// Shared by ProtectedRoute (owner), TopMenu (username, live after a profile
// rename) and the board/Champions pages (theme for sprites/portraits).
export interface UserContextValue {
  user: User;
  setUser: (user: User) => void;
}

export const UserContext = createContext<UserContextValue | null>(null);

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (ctx === null) {
    throw new Error("useUser must be used inside ProtectedRoute");
  }
  return ctx;
}
