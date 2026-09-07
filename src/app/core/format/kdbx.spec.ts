import * as kdbxweb from 'kdbxweb';
import { beforeAll, describe, expect, it } from 'vitest';

import { KdbxDocument, registerArgon2, VaultOpenError } from './kdbx';

const PASSWORD = 'correct horse battery staple';

async function newVaultBytes(password = PASSWORD): Promise<ArrayBuffer> {
  const doc = KdbxDocument.create(password, 'Test Vault');
  doc.addEntry({
    title: 'GitHub',
    username: 'achutharaman',
    password: 'hunter2',
    url: 'https://github.com',
    notes: 'primary account',
  });
  return doc.save();
}

describe('KDBX round-trip', () => {
  beforeAll(() => {
    registerArgon2();
  });

  it('writes a file with the KDBX magic signature', async () => {
    const bytes = new Uint8Array(await newVaultBytes());
    // KDBX signature: 0x9AA2D903, 0xB54BFB67 little-endian.
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x03, 0xd9, 0xa2, 0x9a, 0x67, 0xfb, 0x4b, 0xb5]);
  });

  it('reopens a vault it wrote and preserves entry content', async () => {
    const reopened = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    const vault = reopened.toDomain();

    expect(vault.name).toBe('Test Vault');
    expect(vault.entries).toHaveLength(1);

    const entry = vault.entries[0];
    expect(entry?.title).toBe('GitHub');
    expect(entry?.username).toBe('achutharaman');
    expect(entry?.password).toBe('hunter2');
    expect(entry?.url).toBe('https://github.com');
    expect(entry?.notes).toBe('primary account');
  });

  it('survives repeated save/open cycles without drift', async () => {
    let bytes = await newVaultBytes();
    for (let i = 0; i < 3; i++) {
      const doc = await KdbxDocument.open(bytes, PASSWORD);
      bytes = await doc.save();
    }

    const vault = (await KdbxDocument.open(bytes, PASSWORD)).toDomain();
    expect(vault.entries[0]?.password).toBe('hunter2');
  });

  it('writes new vaults with Argon2id, as SECURITY.md commits to', async () => {
    const bytes = await newVaultBytes();
    const db = await kdbxweb.Kdbx.load(
      bytes,
      new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(PASSWORD)),
    );

    // $UUID of the KDF parameters identifies the algorithm. If kdbxweb had
    // fallen back to AES-KDF, or our setArgon2Impl were never called, this
    // would differ — and the round-trip tests above would still pass, which is
    // why this is asserted separately.
    const kdfUuid = db.header.kdfParameters?.get('$UUID');
    const uuidBase64 =
      kdfUuid instanceof ArrayBuffer
        ? btoa(String.fromCharCode(...new Uint8Array(kdfUuid)))
        : undefined;

    expect(uuidBase64).toBe(kdbxweb.Consts.KdfId.Argon2id);
  });
});

describe('KDBX error reporting', () => {
  it('reports a wrong password distinctly', async () => {
    const bytes = await newVaultBytes();

    await expect(KdbxDocument.open(bytes, 'not the password')).rejects.toThrow(VaultOpenError);
    await expect(KdbxDocument.open(bytes, 'not the password')).rejects.toMatchObject({
      wrongPassword: true,
    });
  });

  it('reports a non-vault file distinctly from a wrong password', async () => {
    const notAVault = new TextEncoder().encode('this is a text file, not a vault').buffer;

    const error = await KdbxDocument.open(notAVault, PASSWORD).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VaultOpenError);
    expect((error as VaultOpenError).wrongPassword).toBe(false);
    expect((error as VaultOpenError).message).toMatch(/not a KDBX vault/);
  });
});

describe('entry editing', () => {
  it('updates an entry and keeps the change after a save/open cycle', async () => {
    const doc = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    const id = doc.toDomain().entries[0]?.id ?? '';

    expect(
      doc.updateEntry(id, {
        title: 'GitHub (work)',
        username: 'achutharaman',
        password: 'a better password',
        url: 'https://github.com',
        notes: 'rotated',
      }),
    ).toBe(true);

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    const entry = reopened.toDomain().entries.find((e) => e.id === id);

    expect(entry?.title).toBe('GitHub (work)');
    expect(entry?.password).toBe('a better password');
  });

  it('adds an entry that persists', async () => {
    const doc = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    doc.addEntry({
      title: 'Second',
      username: 'u',
      password: 'p',
      url: '',
      notes: '',
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    expect(
      reopened
        .toDomain()
        .entries.map((e) => e.title)
        .sort(),
    ).toEqual(['GitHub', 'Second']);
  });

  it('reports an unknown entry id rather than failing silently', async () => {
    const doc = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    expect(
      doc.updateEntry('no-such-id', {
        title: '',
        username: '',
        password: '',
        url: '',
        notes: '',
      }),
    ).toBe(false);
    expect(doc.removeEntry('no-such-id')).toBe(false);
  });

  /*
   * The reason KdbxDocument keeps the parsed Kdbx rather than rebuilding from
   * the domain model. A field this app does not model must survive an edit and
   * save — otherwise opening a KeePassXC vault here would quietly strip data.
   */
  it('preserves custom fields it does not model across an edit and save', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'Has extras',
      username: 'u',
      password: 'p',
      url: '',
      notes: '',
    });

    // Reach through to add a field the domain model has no concept of.
    const inner = await KdbxDocument.open(await doc.save(), PASSWORD);
    const reopenedDoc = inner as unknown as { db: kdbxweb.Kdbx };
    const entry = reopenedDoc.db.getDefaultGroup().entries.find((e) => e.uuid.id === created.id);
    entry?.fields.set('TOTP Seed', 'JBSWY3DPEHPK3PXP');

    const savedOnce = await inner.save();
    const roundTripped = await KdbxDocument.open(savedOnce, PASSWORD);

    // Edit through our own API, then save again.
    roundTripped.updateEntry(created.id, {
      title: 'Has extras (edited)',
      username: 'u',
      password: 'p2',
      url: '',
      notes: '',
    });

    const final = await KdbxDocument.open(await roundTripped.save(), PASSWORD);
    const finalDoc = final as unknown as { db: kdbxweb.Kdbx };
    const finalEntry = finalDoc.db.getDefaultGroup().entries.find((e) => e.uuid.id === created.id);

    expect(finalEntry?.fields.get('TOTP Seed')).toBe('JBSWY3DPEHPK3PXP');
    expect(final.toDomain().entries.find((e) => e.id === created.id)?.title).toBe(
      'Has extras (edited)',
    );
  });
});
