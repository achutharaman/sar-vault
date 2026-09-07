import { describe, expect, it } from 'vitest';

import {
  base64UrlEncode,
  createPkcePair,
  createState,
  createVerifier,
  deriveChallenge,
} from './pkce';

describe('PKCE (RFC 7636)', () => {
  /*
   * The published vector from RFC 7636 Appendix B. This is the one assertion
   * that proves the implementation is actually PKCE and not merely
   * self-consistent — a wrong-but-consistent encoding would sail through every
   * round-trip test and then fail against a real provider with an opaque
   * "invalid_grant".
   */
  it('reproduces the RFC 7636 Appendix B vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    expect(await deriveChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('encodes base64url without padding or URL-unsafe characters', () => {
    // Bytes chosen to force both '+' and '/' in standard base64.
    const bytes = new Uint8Array([0xfb, 0xff, 0xbe, 0xff, 0xef]);

    const encoded = base64UrlEncode(bytes);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
    expect(encoded).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('produces verifiers within the length RFC 7636 section 4.1 allows', () => {
    for (let i = 0; i < 20; i++) {
      const verifier = createVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it('never repeats a verifier or a state', () => {
    const verifiers = new Set<string>();
    const states = new Set<string>();
    for (let i = 0; i < 100; i++) {
      verifiers.add(createVerifier());
      states.add(createState());
    }
    expect(verifiers.size).toBe(100);
    expect(states.size).toBe(100);
  });

  it('pairs a verifier with its own challenge, and always uses S256', async () => {
    const pair = await createPkcePair();

    expect(pair.method).toBe('S256');
    expect(pair.challenge).toBe(await deriveChallenge(pair.verifier));
    // The challenge must not be the verifier: sending the secret itself is the
    // `plain` method, which provides no protection at all.
    expect(pair.challenge).not.toBe(pair.verifier);
  });
});
