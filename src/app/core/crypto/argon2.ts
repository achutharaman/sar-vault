import { argon2d, argon2id } from 'hash-wasm';

import { ARGON2_D, ARGON2_ID, ARGON2_V13, type Argon2Params, CryptoParameterError } from './types';

/**
 * Argon2 key derivation, backed by hash-wasm's hand-tuned WebAssembly build.
 *
 * Per CONTRIBUTING hard rule 1 we do not implement the primitive; this only
 * validates parameters and adapts types. Correctness is pinned by the vectors in
 * argon2.spec.ts, which chain back to RFC 9106.
 *
 * Requires `'wasm-unsafe-eval'` in the CSP `script-src` (living-spec D-009):
 * without it `WebAssembly.instantiate` is blocked and this rejects.
 */
export async function deriveArgon2Key(
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2Params,
): Promise<Uint8Array> {
  assertSupported(params);

  const options = {
    password,
    salt,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memoryKib,
    hashLength: params.hashLength,
    outputType: 'binary',
  } as const;

  return params.type === ARGON2_D ? argon2d(options) : argon2id(options);
}

/**
 * Reject anything we cannot compute *correctly*.
 *
 * The failure mode this guards against is quiet: a KDF given parameters it
 * silently reinterprets returns a plausible-looking key that simply is not the
 * right one. The user would see "wrong password" on a correct password, with
 * nothing pointing at the real cause.
 */
function assertSupported(params: Argon2Params): void {
  if (params.version !== ARGON2_V13) {
    // hash-wasm implements v1.3 only and exposes no version selector, so a v1.0
    // file must fail loudly rather than derive a wrong key.
    throw new CryptoParameterError(
      `Unsupported Argon2 version 0x${params.version.toString(16)}. ` +
        'Only v1.3 (0x13) is supported; this vault was written by an old implementation.',
    );
  }
  if (params.type !== ARGON2_D && params.type !== ARGON2_ID) {
    throw new CryptoParameterError(`Unsupported Argon2 type ${String(params.type)}.`);
  }
  if (!Number.isInteger(params.iterations) || params.iterations < 1) {
    throw new CryptoParameterError(`Argon2 iterations must be >= 1, got ${params.iterations}.`);
  }
  if (!Number.isInteger(params.parallelism) || params.parallelism < 1) {
    throw new CryptoParameterError(`Argon2 parallelism must be >= 1, got ${params.parallelism}.`);
  }
  // RFC 9106 §3.1: m >= 8p.
  if (!Number.isInteger(params.memoryKib) || params.memoryKib < 8 * params.parallelism) {
    throw new CryptoParameterError(
      `Argon2 memory must be an integer >= 8 * parallelism (${8 * params.parallelism} KiB), ` +
        `got ${params.memoryKib} KiB.`,
    );
  }
  if (!Number.isInteger(params.hashLength) || params.hashLength < 4) {
    throw new CryptoParameterError(`Argon2 hash length must be >= 4, got ${params.hashLength}.`);
  }
}
