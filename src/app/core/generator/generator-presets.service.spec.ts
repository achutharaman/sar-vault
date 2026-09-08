import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { KdbxDocument } from '../format/kdbx';
import { VaultService } from '../vault/vault.service';

import { BUILT_IN_PRESETS, GeneratorPresetsService } from './generator-presets.service';
import { DEFAULT_OPTIONS } from './password-generator';

const PASSWORD = 'a sufficiently long master password';

describe('GeneratorPresetsService', () => {
  let service: GeneratorPresetsService;
  let vault: VaultService;

  beforeEach(() => {
    vault = TestBed.inject(VaultService);
    service = TestBed.inject(GeneratorPresetsService);
  });

  /** Presets live in the vault, so most behaviour needs one open. */
  function openVault(): void {
    vault.createVault(PASSWORD, 'Test Vault');
  }

  describe('with no vault open', () => {
    it('offers the built-ins only', () => {
      expect(service.presets().map((p) => p.id)).toEqual(BUILT_IN_PRESETS.map((p) => p.id));
      expect(service.customPresets()).toEqual([]);
      expect(service.canCustomise()).toBe(false);
    });

    it('still generates, so the editor is never broken', () => {
      expect(service.generate()).toHaveLength(DEFAULT_OPTIONS.length);
    });

    /*
     * Reporting failure matters: silently accepting a preset that has nowhere
     * to go would look like it saved and then vanish.
     */
    it('refuses to customise and says so', () => {
      expect(service.add('Tiny', DEFAULT_OPTIONS)).toBeUndefined();
      expect(service.setDefault('pin')).toBe(false);
      expect(service.customPresets()).toEqual([]);
    });
  });

  describe('with a vault open', () => {
    beforeEach(() => openVault());

    it('allows customising', () => {
      expect(service.canCustomise()).toBe(true);
    });

    it('ships built-ins that can all actually generate', () => {
      for (const preset of service.presets()) {
        expect(() => service.generate(preset.id)).not.toThrow();
      }
    });

    it('generates from a named preset', () => {
      expect(service.generate('pin')).toMatch(/^\d{6}$/);
    });

    it('falls back to the default for an unknown preset id', () => {
      expect(service.generate('no-such-preset')).toHaveLength(DEFAULT_OPTIONS.length);
    });

    it('adds a custom preset alongside the built-ins', () => {
      const preset = service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 });

      expect(preset?.builtIn).toBe(false);
      expect(service.presets()).toHaveLength(BUILT_IN_PRESETS.length + 1);
      expect(service.customPresets()).toHaveLength(1);
      expect(service.generate(preset!.id)).toHaveLength(8);
    });

    it('marks the vault dirty, since presets are now vault content', () => {
      vault.save();
      service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 });

      expect(vault.dirty()).toBe(true);
    });

    it('updates a custom preset', () => {
      const preset = service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 })!;

      expect(
        service.update(preset.id, { name: 'Tiny v2', options: { ...DEFAULT_OPTIONS, length: 9 } }),
      ).toBe(true);
      expect(service.byId(preset.id)?.name).toBe('Tiny v2');
      expect(service.generate(preset.id)).toHaveLength(9);
    });

    /*
     * Built-ins are immutable so every vault keeps a known-good set that a bad
     * edit cannot break. "Duplicate" in the UI is how you customise one.
     */
    it('refuses to edit or delete a built-in', () => {
      expect(service.update('strong', { name: 'Hacked' })).toBe(false);
      expect(service.remove('strong')).toBe(false);
      expect(service.byId('strong')?.name).toBe('Strong (20)');
    });

    it('changes the default, including to a built-in', () => {
      expect(service.setDefault('pin')).toBe(true);
      expect(service.defaultPreset().id).toBe('pin');
      expect(service.generate()).toMatch(/^\d{6}$/);
    });

    it('ignores a default that does not exist', () => {
      expect(service.setDefault('nope')).toBe(false);
      expect(service.defaultPreset().id).toBe('strong');
    });

    it('falls back to a built-in when the default custom preset is removed', () => {
      const preset = service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 })!;
      service.setDefault(preset.id);

      expect(service.remove(preset.id)).toBe(true);
      expect(service.defaultPreset().builtIn).toBe(true);
      expect(() => service.generate()).not.toThrow();
    });

    it('removes all custom presets, leaving the built-ins', () => {
      service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 });
      service.resetToDefaults();

      expect(service.customPresets()).toEqual([]);
      expect(service.presets()).toHaveLength(BUILT_IN_PRESETS.length);
    });
  });

  describe('persistence in the vault file', () => {
    /*
     * The whole point of the move: presets have to survive a save/reopen cycle
     * and travel with the file, rather than living in one browser.
     */
    it('survives a save and reopen', async () => {
      openVault();
      const preset = service.add('Tiny', { ...DEFAULT_OPTIONS, length: 8 })!;
      service.setDefault(preset.id);

      const document = (service as unknown as { vault: { document: KdbxDocument } }).vault.document;
      const bytes = await document.save();

      // Reopen as a fresh session would.
      vault.lock();
      expect(service.customPresets()).toEqual([]);

      vault.selectFile(new File([bytes], 'test.kdbx'));
      expect(await vault.unlock(PASSWORD)).toBe(true);

      expect(service.customPresets().map((p) => p.name)).toEqual(['Tiny']);
      expect(service.defaultPreset().name).toBe('Tiny');
      expect(service.generate()).toHaveLength(8);
    });

    it('leaves no settings blob behind when nothing is customised', () => {
      openVault();
      service.add('Tiny', DEFAULT_OPTIONS);
      service.resetToDefaults();

      expect(vault.readSetting('sar-vault.generator')).toBeUndefined();
    });

    it('ignores a corrupt settings blob rather than breaking the generator', () => {
      openVault();
      vault.writeSetting('sar-vault.generator', 'not json at all');

      expect(service.presets()).toHaveLength(BUILT_IN_PRESETS.length);
      expect(() => service.generate()).not.toThrow();
    });

    it('drops a stored preset with no character classes enabled', () => {
      openVault();
      vault.writeSetting(
        'sar-vault.generator',
        JSON.stringify({
          presets: [
            {
              id: 'broken',
              name: 'Broken',
              options: {
                ...DEFAULT_OPTIONS,
                lowercase: false,
                uppercase: false,
                digits: false,
                symbols: false,
              },
            },
          ],
          defaultId: 'broken',
        }),
      );

      expect(service.byId('broken')).toBeUndefined();
      expect(service.defaultPreset().builtIn).toBe(true);
      expect(() => service.generate()).not.toThrow();
    });
  });
});
