import { Injectable } from '@angular/core';

import { oauthConfig } from '../../../environments/generated';

import type { CloudStorageProvider } from './cloud-provider';
import { GoogleDriveProvider } from './google-drive.provider';
import { LocalFileProvider } from './local-file.provider';
import { OneDriveProvider } from './onedrive.provider';

/**
 * The set of storage providers available in this build.
 *
 * living-spec §4: "Adding a provider means implementing this interface and
 * registering it. Nothing else in the codebase changes." This is that registry.
 *
 * Cloud providers are constructed unconditionally but report `isAvailable()`
 * false without a client ID, so a build with no `.env` simply offers local files
 * — rather than failing, or worse, showing a button that cannot work.
 */
@Injectable({ providedIn: 'root' })
export class ProviderRegistry {
  readonly local = new LocalFileProvider();

  readonly cloud: readonly CloudStorageProvider[] = [
    new GoogleDriveProvider(oauthConfig.googleClientId, oauthConfig.redirectUri),
    new OneDriveProvider(oauthConfig.microsoftClientId, oauthConfig.redirectUri),
  ];

  /** Cloud providers this build is actually configured for. */
  availableCloud(): readonly CloudStorageProvider[] {
    return this.cloud.filter((provider) => provider.isAvailable());
  }

  byId(id: string): CloudStorageProvider | undefined {
    return this.cloud.find((provider) => provider.id === id);
  }
}
