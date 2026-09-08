import * as kdbxweb from 'kdbxweb';

import { deriveArgon2Key, toArrayBuffer, toBytes } from '../crypto';
import type { Argon2Type, Argon2Version } from '../crypto';
import type {
  Vault,
  VaultCustomField,
  VaultEntry,
  VaultEntryDraft,
  VaultGroup,
  VaultHistoryEntry,
} from '../model/vault';

/**
 * KDBX 4 support, per living-spec D-006.
 *
 * kdbxweb owns the binary format; this module owns the Argon2 wiring, the
 * mapping to the domain model, and the guarantee that we never lose data the
 * user's other KeePass clients wrote.
 */

/** Field names KDBX uses for the standard entry properties. */
const FIELD = {
  title: 'Title',
  username: 'UserName',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
} as const;

const STANDARD_FIELDS = new Set<string>(Object.values(FIELD));

/**
 * Where a TOTP seed lives in a KDBX file.
 *
 * There is no single convention. KeePass 2.47+ and recent KeePassXC store an
 * `otp` field holding an otpauth URI; older KeePassXC used a bare base32 seed in
 * `TOTP Seed` with parameters in `TOTP Settings`. We read all of them and write
 * the `otp` form, which is the most widely understood.
 */
const OTP_FIELD = 'otp';
const KEEPASSXC_TOTP_FIELDS = ['TOTP Seed', 'TOTP Settings'];
const TOTP_FIELD_NAMES = new Set<string>([OTP_FIELD, ...KEEPASSXC_TOTP_FIELDS]);

let argon2Registered = false;

/**
 * Hand kdbxweb our Argon2 implementation.
 *
 * kdbxweb deliberately ships no Argon2 — `setArgon2Impl` is the seam. That is
 * what lets the crypto layer keep ownership of the KDF, as architecture.md
 * requires, instead of the format library owning it.
 *
 * The `memory` argument arrives in **kibibytes**: kdbxweb reads the KDBX header
 * field `M` (which is in bytes) and divides by 1024 before calling this. Passing
 * bytes straight through would derive a wrong key and present as a bogus "wrong
 * password".
 */
export function registerArgon2(): void {
  if (argon2Registered) {
    return;
  }
  kdbxweb.CryptoEngine.setArgon2Impl(
    async (password, salt, memory, iterations, length, parallelism, type, version) => {
      const key = await deriveArgon2Key(toBytes(password), toBytes(salt), {
        memoryKib: memory,
        iterations,
        parallelism,
        hashLength: length,
        type: type as Argon2Type,
        version: version as Argon2Version,
      });
      return toArrayBuffer(key);
    },
  );
  argon2Registered = true;
}

/** Raised when a vault cannot be opened. Carries a cause for diagnosis. */
export class VaultOpenError extends Error {
  override readonly name = 'VaultOpenError';
  readonly wrongPassword: boolean;

  constructor(message: string, wrongPassword: boolean, options?: { cause?: unknown }) {
    super(message, options);
    this.wrongPassword = wrongPassword;
  }
}

/**
 * An open KDBX file.
 *
 * The parsed `Kdbx` instance is kept as the source of truth and mutated in
 * place, rather than being regenerated from the domain model on save. This is
 * deliberate: a KDBX file written by KeePassXC carries entry history, binary
 * attachments, custom fields, icons, recycle-bin state and auto-type rules that
 * this app does not model. Rebuilding the file from `Vault` would silently
 * discard every one of them — data loss that the user would only discover in
 * another client, long after the fact.
 *
 * So `toDomain()` is a read-only projection for the UI, and every mutation goes
 * through a method here that edits the underlying KDBX object.
 */
export class KdbxDocument {
  private constructor(private readonly db: kdbxweb.Kdbx) {}

  /** Open an existing vault. */
  static async open(data: ArrayBuffer, password: string): Promise<KdbxDocument> {
    registerArgon2();
    const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));

    try {
      const db = await kdbxweb.Kdbx.load(data, credentials);
      return new KdbxDocument(db);
    } catch (error) {
      throw toOpenError(error);
    }
  }

  /** Create a new, empty vault. */
  static create(password: string, name: string): KdbxDocument {
    registerArgon2();
    const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(password));
    const db = kdbxweb.Kdbx.create(credentials, name);

    // kdbxweb (like KeePass itself) defaults new files to Argon2**d**. SECURITY.md
    // commits to Argon2**id**, which is the hybrid variant: Argon2d's resistance to
    // GPU cracking plus Argon2i's resistance to side-channel attacks. Since the
    // vault is opened on whatever machine the user happens to be on, the
    // side-channel half is worth having, and RFC 9106 names Argon2id the default
    // choice. Existing vaults keep whatever KDF they were written with.
    db.header.setKdf(kdbxweb.Consts.KdfId.Argon2id);

    return new KdbxDocument(db);
  }

  /** Serialize back to KDBX bytes. */
  async save(): Promise<ArrayBuffer> {
    return this.db.save();
  }

  /**
   * Read an app setting from the file's custom data.
   *
   * KDBX defines `Meta/CustomData` as a namespaced key-value store for exactly
   * this: application state that should travel with the vault. Other KeePass
   * clients preserve entries they do not recognise, so writing here is safe for
   * interoperability — they will carry our keys through their own saves without
   * acting on them.
   */
  readSetting(key: string): string | undefined {
    return this.db.meta.customData.get(key)?.value;
  }

  /** Write an app setting, or remove it when the value is undefined. */
  writeSetting(key: string, value: string | undefined): void {
    if (value === undefined) {
      this.db.meta.customData.delete(key);
      return;
    }
    this.db.meta.customData.set(key, { value, lastModified: new Date() });
  }

  /**
   * Read-only projection for the UI.
   *
   * The recycle bin is excluded. KDBX deletion is a move, not an erase, so
   * without this a "deleted" entry keeps appearing in the list — which is both
   * confusing and, for a password manager, alarming.
   */
  toDomain(): Vault {
    const groups: VaultGroup[] = [];
    const entries: VaultEntry[] = [];
    const recycleBinId = this.db.meta.recycleBinUuid?.id;

    for (const root of this.db.groups) {
      this.collect(root, undefined, groups, entries, recycleBinId);
    }

    return {
      name: this.db.meta.name ?? 'Vault',
      groups,
      entries,
    };
  }

  /** Apply edits to an existing entry. Returns false if the id is unknown. */
  updateEntry(id: string, draft: VaultEntryDraft): boolean {
    const entry = this.findEntry(id);
    if (!entry) {
      return false;
    }
    // Snapshot **before** applying the edit. pushHistory() captures the entry's
    // current state, so calling it afterwards would record the new value and
    // lose the old one — which defeats the entire point of password history:
    // recovering the password you just replaced.
    entry.pushHistory();
    applyDraft(entry, draft);
    entry.times.update();
    return true;
  }

  /** Create an entry in the given group, or the default group. */
  addEntry(draft: VaultEntryDraft, groupId?: string): VaultEntry {
    const group = (groupId ? this.findGroup(groupId) : undefined) ?? this.db.getDefaultGroup();
    const entry = this.db.createEntry(group);
    applyDraft(entry, draft);
    entry.times.update();
    return toDomainEntry(entry, group.uuid.id);
  }

  /**
   * Move an entry to the recycle bin, matching what other KeePass clients do.
   * Permanent deletion is deliberately not offered yet.
   */
  removeEntry(id: string): boolean {
    const entry = this.findEntry(id);
    if (!entry?.parentGroup) {
      return false;
    }
    this.db.remove(entry);
    return true;
  }

  private collect(
    group: kdbxweb.KdbxGroup,
    parentId: string | undefined,
    groups: VaultGroup[],
    entries: VaultEntry[],
    recycleBinId: string | undefined,
  ): void {
    const id = group.uuid.id;
    if (recycleBinId !== undefined && id === recycleBinId) {
      return;
    }
    groups.push({ id, name: group.name ?? '', parentId });

    for (const entry of group.entries) {
      entries.push(toDomainEntry(entry, id));
    }
    for (const child of group.groups) {
      this.collect(child, id, groups, entries, recycleBinId);
    }
  }

  private findEntry(id: string): kdbxweb.KdbxEntry | undefined {
    for (const group of this.allGroups()) {
      for (const entry of group.entries) {
        if (entry.uuid.id === id) {
          return entry;
        }
      }
    }
    return undefined;
  }

  private findGroup(id: string): kdbxweb.KdbxGroup | undefined {
    return this.allGroups().find((group) => group.uuid.id === id);
  }

  private allGroups(): kdbxweb.KdbxGroup[] {
    const flat: kdbxweb.KdbxGroup[] = [];
    const walk = (group: kdbxweb.KdbxGroup): void => {
      flat.push(group);
      group.groups.forEach(walk);
    };
    this.db.groups.forEach(walk);
    return flat;
  }
}

function applyDraft(entry: kdbxweb.KdbxEntry, draft: VaultEntryDraft): void {
  entry.fields.set(FIELD.title, draft.title);
  entry.fields.set(FIELD.username, draft.username);
  // Passwords are stored as ProtectedValue so kdbxweb applies KDBX inner-stream
  // protection on save, rather than writing them as plain XML text.
  entry.fields.set(FIELD.password, kdbxweb.ProtectedValue.fromString(draft.password));
  entry.fields.set(FIELD.url, draft.url);
  entry.fields.set(FIELD.notes, draft.notes);

  if (draft.tags) {
    entry.tags = [...draft.tags];
  }

  if (draft.totpUri !== undefined) {
    applyTotp(entry, draft.totpUri);
  }

  if (draft.customFields) {
    applyCustomFields(entry, draft.customFields);
  }
}

function applyTotp(entry: kdbxweb.KdbxEntry, uri: string): void {
  if (uri) {
    entry.fields.set(OTP_FIELD, kdbxweb.ProtectedValue.fromString(uri));
    // Drop the legacy pair so the two cannot drift apart and disagree.
    for (const name of KEEPASSXC_TOTP_FIELDS) {
      entry.fields.delete(name);
    }
    return;
  }
  for (const name of TOTP_FIELD_NAMES) {
    entry.fields.delete(name);
  }
}

/**
 * Replace the custom fields, leaving standard and TOTP fields untouched.
 *
 * Only fields the user can actually see in the editor are removed. A field this
 * app does not surface must survive, or editing an entry in sar-vault would
 * quietly strip data another KeePass client depends on.
 */
function applyCustomFields(entry: kdbxweb.KdbxEntry, fields: readonly VaultCustomField[]): void {
  for (const name of [...entry.fields.keys()]) {
    if (!STANDARD_FIELDS.has(name) && !TOTP_FIELD_NAMES.has(name)) {
      entry.fields.delete(name);
    }
  }
  for (const field of fields) {
    if (!field.name || STANDARD_FIELDS.has(field.name) || TOTP_FIELD_NAMES.has(field.name)) {
      continue;
    }
    entry.fields.set(
      field.name,
      field.protected ? kdbxweb.ProtectedValue.fromString(field.value) : field.value,
    );
  }
}

function readCustomFields(entry: kdbxweb.KdbxEntry): VaultCustomField[] {
  const fields: VaultCustomField[] = [];
  for (const [name, value] of entry.fields) {
    if (STANDARD_FIELDS.has(name) || TOTP_FIELD_NAMES.has(name)) {
      continue;
    }
    fields.push({
      name,
      value: value instanceof kdbxweb.ProtectedValue ? value.getText() : (value ?? ''),
      protected: value instanceof kdbxweb.ProtectedValue,
    });
  }
  return fields;
}

/**
 * Recover an otpauth URI from whichever convention the file uses.
 *
 * Returns undefined rather than throwing on a malformed seed: a broken TOTP
 * field must not make the whole entry unreadable.
 */
function readTotpUri(entry: kdbxweb.KdbxEntry): string | undefined {
  const otp = readField(entry, OTP_FIELD);
  if (otp.startsWith('otpauth://')) {
    return otp;
  }

  const seed = readField(entry, 'TOTP Seed');
  if (!seed) {
    return undefined;
  }

  // KeePassXC's "TOTP Settings" is "period;digits", e.g. "30;6".
  const [periodRaw, digitsRaw] = readField(entry, 'TOTP Settings').split(';');
  const period = Number(periodRaw) || 30;
  const digits = Number(digitsRaw) || 6;
  const title = readField(entry, FIELD.title) || 'sar-vault';

  const params = new URLSearchParams({
    secret: seed.replace(/\s/g, ''),
    period: String(period),
    digits: String(digits),
  });
  return `otpauth://totp/${encodeURIComponent(title)}?${params.toString()}`;
}

function readHistory(entry: kdbxweb.KdbxEntry): VaultHistoryEntry[] {
  return [...entry.history]
    .map((past) => ({
      modified: past.times.lastModTime ?? new Date(0),
      title: readField(past, FIELD.title),
      username: readField(past, FIELD.username),
      password: readField(past, FIELD.password),
    }))
    .sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

function toDomainEntry(entry: kdbxweb.KdbxEntry, groupId: string): VaultEntry {
  return {
    id: entry.uuid.id,
    groupId,
    title: readField(entry, FIELD.title),
    username: readField(entry, FIELD.username),
    password: readField(entry, FIELD.password),
    url: readField(entry, FIELD.url),
    notes: readField(entry, FIELD.notes),
    created: entry.times.creationTime ?? new Date(0),
    modified: entry.times.lastModTime ?? new Date(0),
    tags: [...(entry.tags ?? [])],
    customFields: readCustomFields(entry),
    totpUri: readTotpUri(entry),
    history: readHistory(entry),
  };
}

function readField(entry: kdbxweb.KdbxEntry, name: string): string {
  const value = entry.fields.get(name);
  if (value === undefined) {
    return '';
  }
  return value instanceof kdbxweb.ProtectedValue ? value.getText() : value;
}

/**
 * Distinguish "wrong password" from "this file is not a vault".
 *
 * Both arrive as exceptions from kdbxweb, but they mean very different things to
 * someone staring at an unlock screen, and conflating them sends people hunting
 * for a typo in a password that was never the problem.
 */
function toOpenError(error: unknown): VaultOpenError {
  if (error instanceof kdbxweb.KdbxError) {
    if (error.code === kdbxweb.Consts.ErrorCodes.InvalidKey) {
      return new VaultOpenError('Wrong password.', true, { cause: error });
    }
    if (error.code === kdbxweb.Consts.ErrorCodes.BadSignature) {
      return new VaultOpenError('This file is not a KDBX vault.', false, { cause: error });
    }
    return new VaultOpenError(`Could not read the vault: ${error.message}`, false, {
      cause: error,
    });
  }
  return new VaultOpenError('Could not read the vault.', false, { cause: error });
}
