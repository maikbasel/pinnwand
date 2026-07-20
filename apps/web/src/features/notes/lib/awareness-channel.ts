import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { noop } from "@/shared/lib/noop";
import { supabase } from "@/shared/lib/supabase";
import { toExactArrayBuffer } from "./bytes";

export const AWARENESS_THROTTLE_MS = 100;
const AWARENESS_EVENT = "awareness";
const AWARENESS_QUERY_EVENT = "awareness:query";
const QUERY_REPLY_MAX_JITTER_MS = 200;

/** Origin tag for updates that arrived over the wire, never the string "local". */
const REMOTE_ORIGIN = Symbol("awareness-remote");

/**
 * Sends only when the local client is in the changed set.
 *
 * Filtering on `origin === 'local'` would be wrong: when a remote incorrectly
 * nulls this client, applyAwarenessUpdate bumps the local clock so the client
 * re-announces itself, and that update carries a remote origin. Filtering on
 * the client set catches it, and also stops this peer relaying third-party
 * state, which would make fanout quadratic.
 */
export function shouldBroadcast(
  changed: number[],
  localClientId: number
): boolean {
  return changed.includes(localClientId);
}

/**
 * Leading-and-trailing-edge throttle over the *send*, not the awareness event.
 *
 * The awareness handler stays unthrottled and accumulates changed ids here.
 * Debouncing the handler instead (as kevinamick/supabaseprovider does) discards
 * the `removed` set from suppressed calls, which leaves ghost carets alive
 * until the remote 30 second timeout, and freezes carets during continuous
 * typing, which is exactly when they should move.
 */
export class AwarenessThrottle {
  private readonly flush: (clients: number[]) => void;
  private readonly pending = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;

  constructor(flush: (clients: number[]) => void) {
    this.flush = flush;
  }

  push(clients: number[], hasRemoval: boolean): void {
    if (this.cancelled) {
      return;
    }
    for (const id of clients) {
      this.pending.add(id);
    }
    if (hasRemoval) {
      this.emit();
      return;
    }
    if (this.timer !== null) {
      return;
    }
    this.emit();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.pending.size > 0) {
        this.emit();
      }
    }, AWARENESS_THROTTLE_MS);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
  }

  private emit(): void {
    const clients = [...this.pending];
    this.pending.clear();
    this.flush(clients);
  }
}

type ConnectAwarenessOptions = {
  noteId: string;
  awareness: Awareness;
  onError: (error: Error) => void;
};

/**
 * Binds a y-protocols Awareness instance to a Supabase broadcast channel.
 *
 * Broadcast rather than Presence for two independent reasons. Self-hosted
 * Realtime caps a client at CLIENT_PRESENCE_MAX_CALLS=5 per 30 seconds, which
 * is below even the awareness heartbeat. And Awareness already is a presence
 * protocol with its own clock, 30 second peer expiry, and tombstones, so
 * layering Presence under it means two clocks and two lifecycles that disagree.
 *
 * Returns a teardown function.
 */
export function connectAwareness(options: ConnectAwarenessOptions): () => void {
  const { noteId, awareness, onError } = options;
  const localId = awareness.clientID;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let tombstoneSent = false;

  const sendState = (clients: number[]): void => {
    // send() silently falls back to REST when the channel is not pushable, and
    // the REST path JSON.stringify's the payload, which corrupts binary.
    if (!(channel && subscribed) || clients.length === 0) {
      return;
    }
    const update = encodeAwarenessUpdate(awareness, clients);
    channel
      .send({
        type: "broadcast",
        event: AWARENESS_EVENT,
        payload: toExactArrayBuffer(update),
      })
      .then(noop, noop);
  };

  const throttle = new AwarenessThrottle(sendState);

  const onAwarenessUpdate = (
    change: { added: number[]; updated: number[]; removed: number[] },
    _origin: unknown
  ): void => {
    // No origin gate here: when a remote peer wrongly nulls this client's
    // state, applyAwarenessUpdate bumps the local clock and re-announces it
    // via an update carrying a remote origin (see shouldBroadcast doc comment
    // above). Gating on origin would drop that self-repair re-announcement
    // and leave peers seeing this client as gone until the 30s timeout.
    // shouldBroadcast already excludes third-party relays.
    const changed = [...change.added, ...change.updated, ...change.removed];
    if (!shouldBroadcast(changed, localId)) {
      return;
    }
    throttle.push([localId], change.removed.length > 0);
  };

  awareness.on("update", onAwarenessUpdate);

  const clearRemotes = (): void => {
    const remotes = [...awareness.getStates().keys()].filter(
      (id) => id !== localId
    );
    if (remotes.length > 0) {
      removeAwarenessStates(awareness, remotes, REMOTE_ORIGIN);
    }
  };

  const sendTombstone = (): void => {
    if (tombstoneSent) {
      return;
    }
    tombstoneSent = true;
    removeAwarenessStates(awareness, [localId], REMOTE_ORIGIN);
    // Stays explicit: teardown calls awareness.off("update", onAwarenessUpdate)
    // before sendTombstone(), so once the handler is detached this is the only
    // thing that emits the tombstone. On the pagehide/visibilitychange path the
    // handler is still attached and also sends, so the tombstone broadcasts
    // twice — harmless, since applying it is idempotent.
    sendState([localId]);
  };

  // pagehide plus visibilitychange, never beforeunload: iOS Safari and Android
  // Chrome discard backgrounded tabs without firing beforeunload, which is the
  // mobile defect in both community providers.
  const onPageHide = (): void => sendTombstone();
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      sendTombstone();
    }
  };
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("visibilitychange", onVisibility);

  channel = supabase
    .channel(`awareness:${noteId}`, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: AWARENESS_EVENT }, (message) => {
      const payload = message.payload;
      if (!(payload instanceof ArrayBuffer)) {
        return;
      }
      try {
        applyAwarenessUpdate(awareness, new Uint8Array(payload), REMOTE_ORIGIN);
      } catch (error) {
        // A truncated update throws inside applyAwarenessUpdate. An unhandled
        // throw in a channel callback is a swallowed error, so surface it and
        // drop the message: the sender's next heartbeat repairs within 15s.
        onError(
          error instanceof Error
            ? error
            : new Error("Awareness-Update ungültig")
        );
      }
    })
    .on("broadcast", { event: AWARENESS_QUERY_EVENT }, () => {
      // Reply with our own state only. Relaying the full states map would
      // resurrect peers that already died.
      const jitter = Math.random() * QUERY_REPLY_MAX_JITTER_MS;
      setTimeout(() => sendState([localId]), jitter);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        subscribed = true;
        tombstoneSent = false;
        sendState([localId]);
        // Fire-and-forget broadcast retains no state, so a late joiner would
        // otherwise see nobody until each peer next moves. The 15s self-renewal
        // is the safety net, making a lost query a latency bug not a
        // correctness one.
        channel
          ?.send({
            type: "broadcast",
            event: AWARENESS_QUERY_EVENT,
            payload: {},
          })
          .then(noop, noop);
        return;
      }
      if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        subscribed = false;
        clearRemotes();
      }
    });

  return () => {
    // Same function reference that was registered. Passing an unbound method
    // here leaks the listener, which React 19 StrictMode exercises on every
    // dev mount.
    awareness.off("update", onAwarenessUpdate);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("visibilitychange", onVisibility);
    sendTombstone();
    throttle.cancel();
    if (channel) {
      supabase.removeChannel(channel).then(noop, noop);
      channel = null;
    }
  };
}
