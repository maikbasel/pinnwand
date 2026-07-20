// Chunked so a large update cannot exceed the argument limit of
// String.fromCharCode when spread.
const CHUNK = 0x80_00;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Copies a view into a standalone ArrayBuffer sized exactly to its contents.
 *
 * Two reasons this is not optional. supabase-js's socket serializer tests
 * `instanceof ArrayBuffer` and does not test `ArrayBuffer.isView`, so handing
 * it a Uint8Array falls through to JSON.stringify and inflates the payload
 * roughly fivefold in a shape the receiver cannot decode. And lib0's encoder
 * allocates in chunks, so `.buffer` is usually larger than `.byteLength` and
 * would carry trailing garbage that applyAwarenessUpdate tries to parse.
 */
export function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
