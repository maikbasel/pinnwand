import "@testing-library/jest-dom/vitest";

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
