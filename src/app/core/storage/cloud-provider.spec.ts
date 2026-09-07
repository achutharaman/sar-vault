import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotConnectedError } from './cloud-provider';
import { GoogleDriveProvider } from './google-drive.provider';
import { OneDriveProvider } from './onedrive.provider';
import { VersionConflictError } from './types';

const REDIRECT = 'http://localhost:4200/auth/callback';

/** Give a provider a live token without going through a real redirect. */
function connect(provider: GoogleDriveProvider | OneDriveProvider): void {
  const oauth = (provider as unknown as { oauth: { token: unknown } }).oauth;
  oauth.token = { value: 'test-token', expiresAt: Date.now() + 3_600_000 };
}

const json = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
  }) as Response;

describe('cloud provider plumbing', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unavailable until a client ID is configured', () => {
    expect(new GoogleDriveProvider('', REDIRECT).isAvailable()).toBe(false);
    expect(new GoogleDriveProvider('client-id', REDIRECT).isAvailable()).toBe(true);
  });

  it('refuses to make requests before connecting', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);

    await expect(provider.list()).rejects.toThrow(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the bearer token on every request', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ files: [] }));

    await provider.list();

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });

  /*
   * An expired token is a normal state, not a fault: tokens live in memory only
   * and are short-lived by design (Q-005). The provider must drop the dead
   * token and say so, rather than retrying forever.
   */
  it('disconnects and reports clearly on 401', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({}, 401));

    await expect(provider.list()).rejects.toThrow(NotConnectedError);
    expect(provider.isConnected()).toBe(false);
  });

  it('translates 412 into a version conflict rather than a generic failure', async () => {
    const provider = new OneDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({}, 412));

    await expect(
      provider.write(
        { providerId: 'onedrive', id: 'item-1', name: 'v.kdbx' },
        new ArrayBuffer(8),
        'ctag-old',
      ),
    ).rejects.toThrow(VersionConflictError);
  });
});

describe('GoogleDriveProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('requests the drive.file scope, not the hidden appdata folder', () => {
    // Q-008: appdata would hide the vault from the user, contradicting the
    // "your storage, no lock-in" premise.
    expect(GoogleDriveProvider.SCOPES).toEqual(['https://www.googleapis.com/auth/drive.file']);
    expect(GoogleDriveProvider.SCOPES.join(' ')).not.toContain('appdata');
  });

  it('reads content together with a version token', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('alt=media') ? json({}) : json({ name: 'v.kdbx', size: '3', version: '7' }),
      ),
    );

    const { data, version } = await provider.read({
      providerId: 'google-drive',
      id: 'file-1',
      name: 'v.kdbx',
    });

    expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
    expect(version).toBe('7');
  });

  /*
   * Drive v3 has no If-Match on upload, so the check is read-then-compare. The
   * important behaviour is that a stale version aborts *before* any bytes are
   * written — not that the check is atomic, which Google does not allow.
   */
  it('refuses to overwrite when the remote version moved on', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ name: 'v.kdbx', version: '9' }));

    await expect(
      provider.write(
        { providerId: 'google-drive', id: 'file-1', name: 'v.kdbx' },
        new ArrayBuffer(8),
        '7',
      ),
    ).rejects.toThrow(VersionConflictError);

    // Crucially, no upload was attempted.
    const uploads = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/upload/'));
    expect(uploads).toHaveLength(0);
  });

  it('uploads when the version still matches', async () => {
    const provider = new GoogleDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ name: 'v.kdbx', version: '7' }));

    await provider.write(
      { providerId: 'google-drive', id: 'file-1', name: 'v.kdbx' },
      new ArrayBuffer(8),
      '7',
    );

    const uploads = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/upload/'));
    expect(uploads).toHaveLength(1);
    expect((uploads[0]?.[1] as RequestInit).method).toBe('PATCH');
  });
});

describe('OneDriveProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses a conditional write, so the check is atomic', async () => {
    const provider = new OneDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ id: 'item-1', name: 'v.kdbx', cTag: 'ctag-new' }));

    const result = await provider.write(
      { providerId: 'onedrive', id: 'item-1', name: 'v.kdbx' },
      new ArrayBuffer(8),
      'ctag-old',
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['if-match']).toBe('ctag-old');
    expect(result.version).toBe('ctag-new');
  });

  it('omits if-match when there is no known version, so a first write succeeds', async () => {
    const provider = new OneDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ id: 'item-1', name: 'v.kdbx', cTag: 'ctag-1' }));

    await provider.write(
      { providerId: 'onedrive', id: 'item-1', name: 'v.kdbx' },
      new ArrayBuffer(8),
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['if-match']).toBeUndefined();
  });

  it('lists only vault files from the app folder', async () => {
    const provider = new OneDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(
      json({
        value: [
          { id: '1', name: 'personal.kdbx' },
          { id: '2', name: 'notes.txt' },
        ],
      }),
    );

    const refs = await provider.list();

    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe('personal.kdbx');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('special/approot');
  });

  it('prefers cTag over eTag as the version token', async () => {
    const provider = new OneDriveProvider('client-id', REDIRECT);
    connect(provider);
    fetchMock.mockResolvedValue(json({ id: '1', name: 'v.kdbx', cTag: 'c1', eTag: 'e1' }));

    // eTag changes on metadata edits too; cTag tracks content, which is what
    // "did the bytes move on" actually needs.
    expect(
      (await provider.getMetadata({ providerId: 'onedrive', id: '1', name: 'v.kdbx' })).version,
    ).toBe('c1');
  });
});
