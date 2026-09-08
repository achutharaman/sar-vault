import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';

import { GeneratorPresetsService } from '../../core/generator/generator-presets.service';
import { buildPool, entropyBits, strengthLabel } from '../../core/generator/password-generator';
import {
  EMPTY_ENTRY_DRAFT,
  type VaultCustomField,
  type VaultEntry,
  type VaultEntryDraft,
} from '../../core/model/vault';
import { generateTotp, parseOtpauthUri, secondsRemaining } from '../../core/totp/totp';
import { ClipboardService } from '../../core/vault/clipboard.service';

/** Form for a single entry. Emits drafts; it never touches storage itself. */
@Component({
  selector: 'app-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe],
  templateUrl: './entry-editor.html',
  styleUrl: './entry-editor.scss',
})
export class EntryEditor {
  readonly entry = input<VaultEntry | undefined>(undefined);

  readonly submitted = output<VaultEntryDraft>();
  readonly deleted = output<string>();
  readonly cancelled = output<void>();

  protected readonly clipboard = inject(ClipboardService);
  protected readonly presets = inject(GeneratorPresetsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly draft = signal<VaultEntryDraft>({ ...EMPTY_ENTRY_DRAFT });
  protected readonly revealed = signal(false);
  protected readonly showPresetMenu = signal(false);
  protected readonly showHistory = signal(false);
  protected readonly generatorError = signal<string | undefined>(undefined);

  /**
   * The preset the Generate button will use.
   *
   * Sticky for the life of this editor: choosing one from the dropdown keeps it
   * selected, so pressing Generate again re-rolls with the same settings.
   * Reset to the default whenever a different entry is opened.
   */
  protected readonly activePresetId = signal<string>('');
  /** True once something has been generated, so the hint line can appear. */
  protected readonly hasGenerated = signal(false);
  protected readonly tagInput = signal('');

  /** Live TOTP code and countdown, recomputed each second. */
  protected readonly totpCode = signal<string | undefined>(undefined);
  protected readonly totpSeconds = signal(0);
  protected readonly totpError = signal<string | undefined>(undefined);

  /** The preset Generate will use right now. */
  protected readonly activePreset = computed(
    () => this.presets.byId(this.activePresetId()) ?? this.presets.defaultPreset(),
  );

  /** Entropy of the active preset. */
  protected readonly entropy = computed(() => {
    const { options } = this.activePreset();
    return entropyBits(buildPool(options).length, options.length);
  });
  protected readonly strength = computed(() => strengthLabel(this.entropy()));

  protected readonly tags = computed(() => this.draft().tags ?? []);
  protected readonly customFields = computed(() => this.draft().customFields ?? []);
  protected readonly history = computed(() => this.entry()?.history ?? []);

  constructor() {
    // Reset the form whenever a different entry is selected. The password is
    // re-hidden on every switch so one entry's secret is never left on screen
    // while another is being viewed.
    effect(() => {
      const current = this.entry();
      this.draft.set(
        current
          ? {
              title: current.title,
              username: current.username,
              password: current.password,
              url: current.url,
              notes: current.notes,
              tags: [...current.tags],
              customFields: current.customFields.map((f) => ({ ...f })),
              totpUri: current.totpUri ?? '',
            }
          : { ...EMPTY_ENTRY_DRAFT },
      );
      this.revealed.set(false);
      this.showPresetMenu.set(false);
      this.hasGenerated.set(false);
      this.showHistory.set(false);
      this.tagInput.set('');

      // untracked: refreshTotp reads draft(), so tracking it here would make
      // this effect depend on draft — and every edit would re-run the reset,
      // wiping the change the user just made. defaultPreset() is read here too,
      // and tracking that would reset the form whenever settings changed.
      untracked(() => {
        // Every editor session starts from the default preset.
        this.activePresetId.set(this.presets.defaultPreset().id);
        void this.refreshTotp();
      });
    });

    const ticker = setInterval(() => void this.refreshTotp(), 1000);
    this.destroyRef.onDestroy(() => clearInterval(ticker));
  }

  protected patch<K extends keyof VaultEntryDraft>(key: K, value: VaultEntryDraft[K]): void {
    this.draft.update((current) => ({ ...current, [key]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.emit(this.draft());
  }

  // --------------------------------------------------------------- generator

  protected togglePresetMenu(): void {
    this.showPresetMenu.update((open) => !open);
  }

  /**
   * Generate using the currently selected preset.
   *
   * Presets themselves are configured in Settings — putting that form in the
   * editor made a routine action look like a configuration task.
   */
  protected generate(): void {
    try {
      this.patch('password', this.presets.generate(this.activePreset().id));
      this.hasGenerated.set(true);
      this.generatorError.set(undefined);
      // Reveal it: a password the user cannot see is one they cannot
      // sanity-check before saving.
      this.revealed.set(true);
    } catch (error) {
      this.generatorError.set(error instanceof Error ? error.message : 'Could not generate.');
    } finally {
      this.showPresetMenu.set(false);
    }
  }

  /**
   * Pick a preset from the dropdown and generate with it.
   *
   * The choice sticks, so pressing Generate again re-rolls with the same
   * settings. Previously every press after the first silently reverted to the
   * default, which made the dropdown look broken.
   */
  protected choosePreset(presetId: string): void {
    this.activePresetId.set(presetId);
    this.generate();
  }

  /** Close the preset menu on Escape, the behaviour a menu is expected to have. */
  protected onPresetMenuKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.showPresetMenu.set(false);
    }
  }

  // -------------------------------------------------------------------- tags

  protected addTag(): void {
    const tag = this.tagInput().trim();
    if (!tag || this.tags().includes(tag)) {
      this.tagInput.set('');
      return;
    }
    this.patch('tags', [...this.tags(), tag]);
    this.tagInput.set('');
  }

  protected removeTag(tag: string): void {
    this.patch(
      'tags',
      this.tags().filter((t) => t !== tag),
    );
  }

  protected onTagKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addTag();
    }
  }

  // ----------------------------------------------------------- custom fields

  protected addCustomField(): void {
    this.patch('customFields', [...this.customFields(), { name: '', value: '', protected: false }]);
  }

  protected updateCustomField(index: number, patch: Partial<VaultCustomField>): void {
    this.patch(
      'customFields',
      this.customFields().map((field, i) => (i === index ? { ...field, ...patch } : field)),
    );
  }

  protected removeCustomField(index: number): void {
    this.patch(
      'customFields',
      this.customFields().filter((_, i) => i !== index),
    );
  }

  // -------------------------------------------------------------------- TOTP

  protected async refreshTotp(): Promise<void> {
    const uri = this.draft().totpUri;
    if (!uri) {
      this.totpCode.set(undefined);
      this.totpError.set(undefined);
      return;
    }

    try {
      const config = parseOtpauthUri(uri);
      this.totpCode.set(await generateTotp(config));
      this.totpSeconds.set(secondsRemaining(config));
      this.totpError.set(undefined);
    } catch (error) {
      // A bad seed must not break the rest of the editor.
      this.totpCode.set(undefined);
      this.totpError.set(error instanceof Error ? error.message : 'Invalid TOTP secret.');
    }
  }

  protected onTotpUriChange(value: string): void {
    this.patch('totpUri', value);
    void this.refreshTotp();
  }

  // --------------------------------------------------------------- clipboard

  protected async copy(value: string, label: string): Promise<void> {
    await this.clipboard.copy(value, label);
  }
}
