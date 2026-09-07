# Storage layer

Providers implement `StorageProvider` (docs/living-spec.md §4) and are registered at
startup. They receive and return **ciphertext only** — a provider bug cannot leak
plaintext because plaintext never reaches this layer. ESLint enforces that this
directory cannot import from `crypto/` or `format/`.

Version/ETag tokens returned by `read` are passed back on `write` for optimistic
concurrency; this is the foundation of conflict detection (Q-004).
