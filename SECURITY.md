# Security Policy

## ⚠️ Status: unaudited

sar-vault has **not** been independently audited, penetration tested, or formally
reviewed. It is a personal engineering project. Treat it as such. Do not put
credentials in it that you cannot afford to lose or have exposed.

---

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Use GitHub's private vulnerability reporting on this repository
(Security → Report a vulnerability), or email the address listed on the maintainer's
GitHub profile.

Please include: affected version or commit, reproduction steps, impact assessment,
and any proof-of-concept. Expect an acknowledgement within 7 days. Since this is a
side project maintained by one person, please allow reasonable time before public
disclosure — 90 days is the default expectation, and I'm happy to credit reporters.

---

## Threat model

> **Published 2026-09-07**, before implementation, deliberately. It is revised
> whenever a decision in [docs/living-spec.md](docs/living-spec.md) changes what is
> true here — the change protocol in that document requires it.

### Assets being protected

| Asset | Where it lives | Protection |
| --- | --- | --- |
| Vault contents (credentials, notes, TOTP seeds) | Encrypted file in user's cloud/disk | AEAD encryption, key derived from master password |
| Master password | User's head; transiently in browser memory | Never transmitted, never persisted |
| Derived encryption key | Browser memory only, while unlocked | Discarded on lock. See "Key material and KDBX 4" below — the KDBX format rules out non-extractable keys |
| OAuth tokens for storage providers | Browser storage | Narrowest possible scope (app-folder only) |

### Adversaries considered

| Adversary | Capability | Are we resistant? |
| --- | --- | --- |
| Cloud storage provider | Reads the vault file at rest | ✅ Yes — file is encrypted client-side; provider sees ciphertext |
| Network attacker (passive) | Observes traffic | ✅ Yes — TLS, plus vault is already encrypted |
| Network attacker (active / MITM) | Modifies traffic, serves altered app | ⚠️ Partial — HTTPS + HSTS + SRI, but see "Hosted-app problem" |
| Thief with the vault file | Offline brute force | ⚠️ Depends entirely on master password strength and KDF parameters |
| Malicious browser extension | Reads page DOM and memory | ❌ **No.** Total compromise. |
| XSS in the app | Executes JS in origin | ❌ **No.** Total compromise. Mitigated by strict CSP, not eliminated. |
| Local malware / keylogger | Reads keystrokes, process memory | ❌ **No.** Out of scope for any password manager. |
| Compromised host / maintainer | Serves backdoored app bundle | ❌ **No.** See below. |

### What this does NOT protect against — read this

These are inherent to *any* password manager that runs in a browser. They are stated
plainly here rather than buried.

**1. The hosted-app problem.**
Unlike a native app you install once and can pin, a web app is re-delivered on every
visit. If the hosting origin is compromised — or the maintainer is coerced — a
backdoored bundle can exfiltrate your master password on next unlock, and you would
have no way to notice. Mitigations (SRI, reproducible builds, published bundle
hashes) reduce but do not remove this. Users who need to eliminate it should
self-host from a build they verified, or use a native client such as KeePassXC.

**2. JavaScript has no secure memory.**
There is no `mlock`, no guaranteed zeroing, no protection from swap. Strings are
immutable and the garbage collector may copy them freely. We use `ArrayBuffer` /
`Uint8Array` for secret material and overwrite it on lock — but raw key bytes do
enter JS memory, because KDBX 4 requires it (see point 8), and **we cannot promise
that a copy of your master password isn't sitting in a heap page somewhere.**

**3. XSS is game over.**
A single script injection in the app's origin can read the unlocked vault, hook the
unlock form, or exfiltrate the derived key. A strict Content-Security-Policy, no
`eval`, no inline scripts, no third-party CDN, and no `innerHTML` on untrusted data
are hard requirements — but a mitigation is not an immunity.

**4. Browser extensions run in your origin.**
Any extension with host permissions can do everything XSS can. This is unavoidable in
a browser context.

**5. Your master password is the whole ballgame.**
Argon2id makes offline guessing expensive, not impossible. A weak master password
against a stolen vault file is a matter of time and money. The KDF buys you
work-factor, not magic.

**6. Metadata leaks to your storage provider.**
The provider cannot read your entries, but it sees file size, modification times, and
access patterns. Roughly: how many secrets you have and how often you touch them.

**7. Clipboard is not private.**
Copying a password puts it somewhere other applications, and on some platforms other
devices, can read. Auto-clear reduces the window; it does not close it.

**8. Key material and KDBX 4.**
An earlier draft of this document said derived keys would live in non-extractable
`CryptoKey` objects "where possible". Choosing KDBX 4 for interoperability
([D-006](docs/living-spec.md)) makes that largely impossible, and it is better to say
so than to leave the aspiration standing. KDBX derives its composite key, HMAC block
keys and master key by chaining SHA-256/512 over raw bytes, so those bytes must exist
in JavaScript memory by construction. We still overwrite buffers on lock and keep
secrets in `Uint8Array` rather than strings, but the guarantee is weaker than
"the key never enters JS memory", and pretending otherwise would be dishonest.

---

## Application delivery and build integrity

The threat model above names the hosted-app problem as the risk we cannot eliminate.
These are the controls that narrow it. None of them is a substitute for verifying
your own build.

**Content-Security-Policy.** Declared in `index.html` so that development and
production enforce the same policy, with `frame-ancestors`, HSTS and `Referrer-Policy`
added as real headers at the host. `script-src` is `'self' 'wasm-unsafe-eval'` —
the WASM allowance is required because Argon2id ships as WebAssembly and
`WebAssembly.instantiate` is otherwise blocked.

`style-src` permits `'unsafe-inline'`. Angular injects component styles as inline
`<style>` elements at runtime, and the framework's remedy (`ngCspNonce`) needs a
per-request nonce, which needs a server — excluded by design. Style injection is a
materially lower-severity hole than script injection, but it is a concession and is
recorded as one ([D-009](docs/living-spec.md)). An end-to-end test asserts the policy
on every run, so widening it is a visible decision rather than silent drift.

**Dependencies.** Every dependency is attack surface in a password manager, so the
count is kept small and each one is justified in review. `kdbxweb` carries Node-only
fallbacks for XML parsing and hashing that are unreachable in a browser; both are
replaced at build time by local stubs, and a post-build check fails the build if the
real packages reappear in the output ([D-007](docs/living-spec.md)). This removes a
transitive XML parser with known injection advisories from the shipped bundle
entirely, rather than shipping code we never call.

**CI.** GitHub Actions are pinned by commit SHA rather than by mutable version tag.
A tag can be repointed by whoever controls the action's repository, and that code
runs with this repository's context — the same delivery-channel problem the hosted
app has.

**Not yet done.** Reproducible builds and published bundle hashes are the meaningful
mitigation for the hosted-app problem and are **not implemented**. Until they are,
a user who needs to eliminate that risk should self-host from a build they verified,
or use a native client such as KeePassXC.

---

## Cryptographic design (planned)

| Concern | Choice | Rationale |
| --- | --- | --- |
| Key derivation | Argon2id (WASM), PBKDF2-HMAC-SHA256 fallback | Memory-hard; resists GPU/ASIC cracking. Fallback documented as weaker. |
| Symmetric encryption | AEAD — AES-256-GCM or ChaCha20-Poly1305 | Authenticated encryption; tampering is detected, not just decryption failure |
| Randomness | `crypto.getRandomValues()` only | CSPRNG; never `Math.random()` |
| Salts / nonces | Fresh per operation, never reused | Nonce reuse under GCM is catastrophic |
| Integrity | Authentication tag verified before any parsing | Never parse unauthenticated plaintext |
| Vault format | KDBX 4 via `kdbxweb` | Interoperable with KeePassXC, KeePassDX and Strongbox — no lock-in, and no proprietary export path |

Decisions are recorded with reasoning in [docs/living-spec.md](docs/living-spec.md).
All crypto and format code is covered by known-answer test vectors.

---

## Supported versions

Pre-release. Only the latest commit on `main` is supported. Once tagged releases
exist, this table will list them.

| Version | Supported |
| --- | --- |
| `main` | ✅ |
| Everything else | ❌ |
