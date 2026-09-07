/**
 * Storage provider contracts. See docs/living-spec.md §4.
 *
 * Providers move **ciphertext** only. Nothing in this layer may import the
 * crypto or format layers — ESLint enforces it — so a provider bug cannot leak
 * plaintext or keys, because neither is ever reachable from here.
 */

/** A handle to a vault file within some provider. */
export interface VaultFileRef {
  /** Which provider this ref belongs to. */
  readonly providerId: string;
  /** Provider-specific identifier: a path, a file id, a handle key. */
  readonly id: string;
  /** Name for display. */
  readonly name: string;
}

export interface VaultFileMetadata {
  readonly name: string;
  readonly size: number;
  readonly modified: Date | undefined;
  /**
   * Opaque version token — an ETag, a revision id, an mtime.
   *
   * Returned by `read` and passed back to `write`, which is the basis of the
   * optimistic-concurrency check that conflict detection (Q-004) will build on.
   */
  readonly version: string | undefined;
}

export interface VaultFileContent {
  readonly data: ArrayBuffer;
  readonly version: string | undefined;
}

export interface VaultWriteResult {
  readonly version: string | undefined;
}

/**
 * Raised when a write is rejected because the remote copy moved on since it was
 * read — the shape a sync conflict takes.
 */
export class VersionConflictError extends Error {
  override readonly name = 'VersionConflictError';
}

export interface StorageProvider {
  readonly id: string;
  readonly displayName: string;

  /**
   * Whether this provider can be used in the current browser. The local file
   * provider, for instance, behaves differently with and without the File
   * System Access API.
   */
  isAvailable(): boolean;

  list(path?: string): Promise<VaultFileRef[]>;
  read(ref: VaultFileRef): Promise<VaultFileContent>;
  write(ref: VaultFileRef, data: ArrayBuffer, expectedVersion?: string): Promise<VaultWriteResult>;
  getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata>;
}
