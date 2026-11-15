import { useEffect, useRef } from "react";

export function startPolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  scheduler: Pick<typeof globalThis, "setInterval" | "clearInterval"> = globalThis,
): () => void {
  const id = scheduler.setInterval(() => {
    void fn();
  }, intervalMs);
  return () => scheduler.clearInterval(id);
}

export function usePolling(
  fn: () => void | Promise<void>,
  active: boolean,
  intervalMs = 3000,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!active) return;
    return startPolling(() => fnRef.current(), intervalMs, globalThis);
  }, [active, intervalMs]);
}
