import { argon2id as nobleArgon2id } from '@noble/hashes/argon2.js';
import { describe, expect, it } from 'vitest';

import { deriveArgon2Key } from './argon2';
import { ARGON2ID_VECTORS, RFC_9106_ARGON2ID } from './fixtures/argon2-vectors';
import {
  ARGON2_D,
  ARGON2_ID,
  ARGON2_V10,
  ARGON2_V13,
  type Argon2Params,
  CryptoParameterError,
} from './types';

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('Argon2 known-answer vectors', () => {
  /*
   * The trust chain, asserted rather than asserted-in-a-comment:
   *
   *   RFC 9106 published vector
   *     -> @noble/hashes reproduces it        (this test)
   *     -> hash-wasm agrees with noble        (the differential test below)
   *     -> hash-wasm is what we ship
   *
   * RFC 9106's vector uses associated data, which hash-wasm cannot express, so
   * noble is the bridge. If noble ever stopped matching the RFC, this fails and
   * the whole chain is void.
   */
  it('@noble/hashes reproduces the RFC 9106 section 5.3 vector', () => {
    const actual = nobleArgon2id(RFC_9106_ARGON2ID.password, RFC_9106_ARGON2ID.salt, {
      t: RFC_9106_ARGON2ID.iterations,
      m: RFC_9106_ARGON2ID.memoryKib,
      p: RFC_9106_ARGON2ID.parallelism,
      dkLen: RFC_9106_ARGON2ID.hashLength,
      version: 0x13,
      key: RFC_9106_ARGON2ID.secret,
      personalization: RFC_9106_ARGON2ID.associatedData,
    });

    expect(toHex(actual)).toBe(RFC_9106_ARGON2ID.expectedHex);
  });

  for (const vector of ARGON2ID_VECTORS) {
    it(`derives the expected key: ${vector.name}`, async () => {
      const password = new TextEncoder().encode(vector.password);
      const salt = new Uint8Array(vector.saltLength).fill(vector.saltByte);

      const derived = await deriveArgon2Key(password, salt, {
        memoryKib: vector.memoryKib,
        iterations: vector.iterations,
        parallelism: vector.parallelism,
        hashLength: vector.hashLength,
        type: ARGON2_ID,
        version: ARGON2_V13,
      });

      expect(toHex(derived)).toBe(vector.expectedHex);
    });

    it(`agrees with @noble/hashes: ${vector.name}`, async () => {
      const password = new TextEncoder().encode(vector.password);
      const salt = new Uint8Array(vector.saltLength).fill(vector.saltByte);

      const ours = await deriveArgon2Key(password, salt, {
        memoryKib: vector.memoryKib,
        iterations: vector.iterations,
        parallelism: vector.parallelism,
        hashLength: vector.hashLength,
        type: ARGON2_ID,
        version: ARGON2_V13,
      });
      const reference = nobleArgon2id(password, salt, {
        t: vector.iterations,
        m: vector.memoryKib,
        p: vector.parallelism,
        dkLen: vector.hashLength,
        version: 0x13,
      });

      expect(toHex(ours)).toBe(toHex(reference));
    });
  }

  it('supports Argon2d, which KDBX 4 also permits', async () => {
    const derived = await deriveArgon2Key(
      new TextEncoder().encode('pw'),
      new Uint8Array(16).fill(1),
      {
        memoryKib: 64,
        iterations: 2,
        parallelism: 1,
        hashLength: 32,
        type: ARGON2_D,
        version: ARGON2_V13,
      },
    );

    expect(derived).toHaveLength(32);
  });

  it('produces different keys for different salts', async () => {
    const password = new TextEncoder().encode('same password');
    const params = {
      memoryKib: 64,
      iterations: 2,
      parallelism: 1,
      hashLength: 32,
      type: ARGON2_ID,
      version: ARGON2_V13,
    } as const;

    const a = await deriveArgon2Key(password, new Uint8Array(16).fill(1), params);
    const b = await deriveArgon2Key(password, new Uint8Array(16).fill(2), params);

    expect(toHex(a)).not.toBe(toHex(b));
  });
});

describe('Argon2 parameter validation', () => {
  const base: Argon2Params = {
    memoryKib: 64,
    iterations: 2,
    parallelism: 1,
    hashLength: 32,
    type: ARGON2_ID,
    version: ARGON2_V13,
  };

  const derive = (overrides: Partial<Argon2Params>) =>
    deriveArgon2Key(new TextEncoder().encode('pw'), new Uint8Array(16).fill(1), {
      ...base,
      ...overrides,
    });

  /*
   * The important case. hash-wasm implements Argon2 v1.3 only and has no
   * version selector, so handing it a v1.0 file would silently derive a
   * different key — surfacing to the user as "wrong password" on a correct
   * password, with nothing pointing at the real cause.
   */
  it('rejects Argon2 v1.0 rather than silently deriving a wrong key', async () => {
    await expect(derive({ version: ARGON2_V10 })).rejects.toThrow(CryptoParameterError);
    await expect(derive({ version: ARGON2_V10 })).rejects.toThrow(/v1\.3/);
  });

  it('rejects a memory cost below the RFC 9106 minimum of 8 * parallelism', async () => {
    await expect(derive({ memoryKib: 8, parallelism: 4 })).rejects.toThrow(CryptoParameterError);
  });

  it.each([
    ['iterations', { iterations: 0 }],
    ['parallelism', { parallelism: 0 }],
    ['hashLength', { hashLength: 2 }],
  ])('rejects an out-of-range %s', async (_label, overrides) => {
    await expect(derive(overrides)).rejects.toThrow(CryptoParameterError);
  });
});
