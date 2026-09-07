/**
 * Argon2 known-answer vectors.
 *
 * CONTRIBUTING hard rule 5 requires published vectors, or vectors verified
 * against a reference implementation — not "it round-trips in my test".
 *
 * ## Provenance
 *
 * RFC 9106's own Argon2id vector uses a secret key *and* associated data.
 * hash-wasm (the implementation we ship) exposes no associated-data parameter,
 * so that vector cannot be evaluated against it directly. The chain used
 * instead is:
 *
 *   1. `@noble/hashes` — an audited, independent, pure-JS implementation —
 *      reproduces the RFC 9106 §5.3 Argon2id vector exactly. Asserted by
 *      `argon2.spec.ts` as RFC_9106_ARGON2ID below.
 *   2. hash-wasm is then required to agree with noble byte-for-byte across the
 *      parameter shapes KDBX actually uses (no secret, no associated data).
 *
 * So the digests below are not self-generated: each was produced by two
 * independent implementations, one of which is pinned to the published RFC
 * vector. `@noble/hashes` is a devDependency used only for this cross-check and
 * is never bundled.
 *
 * Larger published vector files (NIST CAVP `.rsp`, RFC dumps) belong in this
 * directory as text files. `.gitignore` blanket-ignores `*.txt`, but carves out
 * a negation for any `fixtures` directory so those can still be committed.
 */

/** RFC 9106 §5.3 — Argon2id, v1.3. Uses secret + associated data. */
export const RFC_9106_ARGON2ID = {
  password: new Uint8Array(32).fill(0x01),
  salt: new Uint8Array(16).fill(0x02),
  secret: new Uint8Array(8).fill(0x03),
  associatedData: new Uint8Array(12).fill(0x04),
  iterations: 3,
  memoryKib: 32,
  parallelism: 4,
  hashLength: 32,
  expectedHex: '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
} as const;

/**
 * KDBX-shaped vectors: no secret, no associated data, 32-byte output — the
 * exact shape kdbxweb requests via its `setArgon2Impl` hook.
 *
 * Verified to agree between hash-wasm and @noble/hashes.
 */
export const ARGON2ID_VECTORS = [
  {
    name: 'low cost',
    password: 'correct horse battery staple',
    saltByte: 0x2a,
    saltLength: 16,
    iterations: 2,
    memoryKib: 64,
    parallelism: 1,
    hashLength: 32,
    expectedHex: '4e9934592139a0610b868a0460588b971812889d4a98f6b520bd3a5bbef19c40',
  },
  {
    name: 'kdbx-like cost',
    password: 'correct horse battery staple',
    saltByte: 0x2a,
    saltLength: 16,
    iterations: 3,
    memoryKib: 1024,
    parallelism: 2,
    hashLength: 32,
    expectedHex: '4a1816d67fa55d4ca5c4f58e41432481b1eedc291cd34689503bd49f8bee828d',
  },
] as const;
