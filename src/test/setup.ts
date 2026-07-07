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
