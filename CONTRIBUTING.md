# Contributing to sar-vault

Thanks for taking an interest. This is a security-sensitive project, so a few rules
are stricter than you might expect elsewhere.

## Before you start

- **Security vulnerabilities do not go in public issues.** See [SECURITY.md](SECURITY.md).
- For anything beyond a small fix, open an issue first. Design decisions are tracked
  in [docs/living-spec.md](docs/living-spec.md) — read it so a PR doesn't contradict
  an existing decision.

## Hard rules

These are not negotiable, and a PR that breaks one will be closed regardless of how
good the rest of it is.

1. **No hand-rolled cryptography.** No custom ciphers, no custom KDFs, no custom
   padding, no clever XOR. WebCrypto and vetted libraries only.
2. **No new runtime third-party network calls.** No CDN scripts, no hosted fonts, no
   analytics, no error-reporting services. The app talks to the user's chosen storage
   provider and nothing else.
3. **No plaintext leaves the crypto boundary.** Storage providers handle ciphertext.
   Logging secret material — even in dev builds — is not acceptable.
4. **No new dependency without justification.** Every dependency is attack surface in
   a password manager. Say in the PR why it's needed and why a smaller/no-dependency
   option won't do.
5. **Crypto and format code requires known-answer test vectors.** Not "it round-trips
   in my test" — actual published vectors, or vectors verified against a reference
   implementation.
6. **`innerHTML`, `eval`, `Function()`, and `bypassSecurityTrust*` are banned** unless
   there's an explicit, reviewed reason.

## Development setup

```bash
nvm use          # Node version from .nvmrc
npm ci
npm start
```

## Before opening a PR

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=moderate
```

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(crypto): add Argon2id parameter auto-tuning
fix(gdrive): handle 412 on ETag mismatch during save
docs(security): expand XSS section of threat model
test(kdbx): add KAT vectors for AES-KDF variant
```

Scopes in use: `crypto`, `format`, `storage`, `ui`, `pwa`, `ci`, `docs`.

## Pull requests

- One logical change per PR.
- Every step should leave the app runnable with passing tests.
- If you change the vault format, say so loudly in the PR title and describe the
  backward-compatibility impact. Format changes that break existing vaults need a
  migration path.
- If you change anything in the crypto layer, explain the security reasoning. Expect
  it to be challenged — that's the point, not hostility.
- Update [docs/living-spec.md](docs/living-spec.md) if your change alters an agreed
  decision.

## Code style

Enforced by ESLint and Prettier; `npm run lint` is the source of truth. Beyond that:
strict TypeScript, no `any` without a comment justifying it, signals over RxJS for
component state, standalone components only.

## Licensing

Contributions are licensed under the [MIT License](LICENSE).
