import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { ImportResult } from '../../core/import/importers';
import type { VaultEntryDraft } from '../../core/model/vault';
import { VaultService } from '../../core/vault/vault.service';
import { EntryEditor } from '../entry-editor/entry-editor';
import { EntryList } from '../entry-list/entry-list';

/** The unlocked vault: toolbar, entry list, editor. */
@Component({
  selector: 'app-vault-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntryEditor, EntryList, RouterLink],
  templateUrl: './vault-page.html',
  styleUrl: './vault-page.scss',
})
export class VaultPage {
  protected readonly vault = inject(VaultService);

  protected readonly selectedId = signal<string | undefined>(undefined);
  protected readonly creating = signal(false);
  protected readonly importResult = signal<ImportResult | undefined>(undefined);
  protected readonly importError = signal<string | undefined>(undefined);

  protected readonly selectedEntry = computed(() => {
    const id = this.selectedId();
    if (!id || this.creating()) {
      return undefined;
    }
    return this.vault.vault()?.entries.find((entry) => entry.id === id);
  });

  protected readonly editorOpen = computed(
    () => this.creating() || this.selectedEntry() !== undefined,
  );

  protected select(id: string): void {
    this.creating.set(false);
    this.selectedId.set(id);
  }

  protected startNewEntry(): void {
    this.selectedId.set(undefined);
    this.creating.set(true);
  }

  protected closeEditor(): void {
    this.creating.set(false);
    this.selectedId.set(undefined);
  }

  protected saveEntry(draft: VaultEntryDraft): void {
    if (this.creating()) {
      this.vault.addEntry(draft);
    } else {
      const id = this.selectedId();
      if (id) {
        this.vault.updateEntry(id, draft);
      }
    }
    this.closeEditor();
  }

  protected deleteEntry(id: string): void {
    this.vault.deleteEntry(id);
    this.closeEditor();
  }

  protected onSearch(event: Event): void {
    this.vault.setSearch((event.target as HTMLInputElement).value);
  }

  /**
   * Import an export from another manager.
   *
   * Entries land in the open vault unsaved, so the user reviews them before
   * committing. A file we cannot parse is reported rather than partially
   * imported — a half-import is worse than none, because the user believes
   * their credentials moved across.
   */
  protected async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.importError.set(undefined);
    this.importResult.set(undefined);

    try {
      this.importResult.set(this.vault.importFrom(await file.text(), file.name));
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : 'Could not import that file.');
    } finally {
      // Allow re-selecting the same file after a failure.
      input.value = '';
    }
  }

  protected dismissImport(): void {
    this.importResult.set(undefined);
    this.importError.set(undefined);
  }
}
