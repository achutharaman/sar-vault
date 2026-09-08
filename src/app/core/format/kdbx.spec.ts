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

describe('tags, custom fields, TOTP and history', () => {
  it('round-trips tags', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'Tagged',
      username: '',
      password: '',
      url: '',
      notes: '',
      tags: ['work', 'critical'],
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    const entry = reopened.toDomain().entries.find((e) => e.id === created.id);

    expect(entry?.tags).toEqual(['work', 'critical']);
  });

  it('round-trips custom fields and keeps protected ones protected', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'Has extras',
      username: '',
      password: '',
      url: '',
      notes: '',
      customFields: [
        { name: 'Recovery code', value: 'abc-123', protected: true },
        { name: 'Account number', value: '99887766', protected: false },
      ],
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    const entry = reopened.toDomain().entries.find((e) => e.id === created.id);

    const recovery = entry?.customFields.find((f) => f.name === 'Recovery code');
    const account = entry?.customFields.find((f) => f.name === 'Account number');

    expect(recovery?.value).toBe('abc-123');
    // The protected flag must survive: losing it writes the secret as plain XML.
    expect(recovery?.protected).toBe(true);
    expect(account?.value).toBe('99887766');
    expect(account?.protected).toBe(false);
  });

  it('does not leak standard fields into customFields', async () => {
    const doc = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    const entry = doc.toDomain().entries[0];

    expect(entry?.customFields.map((f) => f.name)).not.toContain('Title');
    expect(entry?.customFields.map((f) => f.name)).not.toContain('Password');
  });

  it('stores a TOTP seed as an otpauth URI and reads it back', async () => {
    const uri = 'otpauth://totp/GitHub:me?secret=MZXW6YTBOI&issuer=GitHub&period=30&digits=6';
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'GitHub',
      username: '',
      password: '',
      url: '',
      notes: '',
      totpUri: uri,
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    expect(reopened.toDomain().entries.find((e) => e.id === created.id)?.totpUri).toBe(uri);
  });

  /*
   * Older KeePassXC entries store a bare base32 seed plus a "period;digits"
   * settings string rather than a URI. Those must be readable, or a vault
   * migrated from KeePassXC would appear to lose its 2FA seeds.
   */
  it('reads a legacy KeePassXC TOTP Seed / TOTP Settings pair', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'Legacy',
      username: '',
      password: '',
      url: '',
      notes: '',
    });

    const inner = doc as unknown as { db: kdbxweb.Kdbx };
    const raw = inner.db.getDefaultGroup().entries.find((e) => e.uuid.id === created.id);
    raw?.fields.set('TOTP Seed', 'MZXW6YTBOI');
    raw?.fields.set('TOTP Settings', '60;8');

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    const uri = reopened.toDomain().entries.find((e) => e.id === created.id)?.totpUri;

    expect(uri).toContain('otpauth://totp/');
    expect(uri).toContain('secret=MZXW6YTBOI');
    expect(uri).toContain('period=60');
    expect(uri).toContain('digits=8');
  });

  it('clears a TOTP seed when the draft passes an empty URI', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'GitHub',
      username: '',
      password: '',
      url: '',
      notes: '',
      totpUri: 'otpauth://totp/GitHub?secret=MZXW6YTBOI',
    });

    doc.updateEntry(created.id, {
      title: 'GitHub',
      username: '',
      password: '',
      url: '',
      notes: '',
      totpUri: '',
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    expect(reopened.toDomain().entries.find((e) => e.id === created.id)?.totpUri).toBeUndefined();
  });

  it('exposes history newest first after edits', async () => {
    const doc = KdbxDocument.open ? await KdbxDocument.open(await newVaultBytes(), PASSWORD) : null;
    const id = doc!.toDomain().entries[0]?.id ?? '';

    doc!.updateEntry(id, {
      title: 'GitHub v2',
      username: 'achutharaman',
      password: 'second',
      url: '',
      notes: '',
    });
    doc!.updateEntry(id, {
      title: 'GitHub v3',
      username: 'achutharaman',
      password: 'third',
      url: '',
      notes: '',
    });

    const reopened = await KdbxDocument.open(await doc!.save(), PASSWORD);
    const entry = reopened.toDomain().entries.find((e) => e.id === id);

    expect(entry?.title).toBe('GitHub v3');
    expect(entry?.history.length).toBeGreaterThanOrEqual(2);
    // Newest first, so the UI can show "most recent previous value" at the top.
    const times = entry!.history.map((h) => h.modified.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(entry?.history.map((h) => h.password)).toContain('hunter2');
  });

  /*
   * The guarantee that makes editing safe: a field this app does not model must
   * survive an edit made through this app.
   */
  it('preserves unmodelled fields when custom fields are rewritten', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const created = doc.addEntry({
      title: 'Entry',
      username: '',
      password: '',
      url: '',
      notes: '',
      customFields: [{ name: 'Keep me', value: 'yes', protected: false }],
    });

    doc.updateEntry(created.id, {
      title: 'Entry edited',
      username: '',
      password: '',
      url: '',
      notes: '',
      customFields: [{ name: 'Keep me', value: 'still yes', protected: false }],
    });

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    const entry = reopened.toDomain().entries.find((e) => e.id === created.id);

    expect(entry?.customFields.find((f) => f.name === 'Keep me')?.value).toBe('still yes');
  });
});

describe('app settings in custom data', () => {
  it('round-trips a setting through a save and reopen', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    doc.writeSetting('sar-vault.test', '{"hello":"world"}');

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);

    expect(reopened.readSetting('sar-vault.test')).toBe('{"hello":"world"}');
  });

  it('returns undefined for a key that was never written', async () => {
    const doc = await KdbxDocument.open(await newVaultBytes(), PASSWORD);
    expect(doc.readSetting('sar-vault.absent')).toBeUndefined();
  });

  it('removes a setting when the value is undefined', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    doc.writeSetting('sar-vault.test', 'value');
    doc.writeSetting('sar-vault.test', undefined);

    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);
    expect(reopened.readSetting('sar-vault.test')).toBeUndefined();
  });

  /*
   * Custom data is shared with every other KeePass client. Writing our key must
   * not disturb one another client wrote, or saving here would strip their
   * settings.
   */
  it('leaves custom data written by other clients alone', async () => {
    const doc = KdbxDocument.create(PASSWORD, 'Test Vault');
    const inner = doc as unknown as { db: kdbxweb.Kdbx };
    inner.db.meta.customData.set('KeePassXC_Other', { value: 'theirs' });

    doc.writeSetting('sar-vault.test', 'ours');
    const reopened = await KdbxDocument.open(await doc.save(), PASSWORD);

    expect(reopened.readSetting('KeePassXC_Other')).toBe('theirs');
    expect(reopened.readSetting('sar-vault.test')).toBe('ours');
  });
});
