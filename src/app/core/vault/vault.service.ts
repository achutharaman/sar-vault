import { computed, inject, Injectable, signal } from '@angular/core';

import { OAuthClient } from '../auth/oauth-client';
import { KdbxDocument, VaultOpenError } from '../format/kdbx';
import type { Vault, VaultEntry, VaultEntryDraft } from '../model/vault';
import { ProviderRegistry } from '../storage/provider-registry';
import type { StorageProvider, VaultFileRef } from '../storage/types';

export type VaultStatus = 'locked' | 'unlocking' | 'unlocked' | 'saving';

/**
 * The only stateful piece in the app (docs/architecture.md).
 *
 * Holds the open vault for the duration of a session and owns the lock/unlock
 * lifecycle. The UI reads the domain model from here and never touches the
 * crypto, format or storage layers directly — ESLint enforces that boundary.
 */
@Injectable({ providedIn: 'root' })
export class VaultService {
  private readonly registry = inject(ProviderRegistry);

  /** Where the open vault is read from and written back to. */
  private provider: StorageProvider = this.registry.local;

  /** The open document. Deliberately not a signal: it is not UI state. */
  private document: KdbxDocument | undefined;
  private fileRef: VaultFileRef | undefined;
  private version: string | undefined;

  private readonly statusSignal = signal<VaultStatus>('locked');
  private readonly vaultSignal = signal<Vault | undefined>(undefined);
  private readonly errorSignal = signal<string | undefined>(undefined);
  private readonly dirtySignal = signal(false);
  private readonly fileNameSignal = signal<string | undefined>(undefined);
  private readonly searchSignal = signal('');

  readonly status = this.statusSignal.asReadonly();
  readonly vault = this.vaultSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly dirty = this.dirtySignal.asReadonly();
  readonly fileName = this.fileNameSignal.asReadonly();
  readonly search = this.searchSignal.asReadonly();

  readonly isUnlocked = computed(() => this.statusSignal() === 'unlocked');
  readonly isBusy = computed(
    () => this.statusSignal() === 'unlocking' || this.statusSignal() === 'saving',
  );

  private readonly cloudFilesSignal = signal<readonly VaultFileRef[]>([]);
  private readonly connectingSignal = signal(false);

  /** Vault files found in the connected cloud provider. */
  readonly cloudFiles = this.cloudFilesSignal.asReadonly();
  readonly connecting = this.connectingSignal.asReadonly();

  /** Cloud providers this build is configured for. */
  readonly cloudProviders = this.registry.availableCloud();

  /**
   * Whether saving writes back in place or downloads a copy.
   *
   * Cloud providers always write back. Locally it depends on the File System
   * Access API, which Firefox and Safari do not implement.
   */
  readonly canWriteBack = computed(
    () => this.providerIdSignal() !== 'local' || this.registry.local.supportsWriteBack(),
  );

  private readonly providerIdSignal = signal('local');
  readonly providerId = this.providerIdSignal.asReadonly();

  /** Entries matching the current search, sorted by title. */
  readonly visibleEntries = computed<readonly VaultEntry[]>(() => {
    const vault = this.vaultSignal();
    if (!vault) {
      return [];
    }
    const term = this.searchSignal().trim().toLowerCase();
    const entries = term
      ? vault.entries.filter((entry) =>
          [entry.title, entry.username, entry.url].some((field) =>
            field.toLowerCase().includes(term),
          ),
        )
      : vault.entries;

    return [...entries].sort((a, b) => a.title.localeCompare(b.title));
  });

  setSearch(term: string): void {
    this.searchSignal.set(term);
  }

  /** Register a file chosen through an `<input type="file">`. */
  selectFile(file: File): void {
    this.useLocal();
    this.fileRef = this.registry.local.registerFile(file);
    this.fileNameSignal.set(file.name);
    this.errorSignal.set(undefined);
  }

  /** Open the system picker, where the browser supports it. */
  async pickFile(): Promise<void> {
    this.errorSignal.set(undefined);
    this.useLocal();
    try {
      const ref = await this.registry.local.pick();
      if (ref) {
        this.fileRef = ref;
        this.fileNameSignal.set(ref.name);
      }
    } catch (error) {
      this.errorSignal.set(describe(error));
    }
  }

  /** Decrypt and open the selected vault. */
  async unlock(password: string): Promise<boolean> {
    if (!this.fileRef) {
      this.errorSignal.set('Choose a vault file first.');
      return false;
    }

    this.statusSignal.set('unlocking');
    this.errorSignal.set(undefined);

    try {
      const { data, version } = await this.provider.read(this.fileRef);
      const document = await KdbxDocument.open(data, password);

      this.document = document;
      this.version = version;
      this.vaultSignal.set(document.toDomain());
      this.dirtySignal.set(false);
      this.statusSignal.set('unlocked');
      return true;
    } catch (error) {
      this.statusSignal.set('locked');
      this.errorSignal.set(describe(error));
      return false;
    }
  }

  /** Create a new empty vault held in memory until it is saved. */
  createVault(password: string, name: string): void {
    const document = KdbxDocument.create(password, name);
    this.document = document;
    this.fileRef = undefined;
    this.version = undefined;
    this.fileNameSignal.set(`${name}.kdbx`);
    this.vaultSignal.set(document.toDomain());
    this.dirtySignal.set(true);
    this.errorSignal.set(undefined);
    this.statusSignal.set('unlocked');
  }

  /**
   * Discard the open vault and every derived value.
   *
   * SECURITY.md is clear that this cannot guarantee the key is gone from memory
   * — JavaScript offers no way to be sure. Dropping every reference we hold is
   * the most the platform allows.
   */
  lock(): void {
    this.document = undefined;
    this.version = undefined;
    this.vaultSignal.set(undefined);
    this.dirtySignal.set(false);
    this.searchSignal.set('');
    this.errorSignal.set(undefined);
    this.statusSignal.set('locked');
  }

  addEntry(draft: VaultEntryDraft): void {
    if (!this.document) {
      return;
    }
    this.document.addEntry(draft);
    this.refresh();
  }

  updateEntry(id: string, draft: VaultEntryDraft): void {
    if (!this.document?.updateEntry(id, draft)) {
      return;
    }
    this.refresh();
  }

  deleteEntry(id: string): void {
    if (!this.document?.removeEntry(id)) {
      return;
    }
    this.refresh();
  }

  // ---------------------------------------------------------------- cloud

  private useLocal(): void {
    this.provider = this.registry.local;
    this.providerIdSignal.set('local');
  }

  /** Send the user to a provider's consent screen. */
  async connectCloud(providerId: string): Promise<void> {
    const provider = this.registry.byId(providerId);
    if (!provider) {
      return;
    }
    this.errorSignal.set(undefined);
    try {
      globalThis.location.assign(await provider.connect());
    } catch (error) {
      this.errorSignal.set(describe(error));
    }
  }

  /**
   * Finish an OAuth redirect, if this page load is one.
   *
   * Returns true when a callback was handled, so the caller can clean the code
   * out of the address bar — leaving it there would put an authorization code in
   * the browser history and in any Referer sent onward.
   */
  async completeCloudSignIn(search: string): Promise<boolean> {
    const params = new URLSearchParams(search);
    const code = params.get('code');
    const state = params.get('state');
    const providerId = OAuthClient.pendingProviderId();

    if (params.get('error')) {
      OAuthClient.clearPending();
      this.errorSignal.set(`Sign-in was cancelled or refused (${params.get('error')}).`);
      return true;
    }
    if (!code || !state || !providerId) {
      return false;
    }

    const provider = this.registry.byId(providerId);
    if (!provider) {
      OAuthClient.clearPending();
      return false;
    }

    this.connectingSignal.set(true);
    try {
      await provider.completeConnect(code, state);
      this.provider = provider;
      this.providerIdSignal.set(provider.id);
      this.cloudFilesSignal.set(await provider.list());
    } catch (error) {
      this.errorSignal.set(describe(error));
    } finally {
      this.connectingSignal.set(false);
    }
    return true;
  }

  /** Choose which cloud file to unlock. */
  selectCloudFile(ref: VaultFileRef): void {
    const provider = this.registry.byId(ref.providerId);
    if (!provider) {
      return;
    }
    this.provider = provider;
    this.providerIdSignal.set(provider.id);
    this.fileRef = ref;
    this.fileNameSignal.set(ref.name);
    this.errorSignal.set(undefined);
  }

  /** Whether a given cloud provider currently holds a usable token. */
  isCloudConnected(providerId: string): boolean {
    return this.registry.byId(providerId)?.isConnected() ?? false;
  }

  disconnectCloud(providerId: string): void {
    this.registry.byId(providerId)?.disconnect();
    this.cloudFilesSignal.set([]);
    if (this.providerIdSignal() === providerId) {
      this.useLocal();
      this.fileRef = undefined;
      this.fileNameSignal.set(undefined);
    }
  }

  /** Serialize and write the vault back to storage. */
  async save(): Promise<boolean> {
    const document = this.document;
    if (!document) {
      return false;
    }

    this.statusSignal.set('saving');
    this.errorSignal.set(undefined);

    try {
      const data = await document.save();
      const ref = this.fileRef ?? {
        providerId: 'local',
        id: 'download',
        name: this.fileNameSignal() ?? 'vault.kdbx',
      };

      const result = await this.provider.write(ref, data, this.version);
      this.version = result.version;
      this.dirtySignal.set(false);
      this.statusSignal.set('unlocked');
      return true;
    } catch (error) {
      this.statusSignal.set('unlocked');
      this.errorSignal.set(describe(error));
      return false;
    }
  }

  private refresh(): void {
    if (this.document) {
      this.vaultSignal.set(this.document.toDomain());
      this.dirtySignal.set(true);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof VaultOpenError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Something went wrong.';
}
