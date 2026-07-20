import { useEffect, useState } from "react";

function readInset(): number {
  const viewport = window.visualViewport;
  if (!viewport) {
    return 0;
  }
  return Math.round(
    Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop))
  );
}

/**
 * Pixel height at the bottom of the layout viewport occluded by the on-screen
 * keyboard. Returns 0 when `window.visualViewport` is unsupported (or during
 * SSR) and when the keyboard is closed. Subscribes to the visualViewport
 * `resize` and `scroll` events: iOS Safari fires `scroll` (not `resize`) when
 * the keyboard shifts the viewport without changing its size.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const onChange = (): void => {
      setInset(readInset());
    };
    onChange();
    viewport.addEventListener("resize", onChange);
    viewport.addEventListener("scroll", onChange);
    return () => {
      viewport.removeEventListener("resize", onChange);
      viewport.removeEventListener("scroll", onChange);
    };
  }, []);

  return inset;
}
