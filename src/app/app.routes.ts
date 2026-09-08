import type { Routes } from '@angular/router';

import { SettingsPage } from './ui/settings-page/settings-page';
import { VaultPage } from './ui/vault-page/vault-page';

export const routes: Routes = [
  { path: '', component: VaultPage },
  { path: 'settings', component: SettingsPage },
  /*
   * The OAuth redirect URI. The shell reads the authorization code from the
   * query string and strips it, so by the time routing settles there is nothing
   * left to handle — this exists so the path resolves to the vault instead of
   * falling through to the wildcard as an error.
   */
  { path: 'auth/callback', redirectTo: '', pathMatch: 'full' },
  { path: '**', redirectTo: '' },
];
