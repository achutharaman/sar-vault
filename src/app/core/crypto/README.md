# Crypto layer

Pure functions over `Uint8Array`. No DOM, no Angular, no I/O, and no knowledge of
what a vault is (docs/architecture.md).

Responsibilities: key derivation, AEAD seal/open, secure random generation,
constant-time comparison.

The boundary is enforced by ESLint (`no-restricted-imports` in `eslint.config.js`),
not by convention — an `@angular/core` import here fails `npm run lint`.

Every primitive added here requires published known-answer vectors, per
CONTRIBUTING.md hard rule 5. Vectors live in `fixtures/` and are exempt from the
`*.txt` ignore rule in `.gitignore`.
