import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("does not poll while inactive", () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, false));
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("polls every 3 s while active", () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, true));
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops when active turns false and resumes when true", () => {
    const fn = vi.fn();
    const { rerender } = renderHook(({ active }) => usePolling(fn, active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("always calls the latest fn without resetting the interval", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => usePolling(fn, true), {
      initialProps: { fn: first },
    });
    rerender({ fn: second });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
