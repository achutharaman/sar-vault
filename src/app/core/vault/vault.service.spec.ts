import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { KdbxDocument } from '../format/kdbx';
import { VaultService } from './vault.service';

const PASSWORD = 'correct horse battery staple';

/** Build a real KDBX file and wrap it as a `File`, as the picker would. */
async function vaultFile(password = PASSWORD): Promise<File> {
  const doc = KdbxDocument.create(password, 'Test Vault');
  doc.addEntry({
    title: 'GitHub',
    username: 'achutharaman',
    password: 'hunter2',
    url: 'https://github.com',
    notes: '',
  });
  doc.addEntry({
    title: 'Email',
    username: 'me@example.com',
    password: 'swordfish',
    url: 'https://mail.example.com',
    notes: '',
  });
  return new File([await doc.save()], 'test.kdbx', { lastModified: 1_700_000_000_000 });
}

describe('VaultService', () => {
  let service: VaultService;

  beforeEach(() => {
    service = TestBed.inject(VaultService);
  });

  it('starts locked with nothing loaded', () => {
    expect(service.status()).toBe('locked');
    expect(service.vault()).toBeUndefined();
    expect(service.isUnlocked()).toBe(false);
  });

  it('refuses to unlock before a file is chosen', async () => {
    expect(await service.unlock(PASSWORD)).toBe(false);
    expect(service.error()).toMatch(/Choose a vault file/);
  });

  it('unlocks a real vault and exposes its entries', async () => {
    service.selectFile(await vaultFile());

    expect(await service.unlock(PASSWORD)).toBe(true);
    expect(service.status()).toBe('unlocked');
    expect(service.vault()?.name).toBe('Test Vault');
    expect(service.visibleEntries()).toHaveLength(2);
    expect(service.dirty()).toBe(false);
  });

  it('reports a wrong password and stays locked', async () => {
    service.selectFile(await vaultFile());

    expect(await service.unlock('wrong')).toBe(false);
    expect(service.status()).toBe('locked');
    expect(service.error()).toMatch(/Wrong password/);
    expect(service.vault()).toBeUndefined();
  });

  it('drops every reference to vault contents on lock', async () => {
    service.selectFile(await vaultFile());
    await service.unlock(PASSWORD);
    service.setSearch('git');

    service.lock();

    expect(service.status()).toBe('locked');
    expect(service.vault()).toBeUndefined();
    expect(service.visibleEntries()).toEqual([]);
    expect(service.search()).toBe('');
    expect(service.dirty()).toBe(false);
  });

  it('sorts entries by title and filters on search', async () => {
    service.selectFile(await vaultFile());
    await service.unlock(PASSWORD);

    expect(service.visibleEntries().map((e) => e.title)).toEqual(['Email', 'GitHub']);

    service.setSearch('github');
    expect(service.visibleEntries().map((e) => e.title)).toEqual(['GitHub']);

    // Search covers username and URL, not just title.
    service.setSearch('me@example.com');
    expect(service.visibleEntries().map((e) => e.title)).toEqual(['Email']);

    service.setSearch('nothing matches this');
    expect(service.visibleEntries()).toEqual([]);
  });

  it('creates a new vault already unlocked and marked unsaved', () => {
    service.createVault(PASSWORD, 'Fresh');

    expect(service.status()).toBe('unlocked');
    expect(service.vault()?.name).toBe('Fresh');
    expect(service.dirty()).toBe(true);
    expect(service.fileName()).toBe('Fresh.kdbx');
  });

  it('adds, updates and deletes entries, marking the vault dirty', async () => {
    service.selectFile(await vaultFile());
    await service.unlock(PASSWORD);

    service.addEntry({
      title: 'Bank',
      username: 'acct',
      password: 'p',
      url: '',
      notes: '',
    });
    expect(service.dirty()).toBe(true);
    expect(service.visibleEntries().map((e) => e.title)).toEqual(['Bank', 'Email', 'GitHub']);

    const github = service.visibleEntries().find((e) => e.title === 'GitHub');
    service.updateEntry(github?.id ?? '', {
      title: 'GitHub (work)',
      username: 'achutharaman',
      password: 'rotated',
      url: 'https://github.com',
      notes: '',
    });
    const updated = service.visibleEntries().find((e) => e.id === github?.id);
    expect(updated?.title).toBe('GitHub (work)');
    expect(updated?.password).toBe('rotated');

    service.deleteEntry(github?.id ?? '');
    expect(service.visibleEntries().some((e) => e.id === github?.id)).toBe(false);
  });

  it('ignores edits when no vault is open, rather than throwing', () => {
    expect(() => {
      service.addEntry({ title: 'x', username: '', password: '', url: '', notes: '' });
      service.updateEntry('nope', { title: '', username: '', password: '', url: '', notes: '' });
      service.deleteEntry('nope');
    }).not.toThrow();
    expect(service.vault()).toBeUndefined();
  });

  /*
   * The save path is asserted end to end — serialize, then reopen the produced
   * bytes — because a save that silently produced an unreadable file is the
   * worst failure this app could have.
   */
  it('saves to bytes that can be reopened with the same password', async () => {
    service.selectFile(await vaultFile());
    await service.unlock(PASSWORD);
    service.addEntry({
      title: 'Added before save',
      username: 'u',
      password: 'p',
      url: '',
      notes: '',
    });

    // Exercise the document directly: writing through the provider in a test
    // would trigger a browser download.
    const document = (service as unknown as { document: KdbxDocument }).document;
    const bytes = await document.save();

    const reopened = await KdbxDocument.open(bytes, PASSWORD);
    expect(
      reopened
        .toDomain()
        .entries.map((e) => e.title)
        .sort(),
    ).toEqual(['Added before save', 'Email', 'GitHub']);
  });
});
