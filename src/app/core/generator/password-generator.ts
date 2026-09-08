/**
 * Password generation.
 *
 * Pure functions over the CSPRNG — no DOM, no Angular, no vault knowledge.
 */

export interface GeneratorOptions {
  readonly length: number;
  readonly lowercase: boolean;
  readonly uppercase: boolean;
  readonly digits: boolean;
  readonly symbols: boolean;
  /** Drop characters that are easy to misread: l, I, 1, O, 0 and friends. */
  readonly excludeAmbiguous: boolean;
  /** Require at least one character from every selected class. */
  readonly requireEachClass: boolean;
}

export const DEFAULT_OPTIONS: GeneratorOptions = {
  length: 20,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  requireEachClass: true,
};

export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
/** Excludes quotes and backslash, which break shell and CSV pasting. */
export const SYMBOLS = '!#$%&()*+,-./:;<=>?@[]^_{|}~';

const AMBIGUOUS = new Set('lI1O0o5S2Z8B');

export class GeneratorError extends Error {
  override readonly name = 'GeneratorError';
}

/** The character pool implied by a set of options. */
export function buildPool(options: GeneratorOptions): string[] {
  let pool = '';
  if (options.lowercase) pool += LOWERCASE;
  if (options.uppercase) pool += UPPERCASE;
  if (options.digits) pool += DIGITS;
  if (options.symbols) pool += SYMBOLS;

  const chars = [...pool];
  return options.excludeAmbiguous ? chars.filter((c) => !AMBIGUOUS.has(c)) : chars;
}

/**
 * A uniformly random index in `[0, max)`.
 *
 * The obvious `randomByte % max` is **biased** whenever `max` does not divide
 * 256: low indices come up more often, and the skew grows with pool size. For a
 * 26-character alphabet that is a real distortion of the keyspace, not a
 * rounding detail. Rejection sampling discards the uneven tail so every index is
 * equally likely.
 */
export function randomIndex(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 256) {
    throw new GeneratorError(`randomIndex supports an integer 1..256, got ${max}`);
  }
  const limit = Math.floor(256 / max) * max;
  const buffer = new Uint8Array(1);

  for (;;) {
    crypto.getRandomValues(buffer);
    const byte = buffer[0] ?? 0;
    if (byte < limit) {
      return byte % max;
    }
    // Landed in the uneven tail — draw again rather than fold it back in.
  }
}

/** Shannon entropy in bits for a uniform draw of `length` from `poolSize`. */
export function entropyBits(poolSize: number, length: number): number {
  if (poolSize <= 1 || length <= 0) {
    return 0;
  }
  return Math.log2(poolSize) * length;
}

/**
 * A coarse label for an entropy figure.
 *
 * Thresholds are judgement calls, not standards. 50 bits is roughly where
 * offline guessing stops being trivial for a fast hash; 100+ is beyond
 * foreseeable brute force. Argon2id raises the real cost well above these, so
 * treat the label as a floor.
 */
export function strengthLabel(bits: number): 'weak' | 'fair' | 'strong' | 'excellent' {
  if (bits < 50) return 'weak';
  if (bits < 75) return 'fair';
  if (bits < 100) return 'strong';
  return 'excellent';
}

function classesPresent(password: string, options: GeneratorOptions): boolean {
  const has = (set: string) => [...password].some((c) => set.includes(c));
  if (options.lowercase && !has(LOWERCASE)) return false;
  if (options.uppercase && !has(UPPERCASE)) return false;
  if (options.digits && !has(DIGITS)) return false;
  if (options.symbols && !has(SYMBOLS)) return false;
  return true;
}

/**
 * Generate a password.
 *
 * With `requireEachClass`, candidates missing a class are discarded and redrawn.
 * Rejection keeps the result uniform over the strings that qualify — unlike the
 * common shortcut of forcing one character per class into fixed positions, which
 * makes those positions predictable. Reported entropy is then a slight
 * overestimate, since the qualifying set is marginally smaller than the whole
 * space.
 */
export function generatePassword(options: GeneratorOptions = DEFAULT_OPTIONS): string {
  const pool = buildPool(options);

  if (pool.length === 0) {
    throw new GeneratorError('Select at least one character type.');
  }
  if (!Number.isInteger(options.length) || options.length < 1) {
    throw new GeneratorError(`Length must be a positive integer, got ${options.length}`);
  }

  const selectedClasses = [
    options.lowercase,
    options.uppercase,
    options.digits,
    options.symbols,
  ].filter(Boolean).length;

  if (options.requireEachClass && options.length < selectedClasses) {
    throw new GeneratorError(
      `Length ${options.length} cannot contain all ${selectedClasses} selected character types.`,
    );
  }

  const draw = (): string => {
    let password = '';
    for (let remaining = options.length; remaining > 0; remaining--) {
      password += pool[randomIndex(pool.length)];
    }
    return password;
  };

  if (!options.requireEachClass) {
    return draw();
  }

  // Bounded so a pathological option set cannot spin forever. With any sane
  // pool the first or second draw qualifies.
  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidate = draw();
    if (classesPresent(candidate, options)) {
      return candidate;
    }
  }
  throw new GeneratorError('Could not satisfy the selected character types.');
}
