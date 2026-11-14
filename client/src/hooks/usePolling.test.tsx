import React from "react";
import ReactDOM from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePolling } from "./usePolling";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(active: boolean, fn: () => void, intervalMs?: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  function Probe(props: { active: boolean }) {
    usePolling(fn, props.active, intervalMs);
    return null;
  }

  act(() => {
    root.render(<Probe active={active} />);
  });

  return {
    rerender(nextActive: boolean) {
      act(() => {
        root.render(<Probe active={nextActive} />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("usePolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately when active and repeats on interval", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const h = mount(true, fn, 3000);

    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(fn).toHaveBeenCalledTimes(3);

    h.unmount();
  });

  it("stops polling when deactivated and does not run when inactive", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const h = mount(true, fn, 3000);

    expect(fn).toHaveBeenCalledTimes(1);
    h.rerender(false);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(fn).toHaveBeenCalledTimes(1);

    h.unmount();
  });
});
