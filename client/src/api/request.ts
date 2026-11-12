import { ApiError } from "../types";

type UnauthorizedHandler = (fromPath?: string) => void;

let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

function extractErrorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error?: unknown }).error;
    if (typeof msg === "string") return msg;
  }
  return status >= 500 ? "Server error" : "Request failed";
}

export async function request<T>(
  path: string,
  opts: RequestInit & { suppressUnauthorized?: boolean } = {},
): Promise<T> {
  const { suppressUnauthorized, ...init } = opts;
  const headers = new Headers(init.headers ?? {});
  const hasBody = init.body !== undefined && init.body !== null;
  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(data, response.status);
    if (response.status === 401 && onUnauthorized && !suppressUnauthorized) {
      const fromPath =
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : undefined;
      onUnauthorized(fromPath);
    }
    throw new ApiError(response.status, message);
  }

  return data as T;
}
