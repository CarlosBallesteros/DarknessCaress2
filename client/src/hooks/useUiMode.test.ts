import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiMode } from "./useUiMode";

const realMatchMedia = window.matchMedia;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.uiMode;
});
afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: realMatchMedia,
  });
});

function stubMatchMedia(matchesLight: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: matchesLight }),
  });
}

describe("useUiMode", () => {
  it("falls back to dark when matchMedia is unavailable (documented fallback)", () => {
    // jsdom ships no matchMedia; make the absence explicit for this case.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    const { result, unmount } = renderHook(() => useUiMode());
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.dataset.uiMode).toBe("dark");
    // the system default is NOT persisted — only an explicit toggle is (05)
    expect(window.localStorage.getItem("dc.uiMode")).toBeNull();
    unmount();
  });

  it("follows the system preference (light) when no choice is stored", () => {
    stubMatchMedia(true);
    const { unmount } = renderHook(() => useUiMode());
    expect(document.documentElement.dataset.uiMode).toBe("light");
    unmount();
  });

  it("toggles to light, sets data-ui-mode and persists the explicit choice", () => {
    stubMatchMedia(false); // system prefers dark
    const { result, unmount } = renderHook(() => useUiMode());
    act(() => {
      result.current.toggle();
    });
    expect(result.current.mode).toBe("light");
    expect(document.documentElement.dataset.uiMode).toBe("light");
    expect(window.localStorage.getItem("dc.uiMode")).toBe("light");
    unmount();
  });

  it("restores a persisted explicit choice over the system preference", () => {
    window.localStorage.setItem("dc.uiMode", "dark");
    stubMatchMedia(true);
    const { unmount } = renderHook(() => useUiMode());
    expect(document.documentElement.dataset.uiMode).toBe("dark");
    unmount();
  });
});
