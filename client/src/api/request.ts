// Thin fetch wrapper per 05: JSON body in, error envelope ({error}) unwrapped
// into ApiError, success body returned as-is (the body IS the resource, 06).
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  // Auth-group and /me endpoints own their 401s inline (login error banner,
  // ProtectedRoute redirect with back-link state, profile inline errors), so
  // they opt out of the app-wide redirect. Every other 401 means the session
  // died under the user: the wrapper sends them to /login (05).
  skipAuthRedirect?: boolean;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, skipAuthRedirect = false } = opts;
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "include",
  });
  if (res.status === 401 && !skipAuthRedirect) {
    // Same redirect as ProtectedRoute's 401 (05) — the login page is where the
    // session is restored.
    window.location.assign("/login");
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const payload: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      typeof (payload as { error?: unknown } | null)?.error === "string"
        ? (payload as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message);
  }
  return payload as T;
}
