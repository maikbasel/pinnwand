import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardInset } from "./use-keyboard-inset";

type MockVisualViewport = {
  height: number;
  offsetTop: number;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function stubVisualViewport(viewport: MockVisualViewport | undefined): void {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
}

function createMockViewport(
  height: number,
  offsetTop: number
): MockVisualViewport {
  return {
    height,
    offsetTop,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

describe("useKeyboardInset", () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    stubVisualViewport(undefined);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it("returns 0 when visualViewport is unsupported", () => {
    stubVisualViewport(undefined);

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(0);
  });

  it("returns the inset for a keyboard-open geometry", () => {
    stubVisualViewport(createMockViewport(500, 0));

    const { result } = renderHook(() => useKeyboardInset());

    expect(result.current).toBe(300);
  });

  it("recomputes when the visualViewport resize event fires", () => {
    const viewport = createMockViewport(500, 0);
    stubVisualViewport(viewport);

    const { result } = renderHook(() => useKeyboardInset());
    expect(result.current).toBe(300);

    const resizeHandler = viewport.addEventListener.mock.calls.find(
      ([eventName]) => eventName === "resize"
    )?.[1] as () => void;
    expect(resizeHandler).toBeDefined();

    viewport.height = 800;
    act(() => {
      resizeHandler();
    });

    expect(result.current).toBe(0);
  });

  it("removes its listeners on unmount", () => {
    const viewport = createMockViewport(500, 0);
    stubVisualViewport(viewport);

    const { unmount } = renderHook(() => useKeyboardInset());
    unmount();

    expect(viewport.removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function)
    );
    expect(viewport.removeEventListener).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function)
    );
  });
});
