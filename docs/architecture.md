# Architecture

> Draft — expanded as the design settles. See [living-spec.md](living-spec.md) for
> open decisions.

## Principle

Four layers, each depending only on the one below it through an interface. The goal
is that changing the KDF, adding a storage provider, or swapping the vault format
touches exactly one layer.

```
UI  →  Vault service  →  Format layer  →  Crypto layer
                      →  Storage layer  →  Providers
```

## Crypto layer

Pure functions over `Uint8Array`. No DOM, no Angular, no I/O. This makes it trivially
testable against known-answer vectors and portable if it's ever extracted to a
standalone package.

Responsibilities: key derivation, AEAD seal/open, secure random generation, constant-
time comparison where needed.

Explicitly *not* its responsibility: knowing what a vault is.

## Format layer

Translates between an encrypted byte stream and the in-memory `Vault` domain model.
Owns header parsing, KDF parameter storage, compression, and inner-stream protection.

The authentication tag is verified **before** any parsing of decrypted content. We
never parse unauthenticated bytes.

## Storage layer

Providers implement one interface and are registered at startup. They receive and
return ciphertext. A provider bug cannot leak plaintext because plaintext never
reaches it.

Version/ETag tokens returned by `read` are passed back on `write` for optimistic
concurrency — this is the foundation of conflict detection.

## Vault service

The only stateful piece. Holds the unlocked vault and the derived key for the
duration of a session. Owns lock/unlock lifecycle, idle timeout, and the save/sync
cycle. Discards key material on lock.

## UI layer

Angular standalone components with signals. Reads the vault domain model, never
touches crypto or storage directly. Contains no security logic beyond input handling
and display.

## Session lifecycle

```
locked → [master password + optional key file]
       → derive key (Argon2id, may take ~1s)
       → fetch ciphertext from provider
       → verify tag → decrypt → parse
       → unlocked
       → [idle timeout | manual lock | tab close]
       → zero key material → locked
```
