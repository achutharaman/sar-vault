/**
 * Randomness and byte-handling helpers for the crypto layer.
 *
 * Pure functions over `Uint8Array`. No DOM beyond `crypto`, no I/O.
 */

/**
 * Cryptographically secure random bytes.
 *
 * `Math.random()` is banned repo-wide by an ESLint rule; this is the only
 * sanctioned source of randomness (SECURITY.md).
 */
export function secureRandom(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError(`secureRandom: length must be a non-negative integer, got ${length}`);
  }
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Compare two byte arrays without leaking *where* they differ through timing.
 *
 * A plain `===` loop returns as soon as it finds a mismatch, so the time taken
 * reveals the length of the matching prefix — enough to reconstruct a secret one
 * byte at a time. This always reads every byte of the longer array.
 *
 * Lengths are still compared up front: array length is not secret here, and
 * hiding it would mean reading past the end of one of the inputs.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    // `noUncheckedIndexedAccess` types these as possibly-undefined; the loop
    // bound guarantees they are not, and `?? 0` keeps that explicit without
    // introducing a non-null assertion.
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Overwrite a buffer holding secret material.
 *
 * This is a best-effort measure, not a guarantee. SECURITY.md is explicit that
 * JavaScript has no secure memory: there is no `mlock`, the GC may have copied
 * the bytes elsewhere already, and pages may have been swapped to disk. Zeroing
 * narrows the window in which a heap snapshot reveals a key; it does not close
 * it.
 */
export function zeroize(...buffers: (Uint8Array | undefined | null)[]): void {
  for (const buffer of buffers) {
    buffer?.fill(0);
  }
}

/** Copy bytes out of an `ArrayBuffer` as a `Uint8Array`. */
export function toBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer.slice(0));
}

/** Copy bytes into a fresh `ArrayBuffer`, the shape kdbxweb's APIs expect. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}
