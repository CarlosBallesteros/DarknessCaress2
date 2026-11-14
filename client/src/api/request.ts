export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function isPublicRoutePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/register";
}

type RequestOptions = RequestInit & { suppressAuthRedirect?: boolean };

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { suppressAuthRedirect, headers, body, ...rest } = opts;
  const init: RequestInit = {
    credentials: "include",
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
  };
  if (body !== undefined) {
    init.body = body;
  }

  const res = await fetch(path, init);
  if (res.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    const err = new ApiError(res.status, message);

    if (res.status === 401 && !suppressAuthRedirect) {
      const current = window.location.pathname;
      if (!isPublicRoutePath(current)) {
        const returnTo = current + window.location.search;
        const url = `/login${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;
        window.location.assign(url);
      }
    }
    throw err;
  }

  return data as T;
}
