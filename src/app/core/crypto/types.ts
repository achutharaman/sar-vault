/**
 * Crypto layer contracts. See docs/living-spec.md §4 and docs/architecture.md.
 *
 * Everything here is plain data over `Uint8Array` — no DOM, no Angular, no I/O,
 * and no knowledge of what a vault is. ESLint enforces that.
 */

/** Argon2 variant, matching the values KDBX 4 stores in its KDF parameters. */
export const ARGON2_D = 0;
export const ARGON2_ID = 2;
export type Argon2Type = typeof ARGON2_D | typeof ARGON2_ID;

/** Argon2 version, as stored in the KDBX header. `0x13` is v1.3. */
export const ARGON2_V10 = 0x10;
export const ARGON2_V13 = 0x13;
export type Argon2Version = typeof ARGON2_V10 | typeof ARGON2_V13;

/**
 * Argon2 cost parameters.
 *
 * `memoryKib` is in **kibibytes**, not bytes. KDBX stores this value in bytes in
 * its header; kdbxweb divides by 1024 before handing it to the KDF, and this
 * type follows the KDF's convention. Getting the unit wrong derives a different
 * key and fails to open the vault, so it is named rather than left as `memory`.
 */
export interface Argon2Params {
  readonly memoryKib: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly hashLength: number;
  readonly type: Argon2Type;
  readonly version: Argon2Version;
}

/** Thrown when a KDF is asked for something it cannot compute correctly. */
export class CryptoParameterError extends Error {
  override readonly name = 'CryptoParameterError';
}
