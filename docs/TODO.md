# TODO

Known gaps, carried deliberately rather than forgotten. Roadmap *features* live
in the README; this is for work that is finished-looking but unproven, or for
follow-ups that fall between roadmap items.

Design principle 4: every limitation a security reviewer would raise gets
written down before they raise it.

---
## Priority

Ordered by what costs the user most if it stays missing, not by effort.

| # | Work | Why here |
| --- | --- | --- |
| 1 | Verify cloud providers live | v0.2 is ticked off but has never touched a real endpoint. Finishing something already claimed done comes before starting anything new |
| 2 | **v0.5** — fewer steps and data safety | The only item on this list that loses user data. Entries added and never downloaded are gone on close, with no warning |
| 3 | **v0.6** — master password management | There is currently no way to rotate a master password at all. A user who suspects theirs is compromised has no move |
| 4 | **v0.7** — groups | Organisation. Matters once a vault is large, not before |
| 5 | **v0.8** — UI/UX | Polish. Deliberately last: it is the most visible work and the least costly to defer |

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

---

## v0.5 — Fewer steps and data safety

**Status:** not started. Convenience work; no format change.

- [ ] **Remember the last vault file**, so a file need not be picked every session.

      The File System Access API returns a handle that can be persisted in
      IndexedDB and re-authorised later with `queryPermission` /
      `requestPermission` — the browser still asks once per session, but the user
      no longer hunts for the file. Chromium only; Firefox and Safari have no
      such API, so the picker stays as the fallback there.

      A stored handle points at a file containing someone's credentials. It is
      not the vault and not a key, but it is a pointer worth thinking about
      before storing, and SECURITY.md should say what is kept.

- [ ] **Auto-save on change**, so entries added but never downloaded are not lost.

      Depends on the item above: real auto-save needs a writable handle. Without
      one (Firefox, Safari) "auto-save" would mean repeatedly triggering
      downloads, which is not viable — those browsers need an explicit unsaved
      warning instead.

      Needs debouncing, and care with cloud targets: a write per keystroke would
      be wasteful and would multiply version conflicts (D-021). Should also
      interact sensibly with idle auto-lock — a save must complete before the
      vault locks.

- [ ] **Copy password directly from the entry list**, without opening the editor.

      `ClipboardService` already handles copy plus auto-clear, so this is mostly
      UI. Worth deciding whether the list may show any secret at all, or only
      copy it — currently the list deliberately shows none.

---

---

## v0.6 — Master password management

**Status:** not started. Touches the crypto boundary — expect scrutiny.

- [ ] **Change the master password.**

      kdbxweb supports replacing `db.credentials` and re-saving, which
      re-encrypts the file under the new key. Requires the current password, and
      must be an atomic replace: a half-written vault here is unrecoverable.
      Should also warn that other devices holding the old copy keep the old
      password until they sync.

- [ ] **Recovery / "forgot password" via TOTP** — ⚠️ **see the problem below
      before starting.**

      As proposed this cannot work, and the conflict is fundamental rather than
      an implementation detail.

      The master password *is* the encryption key. There is no server and no
      escrow, so nothing exists that could authorise a reset. A TOTP secret
      would have to be stored somewhere — and if it lives in the vault, it is
      encrypted under the password you have forgotten. Circular. If it lives
      anywhere else, then something outside the vault can unlock the vault, and
      the zero-knowledge claim in README and SECURITY.md is no longer true. The
      unlock screen currently tells users, in as many words, that there is no
      recovery.

      Honest alternatives, if the goal is "don't lose everything to one
      forgotten password":

      - **Key file as a second factor** — KDBX supports it natively, and it is
        already listed under **Later** in the README. Unlock needs password *and*
        file. This adds a factor; it does not add recovery.
      - **A recovery copy the user creates deliberately** — export the vault
        re-encrypted under a long random recovery code they store offline. This
        is real recovery, and it is honest, because the user chooses to create a
        second credential and knows it exists.
      - **TOTP as a second factor on unlock** — plausible only if the seed is
        combined into the key derivation, not checked against it. Checking a code
        after decryption protects nothing: an attacker with the file skips the UI
        entirely.

      Whichever is chosen, SECURITY.md's threat model and the unlock screen's
      "there is no recovery" wording both have to change with it.

---

---

## v0.7 — Groups

**Status:** not started.

- [ ] **Folder/tree structure for entries.**

      Most of the data model is already there: KDBX is natively hierarchical,
      `VaultGroup` exists, and `toDomain()` already projects groups with each
      entry carrying a `groupId`. The UI ignores all of it and renders one flat
      list.

      So this is largely UI work plus moving entries between groups, creating and
      renaming groups, and deciding how search interacts with the tree. The
      recycle bin is already excluded from the projection (D-018) and must stay
      excluded.

---

---

## v0.8 — UI/UX improvements

**Status:** not started. Scoped as a release of its own.

**Focus:** frontend and user experience, not new functionality. Existing behaviour
and workflows must be preserved.

Review the existing screens and components and improve where it helps most:

- [ ] Visual consistency; modernise the UI
- [ ] Spacing, alignment, typography, colour, component hierarchy
- [ ] More intuitive flows; fewer clicks and steps
- [ ] Navigation and discoverability of important actions
- [ ] Forms, buttons, dialogs, tables, filters and other interactive components
- [ ] Loading, empty, success and error states
- [ ] Responsiveness across screen sizes
- [ ] Accessibility and usability
- [ ] Consistent behaviour and styling across the app
- [ ] Identify confusing, cluttered or visually outdated areas and fix them

**Goal:** the app should feel more polished, intuitive, consistent and pleasant
to use.

Start by reviewing the current UI and prioritising whatever gives the most
noticeable improvement to the end user, rather than working through this list in
order.

Worth knowing before starting: the styling is deliberately plain. v0.1 chose
"functional, not polished" and never revisited it — colour tokens are in
`src/styles.scss`, and each component carries its own styles. There has been no
design pass, and WCAG 2.2 AA is a separate item under **Later** in the README.

---

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
