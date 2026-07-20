import { describe, expect, it } from "vitest";
import { fromBase64, toBase64, toExactArrayBuffer } from "./bytes";

describe("bytes", () => {
  it("round-trips a byte array through base64", () => {
    const input = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect(fromBase64(toBase64(input))).toEqual(input);
  });

  it("round-trips a large array without blowing the call stack", () => {
    const input = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(fromBase64(toBase64(input))).toEqual(input);
  });

  it("produces an ArrayBuffer of exactly byteLength", () => {
    // Mimic lib0's over-allocation: a view onto a larger buffer.
    const backing = new ArrayBuffer(64);
    const view = new Uint8Array(backing, 8, 4);
    view.set([1, 2, 3, 4]);
    const exact = toExactArrayBuffer(view);
    expect(exact.byteLength).toBe(4);
    expect(new Uint8Array(exact)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("returns a real ArrayBuffer, not a view", () => {
    const view = new Uint8Array([9, 9]);
    expect(toExactArrayBuffer(view) instanceof ArrayBuffer).toBe(true);
  });
});
