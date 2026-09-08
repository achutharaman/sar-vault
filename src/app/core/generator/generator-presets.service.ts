import { computed, inject, Injectable } from '@angular/core';

import { VaultService } from '../vault/vault.service';

import { DEFAULT_OPTIONS, type GeneratorOptions, generatePassword } from './password-generator';

/** A named generator configuration. */
export interface GeneratorPreset {
  readonly id: string;
  readonly name: string;
  readonly options: GeneratorOptions;
  /** Built-ins ship with the app and cannot be edited or deleted. */
  readonly builtIn: boolean;
}

/**
 * Key in the vault's `Meta/CustomData`.
 *
 * Namespaced, because custom data is shared with every other KeePass client
 * that opens the file.
 */
const SETTING_KEY = 'sar-vault.generator';

/**
 * The presets that ship with the app.
 *
 * These live in code, not in the vault: every vault gets them, they cannot be
 * broken by a bad edit, and one added in a later release appears for everyone
 * without a migration.
 */
export const BUILT_IN_PRESETS: readonly GeneratorPreset[] = [
  { id: 'strong', name: 'Strong (20)', builtIn: true, options: { ...DEFAULT_OPTIONS } },
  {
    id: 'no-symbols',
    name: 'Letters & digits (16)',
    builtIn: true,
    options: { ...DEFAULT_OPTIONS, length: 16, symbols: false },
  },
  {
    id: 'pin',
    name: 'Numeric PIN (6)',
    builtIn: true,
    options: {
      ...DEFAULT_OPTIONS,
      length: 6,
      lowercase: false,
      uppercase: false,
      symbols: false,
      digits: true,
      // A 6-digit PIN cannot contain four character classes.
      requireEachClass: false,
    },
  },
  { id: 'long', name: 'Long (32)', builtIn: true, options: { ...DEFAULT_OPTIONS, length: 32 } },
];

/** What is persisted in the vault: the user's own presets, and their default. */
interface StoredState {
  presets: { id: string; name: string; options: GeneratorOptions }[];
  defaultId: string;
}

/**
 * Password generator presets.
 *
 * Built-ins come from code; anything the user creates is stored **inside the
 * vault file**, in `Meta/CustomData`. Presets therefore follow the vault between
 * devices and browsers rather than being stranded in one browser's
 * `localStorage`, and they are covered by the same encryption as the rest of the
 * file.
 *
 * The cost, surfaced in the UI: changing a preset marks the vault dirty and is
 * only durable once saved. With no vault open, only the built-ins exist.
 */
@Injectable({ providedIn: 'root' })
export class GeneratorPresetsService {
  private readonly vault = inject(VaultService);

  /** The user's own presets, read from the open vault. */
  private readonly stored = computed<StoredState>(() => {
    const raw = this.vault.readSetting(SETTING_KEY);
    if (!raw) {
      return { presets: [], defaultId: BUILT_IN_PRESETS[0]!.id };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<StoredState>;
      return {
        presets: (parsed.presets ?? []).filter(isValidStoredPreset),
        defaultId: parsed.defaultId ?? BUILT_IN_PRESETS[0]!.id,
      };
    } catch {
      // The vault is decrypted and authenticated, so this is not an attack
      // surface — but it may have been written by an older version or edited by
      // hand, and a malformed preset reaching the generator would throw on
      // every click.
      return { presets: [], defaultId: BUILT_IN_PRESETS[0]!.id };
    }
  });

  readonly presets = computed<GeneratorPreset[]>(() => [
    ...BUILT_IN_PRESETS,
    ...this.stored().presets.map((preset) => ({ ...preset, builtIn: false })),
  ]);

  /** Whether presets can currently be changed — i.e. a vault is open. */
  readonly canCustomise = computed(() => this.vault.isUnlocked());

  readonly defaultId = computed(() => {
    const stored = this.stored().defaultId;
    return this.presets().some((preset) => preset.id === stored) ? stored : BUILT_IN_PRESETS[0]!.id;
  });

  readonly defaultPreset = computed<GeneratorPreset>(
    () => this.presets().find((preset) => preset.id === this.defaultId()) ?? BUILT_IN_PRESETS[0]!,
  );

  /** Presets the user created, which are the only editable ones. */
  readonly customPresets = computed(() => this.presets().filter((preset) => !preset.builtIn));

  byId(id: string): GeneratorPreset | undefined {
    return this.presets().find((preset) => preset.id === id);
  }

  /** Generate using a named preset, or the default when none is given. */
  generate(presetId?: string): string {
    const preset = (presetId ? this.byId(presetId) : undefined) ?? this.defaultPreset();
    return generatePassword(preset.options);
  }

  add(name: string, options: GeneratorOptions): GeneratorPreset | undefined {
    const preset = {
      id: `preset-${crypto.randomUUID()}`,
      name: name.trim() || 'Untitled',
      options: { ...options },
    };
    const state = this.stored();
    if (!this.persist({ ...state, presets: [...state.presets, preset] })) {
      return undefined;
    }
    return { ...preset, builtIn: false };
  }

  /** Built-ins are immutable; this only affects the user's own presets. */
  update(id: string, changes: { name?: string; options?: GeneratorOptions }): boolean {
    const state = this.stored();
    if (!state.presets.some((preset) => preset.id === id)) {
      return false;
    }
    return this.persist({
      ...state,
      presets: state.presets.map((preset) =>
        preset.id === id
          ? {
              ...preset,
              name: changes.name?.trim() || preset.name,
              options: changes.options ? { ...changes.options } : preset.options,
            }
          : preset,
      ),
    });
  }

  /**
   * Remove one of the user's presets.
   *
   * Built-ins cannot be removed, so at least one preset always remains and
   * `defaultPreset()` can never point at nothing.
   */
  remove(id: string): boolean {
    const state = this.stored();
    if (!state.presets.some((preset) => preset.id === id)) {
      return false;
    }
    return this.persist({
      presets: state.presets.filter((preset) => preset.id !== id),
      defaultId: state.defaultId === id ? BUILT_IN_PRESETS[0]!.id : state.defaultId,
    });
  }

  setDefault(id: string): boolean {
    if (!this.byId(id)) {
      return false;
    }
    return this.persist({ ...this.stored(), defaultId: id });
  }

  /** Discard the user's presets, leaving the built-ins. */
  resetToDefaults(): boolean {
    return this.persist({ presets: [], defaultId: BUILT_IN_PRESETS[0]!.id });
  }

  /**
   * Write state back into the vault.
   *
   * Returns false when no vault is open — the caller surfaces that rather than
   * appearing to save into nothing.
   */
  private persist(state: StoredState): boolean {
    const isDefaultState =
      state.presets.length === 0 && state.defaultId === BUILT_IN_PRESETS[0]!.id;
    // Don't leave an empty settings blob behind in someone's vault.
    return this.vault.writeSetting(SETTING_KEY, isDefaultState ? undefined : JSON.stringify(state));
  }
}

function isValidStoredPreset(value: unknown): value is StoredState['presets'][number] {
  const preset = value as { id?: unknown; name?: unknown; options?: Partial<GeneratorOptions> };
  const options = preset?.options;

  return (
    typeof preset?.id === 'string' &&
    typeof preset.name === 'string' &&
    typeof options?.length === 'number' &&
    Number.isInteger(options.length) &&
    options.length > 0 &&
    typeof options.lowercase === 'boolean' &&
    typeof options.uppercase === 'boolean' &&
    typeof options.digits === 'boolean' &&
    typeof options.symbols === 'boolean' &&
    // At least one class must be enabled, or generate() would throw.
    (options.lowercase || options.uppercase || options.digits || options.symbols)
  );
}
