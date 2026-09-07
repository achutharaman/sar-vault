import {
  type StorageProvider,
  type VaultFileContent,
  type VaultFileMetadata,
  type VaultFileRef,
  type VaultWriteResult,
} from './types';

/**
 * Minimal shape of the File System Access API we rely on.
 *
 * Declared locally rather than pulled from a DOM lib, because TypeScript's
 * bundled definitions do not include it consistently and it is unavailable in
 * Firefox and Safari — we must feature-detect regardless.
 */
interface FileSystemWritable {
  write(data: BufferSource): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritable>;
}
interface FilePickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemFileHandleLike>;
}

const KDBX_PICKER_TYPES = [
  {
    description: 'KeePass vault',
    accept: { 'application/x-keepass': ['.kdbx'] },
  },
];

/**
 * Reads and writes a vault on the user's own disk.
 *
 * Two modes, chosen by feature detection:
 *
 *  - **File System Access API** (Chromium): a real file handle, so saving writes
 *    back to the file the user opened. This is what makes editing feel normal.
 *  - **Download/upload fallback** (Firefox, Safari): open via `<input type=file>`,
 *    save by downloading a new copy. Clunky, but it is the only option those
 *    browsers offer without a server.
 *
 * Version tokens are the file's `lastModified` timestamp. That is weaker than an
 * ETag — it has second-ish granularity and a user could edit the file in another
 * client within the same tick — but it is the only revision signal the platform
 * exposes for local files, and it is enough to catch the realistic case of the
 * file changing underneath a long-open tab.
 */
export class LocalFileProvider implements StorageProvider {
  readonly id = 'local';
  readonly displayName = 'This device';

  private readonly handles = new Map<string, FileSystemFileHandleLike>();
  private readonly files = new Map<string, File>();
  private nextRefId = 1;

  isAvailable(): boolean {
    return true;
  }

  /** Whether saving can write back in place, rather than downloading a copy. */
  supportsWriteBack(): boolean {
    const win = globalThis as unknown as FilePickerWindow;
    return typeof win.showOpenFilePicker === 'function';
  }

  /**
   * Local files have no browsable listing without a directory handle, so this
   * returns the files opened in this session rather than pretending to scan a
   * filesystem we have no access to.
   */
  async list(): Promise<VaultFileRef[]> {
    const refs: VaultFileRef[] = [];
    for (const [id, handle] of this.handles) {
      refs.push({ providerId: this.id, id, name: handle.name });
    }
    for (const [id, file] of this.files) {
      refs.push({ providerId: this.id, id, name: file.name });
    }
    return refs;
  }

  /** Open the system file picker and register the chosen vault. */
  async pick(): Promise<VaultFileRef | undefined> {
    const win = globalThis as unknown as FilePickerWindow;
    if (typeof win.showOpenFilePicker !== 'function') {
      throw new Error('File System Access API unavailable; use openFile() instead.');
    }

    let handles: FileSystemFileHandleLike[];
    try {
      handles = await win.showOpenFilePicker({
        types: KDBX_PICKER_TYPES,
        multiple: false,
      });
    } catch (error) {
      // The user dismissing the picker is a normal outcome, not a failure.
      if (error instanceof DOMException && error.name === 'AbortError') {
        return undefined;
      }
      throw error;
    }

    const handle = handles[0];
    if (!handle) {
      return undefined;
    }
    const id = `handle:${this.nextRefId++}`;
    this.handles.set(id, handle);
    return { providerId: this.id, id, name: handle.name };
  }

  /** Register a `File` from an `<input type="file">`, for the fallback path. */
  registerFile(file: File): VaultFileRef {
    const id = `file:${this.nextRefId++}`;
    this.files.set(id, file);
    return { providerId: this.id, id, name: file.name };
  }

  async read(ref: VaultFileRef): Promise<VaultFileContent> {
    const file = await this.resolveFile(ref);
    return {
      data: await file.arrayBuffer(),
      version: String(file.lastModified),
    };
  }

  async write(
    ref: VaultFileRef,
    data: ArrayBuffer,
    expectedVersion?: string,
  ): Promise<VaultWriteResult> {
    const handle = this.handles.get(ref.id);

    if (!handle) {
      // Fallback path: no handle, so the best available "write" is handing the
      // user a copy to save wherever they like.
      this.download(ref.name, data);
      return { version: undefined };
    }

    if (expectedVersion !== undefined) {
      const current = String((await handle.getFile()).lastModified);
      if (current !== expectedVersion) {
        // Deliberately not thrown as VersionConflictError yet: conflict handling
        // is Q-004 and unresolved, so the caller decides. Reporting it at all is
        // what matters here.
        throw new Error(
          'This vault changed on disk since it was opened. Reload it before saving, ' +
            'or your changes will overwrite the newer copy.',
        );
      }
    }

    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();

    return { version: String((await handle.getFile()).lastModified) };
  }

  async getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata> {
    const file = await this.resolveFile(ref);
    return {
      name: file.name,
      size: file.size,
      modified: new Date(file.lastModified),
      version: String(file.lastModified),
    };
  }

  private async resolveFile(ref: VaultFileRef): Promise<File> {
    const handle = this.handles.get(ref.id);
    if (handle) {
      return handle.getFile();
    }
    const file = this.files.get(ref.id);
    if (file) {
      return file;
    }
    throw new Error(`Unknown local file reference: ${ref.id}`);
  }

  private download(name: string, data: ArrayBuffer): void {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name.endsWith('.kdbx') ? name : `${name}.kdbx`;
    link.click();
    URL.revokeObjectURL(url);
  }
}
