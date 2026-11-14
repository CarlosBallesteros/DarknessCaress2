export interface User {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

export interface Board {
  tiles: string[][];
}

export type ClassKey = "sword" | "axe" | "spear" | "archer" | "mage" | "healer";
