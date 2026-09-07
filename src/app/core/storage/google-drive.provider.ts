import { OAuthClient } from '../auth/oauth-client';

import { CloudStorageProvider } from './cloud-provider';
import {
  type VaultFileContent,
  type VaultFileMetadata,
  type VaultFileRef,
  type VaultWriteResult,
  VersionConflictError,
} from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/**
 * Google Drive, using the `drive.file` scope (living-spec Q-008).
 *
 * ## Why `drive.file` and not `drive.appdata`
 *
 * `drive.appdata` writes to a hidden folder the user cannot see, back up, or
 * open with any other client. That directly contradicts this project's central
 * claim — that the vault lives in storage *you* control, with no lock-in.
 *
 * `drive.file` keeps the vault visible in the user's Drive, where they can copy,
 * back up and open it in KeePassXC. Its limitation is that the app can only
 * reach files it created; adopting a pre-existing Drive file needs Google's
 * Picker, which loads third-party JavaScript from Google's CDN and is therefore
 * barred by CONTRIBUTING hard rule 2 and by our CSP. So v0.2 creates the vault
 * here; importing an existing one means opening it locally and saving it up.
 *
 * ## Concurrency
 *
 * Drive v3 dropped ETags and offers no `If-Match` on uploads, so the version
 * check is read-then-compare rather than atomic. A change landing inside that
 * window would go undetected. Microsoft Graph does support conditional writes,
 * and OneDriveProvider uses them — the asymmetry is Google's, not ours, and is
 * recorded rather than papered over. Q-004 will decide whether that gap needs
 * closing with Drive revisions.
 */
export class GoogleDriveProvider extends CloudStorageProvider {
  readonly id = 'google-drive';
  readonly displayName = 'Google Drive';

  static readonly SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

  constructor(clientId: string, redirectUri: string) {
    super(
      new OAuthClient({
        id: 'google-drive',
        displayName: 'Google Drive',
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        clientId,
        scopes: GoogleDriveProvider.SCOPES,
        redirectUri,
        // Without this Google returns no usable consent for a public client on
        // repeat visits.
        extraAuthParams: { include_granted_scopes: 'true', prompt: 'consent' },
      }),
    );
  }

  async list(): Promise<VaultFileRef[]> {
    const params = new URLSearchParams({
      q: "trashed = false and name contains '.kdbx'",
      fields: 'files(id,name)',
      pageSize: '100',
    });

    const response = await this.request(`${API}/files?${params.toString()}`);
    const payload = (await response.json()) as { files?: { id: string; name: string }[] };

    return (payload.files ?? []).map((file) => ({
      providerId: this.id,
      id: file.id,
      name: file.name,
    }));
  }

  async read(ref: VaultFileRef): Promise<VaultFileContent> {
    const [content, metadata] = await Promise.all([
      this.request(`${API}/files/${encodeURIComponent(ref.id)}?alt=media`),
      this.getMetadata(ref),
    ]);

    return { data: await content.arrayBuffer(), version: metadata.version };
  }

  async write(
    ref: VaultFileRef,
    data: ArrayBuffer,
    expectedVersion?: string,
  ): Promise<VaultWriteResult> {
    if (expectedVersion !== undefined) {
      const current = await this.getMetadata(ref);
      if (current.version !== expectedVersion) {
        throw new VersionConflictError(
          'This vault changed in Google Drive since it was opened. ' +
            'Reload it before saving, or your changes will overwrite the newer copy.',
        );
      }
    }

    await this.request(
      `${UPLOAD}/files/${encodeURIComponent(ref.id)}?uploadType=media&fields=version`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data,
      },
    );

    return { version: (await this.getMetadata(ref)).version };
  }

  /** Create a new vault file and return a ref to it. */
  async create(name: string, data: ArrayBuffer): Promise<VaultFileRef> {
    const boundary = `sar-vault-${crypto.randomUUID()}`;
    const metadata = JSON.stringify({ name, mimeType: 'application/octet-stream' });

    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
      data,
      `\r\n--${boundary}--`,
    ]);

    const response = await this.request(`${UPLOAD}/files?uploadType=multipart&fields=id,name`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });

    const created = (await response.json()) as { id: string; name: string };
    return { providerId: this.id, id: created.id, name: created.name };
  }

  async getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata> {
    const params = new URLSearchParams({ fields: 'name,size,modifiedTime,version' });
    const response = await this.request(
      `${API}/files/${encodeURIComponent(ref.id)}?${params.toString()}`,
    );

    const file = (await response.json()) as {
      name: string;
      size?: string;
      modifiedTime?: string;
      version?: string;
    };

    return {
      name: file.name,
      size: Number(file.size ?? 0),
      modified: file.modifiedTime ? new Date(file.modifiedTime) : undefined,
      // Drive's `version` is a monotonically increasing counter, the closest
      // thing v3 offers to an ETag.
      version: file.version,
    };
  }
}
