import type { MetaResponse, StatsResponse } from "../types/api";
import { request } from "./request";

// Meta is deliberately public (06 endpoint 7) — the landing page needs the
// data shown is harmless game metadata. Stats is the authed aggregate
// (06 endpoint 8).
export async function getMeta(): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta");
}

export async function getStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/api/stats");
}
