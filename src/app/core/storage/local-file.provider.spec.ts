import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalFileProvider } from './local-file.provider';

const makeFile = (name: string, bytes: number[], lastModified = 1_700_000_000_000): File =>
  new File([new Uint8Array(bytes)], name, { lastModified });

describe('LocalFileProvider', () => {
  it('reads back a registered file with a version token', async () => {
    const provider = new LocalFileProvider();
    const ref = provider.registerFile(makeFile('vault.kdbx', [1, 2, 3]));

    const { data, version } = await provider.read(ref);

    expect(Array.from(new Uint8Array(data))).toEqual([1, 2, 3]);
    expect(version).toBe('1700000000000');
  });

  it('reports metadata without reading the whole file into the caller', async () => {
    const provider = new LocalFileProvider();
    const ref = provider.registerFile(makeFile('vault.kdbx', [1, 2, 3, 4]));

    const meta = await provider.getMetadata(ref);

    expect(meta.name).toBe('vault.kdbx');
    expect(meta.size).toBe(4);
    expect(meta.modified?.getTime()).toBe(1_700_000_000_000);
  });

  it('lists the files opened in this session', async () => {
    const provider = new LocalFileProvider();
    provider.registerFile(makeFile('a.kdbx', [0]));
    provider.registerFile(makeFile('b.kdbx', [0]));

    expect((await provider.list()).map((r) => r.name).sort()).toEqual(['a.kdbx', 'b.kdbx']);
  });

  it('rejects an unknown reference rather than returning empty data', async () => {
    const provider = new LocalFileProvider();

    await expect(
      provider.read({ providerId: 'local', id: 'file:999', name: 'ghost.kdbx' }),
    ).rejects.toThrow(/Unknown local file reference/);
  });

  it('reports whether it can write back in place', () => {
    const provider = new LocalFileProvider();
    // Depends on the browser: true in Chromium, false in Firefox/Safari. The
    // assertion is that it answers consistently with the API's presence, not
    // which answer it gives.
    expect(provider.supportsWriteBack()).toBe(
      typeof (globalThis as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function',
    );
  });
});

/**
 * Minimal stand-in for a File System Access handle, so the write-back branch is
 * exercised without a real file picker.
 */
function fakeHandle(name: string, initial: number[], lastModified = 1_700_000_000_000) {
  const state: { bytes: Uint8Array<ArrayBuffer>; lastModified: number } = {
    bytes: Uint8Array.from(initial),
    lastModified,
  };
  const written: Uint8Array<ArrayBuffer>[] = [];
  return {
    written,
    state,
    handle: {
      name,
      getFile: () =>
        Promise.resolve(new File([state.bytes], name, { lastModified: state.lastModified })),
      createWritable: () =>
        Promise.resolve({
          write: (data: BufferSource) => {
            const source = new Uint8Array(data as ArrayBuffer);
            const copy = new Uint8Array(source.length);
            copy.set(source);
            written.push(copy);
            return Promise.resolve();
          },
          close: () => {
            const last = written[written.length - 1];
            if (last) state.bytes = last;
            state.lastModified += 1000;
            return Promise.resolve();
          },
        }),
    },
  };
}

describe('LocalFileProvider.write — write-back branch', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Register a handle through the real pick() path. */
  async function providerWithHandle(fake: ReturnType<typeof fakeHandle>) {
    const provider = new LocalFileProvider();
    vi.stubGlobal('showOpenFilePicker', () => Promise.resolve([fake.handle]));
    const ref = await provider.pick();
    return { provider, ref: ref! };
  }

  it('writes bytes back to the opened file and returns a new version', async () => {
    const fake = fakeHandle('vault.kdbx', [1, 2, 3]);
    const { provider, ref } = await providerWithHandle(fake);
    const { version: before } = await provider.read(ref);

    const result = await provider.write(ref, new Uint8Array([9, 9, 9]).buffer, before);

    expect(Array.from(fake.state.bytes)).toEqual([9, 9, 9]);
    expect(result.version).not.toBe(before);
  });

  /*
   * The point of carrying version tokens around. If the file moved on since it
   * was opened — edited in KeePassXC in another window, say — writing would
   * destroy that change, so the write must be refused before it happens.
   */
  it('refuses to overwrite a file that changed since it was read', async () => {
    const fake = fakeHandle('vault.kdbx', [1, 2, 3]);
    const { provider, ref } = await providerWithHandle(fake);

    fake.state.lastModified += 5000; // someone else saved

    await expect(provider.write(ref, new Uint8Array([9]).buffer, '1700000000000')).rejects.toThrow(
      /changed on disk/i,
    );
    expect(Array.from(fake.state.bytes)).toEqual([1, 2, 3]);
  });

  it('writes without a version check when none is known', async () => {
    const fake = fakeHandle('vault.kdbx', [1]);
    const { provider, ref } = await providerWithHandle(fake);

    await provider.write(ref, new Uint8Array([7]).buffer);

    expect(Array.from(fake.state.bytes)).toEqual([7]);
  });

  it('returns undefined from pick() when the user dismisses the dialog', async () => {
    const provider = new LocalFileProvider();
    vi.stubGlobal('showOpenFilePicker', () =>
      Promise.reject(new DOMException('aborted', 'AbortError')),
    );

    await expect(provider.pick()).resolves.toBeUndefined();
  });
});

describe('LocalFileProvider.write — download fallback', () => {
  // unstubAllGlobals does not undo spies. Without restoreAllMocks the next
  // test's `document.createElement.bind(document)` captures this test's mock
  // and recurses until the stack blows.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Capture the anchor the provider builds, instead of navigating. */
  function captureDownload() {
    const createUrl = vi.fn(() => 'blob:fake');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });

    const clicked: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLAnchorElement;
      if (tag === 'a') {
        el.click = () => clicked.push(el);
      }
      return el;
    });

    return { clicked, createUrl, revokeUrl };
  }

  /*
   * Firefox and Safari expose no writable file handle, so the only "save" the
   * platform allows is handing the user a copy. This asserts that path really
   * produces a download rather than failing silently.
   */
  it('downloads a copy when there is no handle for the reference', async () => {
    const provider = new LocalFileProvider();
    const ref = provider.registerFile(makeFile('vault.kdbx', [1, 2, 3]));
    const { clicked, createUrl, revokeUrl } = captureDownload();

    const result = await provider.write(ref, new Uint8Array([9, 9]).buffer);

    expect(createUrl).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe('vault.kdbx');
    // No handle means no filesystem version to report back.
    expect(result.version).toBeUndefined();
    expect(revokeUrl).toHaveBeenCalledWith('blob:fake');
  });

  it('appends .kdbx when the reference name lacks it', async () => {
    const provider = new LocalFileProvider();
    const { clicked } = captureDownload();

    await provider.write(
      { providerId: 'local', id: 'download', name: 'My Vault' },
      new ArrayBuffer(4),
    );

    expect(clicked[0]?.download).toBe('My Vault.kdbx');
  });
});
