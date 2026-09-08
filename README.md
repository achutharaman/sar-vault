# sar-vault

> Your passwords, your encryption, your cloud storage. No server in the middle.

**sar-vault** is a client-only password manager. The vault is a single encrypted
KDBX 4 file that lives in storage *you* control — Google Drive, OneDrive, Dropbox,
or your local disk. Encryption and decryption happen only in your browser. There is
no backend, no account to create, and no service that ever sees your master password
or your vault contents.

> [!WARNING]
> **This project is unaudited and under active development. Do not use it for real
> credentials yet.** Read [SECURITY.md](SECURITY.md) for the full threat model —
> including an honest list of what a browser-based password manager fundamentally
> *cannot* protect you from.

---

## Status

🚧 **Pre-alpha, and still unaudited.** v0.1 and v0.2 are implemented: the app opens,
edits and saves real KDBX 4 vaults, locally or in Google Drive / OneDrive. It has not
been reviewed by anyone but its author — see [SECURITY.md](SECURITY.md) before trusting
it with anything. See [docs/living-spec.md](docs/living-spec.md) for scope and decisions.

| Area | Status |
| --- | --- |
| Threat model | Published |
| Vault format decision (KDBX 4 vs custom) | Decided — KDBX 4 via `kdbxweb` |
| Crypto core | Argon2id, vectors chaining to RFC 9106 |
| Storage providers | Local file, Google Drive, OneDrive |
| UI | Unlock, browse, search, edit, save, generate, TOTP, import |

---

## Why this exists

Bitwarden, KeePassXC, 1Password and Proton Pass all solve password management well.
sar-vault is not trying to beat them on features. It explores one specific
architecture:

**Bring-your-own-storage, zero-knowledge, zero-backend.**

- You already pay for cloud storage. You shouldn't need to also trust a password
  manager vendor's servers, uptime, breach history, or business model.
- The vault is a standard KDBX file, so it stays readable by KeePassXC, KeePassDX,
  and Strongbox. No lock-in, no proprietary export path.
- The entire app is static files. There is no server-side code to compromise,
  subpoena, or shut down.

The interesting engineering here is in the constraints: doing OAuth without a
backend, doing memory-hard key derivation in a browser, and handling multi-device
sync conflicts on a file you don't control.

---

## Design principles

1. **Never hand-roll cryptographic primitives.** WebCrypto (SubtleCrypto) and vetted
   libraries only.
2. **The server knows nothing, because there is no server.** Static hosting only.
3. **Layers stay separable.** Swapping the KDF, adding a storage provider, or
   changing the vault format must not ripple into the UI.
4. **Be honest in the docs.** Every limitation a security reviewer would raise gets
   written down before they raise it.
5. **No third-party calls at runtime.** No analytics, no CDN fonts, no telemetry.
   Strict CSP, Subresource Integrity on everything.

---

## Architecture

```
┌──────────────────────────────────────────────┐
│  UI layer (Angular, signals, standalone)     │
│  entry list · editor · generator · settings  │
└──────────────────┬───────────────────────────┘
                   │  vault domain model only
┌──────────────────▼───────────────────────────┐
│  Vault service                                │
│  unlock/lock · entry CRUD · search · sync     │
└────────┬──────────────────────┬───────────────┘
         │                      │
┌────────▼─────────┐  ┌─────────▼────────────────┐
│ Format layer     │  │ Storage provider layer   │
│ KDBX 4 read/write│  │ list · read · write ·    │
│ (or custom)      │  │ getMetadata              │
└────────┬─────────┘  └─────────┬────────────────┘
         │                      │
┌────────▼─────────┐  ┌─────────▼────────────────┐
│ Crypto layer     │  │ Providers                │
│ Argon2id · AEAD  │  │ LocalFile · GDrive ·     │
│ CSPRNG · KAT     │  │ OneDrive · Dropbox · Box │
└──────────────────┘  └──────────────────────────┘
```

Each boundary is an interface. The UI never touches crypto. The format layer never
touches storage. Providers never see plaintext.

---

## Stack

- **Angular 22** — standalone components, signals, Signal Forms, zoneless change
  detection, strict TypeScript
- **WebCrypto** for AEAD and CSPRNG; **Argon2id via WASM** for key derivation
- **PWA** with offline support — planned, not yet built
- **Playwright** for E2E, **Vitest** for unit tests — run in real Chromium, so
  known-answer vectors are checked against genuine WebCrypto and WebAssembly
- **Static hosting** — S3 + CloudFront or Cloudflare Pages
- **GitHub Actions** — lint, test, build, dependency audit, deploy on tag

---

## Roadmap

**v0.1 — core**
- [x] Threat model published
- [x] Vault format decision documented
- [x] Crypto layer with known-answer test vectors
- [x] KDBX 4 read/write (or documented custom format)
- [x] Local file provider (download / upload)
- [x] Unlock, browse, edit, save

**v0.2 — cloud**
- [x] Storage provider interface finalised
- [x] Google Drive (`drive.file` scope, PKCE) — not `drive.appdata`, which hides
      the vault from its owner
- [x] OneDrive (app folder, PKCE)
- [x] Static host config: SPA fallback for `/auth/callback`, security headers
- [ ] Verified against live Google / Microsoft endpoints — needs OAuth client IDs;
      everything so far is proven against mocked responses only.
      See [docs/TODO.md](docs/TODO.md)
- [x] ETag / version-based conflict detection

**v0.3 — usability**
- [x] Password generator with entropy indicator — named presets in Settings, one-click
      generate from the default, dropdown for the rest. Custom presets are stored in the
      vault file, so they travel with it
- [x] TOTP generation (RFC 6238, verified against the published vectors)
- [x] Search, tags, custom fields, password history
- [x] Idle auto-lock, clipboard auto-clear
- [x] Import from KeePass CSV/XML, Bitwarden JSON, browser CSV

**Later**
- [ ] Dropbox, Box, WebDAV
- [ ] Key file / second factor
- [ ] Entry-level merge on conflict
- [ ] Attachments
- [ ] WCAG 2.2 AA audit

---

## Development

Prerequisites: Node.js (see [`.nvmrc`](.nvmrc)) and npm.

```bash
npm ci          # install
npm start       # dev server on :4200
npm test        # unit tests (Vitest in real Chromium)
npm run e2e     # Playwright
npm run lint    # ESLint + Prettier
npm run build   # production build
```

Unit and E2E tests need a real browser:

```bash
sudo npx playwright install-deps chromium   # once per machine
npx playwright install chromium
```

To enable cloud storage, copy `.env.example` to `.env` and fill in the OAuth client
IDs you registered with Google and Microsoft. Without them the app still works — it
just offers local files only.

---

## Deployment

See [docs/deployment.md](docs/deployment.md). The app is static files, but two
things must be configured at the host: SPA fallback for the OAuth callback path,
and the response headers SECURITY.md relies on. `npm run verify:bundle` fails the
build if either is missing from the output.

Known gaps are tracked in [docs/TODO.md](docs/TODO.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[SECURITY.md](SECURITY.md) — please don't open a public issue for a vulnerability.

## License

[MIT](LICENSE) © 2026 SAR
