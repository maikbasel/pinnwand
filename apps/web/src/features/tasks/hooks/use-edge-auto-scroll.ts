import { type RefObject, useEffect, useRef } from "react";
import { edgeScrollDelta } from "../lib/edge-scroll";

/**
 * While `active`, scrolls the referenced horizontal container when the pointer
 * nears its left/right edge, at a controlled speed. Replaces dnd-kit's built-in
 * auto-scroll for the board strip, which cannot drive a horizontal container
 * whose columns are vertically scrollable (clauderic/dnd-kit#1108).
 */
export function useEdgeAutoScroll(
  scrollRef: RefObject<HTMLElement | null>,
  active: boolean
): void {
  const pointerXRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!(active && element)) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      pointerXRef.current = event.clientX;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) {
        pointerXRef.current = touch.clientX;
      }
    };

    const tick = () => {
      const pointerX = pointerXRef.current;
      if (pointerX !== null) {
        const rect = element.getBoundingClientRect();
        const delta = edgeScrollDelta(pointerX, rect.left, rect.right);
        if (delta !== 0) {
          element.scrollLeft += delta;
        }
      }
      frameRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
      pointerXRef.current = null;
    };
  }, [active, scrollRef]);
}
