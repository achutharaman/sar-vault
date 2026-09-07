import { OAuthClient } from '../auth/oauth-client';

import { CloudStorageProvider } from './cloud-provider';
import type { VaultFileContent, VaultFileMetadata, VaultFileRef, VaultWriteResult } from './types';

const GRAPH = 'https://graph.microsoft.com/v1.0';
/** The app folder: `Apps/sar-vault` in the user's OneDrive. Visible to them. */
const APP_ROOT = `${GRAPH}/me/drive/special/approot`;

interface DriveItem {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  cTag?: string;
  lastModifiedDateTime?: string;
}

/**
 * Microsoft OneDrive, via Graph, scoped to this app's own folder.
 *
 * `Files.ReadWrite.AppFolder` is narrower than Google's `drive.file` but does
 * not carry the same cost: OneDrive's app folder lives at `Apps/sar-vault` in
 * the user's normal drive, so it stays visible, backup-able and openable in
 * KeePassXC. Google's equivalent (`drive.appdata`) is hidden, which is why the
 * Drive provider took a different scope — see GoogleDriveProvider.
 *
 * Unlike Drive, Graph supports conditional writes: `if-match` against the item's
 * cTag makes the version check atomic, and the server answers 412 rather than
 * letting a concurrent change be silently overwritten.
 */
export class OneDriveProvider extends CloudStorageProvider {
  readonly id = 'onedrive';
  readonly displayName = 'OneDrive';

  static readonly SCOPES = ['Files.ReadWrite.AppFolder', 'offline_access'] as const;

  constructor(clientId: string, redirectUri: string) {
    super(
      new OAuthClient({
        id: 'onedrive',
        displayName: 'OneDrive',
        authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        clientId,
        scopes: OneDriveProvider.SCOPES,
        redirectUri,
      }),
    );
  }

  async list(): Promise<VaultFileRef[]> {
    const response = await this.request(`${APP_ROOT}/children?$select=id,name`);
    const payload = (await response.json()) as { value?: DriveItem[] };

    return (payload.value ?? [])
      .filter((item) => item.name.endsWith('.kdbx'))
      .map((item) => ({ providerId: this.id, id: item.id, name: item.name }));
  }

  async read(ref: VaultFileRef): Promise<VaultFileContent> {
    const [content, metadata] = await Promise.all([
      this.request(`${GRAPH}/me/drive/items/${encodeURIComponent(ref.id)}/content`),
      this.getMetadata(ref),
    ]);

    return { data: await content.arrayBuffer(), version: metadata.version };
  }

  async write(
    ref: VaultFileRef,
    data: ArrayBuffer,
    expectedVersion?: string,
  ): Promise<VaultWriteResult> {
    // Conditional write: the server rejects with 412 if the item moved on,
    // which `request` translates into a VersionConflictError. No read-then-write
    // window, unlike the Drive provider.
    const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
    if (expectedVersion !== undefined) {
      headers['if-match'] = expectedVersion;
    }

    const response = await this.request(
      `${GRAPH}/me/drive/items/${encodeURIComponent(ref.id)}/content`,
      { method: 'PUT', headers, body: data },
    );

    const item = (await response.json()) as DriveItem;
    return { version: item.cTag ?? item.eTag };
  }

  /** Create a new vault in the app folder and return a ref to it. */
  async create(name: string, data: ArrayBuffer): Promise<VaultFileRef> {
    const fileName = name.endsWith('.kdbx') ? name : `${name}.kdbx`;
    const response = await this.request(`${APP_ROOT}:/${encodeURIComponent(fileName)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });

    const item = (await response.json()) as DriveItem;
    return { providerId: this.id, id: item.id, name: item.name };
  }

  async getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata> {
    const response = await this.request(
      `${GRAPH}/me/drive/items/${encodeURIComponent(ref.id)}?$select=id,name,size,cTag,eTag,lastModifiedDateTime`,
    );
    const item = (await response.json()) as DriveItem;

    return {
      name: item.name,
      size: item.size ?? 0,
      modified: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined,
      // cTag changes on content change; eTag also changes on metadata edits, so
      // cTag is the right token for "did the bytes move on".
      version: item.cTag ?? item.eTag,
    };
  }
}
