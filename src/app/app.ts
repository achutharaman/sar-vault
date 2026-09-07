import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';

import { VaultService } from './core/vault/vault.service';
import type { VaultEntryDraft } from './core/model/vault';
import { EntryEditor } from './ui/entry-editor/entry-editor';
import { EntryList } from './ui/entry-list/entry-list';
import { UnlockScreen } from './ui/unlock-screen/unlock-screen';

/**
 * Application shell.
 *
 * Chooses between the unlock screen and the vault view, and wires UI events to
 * `VaultService`. All vault state lives in the service, not here.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EntryEditor, EntryList, UnlockScreen],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly vault = inject(VaultService);

  constructor() {
    void this.handleOAuthRedirect();
  }

  /**
   * Complete an OAuth redirect if this page load is one.
   *
   * The authorization code is stripped from the URL immediately afterwards.
   * Leaving it in the address bar would write it into browser history and into
   * any Referer header the page later sends — and a code is redeemable exactly
   * once by whoever holds it and the matching verifier.
   */
  private async handleOAuthRedirect(): Promise<void> {
    const { search, pathname } = globalThis.location;
    if (!search) {
      return;
    }

    if (await this.vault.completeCloudSignIn(search)) {
      const clean = pathname === '/auth/callback' ? '/' : pathname;
      globalThis.history.replaceState({}, '', clean);
    }
  }

  protected readonly selectedId = signal<string | undefined>(undefined);
  protected readonly creating = signal(false);

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
}
