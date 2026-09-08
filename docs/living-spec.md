# Living Spec — sar-vault

Running record of agreed scope and design decisions. Updated whenever something
changes. If a decision here conflicts with code, this document is wrong — fix it.

**Last updated:** 2026-09-07
**Phase:** v0.2 (cloud) implemented — OAuth PKCE, Google Drive, OneDrive, conflict detection

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
| D-005 | Unit test runner: Vitest via `@angular/build:unit-test` | 2026-09-07 | Resolves Q-007. It is the Angular 22 default (`ng new --test-runner` enum is `vitest\|karma`), so this is the low-friction path, not a preference |
| D-006 | Vault format: KDBX 4 via `kdbxweb` 2.1.1 (MIT) | 2026-09-07 | Resolves Q-001. Keeps KeePassXC / KeePassDX / Strongbox interop. Ships **no** Argon2 — it is injected via `CryptoEngine.setArgon2Impl()`, so the crypto layer retains ownership of the KDF as architecture.md requires |
| D-007 | Replace kdbxweb's Node-only fallbacks (`@xmldom/xmldom` and Node `crypto`) with local stub packages in `tools/stubs/` | 2026-09-07 | kdbxweb 2.1.1 pulls `@xmldom/xmldom@^0.7.4` (resolves 0.7.13), carrying 6 advisories (1 high, 1 moderate) that fail the `npm audit --audit-level=moderate` gate; its UMD wrapper also `require`s Node's `crypto`, which breaks a browser build outright. Both are unreachable in a browser (`createDOMParser()` prefers `globalThis.DOMParser`; every hash/cipher call prefers `globalThis.crypto.subtle`). **A tsconfig `paths` mapping does not work** — it does not intercept `require` calls inside a prebuilt dependency. The working mechanism is npm resolution: a local `file:` package for `crypto` plus an `overrides` entry for `@xmldom/xmldom`. Verified: bundle 451.93 kB → 358.53 kB, real-xmldom sentinels absent, `npm audit` clean. Stubbing Node crypto additionally guarantees kdbxweb cannot silently fall back off WebCrypto. Enforced by `npm run verify:bundle` |
| D-008 | Unit tests run in real Chromium (Vitest browser mode) | 2026-09-07 | Known-answer vectors must be certified against real WebCrypto and real `WebAssembly.instantiate`, not jsdom shims. Reuses the Playwright browser already installed for E2E |
| D-009 | CSP: strict `script-src 'self' 'wasm-unsafe-eval'`; `style-src` permits `'unsafe-inline'` | 2026-09-07 | Argon2id WASM cannot instantiate without `wasm-unsafe-eval`. Angular injects component styles at runtime; the framework remedy (`ngCspNonce`) needs per-request nonce generation, which requires a server and is excluded by D-003. Script injection stays strictly controlled; the style-src concession is documented in SECURITY.md per design principle 4 |
| D-010 | Layer boundaries enforced by ESLint `no-restricted-imports`, scoped by path | 2026-09-07 | Makes architecture.md's four-layer rule mechanical rather than review-dependent. Uses a built-in rule, so it adds no dependency under hard rule #4 |
| D-011 | GitHub Actions pinned by commit SHA, not by version tag | 2026-09-07 | A tag is mutable and the action then runs with this repository's context — the same delivery-channel risk SECURITY.md describes for the hosted app. Dependabot maintains SHA pins and the trailing version comment |
| D-012 | Prettier does not format Markdown | 2026-09-07 | It pads tables well beyond the 100-column limit set in `.editorconfig` and rewrites `*emphasis*` to `_emphasis_`. The docs are hand-wrapped and are currently the project's main artifact; code remains Prettier-owned |
| D-013 | `strict` and `noUncheckedIndexedAccess` set explicitly in tsconfig | 2026-09-07 | `ng new --strict` does not actually emit `strict`, despite CONTRIBUTING requiring it. `noUncheckedIndexedAccess` types `bytes[i]` as `number \| undefined`, which is the right default for code that indexes byte arrays constantly — it caught an unchecked index in the first spec written |
| D-014 | Argon2id via `hash-wasm` 4.12.0 (MIT) | 2026-09-07 | Resolves Q-009. Hand-tuned WASM, and carries PBKDF2 for the documented fallback in the same dependency, so it costs one entry under hard rule #4 rather than two. `argon2-browser`, the alternative, has not shipped since 2022-04 |
| D-015 | Argon2 vectors verified through a two-step chain, with `@noble/hashes` as a dev-only cross-check | 2026-09-07 | RFC 9106's Argon2id vector uses associated data, which hash-wasm cannot express, so it cannot be evaluated against the implementation we ship. Instead `@noble/hashes` is asserted to reproduce the RFC vector exactly, and hash-wasm is asserted to agree with noble byte-for-byte on KDBX-shaped parameters. Satisfies hard rule #5 without self-generated digests |
| D-016 | New vaults are written with Argon2**id**, not kdbxweb's Argon2**d** default | 2026-09-07 | SECURITY.md commits to Argon2id, and RFC 9106 names it the default choice. Set explicitly via `header.setKdf`. Existing vaults keep whatever KDF they were written with |
| D-017 | The parsed `Kdbx` object is the source of truth; the domain model is a read-only projection | 2026-09-07 | Rebuilding a KDBX file from our simplified model would silently drop entry history, attachments, custom fields, icons and auto-type rules that KeePassXC wrote — data loss discovered only in another client, long after the fact. All mutations edit the parsed object. Covered by a test that a custom field survives an edit and save |
| D-018 | The recycle bin is excluded from the domain projection | 2026-09-07 | KDBX deletion is a move, not an erase. Without this, deleted entries keep appearing in the list — caught by a test rather than by review |
| D-019 | Google Drive uses the `drive.file` scope, not `drive.appdata` | 2026-09-07 | Resolves Q-008. `appdata` is a hidden folder: the user cannot see, back up, or open their own vault in KeePassXC, which contradicts the project's central claim. `drive.file` keeps the vault visible in their Drive. The cost is that adopting a *pre-existing* Drive file needs Google's Picker, which loads third-party script and is barred by hard rule #2 and by our CSP — so the app only handles files it created. Importing means opening locally and saving up |
| D-020 | OAuth access tokens are held in memory only; no refresh tokens | 2026-09-07 | Resolves Q-005. Persisting a token would leave a credential for the user's cloud storage on disk, readable by any XSS — and SECURITY.md already states an XSS here is a total compromise, so this avoids widening what that compromise yields. Cost: reconnecting each session. Google does not issue refresh tokens to public browser clients without a secret anyway. The PKCE *verifier* does use `sessionStorage`, because the redirect destroys the page — it is tab-scoped, single-use, and useless without the matching code |
| D-021 | Conflict detection: version token compared on write; the write is refused, never merged | 2026-09-07 | Resolves Q-004 for v0.2. OneDrive uses a true conditional write (`if-match` on cTag → 412), so the check is atomic. Drive v3 has no `If-Match` on upload, so it is read-then-compare with a small race window — Google's limitation, recorded rather than hidden. Entry-level merge stays in **Later** as the roadmap has it |
| D-026 | The password generator draws with rejection sampling, and enforces class coverage by re-drawing | 2026-09-07 | `randomByte % poolSize` is biased whenever the pool does not divide 256 — for a 26-character alphabet the low indices come up ~11% more often, which is a real distortion of the keyspace. Enforcing "one of each class" by fixing positions would be worse still: it makes those positions predictable. Both are covered by tests, including a distribution check |
| D-027 | TOTP is pinned to the RFC 6238 published vectors across SHA1/256/512, including T=20000000000 | 2026-09-07 | That timestamp exceeds 2^31 seconds and is in the RFC's table precisely to catch a 32-bit counter overflow; the counter is computed with BigInt because of it. Without published vectors an implementation can be perfectly self-consistent and still disagree with every authenticator app |
| D-032 | Custom generator presets live in the vault's `Meta/CustomData`; the built-ins live in code | 2026-09-07 | `localStorage` stranded presets in one browser on one device — the opposite of a vault you carry between machines. KDBX defines `Meta/CustomData` as a namespaced key-value store for exactly this, and other clients preserve keys they do not recognise. Built-ins stay in code so every vault has a known-good set that a bad edit cannot break, and so a preset added in a later release reaches everyone without a migration. Consequences, both surfaced in the UI: changing a preset marks the vault dirty, and with no vault open only the built-ins exist |
| D-031 | The generator preset chosen in the editor is sticky for that editing session, and resets to the default when a different entry is opened | 2026-09-07 | Previously the dropdown generated with the chosen preset once and every later press of Generate reverted to the default, which made the control look broken. Generate now uses whatever is selected; the menu lists every preset (marking the active one and the default) so the user can switch back. Reset happens in the same `untracked` block as the rest of the form reset, so changing the default in Settings cannot wipe an in-progress edit |
| D-030 | Settings is a routed page (`/settings`), not a collapsible panel | 2026-09-07 | A panel over the vault gave settings no URL, no browser Back, and no way to bookmark or reload it, while leaving the vault visible behind a configuration form. Routing also removes the manual `location.pathname` handling the OAuth callback needed. The locked check stays in the shell rather than a route guard, so an idle lock replaces whatever page is open immediately — a guard only runs on navigation. Note this makes the SPA rewrite in `public/_redirects` load-bearing for `/settings` too, not only OAuth |
| D-029 | Generator configuration lives in Settings as named presets, with one default; the editor offers a split button | 2026-09-07 | The full option form inside the entry editor turned a routine action into a configuration task on every use. Presets move it to Settings: the main half of the button generates from the default in one click, the caret offers the rest. Presets persist in `localStorage`, which is acceptable **only** because they hold no secret material — lengths and character-class flags. Stored state is validated on read, since it is user-writable and a malformed preset would make the button throw |
| D-028 | `pushHistory()` is called **before** applying an edit | 2026-09-07 | It snapshots the entry's current state, so calling it afterwards records the new value and loses the old one — defeating the only purpose of password history, which is recovering the password you just replaced. Caught by a test, not by review |
| D-025 | Host config (`_headers`, `_redirects`) is committed under `public/` and asserted by `verify:bundle` | 2026-09-07 | The OAuth redirect URI is a client-side route, so without an SPA rewrite a static host 404s it and cloud storage can never be connected — a total feature failure with no error message. `frame-ancestors` is likewise unavailable to the meta-tag CSP. Both were documented as "set at the host" and set nowhere. Asserting them in the build turns a deployment step someone must remember into something CI checks |
| D-024 | `create()` is on the `CloudStorageProvider` base class, and `save()` calls it for a new vault | 2026-09-07 | It is the *entry point* for cloud storage, not an optional extra: with `drive.file` and the OneDrive app folder a provider can only see files it created, so without this `list()` stays empty forever and the cloud is unreachable. It had been written on the concrete providers and called from nowhere — every provider test passed while the feature was unusable, because nothing covered the service/provider seam. That seam now has its own spec |
| D-023 | The xmldom stub is a direct devDependency plus a `$`-reference override, never a bare `file:` in `overrides` | 2026-09-07 | A `file:` spec inside `overrides` is resolved **relative to the dependent package** by npm 10 — it produced `node_modules/@xmldom/xmldom -> ../kdbxweb/tools/stubs/xmldom`, a dangling symlink, while npm 11 resolved it from the project root and worked. CI (Node 22 / npm 10) failed while local dev (Node 24 / npm 11) passed. `"@xmldom/xmldom": "$@xmldom/xmldom"` reuses the spec from our own devDependencies, which resolves identically on both |
| D-022 | OAuth client IDs injected at build time by a 12-line script, not a plugin | 2026-09-07 | `.env.example` already established the `NG_APP_*` convention, but Angular has no built-in env injection and a plugin would be another dependency to justify under hard rule #4. `scripts/generate-env.mjs` reads only allow-listed `NG_APP_*` keys, so an unrelated secret in `.env` cannot be swept into the bundle |

---

## 3. Open decisions

| # | Question | Options | Status |
| --- | --- | --- | --- |
| Q-001 | Vault format | Implement KDBX 4 · use `kdbxweb` · custom documented format | **Open — decide first** |
| Q-002 | AEAD choice | AES-256-GCM (WebCrypto native) vs ChaCha20-Poly1305 (library) | **Largely moot for the vault itself** — KDBX 4 defines its own construction and kdbxweb implements it. Still open for anything we encrypt outside the vault file |
| Q-003 | Argon2id parameters | Memory / iterations / parallelism; behaviour on low-end devices | Open — new vaults currently take kdbxweb's defaults. Needs a deliberate choice plus a fallback for low-memory devices |
| Q-006 | Attachments in v1? | In scope vs deferred | Leaning defer |
| Q-013 | Adopting a pre-existing cloud vault | Google's Picker is barred by hard rule #2. Options: keep create-only, allow an upload-then-save path, or revisit the rule | Open — today the workaround is to open the file locally and save it to the cloud |
| Q-011 | Argon2 on the UI thread | Whether key derivation moves to a Web Worker, and how progress is reported | Open — derivation currently blocks the UI thread. Tolerable at kdbxweb's default cost, not at the higher parameters Q-003 may choose |
| Q-012 | Passwords as strings in the domain model | Whether to carry secrets as `Uint8Array` with an explicit reveal step instead | Open — the UI must display and edit them, so v0.1 accepts strings; SECURITY.md records why that is a weakening |
| Q-010 | Reproducible builds and published bundle hashes | How to produce and publish them; whether to document a verification procedure for users | Open — SECURITY.md names this as the mitigation for the hosted-app problem and currently records it as not implemented |

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
| 2026-09-07 | Q-007 resolved as Vitest (D-005) | Test tooling only; no vault format impact |
| 2026-09-07 | Q-001 resolved as KDBX 4 via `kdbxweb` (D-006) | Vault files will be KDBX 4, readable by KeePassXC. No existing vaults to migrate. Argon2id still owned by the crypto layer |
| 2026-09-07 | Supply-chain and CSP decisions recorded (D-007 … D-010) | Build and CI configuration; no vault format or token impact |
| 2026-09-07 | Phase 0 implemented: Angular 22 workspace, Vitest in real Chromium, ESLint hard-rule and layer enforcement, Playwright, CSP, bundle verification, CI rewrite | No vault format or token impact — no vault code exists yet |
| 2026-09-07 | D-007 mechanism corrected after testing: tsconfig `paths` does not intercept requires inside kdbxweb's UMD dist; replaced with npm-level stub packages | Build only |
| 2026-09-07 | Threat model published (SECURITY.md); non-extractable-key claim withdrawn as unachievable under KDBX 4 | Documentation — corrects a claim that D-006 made untrue |
| 2026-09-07 | Phase 1 implemented: crypto (Argon2id), format (KDBX 4), storage (local file), vault service, and the unlock/browse/edit/save UI | **Vault format is now real.** Files written are KDBX 4 with Argon2id, readable by KeePassXC. No existing vaults to migrate |
| 2026-09-07 | Q-009 resolved as hash-wasm (D-014); Q-002 and Q-003 reassessed in light of KDBX owning its own AEAD | No token impact |
| 2026-09-07 | v0.2 implemented: OAuth 2.0 with PKCE, Google Drive, OneDrive, provider registry, version-based conflict detection | **Stored OAuth tokens are not invalidated — because none are stored** (D-020). No vault format change; files written to cloud storage are the same KDBX 4 as local ones |
| 2026-09-07 | Q-004, Q-005 and Q-008 resolved (D-019 … D-021); CSP `connect-src` widened to the four provider origins and nothing else | The CSP change is asserted by an e2e test, so adding any further origin fails CI |
| 2026-09-07 | Fixed the xmldom override so it resolves on npm 10 as well as npm 11 (D-023) | Build/test only. The dangling symlink made kdbxweb's eager `require` fail at import, breaking three test suites on CI while passing locally |
| 2026-09-07 | Custom presets moved from `localStorage` into the vault file (D-032) | **Vault content change, additive.** Presets are written to `Meta/CustomData` under `sar-vault.generator`. Existing vaults are unaffected — absent settings mean built-ins only. Other KeePass clients carry the key through their own saves without acting on it. Any presets a user had in `localStorage` are not migrated and will need recreating |
| 2026-09-07 | Fixed: the editor's preset selection now sticks across repeated Generate presses (D-031) | UI only |
| 2026-09-07 | Settings moved to its own route; the shell now hosts a router-outlet and owns only the locked/unlocked switch and the OAuth redirect (D-030) | UI only. Deployment note: the SPA fallback now matters for `/settings` as well as `/auth/callback` |
| 2026-09-07 | Generator reworked into named presets managed in Settings, with a default and a split-button picker in the editor (D-029) | UI and preferences only. No vault format or token impact; presets are stored separately from the vault and contain no secrets |
| 2026-09-07 | v0.3 implemented: password generator, TOTP, tags, custom fields, password history, idle auto-lock, clipboard auto-clear, and importers for KeePass CSV/XML, Bitwarden JSON and browser CSV | **Vault format impact: additive.** Tags, custom fields and TOTP seeds are written to standard KDBX fields, so files stay readable by KeePassXC. TOTP is written as an `otp` otpauth URI; legacy KeePassXC `TOTP Seed`/`TOTP Settings` pairs are read but migrated on save |
| 2026-09-07 | Added host deployment config and docs/TODO.md for the remaining unproven work (D-025) | Deployment only. Live-endpoint verification remains outstanding and is now tracked rather than implied |
| 2026-09-07 | Closed the v0.1/v0.2 gaps: cloud `create()` wired into `save()` with a destination chooser (D-024), plus direct tests for `LocalFileProvider.write()` (both branches) and for the service/provider seam | No vault format or token impact. Cloud storage is reachable end to end for the first time; still unverified against real Google/Microsoft endpoints |
