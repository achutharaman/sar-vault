/**
 * Time-based one-time passwords (RFC 6238), built on HOTP (RFC 4226).
 *
 * Pure over `Uint8Array` and WebCrypto — no DOM, no Angular, no vault knowledge.
 * The KDBX side of this (which field a seed lives in) belongs to the format
 * layer, not here.
 */

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512';

export interface TotpConfig {
  readonly secret: Uint8Array;
  readonly digits: number;
  readonly periodSeconds: number;
  readonly algorithm: TotpAlgorithm;
  /** Shown in the UI; carried through from an otpauth URI when present. */
  readonly issuer?: string;
  readonly label?: string;
}

/**
 * RFC 6238 §4 defaults. SHA1 is the default not because it is the strongest
 * hash, but because virtually every authenticator implements only this — a
 * "better" default would produce codes the user's other devices reject. HMAC-SHA1
 * remains sound; the weaknesses in SHA1 are collision attacks, which do not
 * apply to HMAC here.
 */
export const TOTP_DEFAULTS = {
  digits: 6,
  periodSeconds: 30,
  algorithm: 'SHA1' as TotpAlgorithm,
};

export class TotpError extends Error {
  override readonly name = 'TotpError';
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode RFC 4648 base32.
 *
 * Authenticator secrets are shared as base32, usually without padding and often
 * with spaces or lowercase from copy-paste, so all three are tolerated. A
 * character outside the alphabet is an error rather than something to skip —
 * silently ignoring it would yield a wrong secret and codes that never match,
 * with nothing to point at the cause.
 */
export function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();

  if (cleaned.length === 0) {
    throw new TotpError('The secret is empty.');
  }

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new TotpError(`"${char}" is not valid base32.`);
    }
    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

/** Encode bytes as base32, for round-tripping a secret back into a URI. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

/**
 * HOTP (RFC 4226 §5.3): HMAC the counter, then take a 4-byte window whose
 * offset is chosen by the low nibble of the final byte — the "dynamic
 * truncation" that stops the code depending on a fixed slice of the MAC.
 */
async function hotp(
  secret: Uint8Array,
  counter: bigint,
  digits: number,
  algorithm: TotpAlgorithm,
): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  // WebCrypto needs an ArrayBuffer-backed view; a plain `Uint8Array` widens to
  // `ArrayBufferLike`, which could be a SharedArrayBuffer. Copying also avoids
  // handing the key material a caller still holds a reference to.
  const keyBytes = new Uint8Array(secret.length);
  keyBytes.set(secret);

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: `SHA-${algorithm.slice(3)}` } },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    (((mac[offset + 1] ?? 0) & 0xff) << 16) |
    (((mac[offset + 2] ?? 0) & 0xff) << 8) |
    ((mac[offset + 3] ?? 0) & 0xff);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/** The current code for a config, at a given time (defaults to now). */
export async function generateTotp(config: TotpConfig, atMs: number = Date.now()): Promise<string> {
  if (config.digits < 6 || config.digits > 10) {
    throw new TotpError(`Digits must be 6..10, got ${config.digits}.`);
  }
  if (config.periodSeconds < 1) {
    throw new TotpError(`Period must be at least 1 second, got ${config.periodSeconds}.`);
  }
  if (config.secret.length === 0) {
    throw new TotpError('The secret is empty.');
  }

  const counter = BigInt(Math.floor(atMs / 1000 / config.periodSeconds));
  return hotp(config.secret, counter, config.digits, config.algorithm);
}

/** Seconds until the current code expires. */
export function secondsRemaining(config: TotpConfig, atMs: number = Date.now()): number {
  const seconds = Math.floor(atMs / 1000);
  return config.periodSeconds - (seconds % config.periodSeconds);
}

/**
 * Parse an `otpauth://totp/...` URI, the format every authenticator's QR code
 * encodes.
 *
 * Only `totp` is accepted — `hotp` is counter-based, and treating one as the
 * other would produce codes that never verify.
 */
export function parseOtpauthUri(uri: string): TotpConfig {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new TotpError('Not a valid otpauth URI.');
  }

  if (url.protocol !== 'otpauth:') {
    throw new TotpError(`Expected an otpauth: URI, got "${url.protocol}".`);
  }
  if (url.host.toLowerCase() !== 'totp') {
    throw new TotpError(`Only time-based (totp) codes are supported, got "${url.host}".`);
  }

  const secretParam = url.searchParams.get('secret');
  if (!secretParam) {
    throw new TotpError('The URI has no secret.');
  }

  const algorithmParam = (
    url.searchParams.get('algorithm') ?? TOTP_DEFAULTS.algorithm
  ).toUpperCase();
  if (algorithmParam !== 'SHA1' && algorithmParam !== 'SHA256' && algorithmParam !== 'SHA512') {
    throw new TotpError(`Unsupported algorithm "${algorithmParam}".`);
  }

  const label = decodeURIComponent(url.pathname.replace(/^\//, ''));

  return {
    secret: base32Decode(secretParam),
    digits: Number(url.searchParams.get('digits') ?? TOTP_DEFAULTS.digits),
    periodSeconds: Number(url.searchParams.get('period') ?? TOTP_DEFAULTS.periodSeconds),
    algorithm: algorithmParam,
    issuer:
      url.searchParams.get('issuer') ?? (label.includes(':') ? label.split(':')[0] : undefined),
    label: label || undefined,
  };
}

/** Build an otpauth URI, so a secret can be exported to another authenticator. */
export function toOtpauthUri(config: TotpConfig): string {
  const label = config.label ?? 'sar-vault';
  const params = new URLSearchParams({
    secret: base32Encode(config.secret),
    algorithm: config.algorithm,
    digits: String(config.digits),
    period: String(config.periodSeconds),
  });
  if (config.issuer) {
    params.set('issuer', config.issuer);
  }
  return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

/**
 * Build a config from a bare base32 secret, as older KeePassXC entries store it.
 */
export function fromBase32Secret(
  secret: string,
  overrides: Partial<Omit<TotpConfig, 'secret'>> = {},
): TotpConfig {
  return {
    secret: base32Decode(secret),
    digits: overrides.digits ?? TOTP_DEFAULTS.digits,
    periodSeconds: overrides.periodSeconds ?? TOTP_DEFAULTS.periodSeconds,
    algorithm: overrides.algorithm ?? TOTP_DEFAULTS.algorithm,
    ...(overrides.issuer !== undefined ? { issuer: overrides.issuer } : {}),
    ...(overrides.label !== undefined ? { label: overrides.label } : {}),
  };
}
