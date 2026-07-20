import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn((_payload: { type: string; event: string }) =>
  Promise.resolve("ok" as const)
);
let subscribeCallback: ((status: string) => void) | undefined;

type ChannelMock = {
  on: (
    type: string,
    filter: { event: string },
    handler: (message: { payload: unknown }) => void
  ) => ChannelMock;
  subscribe: (cb: (status: string) => void) => ChannelMock;
  send: typeof sendMock;
};

const channelMock: ChannelMock = {
  on: vi.fn((_type, _filter, _handler) => channelMock),
  subscribe: vi.fn((cb) => {
    subscribeCallback = cb;
    return channelMock;
  }),
  send: sendMock,
};

vi.mock("@/shared/lib/supabase", () => ({
  supabase: {
    channel: vi.fn(() => channelMock),
    removeChannel: vi.fn(() => Promise.resolve("ok")),
  },
}));

import { Awareness } from "y-protocols/awareness";
import { Doc } from "yjs";
import {
  AwarenessThrottle,
  connectAwareness,
  shouldBroadcast,
} from "./awareness-channel";

describe("shouldBroadcast", () => {
  it("sends when the local client changed", () => {
    expect(shouldBroadcast([7, 9], 7)).toBe(true);
  });

  it("does not relay a change that is only about other peers", () => {
    // Relaying third-party state would make fanout quadratic and can
    // resurrect a peer that already died.
    expect(shouldBroadcast([9, 12], 7)).toBe(false);
  });

  it("sends on an empty local id set only when it contains the local id", () => {
    expect(shouldBroadcast([], 7)).toBe(false);
  });
});

describe("AwarenessThrottle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes immediately on the leading edge", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("coalesces a burst into one trailing flush", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([1], false);
    throttle.push([1], false);
    expect(flush).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("accumulates changed ids across suppressed events", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], false);
    throttle.push([3], false);
    vi.advanceTimersByTime(100);
    expect(flush).toHaveBeenLastCalledWith([2, 3]);
  });

  it("bypasses the throttle for a removal", () => {
    // Removals are rare and correctness-critical: a suppressed tombstone
    // leaves a ghost caret until the remote 30s timeout expires it.
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], true);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("stops flushing after cancel", () => {
    const flush = vi.fn();
    const throttle = new AwarenessThrottle(flush);
    throttle.push([1], false);
    throttle.push([2], false);
    throttle.cancel();
    vi.advanceTimersByTime(500);
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe("connectAwareness self-repair broadcast", () => {
  const NOTE_ID = "note-1";

  beforeEach(() => {
    sendMock.mockClear();
    subscribeCallback = undefined;
  });

  it("re-broadcasts when a remote peer wrongly nulls the local client, regardless of origin", () => {
    // Regression for the inverted bug: an `origin === REMOTE_ORIGIN` guard in
    // onAwarenessUpdate would drop this self-repair re-announcement, leaving
    // peers seeing this client as gone until the 30s awareness timeout.
    const doc = new Doc();
    const awareness = new Awareness(doc);
    const localId = awareness.clientID;
    const onError = vi.fn();

    const teardown = connectAwareness({ noteId: NOTE_ID, awareness, onError });
    subscribeCallback?.("SUBSCRIBED");
    sendMock.mockClear(); // drop the connect handshake sends

    // Mirrors what applyAwarenessUpdate does when a remote client nulls this
    // client's state: the local state is kept, the clock is bumped, and
    // localId lands in `removed` on an update carrying a remote origin.
    const remoteOrigin = Symbol("remote-peer");
    awareness.emit("update", [
      { added: [], updated: [], removed: [localId] },
      remoteOrigin,
    ]);

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0].type).toBe("broadcast");

    teardown();
    expect(onError).not.toHaveBeenCalled();
  });

  it("does not relay an update about a different client, regardless of origin", () => {
    const doc = new Doc();
    const awareness = new Awareness(doc);
    const localId = awareness.clientID;
    const onError = vi.fn();

    const teardown = connectAwareness({ noteId: NOTE_ID, awareness, onError });
    subscribeCallback?.("SUBSCRIBED");
    sendMock.mockClear();

    const remoteOrigin = Symbol("remote-peer");
    awareness.emit("update", [
      { added: [], updated: [localId + 1], removed: [] },
      remoteOrigin,
    ]);

    expect(sendMock).not.toHaveBeenCalled();

    teardown();
  });
});
