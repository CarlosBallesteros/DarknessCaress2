import type { Stats } from "../types";
import { request } from "./request";

export function getStats(): Promise<Stats> {
  return request<Stats>("/api/stats");
}
