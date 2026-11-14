import { useEffect, useRef } from "react";

export function usePolling(
  fn: () => void | Promise<void>,
  active: boolean,
  intervalMs = 3000,
): void {
  const fnRef = useRef(fn);

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!active) {
      return;
    }
    const tick = () => {
      void fnRef.current();
    };
    tick();
    const id = window.setInterval(tick, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [active, intervalMs]);
}
