import { useCallback, useEffect, useState } from "react";

export type UiMode = "dark" | "light";

const STORAGE_KEY = "dc.uiMode";

function systemMode(): UiMode {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function initialMode(): UiMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  return systemMode();
}

export function useUiMode(): { mode: UiMode; toggle: () => void } {
  const [mode, setMode] = useState<UiMode>(initialMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-ui-mode", mode);
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { mode, toggle };
}
