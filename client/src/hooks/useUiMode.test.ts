import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useUiMode } from "./useUiMode";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.uiMode;
});

describe("useUiMode", () => {
  it("defaults to dark, persisted, and sets data-ui-mode on <html>", () => {
    const { result } = renderHook(() => useUiMode());
    expect(result.current.mode).toBe("dark");
    expect(document.documentElement.dataset.uiMode).toBe("dark");
    expect(window.localStorage.getItem("dc.uiMode")).toBe("dark");
  });

  it("toggles to light and persists", () => {
    const { result } = renderHook(() => useUiMode());
    act(() => {
      result.current.toggle();
    });
    expect(result.current.mode).toBe("light");
    expect(document.documentElement.dataset.uiMode).toBe("light");
    expect(window.localStorage.getItem("dc.uiMode")).toBe("light");
  });

  it("restores a persisted light mode", () => {
    window.localStorage.setItem("dc.uiMode", "light");
    const { result } = renderHook(() => useUiMode());
    expect(result.current.mode).toBe("light");
    expect(document.documentElement.dataset.uiMode).toBe("light");
  });
});
