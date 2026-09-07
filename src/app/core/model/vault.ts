/**
 * The vault domain model.
 *
 * This is the currency between layers: the format layer produces it, the vault
 * service holds it, and the UI renders it. It is deliberately a *projection* —
 * a readable view of the parts of a KDBX file this app understands — and never
 * the source of truth for saving. See `KdbxDocument` in the format layer for
 * why that distinction matters.
 */

/** A single credential record. */
export interface VaultEntry {
  /** KDBX UUID, stable across saves. */
  readonly id: string;
  readonly groupId: string;
  readonly title: string;
  readonly username: string;
  /**
   * Plaintext, and only ever populated while the vault is unlocked.
   *
   * SECURITY.md is explicit that JavaScript strings cannot be reliably erased:
   * they are immutable and the garbage collector may copy them freely. Holding
   * a password as a string is therefore a known weakening, accepted here
   * because the UI must display and edit it. It is not written anywhere outside
   * memory, and the whole model is dropped on lock.
   */
  readonly password: string;
  readonly url: string;
  readonly notes: string;
  readonly created: Date;
  readonly modified: Date;
}

/** A folder of entries. KDBX groups nest arbitrarily. */
export interface VaultGroup {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | undefined;
}

/** The readable projection of an unlocked vault. */
export interface Vault {
  readonly name: string;
  readonly groups: readonly VaultGroup[];
  readonly entries: readonly VaultEntry[];
}

/** The editable fields of an entry. */
export type VaultEntryDraft = Pick<VaultEntry, 'title' | 'username' | 'password' | 'url' | 'notes'>;

export const EMPTY_ENTRY_DRAFT: VaultEntryDraft = {
  title: '',
  username: '',
  password: '',
  url: '',
  notes: '',
};
