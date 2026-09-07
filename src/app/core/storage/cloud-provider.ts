import type { OAuthClient } from '../auth/oauth-client';

import {
  type StorageProvider,
  type VaultFileContent,
  type VaultFileMetadata,
  type VaultFileRef,
  type VaultWriteResult,
  VersionConflictError,
} from './types';

/** Raised when the provider needs the user to (re)authorize. */
export class NotConnectedError extends Error {
  override readonly name = 'NotConnectedError';
}

/**
 * Shared mechanics for providers that talk to a cloud API over HTTP.
 *
 * This layer never sees plaintext or keys — it moves opaque `ArrayBuffer`s that
 * the format layer has already encrypted. ESLint forbids importing the crypto or
 * format layers here, so that is structural rather than a promise.
 */
export abstract class CloudStorageProvider implements StorageProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;

  protected constructor(protected readonly oauth: OAuthClient) {}

  isAvailable(): boolean {
    return this.oauth.isConfigured;
  }

  isConnected(): boolean {
    return this.oauth.isConnected();
  }

  /** Send the user to the provider's consent screen. */
  async connect(): Promise<string> {
    return this.oauth.beginAuthorization();
  }

  /** Redeem the authorization code returned to the redirect URI. */
  async completeConnect(code: string, state: string): Promise<void> {
    await this.oauth.completeAuthorization(code, state);
  }

  disconnect(): void {
    this.oauth.disconnect();
  }

  abstract list(path?: string): Promise<VaultFileRef[]>;
  abstract read(ref: VaultFileRef): Promise<VaultFileContent>;
  abstract write(
    ref: VaultFileRef,
    data: ArrayBuffer,
    expectedVersion?: string,
  ): Promise<VaultWriteResult>;
  abstract getMetadata(ref: VaultFileRef): Promise<VaultFileMetadata>;

  /** Authenticated request, with provider errors mapped to useful exceptions. */
  protected async request(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.oauth.getToken();
    if (!token) {
      throw new NotConnectedError(`Not connected to ${this.displayName}. Connect and try again.`);
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      return response;
    }

    // 412 is the whole point of passing version tokens around: the remote copy
    // moved on since we read it, so writing would destroy someone else's change.
    if (response.status === 412) {
      throw new VersionConflictError(
        'This vault changed in your cloud storage since it was opened. ' +
          'Reload it before saving, or your changes will overwrite the newer copy.',
      );
    }

    if (response.status === 401 || response.status === 403) {
      // Tokens are held in memory only and are short-lived by design
      // (living-spec Q-005), so expiry is an expected state, not a fault.
      this.oauth.disconnect();
      throw new NotConnectedError(
        `${this.displayName} rejected the request. Connect again to continue.`,
      );
    }

    throw new Error(`${this.displayName} request failed (${response.status}).`);
  }
}
