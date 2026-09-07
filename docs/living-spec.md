# Living Spec — sar-vault

Running record of agreed scope and design decisions. Updated whenever something
changes. If a decision here conflicts with code, this document is wrong — fix it.

**Last updated:** 2026-09-07
**Phase:** Design (no implementation yet)

---

## 1. Product definition

A client-only, zero-knowledge password manager. The vault is a single encrypted file
stored in user-controlled storage. No backend exists at any point in the
architecture.

**Non-goals (explicitly out of scope):**
- Hosting vaults, accounts, or any server-side state
- Team/organisation sharing, SSO, admin consoles
- Browser extension for autofill (may be reconsidered post-v1)
- Native mobile apps (PWA only)

---

## 2. Decisions made

| # | Decision | Date | Notes |
| --- | --- | --- | --- |
| D-001 | Repository name: `sar-vault` | 2026-09-07 | Fits `sar-` namespace |
| D-002 | MIT license | 2026-09-07 | |
| D-003 | No backend, no telemetry, no third-party runtime calls | 2026-09-07 | Hard constraint, not a preference |
| D-004 | Never hand-roll crypto primitives | 2026-09-07 | WebCrypto + vetted libs only |

---

## 3. Open decisions

| # | Question | Options | Status |
| --- | --- | --- | --- |
| Q-001 | Vault format | Implement KDBX 4 · use `kdbxweb` · custom documented format | **Open — decide first** |
| Q-002 | AEAD choice | AES-256-GCM (WebCrypto native) vs ChaCha20-Poly1305 (library) | Open |
| Q-003 | Argon2id parameters | Memory / iterations / parallelism; behaviour on low-end devices | Open |
| Q-004 | Sync conflict strategy | ETag + last-write-wins vs entry-level merge vs KDBX merge semantics | Open |
| Q-005 | OAuth token storage | In-memory only vs sessionStorage vs IndexedDB; refresh-token handling without a backend | Open |
| Q-006 | Attachments in v1? | In scope vs deferred | Leaning defer |
| Q-007 | Unit test runner | Vitest vs Jest vs Karma | Open |

---

## 4. Layer contracts

Interfaces are the seams that let requirements change without rippling. Signatures
below are indicative and will be finalised with the code.

### Storage provider

```ts
interface StorageProvider {
  readonly id: string;
  readonly displayName: string;
  list(path?: string): Promise<VaultFileRef[]>;
  read(ref: VaultFileRef): Promise<{ data: ArrayBuffer; version: string }>;
  write(ref: VaultFileRef, data: ArrayBuffer, expectedVersion?: string): Promise<{ version: string }>;
  getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata>;
}
```

Adding a provider means implementing this interface and registering it. Nothing else
in the codebase changes. Providers receive ciphertext only — they never see plaintext
or keys.

### Crypto

```ts
interface KeyDerivation {
  readonly id: 'argon2id' | 'pbkdf2';
  deriveKey(password: Uint8Array, salt: Uint8Array, params: KdfParams): Promise<CryptoKey>;
}

interface AeadCipher {
  readonly id: 'aes-256-gcm' | 'chacha20-poly1305';
  encrypt(key: CryptoKey, plaintext: Uint8Array, aad?: Uint8Array): Promise<SealedData>;
  decrypt(key: CryptoKey, sealed: SealedData, aad?: Uint8Array): Promise<Uint8Array>;
}
```

### Vault format

```ts
interface VaultFormat {
  readonly id: string;
  readonly version: string;
  canParse(data: ArrayBuffer): boolean;
  parse(data: ArrayBuffer, credentials: VaultCredentials): Promise<Vault>;
  serialize(vault: Vault, credentials: VaultCredentials): Promise<ArrayBuffer>;
}
```

---

## 5. Change protocol

When a requirement changes, record here **before** implementing:

1. What changed and why
2. Which layers are affected
3. Whether existing vault files remain readable — **backward compatibility for vault
   format changes is flagged explicitly, every time**
4. Whether stored OAuth tokens are invalidated
5. Which tests and docs need updating

Format changes that break existing vaults require a migration path or a major version
bump. There is no exception to this.

---

## 6. Change log

| Date | Change | Impact |
| --- | --- | --- |
| 2026-09-07 | Repository initialised, scaffold committed | None — no code yet |
