import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "./usePolling";

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls on interval while active and stops when cleaned up", () => {
    const fn = vi.fn();
    const stop = startPolling(fn, 3000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(9000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("can be restarted after stop (active toggle behavior)", () => {
    const fn = vi.fn();
    let stop = startPolling(fn, 3000);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop = startPolling(fn, 3000);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });
});
