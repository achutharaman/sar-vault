/**
 * Phase 0 environment smoke test.
 *
 * This proves the runtime the crypto layer will depend on is genuinely present
 * *before* Phase 1 starts relying on it. Per D-008 these run in real Chromium
 * rather than jsdom, because known-answer vectors verified against a shim only
 * prove the shim agrees with itself.
 *
 * It deliberately asserts nothing about sar-vault's own code — there is none yet.
 */
import { describe, expect, it } from 'vitest';

describe('crypto runtime', () => {
  it('exposes a CSPRNG', () => {
    const a = new Uint8Array(32);
    const b = new Uint8Array(32);
    crypto.getRandomValues(a);
    crypto.getRandomValues(b);

    // Compared as plain arrays: under jsdom, typed arrays from another realm
    // fail identity-based equality even when the bytes match.
    expect(Array.from(a)).not.toEqual(Array.from(new Uint8Array(32)));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('exposes SubtleCrypto and round-trips AES-256-GCM', async () => {
    expect(crypto.subtle).toBeDefined();

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('sar-vault');

    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed);

    expect(Array.from(new Uint8Array(opened))).toEqual(Array.from(plaintext));
  });

  it('detects tampering rather than returning garbage', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('x')),
    );

    // Flip a bit of the ciphertext. `noUncheckedIndexedAccess` types the read as
    // `number | undefined`, so the bound is established before mutating.
    expect(sealed.length).toBeGreaterThan(0);
    sealed[0] = (sealed[0] ?? 0) ^ 0xff;

    await expect(crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed)).rejects.toThrow();
  });

  it('supports non-extractable keys', async () => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
    ]);

    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });
});

describe('WebAssembly runtime', () => {
  // (module (func (export "add") (param i32 i32) (result i32)
  //   local.get 0 local.get 1 i32.add))
  const ADD_MODULE = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
    0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
    0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
  ]);

  it('validates and instantiates a module', async () => {
    // Argon2id ships as WASM (Q-009). Under a strict CSP this needs
    // 'wasm-unsafe-eval' in script-src — see D-009.
    expect(WebAssembly.validate(ADD_MODULE)).toBe(true);

    const { instance } = await WebAssembly.instantiate(ADD_MODULE);
    const add = instance.exports['add'] as (a: number, b: number) => number;

    expect(add(2, 3)).toBe(5);
  });
});
