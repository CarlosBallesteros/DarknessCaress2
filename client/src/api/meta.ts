import type { Meta } from "../types";
import { request } from "./request";

export function getMeta(): Promise<Meta> {
  return request<Meta>("/api/meta");
}
