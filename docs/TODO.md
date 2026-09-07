# TODO

Known gaps, carried deliberately rather than forgotten. Roadmap *features* live
in the README; this is for work that is finished-looking but unproven, or for
follow-ups that fall between roadmap items.

Design principle 4: every limitation a security reviewer would raise gets
written down before they raise it.

---

## Blocking v0.2 being called "done"

### Verify the cloud providers against live endpoints

**Status:** not started. Needs OAuth client IDs registered by the maintainer.

Everything in the cloud path — the redirect, consent, token exchange, list,
read, write and create — is proven only against **mocked `fetch`**. No request
has ever reached Google or Microsoft. Unit and seam tests confirm the code does
what it intends; they cannot confirm the providers agree.

Setup steps are in [deployment.md](deployment.md#registering-the-oauth-apps).

What to check once client IDs exist, in order:

- [ ] **Microsoft: the redirect URI is registered as "Single-page application", not
      "Web".** Registered as Web, the token endpoint refuses the browser's
      cross-origin request and expects a client secret a browser app cannot
      hold. It surfaces as an opaque CORS or `invalid_client` error. This is the
      most likely single point of failure.
- [ ] **Google: the redirect URI matches byte for byte**, trailing slash included.
- [ ] Consent screen returns to `/auth/callback` and the app strips the code from
      the URL (`app.ts` `handleOAuthRedirect`).
- [ ] Token exchange succeeds from the browser — i.e. both token endpoints send
      CORS headers for a public PKCE client.
- [ ] `create()` on Google Drive: the multipart body is assembled by hand with a
      `Blob`; boundary handling is exactly what mocks cannot catch.
- [ ] The created file is **visible in the user's own Drive** — that is the whole
      argument for `drive.file` over `drive.appdata` (Q-008/D-019). If it is not,
      the scope decision needs revisiting.
- [ ] `list()` returns the created file on a later session.
- [ ] OneDrive conditional write: force a conflict by editing the file elsewhere,
      confirm a real 412 and that the app refuses rather than overwrites.
- [ ] Google Drive conflict: same, acknowledging the read-then-compare race
      window Drive v3 forces on us.
- [ ] Token expiry mid-session degrades to "connect again" rather than a hang.

---

## Follow-ups

### Reproducible builds and published bundle hashes

**Status:** not started. Tracked as Q-010 in the living spec.

SECURITY.md names this as the mitigation for the hosted-app problem and records
it as unimplemented. Until it exists, "verify your own build" is advice a user
cannot act on.

### Argon2 runs on the UI thread

**Status:** not started. Tracked as Q-011.

Tolerable at kdbxweb's default cost; not at the higher parameters Q-003 may
choose. Moving it to a Web Worker also allows a progress indicator instead of a
frozen tab.

### Argon2 cost parameters are kdbxweb's defaults

**Status:** not started. Tracked as Q-003.

New vaults inherit whatever kdbxweb picks. This is the number that decides how
expensive a stolen vault is to crack, so it deserves a deliberate choice plus a
fallback for low-memory devices.

### Passwords are strings in the domain model

**Status:** accepted for now. Tracked as Q-012.

SECURITY.md records why this is a weakening: JavaScript strings are immutable
and cannot be reliably erased. The UI has to display and edit them, so v0.1
accepted it.

### Adopting a pre-existing cloud vault

**Status:** not started. Tracked as Q-013.

With `drive.file` the app can only see files it created. Importing an existing
Drive vault would need Google's Picker, which loads third-party script and is
barred by hard rule 2 and by the CSP. Today's workaround: open the file locally,
then save it to the cloud.
