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

🚧 **Pre-alpha — design phase.** Nothing here is usable yet. See
[docs/living-spec.md](docs/living-spec.md) for current scope and decisions.

| Area | Status |
| --- | --- |
| Threat model | In progress |
| Vault format decision (KDBX 4 vs custom) | In progress |
| Crypto core | Not started |
| Storage providers | Not started |
| UI | Not started |

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

## Planned architecture

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

## Planned stack

- **Angular 22** — standalone components, signals, Signal Forms, zoneless change
  detection, strict TypeScript
- **WebCrypto** for AEAD and CSPRNG; **Argon2id via WASM** for key derivation
- **PWA** with offline support — the vault is usable with no connectivity
- **Playwright** for E2E, **Vitest/Jest** for unit tests with known-answer vectors
  on all crypto and format code
- **Static hosting** — S3 + CloudFront or Cloudflare Pages
- **GitHub Actions** — lint, test, build, dependency audit, deploy on tag

---

## Roadmap

**v0.1 — core**
- [ ] Threat model published
- [ ] Vault format decision documented
- [ ] Crypto layer with known-answer test vectors
- [ ] KDBX 4 read/write (or documented custom format)
- [ ] Local file provider (download / upload)
- [ ] Unlock, browse, edit, save

**v0.2 — cloud**
- [ ] Storage provider interface finalised
- [ ] Google Drive (`drive.appdata` scope, PKCE)
- [ ] OneDrive (app folder, PKCE)
- [ ] ETag / version-based conflict detection

**v0.3 — usability**
- [ ] Password generator with entropy indicator
- [ ] TOTP generation
- [ ] Search, tags, custom fields, password history
- [ ] Idle auto-lock, clipboard auto-clear
- [ ] Import from KeePass CSV/XML, Bitwarden JSON, browser CSV

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
npm start       # dev server
npm test        # unit tests
npm run e2e     # Playwright
npm run lint    # lint
npm run build   # production build
```

*(Scripts land once the Angular workspace is scaffolded.)*

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through
[SECURITY.md](SECURITY.md) — please don't open a public issue for a vulnerability.

## License

[MIT](LICENSE) © 2026 SAR
