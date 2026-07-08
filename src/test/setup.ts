import "@testing-library/jest-dom/vitest";
import { afterAll } from "vitest";

// input-otp's OTPInput schedules 0/10/50ms mount timers whose callback runs a
// React setState. They are not cleared on unmount, so the last OTP render in a
// file can fire its 50ms timer *after* that file's jsdom is torn down — React's
// scheduler then reads `window` and throws `window is not defined`, an
// unhandled error that fails the run's exit code even though every assertion
// passed. Hold each file open briefly so those timers fire (harmlessly, on the
// already-unmounted tree) while the environment still exists.
const INPUT_OTP_TIMER_DRAIN_MS = 75;
afterAll(
  () =>
    new Promise((resolve) => {
      setTimeout(resolve, INPUT_OTP_TIMER_DRAIN_MS);
    })
);

// jsdom does not implement ResizeObserver. input-otp's OTPInput observes its
// container to size fake carets; without a stub the mount throws and React
// unmounts the tree, breaking any test that renders it.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {
      // no-op: jsdom has no real layout to observe
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
  }
  globalThis.ResizeObserver = ResizeObserverStub;
}

// jsdom does not implement matchMedia. The sidebar (useIsMobile) and the
// responsive confirm surfaces (useMediaQuery) read it on mount; without a stub
// any test that renders them throws. Default to the desktop viewport (no match).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
