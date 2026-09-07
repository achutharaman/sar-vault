# Format layer

Translates between an encrypted byte stream and the in-memory `Vault` domain model.
Owns header parsing, KDF parameter storage, compression, and inner-stream protection.

Per D-006 this is KDBX 4 via `kdbxweb`. `kdbxweb` ships no Argon2 — the crypto layer
supplies one through `CryptoEngine.setArgon2Impl()`, so the KDF stays owned by the
layer below (see Q-009).

The authentication tag is verified **before** any parsing of decrypted content. We
never parse unauthenticated bytes.
