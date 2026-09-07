import * as kdbxweb from 'kdbxweb';

import { deriveArgon2Key, toArrayBuffer, toBytes } from '../crypto';
import type { Argon2Type, Argon2Version } from '../crypto';
import type { Vault, VaultEntry, VaultEntryDraft, VaultGroup } from '../model/vault';

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
    applyDraft(entry, draft);
    // Records a history snapshot and bumps modification times, the same as any
    // other KeePass client would.
    entry.pushHistory();
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
