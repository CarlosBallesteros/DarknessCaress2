import { useCallback, useEffect, useState } from "react";

// Pure client feature (05): light/dark UI mode. data-ui-mode goes on <html>;
// persisted under localStorage; default dark (which the token sheet encodes as
// the attribute-less default, so first paint is already correct).
export type UiMode = "dark" | "light";

const STORAGE_KEY = "dc.uiMode";

function initialMode(): UiMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useUiMode(): { mode: UiMode; toggle: () => void } {
  const [mode, setMode] = useState<UiMode>(initialMode);

  useEffect(() => {
    document.documentElement.dataset.uiMode = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage unavailable (e.g. blocked storage) — mode still works
      // for the session.
    }
  }, [mode]);

  const toggle = useCallback(() => {
    setMode((m) => (m === "dark" ? "light" : "dark"));
  }, []);

  return { mode, toggle };
}
