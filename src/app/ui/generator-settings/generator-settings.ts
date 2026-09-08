import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';

import {
  type GeneratorPreset,
  GeneratorPresetsService,
} from '../../core/generator/generator-presets.service';
import {
  buildPool,
  DEFAULT_OPTIONS,
  entropyBits,
  type GeneratorOptions,
  strengthLabel,
} from '../../core/generator/password-generator';

/**
 * Manage password generator presets.
 *
 * This form used to live inside the entry editor, which made a routine action
 * (generate a password) look like a configuration task every time. Configuration
 * belongs here; the editor just picks a preset.
 */
@Component({
  selector: 'app-generator-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  templateUrl: './generator-settings.html',
  styleUrl: './generator-settings.scss',
})
export class GeneratorSettings {
  protected readonly presets = inject(GeneratorPresetsService);

  /** The preset being edited, or 'new' while adding one. */
  protected readonly editingId = signal<string | undefined>(undefined);
  protected readonly draftName = signal('');
  protected readonly draftOptions = signal<GeneratorOptions>({ ...DEFAULT_OPTIONS });
  protected readonly error = signal<string | undefined>(undefined);

  protected readonly draftEntropy = computed(() => {
    const options = this.draftOptions();
    return entropyBits(buildPool(options).length, options.length);
  });
  protected readonly draftStrength = computed(() => strengthLabel(this.draftEntropy()));

  /** Whether the draft could actually generate, so Save can be blocked early. */
  protected readonly draftValid = computed(() => {
    const options = this.draftOptions();
    const classes = [options.lowercase, options.uppercase, options.digits, options.symbols].filter(
      Boolean,
    ).length;

    if (classes === 0) {
      return false;
    }
    return !options.requireEachClass || options.length >= classes;
  });

  protected readonly validationMessage = computed(() => {
    const options = this.draftOptions();
    const classes = [options.lowercase, options.uppercase, options.digits, options.symbols].filter(
      Boolean,
    ).length;

    if (classes === 0) {
      return 'Select at least one character type.';
    }
    if (options.requireEachClass && options.length < classes) {
      return `A length of ${options.length} cannot contain all ${classes} selected types.`;
    }
    return undefined;
  });

  protected entropyOf(preset: GeneratorPreset): number {
    return entropyBits(buildPool(preset.options).length, preset.options.length);
  }

  protected summary(preset: GeneratorPreset): string {
    const { options } = preset;
    const parts = [
      options.lowercase ? 'a–z' : undefined,
      options.uppercase ? 'A–Z' : undefined,
      options.digits ? '0–9' : undefined,
      options.symbols ? 'symbols' : undefined,
    ].filter(Boolean);
    return `${options.length} chars · ${parts.join(', ')}${
      options.excludeAmbiguous ? ' · no look-alikes' : ''
    }`;
  }

  protected startNew(): void {
    this.editingId.set('new');
    this.draftName.set('');
    this.draftOptions.set({ ...DEFAULT_OPTIONS });
    this.error.set(undefined);
  }

  protected startEdit(preset: GeneratorPreset): void {
    this.editingId.set(preset.id);
    this.draftName.set(preset.name);
    this.draftOptions.set({ ...preset.options });
    this.error.set(undefined);
  }

  /**
   * Start a new preset seeded from an existing one.
   *
   * The only way to "change" a built-in: they are immutable so that every vault
   * keeps a known-good set, but copying one is usually what someone editing it
   * actually wanted.
   */
  protected duplicate(preset: GeneratorPreset): void {
    this.editingId.set('new');
    this.draftName.set(`${preset.name} copy`);
    this.draftOptions.set({ ...preset.options });
    this.error.set(undefined);
  }

  protected cancelEdit(): void {
    this.editingId.set(undefined);
    this.error.set(undefined);
  }

  protected setOption<K extends keyof GeneratorOptions>(key: K, value: GeneratorOptions[K]): void {
    this.draftOptions.update((current) => ({ ...current, [key]: value }));
  }

  protected save(): void {
    if (!this.draftValid()) {
      this.error.set(this.validationMessage());
      return;
    }

    const id = this.editingId();
    const ok =
      id === 'new'
        ? this.presets.add(this.draftName(), this.draftOptions()) !== undefined
        : !!id && this.presets.update(id, { name: this.draftName(), options: this.draftOptions() });

    if (!ok) {
      this.error.set('Unlock a vault first — presets are stored inside it.');
      return;
    }
    this.cancelEdit();
  }

  protected remove(preset: GeneratorPreset): void {
    if (!this.presets.remove(preset.id)) {
      this.error.set('That preset could not be removed.');
      return;
    }
    if (this.editingId() === preset.id) {
      this.cancelEdit();
    }
  }

  protected setDefault(preset: GeneratorPreset): void {
    if (!this.presets.setDefault(preset.id)) {
      this.error.set('Unlock a vault first — presets are stored inside it.');
    }
  }
}
