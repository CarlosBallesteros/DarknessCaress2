import { useCallback, useEffect, useState } from "react";

// Pure client feature (05): light/dark UI mode. data-ui-mode goes on <html>;
// an explicit toggle persists under localStorage key dc.uiMode and overrides;
// with no stored choice the DEFAULT is the system preference, falling back to
// dark when matchMedia is unavailable. The system default is NOT persisted —
// only an explicit user choice is.
export type UiMode = "dark" | "light";

const STORAGE_KEY = "dc.uiMode";

function storedMode(): UiMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // storage unavailable (blocked, privacy mode) — no override
  }
}

function systemMode(): UiMode {
  try {
    if (typeof window.matchMedia !== "function") {
      return "dark";
    }
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark"; // API unavailable — the documented fallback (05)
  }
}

function initialMode(): UiMode {
  return storedMode() ?? systemMode();
}

export function useUiMode(): { mode: UiMode; toggle: () => void } {
  const [mode, setMode] = useState<UiMode>(initialMode);

  useEffect(() => {
    document.documentElement.dataset.uiMode = mode;
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: UiMode = current === "dark" ? "light" : "dark";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // storage unavailable — the toggle still works for this session
      }
      return next;
    });
  }, []);

  return { mode, toggle };
}
