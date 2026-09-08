import { describe, expect, it } from 'vitest';

import {
  buildPool,
  DEFAULT_OPTIONS,
  DIGITS,
  entropyBits,
  generatePassword,
  GeneratorError,
  LOWERCASE,
  randomIndex,
  strengthLabel,
  SYMBOLS,
  UPPERCASE,
} from './password-generator';

describe('randomIndex', () => {
  it('stays within range', () => {
    for (const max of [1, 2, 3, 26, 62, 95, 256]) {
      for (let i = 0; i < 200; i++) {
        const value = randomIndex(max);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(max);
      }
    }
  });

  it('rejects an unusable range rather than returning something plausible', () => {
    expect(() => randomIndex(0)).toThrow(GeneratorError);
    expect(() => randomIndex(-1)).toThrow(GeneratorError);
    expect(() => randomIndex(257)).toThrow(GeneratorError);
    expect(() => randomIndex(2.5)).toThrow(GeneratorError);
  });

  /*
   * The reason rejection sampling exists here.
   *
   * With `byte % 26`, bytes 0..255 map unevenly: indices 0..21 get 10 chances
   * each and 22..25 only 9, so the first 22 letters are ~11% more likely. This
   * checks the distribution is flat enough that such a skew would show up.
   *
   * Tolerance is deliberately loose — this must not flake — but a modulo bias
   * of that size across 26,000 draws sits far outside it.
   */
  it('is not measurably biased across a non-power-of-two range', () => {
    const max = 26;
    const draws = 26_000;
    const counts = new Array<number>(max).fill(0);

    for (let i = 0; i < draws; i++) {
      counts[randomIndex(max)]! += 1;
    }

    const expected = draws / max;
    for (const count of counts) {
      // ±20%: a modulo bias would put the low indices ~11% high and the tail
      // ~11% low *systematically*, which compounds across the whole array.
      expect(count).toBeGreaterThan(expected * 0.8);
      expect(count).toBeLessThan(expected * 1.2);
    }

    // And every index must actually be reachable.
    expect(counts.every((c) => c > 0)).toBe(true);
  });
});

describe('buildPool', () => {
  it('includes only the selected classes', () => {
    const pool = buildPool({ ...DEFAULT_OPTIONS, symbols: false, digits: false }).join('');
    expect(pool).toContain('a');
    expect(pool).toContain('A');
    expect(pool).not.toContain('5');
    expect(pool).not.toContain('!');
  });

  it('drops look-alike characters when asked', () => {
    const pool = buildPool({ ...DEFAULT_OPTIONS, excludeAmbiguous: true }).join('');
    for (const char of ['l', 'I', '1', 'O', '0']) {
      expect(pool).not.toContain(char);
    }
    expect(pool.length).toBeGreaterThan(40);
  });

  it('excludes quotes and backslash, which break shell and CSV pasting', () => {
    expect(SYMBOLS).not.toContain('"');
    expect(SYMBOLS).not.toContain("'");
    expect(SYMBOLS).not.toContain('\\');
    expect(SYMBOLS).not.toContain('`');
  });
});

describe('entropyBits', () => {
  it('matches length * log2(pool)', () => {
    // 26 lowercase letters ≈ 4.7 bits each.
    expect(entropyBits(26, 10)).toBeCloseTo(47.0, 1);
    // The full default pool of 88 characters over 20 slots.
    expect(entropyBits(88, 20)).toBeCloseTo(129.2, 1);
  });

  it('is zero for a degenerate pool or empty password', () => {
    expect(entropyBits(1, 20)).toBe(0);
    expect(entropyBits(88, 0)).toBe(0);
  });

  it('agrees with the pool the generator actually uses', () => {
    const pool = buildPool(DEFAULT_OPTIONS);
    expect(pool).toHaveLength(LOWERCASE.length + UPPERCASE.length + DIGITS.length + SYMBOLS.length);
    expect(entropyBits(pool.length, DEFAULT_OPTIONS.length)).toBeGreaterThan(100);
  });
});

describe('strengthLabel', () => {
  it.each([
    [30, 'weak'],
    [49.9, 'weak'],
    [50, 'fair'],
    [74.9, 'fair'],
    [75, 'strong'],
    [99.9, 'strong'],
    [100, 'excellent'],
  ])('labels %s bits as %s', (bits, label) => {
    expect(strengthLabel(bits)).toBe(label);
  });
});

describe('generatePassword', () => {
  it('produces the requested length', () => {
    for (const length of [8, 16, 32, 64, 128]) {
      expect(generatePassword({ ...DEFAULT_OPTIONS, length })).toHaveLength(length);
    }
  });

  it('draws only from the selected pool', () => {
    const options = { ...DEFAULT_OPTIONS, symbols: false, digits: false, length: 200 };
    const pool = new Set(buildPool(options));

    for (const char of generatePassword(options)) {
      expect(pool.has(char)).toBe(true);
    }
  });

  it('includes every selected class when asked', () => {
    for (let i = 0; i < 40; i++) {
      const password = generatePassword({ ...DEFAULT_OPTIONS, length: 8 });
      expect([...password].some((c) => LOWERCASE.includes(c))).toBe(true);
      expect([...password].some((c) => UPPERCASE.includes(c))).toBe(true);
      expect([...password].some((c) => DIGITS.includes(c))).toBe(true);
      expect([...password].some((c) => SYMBOLS.includes(c))).toBe(true);
    }
  });

  /*
   * The naive way to guarantee class coverage is to place one character of each
   * class at a fixed position. That leaks structure: position 0 is always
   * lowercase, position 1 always uppercase, and so on. Rejection sampling has no
   * such pattern, so the first character should vary across all classes.
   */
  it('does not pin classes to fixed positions', () => {
    const firstChars = new Set<string>();
    for (let i = 0; i < 200; i++) {
      firstChars.add(generatePassword({ ...DEFAULT_OPTIONS, length: 8 })[0] ?? '');
    }

    const classesSeen = [LOWERCASE, UPPERCASE, DIGITS, SYMBOLS].filter((set) =>
      [...firstChars].some((c) => set.includes(c)),
    );
    expect(classesSeen.length).toBeGreaterThan(1);
  });

  it('never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(generatePassword());
    }
    expect(seen.size).toBe(200);
  });

  it('refuses when no character type is selected', () => {
    expect(() =>
      generatePassword({
        ...DEFAULT_OPTIONS,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
      }),
    ).toThrow(/at least one character type/i);
  });

  it('refuses a length too short to hold every required class', () => {
    expect(() => generatePassword({ ...DEFAULT_OPTIONS, length: 3 })).toThrow(
      /cannot contain all 4/i,
    );
  });

  it('allows a short password when class coverage is not required', () => {
    expect(
      generatePassword({ ...DEFAULT_OPTIONS, length: 3, requireEachClass: false }),
    ).toHaveLength(3);
  });

  it('rejects a nonsensical length', () => {
    expect(() => generatePassword({ ...DEFAULT_OPTIONS, length: 0 })).toThrow(GeneratorError);
    expect(() => generatePassword({ ...DEFAULT_OPTIONS, length: 2.5 })).toThrow(GeneratorError);
  });
});
