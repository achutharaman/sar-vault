/**
 * PKCE (RFC 7636) for OAuth 2.0 authorization-code flows.
 *
 * A browser-only app cannot hold a client secret — anything shipped to the
 * browser is public. PKCE is what makes the authorization-code flow safe
 * without one: the app sends a hash of a random secret up front, then proves it
 * knows the original when redeeming the code. An attacker who intercepts the
 * code cannot exchange it.
 *
 * `.env.example` already spells this out: if a `*_SECRET` ever appears in this
 * app's configuration, the architecture has grown a backend.
 */

/** A verifier and the challenge derived from it. */
export interface PkcePair {
  /** The random secret, held until the token exchange. */
  readonly verifier: string;
  /** BASE64URL(SHA-256(verifier)), sent with the authorization request. */
  readonly challenge: string;
  /** Always `S256`. `plain` is permitted by RFC 7636 but offers no protection. */
  readonly method: 'S256';
}

/**
 * Base64url per RFC 4648 §5 — standard base64 with `+/` swapped for `-_` and
 * padding stripped. RFC 7636 requires this exact encoding; ordinary base64
 * would produce characters that are unsafe in a URL.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a code verifier: 32 random bytes, base64url-encoded to 43 chars.
 *
 * RFC 7636 §4.1 allows 43–128 characters and requires "sufficient entropy";
 * 256 bits is the recommended amount, and the spec's own example uses exactly
 * this construction.
 */
export function createVerifier(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

/** Derive the S256 challenge for a verifier. */
export async function deriveChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Generate a fresh verifier/challenge pair. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createVerifier();
  return {
    verifier,
    challenge: await deriveChallenge(verifier),
    method: 'S256',
  };
}

/**
 * An opaque value round-tripped through the provider to bind the callback to
 * the request that started it — the CSRF defence for the redirect.
 */
export function createState(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
}
