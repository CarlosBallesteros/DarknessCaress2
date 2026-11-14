import { useEffect, useState } from "react";

export type UiMode = "dark" | "light";

const STORAGE_KEY = "dc.uiMode";

function getInitialMode(): UiMode {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "dark" || stored === "light") return stored;
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

export function useUiMode(): [UiMode, () => void] {
  const [mode, setMode] = useState<UiMode>(getInitialMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-ui-mode", mode);
  }, [mode]);

  const toggle = () => {
    setMode((prev) => {
      const next: UiMode = prev === "dark" ? "light" : "dark";
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  };

  return [mode, toggle];
}
