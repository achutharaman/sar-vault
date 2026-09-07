import { describe, expect, it } from 'vitest';

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
