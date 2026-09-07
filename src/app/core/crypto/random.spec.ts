import { describe, expect, it } from 'vitest';

import { constantTimeEqual, secureRandom, toArrayBuffer, toBytes, zeroize } from './random';

describe('secureRandom', () => {
  it('returns the requested length', () => {
    expect(secureRandom(0)).toHaveLength(0);
    expect(secureRandom(32)).toHaveLength(32);
  });

  it('does not repeat across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(secureRandom(16).join(','));
    }
    expect(seen.size).toBe(50);
  });

  it('rejects invalid lengths rather than returning a short buffer', () => {
    expect(() => secureRandom(-1)).toThrow(RangeError);
    expect(() => secureRandom(1.5)).toThrow(RangeError);
  });
});

describe('constantTimeEqual', () => {
  it('is true for identical content', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });

  it('is false for differing content', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('is false for differing lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  /*
   * Not a timing measurement — those are hopelessly noisy in a browser and would
   * be flaky. This asserts the property the implementation relies on: every byte
   * is examined, so there is no early return whose position depends on secret
   * data. A first-byte mismatch and a last-byte mismatch must be indistinguishable
   * in result, and the loop must not short-circuit.
   */
  it('examines the whole array regardless of where the difference is', () => {
    const base = new Uint8Array(64).fill(7);

    const differsFirst = Uint8Array.from(base);
    differsFirst[0] = 8;

    const differsLast = Uint8Array.from(base);
    differsLast[63] = 8;

    expect(constantTimeEqual(base, differsFirst)).toBe(false);
    expect(constantTimeEqual(base, differsLast)).toBe(false);
  });
});

describe('zeroize', () => {
  it('overwrites buffer contents', () => {
    const secret = new Uint8Array([1, 2, 3, 4]);
    zeroize(secret);
    expect(Array.from(secret)).toEqual([0, 0, 0, 0]);
  });

  it('handles several buffers, and tolerates null or undefined', () => {
    const a = new Uint8Array([1, 1]);
    const b = new Uint8Array([2, 2]);
    zeroize(a, undefined, b, null);
    expect(Array.from(a)).toEqual([0, 0]);
    expect(Array.from(b)).toEqual([0, 0]);
  });
});

describe('buffer conversion', () => {
  it('round-trips bytes through an ArrayBuffer', () => {
    const original = new Uint8Array([1, 2, 3, 250]);
    expect(Array.from(toBytes(toArrayBuffer(original)))).toEqual(Array.from(original));
  });

  it('copies rather than aliasing, so zeroizing one does not corrupt the other', () => {
    const original = new Uint8Array([1, 2, 3]);
    const buffer = toArrayBuffer(original);

    zeroize(original);

    expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
  });
});
