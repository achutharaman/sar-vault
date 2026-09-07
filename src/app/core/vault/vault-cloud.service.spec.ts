import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OAuthClient } from '../auth/oauth-client';
import { CloudStorageProvider } from '../storage/cloud-provider';
import { ProviderRegistry } from '../storage/provider-registry';
import {
  type VaultFileContent,
  type VaultFileMetadata,
  type VaultFileRef,
  type VaultWriteResult,
  VersionConflictError,
} from '../storage/types';
import { VaultService } from './vault.service';

/**
 * The service-to-provider seam.
 *
 * These tests exist because this seam had none, and a real bug lived here: the
 * providers' `create()` was written, unit-tested in isolation, and called from
 * nowhere. Every provider test passed while cloud storage was unusable end to
 * end, because nothing exercised the join between the two.
 */
class FakeCloudProvider extends CloudStorageProvider {
  readonly id = 'fake-cloud';
  readonly displayName = 'Fake Cloud';

  connected = true;
  readonly files = new Map<string, ArrayBuffer>();
  version = 'v1';
  createCalls = 0;
  writeCalls = 0;
  /** Set to make the next write behave as a losing conditional write. */
  conflictOnWrite = false;

  constructor() {
    // The base class only uses the OAuth client for tokens and connection
    // state, both of which are overridden below.
    super({
      isConfigured: true,
      isConnected: () => true,
      getToken: () => 'fake-token',
      disconnect: () => undefined,
      beginAuthorization: () => Promise.resolve('https://example.test/authorize'),
      completeAuthorization: () => Promise.resolve(),
      displayName: 'Fake Cloud',
    } as unknown as OAuthClient);
  }

  override isAvailable(): boolean {
    return true;
  }
  override isConnected(): boolean {
    return this.connected;
  }
  override disconnect(): void {
    this.connected = false;
  }

  async create(name: string, data: ArrayBuffer): Promise<VaultFileRef> {
    this.createCalls++;
    const ref = { providerId: this.id, id: `remote-${this.files.size + 1}`, name };
    this.files.set(ref.id, data);
    return ref;
  }

  async list(): Promise<VaultFileRef[]> {
    return [...this.files.keys()].map((id) => ({
      providerId: this.id,
      id,
      name: 'remote.kdbx',
    }));
  }

  async read(ref: VaultFileRef): Promise<VaultFileContent> {
    return { data: this.files.get(ref.id) ?? new ArrayBuffer(0), version: this.version };
  }

  async write(
    ref: VaultFileRef,
    data: ArrayBuffer,
    expectedVersion?: string,
  ): Promise<VaultWriteResult> {
    this.writeCalls++;
    if (
      this.conflictOnWrite ||
      (expectedVersion !== undefined && expectedVersion !== this.version)
    ) {
      throw new VersionConflictError('This vault changed in your cloud storage.');
    }
    this.files.set(ref.id, data);
    this.version = `${this.version}+`;
    return { version: this.version };
  }

  async getMetadata(): Promise<VaultFileMetadata> {
    return { name: 'remote.kdbx', size: 0, modified: undefined, version: this.version };
  }
}

/** Registry that offers only the fake provider. */
class FakeRegistry {
  readonly local = { displayName: 'This device', supportsWriteBack: () => false };
  readonly provider = new FakeCloudProvider();
  readonly cloud = [this.provider];

  availableCloud() {
    return this.cloud;
  }
  byId(id: string) {
    return id === this.provider.id ? this.provider : undefined;
  }
}

describe('VaultService + cloud provider', () => {
  let service: VaultService;
  let registry: FakeRegistry;

  beforeEach(() => {
    registry = new FakeRegistry();
    TestBed.configureTestingModule({
      providers: [{ provide: ProviderRegistry, useValue: registry }],
    });
    service = TestBed.inject(VaultService);
    sessionStorage.clear();
  });

  /** Put the service in the state a completed OAuth redirect would leave it. */
  async function connect(): Promise<void> {
    const oauth = (registry.provider as unknown as { oauth: Record<string, unknown> }).oauth;
    oauth['completeAuthorization'] = () => Promise.resolve();
    sessionStorage.setItem(
      'sar-vault.oauth.pending',
      JSON.stringify({ providerId: 'fake-cloud', verifier: 'v', state: 's' }),
    );
    await service.completeCloudSignIn('?code=abc&state=s');
  }

  it('offers only local storage until a provider is connected', () => {
    expect(service.newVaultTargets().map((t) => t.id)).toEqual(['local']);
  });

  it('offers a connected provider as a destination, and selects it', async () => {
    await connect();

    expect(service.newVaultTargets().map((t) => t.id)).toEqual(['local', 'fake-cloud']);
    expect(service.saveTarget()).toBe('fake-cloud');
    expect(service.isCloudConnected('fake-cloud')).toBe(true);
  });

  /*
   * The regression test for the bug. A new vault has no file behind it, and
   * with narrow scopes the provider can only see files it created — so the
   * first save has to be a `create()`. Previously it silently fell through to a
   * local download, leaving cloud storage permanently empty.
   */
  it('creates the file on the first save to a cloud target', async () => {
    await connect();
    service.createVault('a strong master password', 'Cloud Vault');

    expect(await service.save()).toBe(true);

    expect(registry.provider.createCalls).toBe(1);
    expect(registry.provider.files.size).toBe(1);
    expect(service.providerId()).toBe('fake-cloud');
    expect(service.dirty()).toBe(false);
  });

  it('writes to the existing file on subsequent saves, not create again', async () => {
    await connect();
    service.createVault('a strong master password', 'Cloud Vault');
    await service.save();

    service.addEntry({ title: 'Second', username: '', password: '', url: '', notes: '' });
    expect(await service.save()).toBe(true);

    expect(registry.provider.createCalls).toBe(1);
    expect(registry.provider.writeCalls).toBe(1);
  });

  it('the created file can be read back and unlocked', async () => {
    await connect();
    service.createVault('a strong master password', 'Cloud Vault');
    service.addEntry({ title: 'GitHub', username: 'me', password: 'pw', url: '', notes: '' });
    await service.save();

    // Re-open from the provider exactly as a fresh session would.
    service.lock();
    const [ref] = await registry.provider.list();
    service.selectCloudFile(ref!);

    expect(await service.unlock('a strong master password')).toBe(true);
    expect(service.visibleEntries().map((e) => e.title)).toEqual(['GitHub']);
  });

  it('surfaces a version conflict instead of overwriting', async () => {
    await connect();
    service.createVault('a strong master password', 'Cloud Vault');
    await service.save();

    registry.provider.conflictOnWrite = true;
    service.addEntry({ title: 'Later edit', username: '', password: '', url: '', notes: '' });

    expect(await service.save()).toBe(false);
    expect(service.error()).toMatch(/changed in your cloud storage/i);
    // The vault stays dirty, so the user's edits are not silently discarded.
    expect(service.dirty()).toBe(true);
    expect(service.status()).toBe('unlocked');
  });

  it('falls back to local when the chosen target is not connected', async () => {
    await connect();
    service.createVault('a strong master password', 'Cloud Vault');
    registry.provider.connected = false;

    await service.save();

    expect(registry.provider.createCalls).toBe(0);
  });

  it('drops the provider as a destination on disconnect', async () => {
    await connect();
    service.disconnectCloud('fake-cloud');

    expect(service.isCloudConnected('fake-cloud')).toBe(false);
    expect(service.saveTarget()).toBe('local');
    expect(service.newVaultTargets().map((t) => t.id)).toEqual(['local']);
  });

  /*
   * State-mismatch rejection itself belongs to OAuthClient and is covered
   * there. What matters at this seam is the consequence: a failed connect must
   * not leave the provider looking connected, or the UI would offer a
   * destination that cannot be written to.
   */
  it('stays disconnected and reports the error when connecting fails', async () => {
    vi.spyOn(registry.provider, 'completeConnect').mockRejectedValue(
      new Error('Authorization state mismatch — the callback was not trusted.'),
    );
    sessionStorage.setItem(
      'sar-vault.oauth.pending',
      JSON.stringify({ providerId: 'fake-cloud', verifier: 'v', state: 'expected' }),
    );

    await service.completeCloudSignIn('?code=abc&state=attacker');

    expect(service.isCloudConnected('fake-cloud')).toBe(false);
    expect(service.saveTarget()).toBe('local');
    expect(service.error()).toMatch(/state mismatch/i);
    expect(service.newVaultTargets().map((t) => t.id)).toEqual(['local']);
  });

  it('reports a refused sign-in without leaving a pending request behind', async () => {
    await service.completeCloudSignIn('?error=access_denied');

    expect(service.error()).toMatch(/cancelled or refused/i);
    expect(sessionStorage.getItem('sar-vault.oauth.pending')).toBeNull();
  });
});
