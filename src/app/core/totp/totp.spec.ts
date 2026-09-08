import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  fromBase32Secret,
  generateTotp,
  parseOtpauthUri,
  secondsRemaining,
  toOtpauthUri,
  TotpError,
  type TotpAlgorithm,
} from './totp';

const text = (s: string) => new TextEncoder().encode(s);

/*
 * RFC 6238 Appendix B.
 *
 * The seeds are ASCII "12345678901234567890" repeated to the hash's block
 * length. These are the vectors that prove the implementation is actually TOTP
 * rather than merely self-consistent: a wrong counter encoding, a wrong
 * truncation offset, or a wrong seed length would round-trip happily against
 * our own code and then disagree with every authenticator app.
 */
const RFC_SEEDS: Record<TotpAlgorithm, Uint8Array> = {
  SHA1: text('12345678901234567890'),
  SHA256: text('12345678901234567890123456789012'),
  SHA512: text('1234567890123456789012345678901234567890123456789012345678901234'),
};

const RFC_VECTORS: { seconds: number; algorithm: TotpAlgorithm; code: string }[] = [
  { seconds: 59, algorithm: 'SHA1', code: '94287082' },
  { seconds: 59, algorithm: 'SHA256', code: '46119246' },
  { seconds: 59, algorithm: 'SHA512', code: '90693936' },
  { seconds: 1111111109, algorithm: 'SHA1', code: '07081804' },
  { seconds: 1111111109, algorithm: 'SHA256', code: '68084774' },
  { seconds: 1111111109, algorithm: 'SHA512', code: '25091201' },
  { seconds: 1111111111, algorithm: 'SHA1', code: '14050471' },
  { seconds: 1234567890, algorithm: 'SHA1', code: '89005924' },
  { seconds: 1234567890, algorithm: 'SHA256', code: '91819424' },
  { seconds: 1234567890, algorithm: 'SHA512', code: '93441116' },
  { seconds: 2000000000, algorithm: 'SHA1', code: '69279037' },
  { seconds: 20000000000, algorithm: 'SHA1', code: '65353130' },
  { seconds: 20000000000, algorithm: 'SHA256', code: '77737706' },
  { seconds: 20000000000, algorithm: 'SHA512', code: '47863826' },
];

describe('TOTP — RFC 6238 known-answer vectors', () => {
  for (const { seconds, algorithm, code } of RFC_VECTORS) {
    it(`matches T=${seconds} ${algorithm}`, async () => {
      const actual = await generateTotp(
        {
          secret: RFC_SEEDS[algorithm],
          digits: 8,
          periodSeconds: 30,
          algorithm,
        },
        seconds * 1000,
      );

      expect(actual).toBe(code);
    });
  }

  /*
   * T=20000000000 is past 2^31 seconds, which is where a 32-bit counter would
   * silently wrap. It is in the RFC's table precisely to catch that, and it is
   * why the counter is computed with BigInt here.
   */
  it('handles a counter beyond 32 bits', async () => {
    expect(
      await generateTotp(
        { secret: RFC_SEEDS.SHA1, digits: 8, periodSeconds: 30, algorithm: 'SHA1' },
        20000000000 * 1000,
      ),
    ).toBe('65353130');
  });
});

describe('base32', () => {
  // RFC 4648 §10 test vectors.
  it.each([
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6===', 'foo'],
    ['MZXW6YQ=', 'foob'],
    ['MZXW6YTB', 'fooba'],
    ['MZXW6YTBOI======', 'foobar'],
  ])('decodes %s to %s', (encoded, expected) => {
    expect(new TextDecoder().decode(base32Decode(encoded))).toBe(expected);
  });

  it('round-trips through encode', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });

  it('tolerates the shapes people actually paste', () => {
    const canonical = Array.from(base32Decode('MZXW6YTBOI======'));
    expect(Array.from(base32Decode('mzxw6ytboi'))).toEqual(canonical);
    expect(Array.from(base32Decode('MZXW 6YTB OI'))).toEqual(canonical);
    expect(Array.from(base32Decode('MZXW-6YTB-OI'))).toEqual(canonical);
  });

  /*
   * Skipping an invalid character would produce a plausible-looking secret that
   * generates codes the server never accepts, with nothing indicating why.
   */
  it('rejects an invalid character rather than skipping it', () => {
    expect(() => base32Decode('MZXW6YTB!')).toThrow(TotpError);
    expect(() => base32Decode('MZXW0YTB')).toThrow(/not valid base32/i);
    expect(() => base32Decode('   ')).toThrow(/empty/i);
  });
});

describe('otpauth URI', () => {
  it('parses a typical authenticator URI', () => {
    const config = parseOtpauthUri(
      'otpauth://totp/GitHub:achutharaman?secret=MZXW6YTBOI&issuer=GitHub&algorithm=SHA256&digits=8&period=60',
    );

    expect(new TextDecoder().decode(config.secret)).toBe('foobar');
    expect(config.issuer).toBe('GitHub');
    expect(config.algorithm).toBe('SHA256');
    expect(config.digits).toBe(8);
    expect(config.periodSeconds).toBe(60);
  });

  it('applies RFC 6238 defaults when parameters are absent', () => {
    const config = parseOtpauthUri('otpauth://totp/Example?secret=MZXW6YTBOI');

    expect(config.algorithm).toBe('SHA1');
    expect(config.digits).toBe(6);
    expect(config.periodSeconds).toBe(30);
  });

  it('infers the issuer from a "Issuer:account" label', () => {
    expect(parseOtpauthUri('otpauth://totp/GitHub:me?secret=MZXW6YTBOI').issuer).toBe('GitHub');
  });

  /*
   * hotp is counter-based. Treating it as time-based would generate codes that
   * never verify, so it has to be refused rather than coerced.
   */
  it('refuses counter-based (hotp) URIs', () => {
    expect(() => parseOtpauthUri('otpauth://hotp/Example?secret=MZXW6YTBOI&counter=1')).toThrow(
      /time-based/i,
    );
  });

  it.each([
    ['https://example.com', /otpauth:/],
    ['otpauth://totp/Example', /no secret/i],
    ['not a uri at all', /valid otpauth/i],
    ['otpauth://totp/Example?secret=MZXW6YTBOI&algorithm=MD5', /Unsupported algorithm/i],
  ])('rejects %s', (uri, message) => {
    expect(() => parseOtpauthUri(uri)).toThrow(message);
  });

  it('round-trips a config back to a URI', () => {
    const original = parseOtpauthUri(
      'otpauth://totp/GitHub:me?secret=MZXW6YTBOI&issuer=GitHub&algorithm=SHA256&digits=8&period=60',
    );
    const reparsed = parseOtpauthUri(toOtpauthUri(original));

    expect(Array.from(reparsed.secret)).toEqual(Array.from(original.secret));
    expect(reparsed.algorithm).toBe(original.algorithm);
    expect(reparsed.digits).toBe(original.digits);
    expect(reparsed.periodSeconds).toBe(original.periodSeconds);
    expect(reparsed.issuer).toBe(original.issuer);
  });
});

describe('countdown', () => {
  it('counts down within the period and resets at the boundary', () => {
    const config = fromBase32Secret('MZXW6YTBOI');

    expect(secondsRemaining(config, 0)).toBe(30);
    expect(secondsRemaining(config, 1_000)).toBe(29);
    expect(secondsRemaining(config, 29_000)).toBe(1);
    expect(secondsRemaining(config, 30_000)).toBe(30);
  });

  it('holds the same code for a whole period, then changes', async () => {
    const config = fromBase32Secret('MZXW6YTBOI');

    const atStart = await generateTotp(config, 30_000);
    const atEnd = await generateTotp(config, 59_999);
    const afterRollover = await generateTotp(config, 60_000);

    expect(atEnd).toBe(atStart);
    expect(afterRollover).not.toBe(atStart);
  });
});

describe('parameter validation', () => {
  const config = fromBase32Secret('MZXW6YTBOI');

  it.each([
    [{ digits: 5 }, /Digits must be/],
    [{ digits: 11 }, /Digits must be/],
    [{ periodSeconds: 0 }, /Period must be/],
  ])('rejects %o', async (overrides, message) => {
    await expect(generateTotp({ ...config, ...overrides })).rejects.toThrow(message);
  });

  it('rejects an empty secret', async () => {
    await expect(generateTotp({ ...config, secret: new Uint8Array() })).rejects.toThrow(/empty/i);
  });
});
