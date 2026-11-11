import { useEffect, useRef } from "react";

// Polling contract (06): every 3 s while a game/list is ai_turn, never
// otherwise. `active` switches the interval; no cross-tab or visibility-API
// fanciness (05).
const POLL_MS = 3000;

export function usePolling(fn: () => void | Promise<void>, active: boolean): void {
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => {
      void latest.current();
    }, POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [active]);
}
