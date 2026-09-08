import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { AutoLockService } from './core/vault/auto-lock.service';
import { VaultService } from './core/vault/vault.service';
import { UnlockScreen } from './ui/unlock-screen/unlock-screen';

/**
 * Application shell.
 *
 * Owns exactly two things: whether the vault is locked, and completing an OAuth
 * redirect. Everything else lives on a route — the vault at `/`, settings at
 * `/settings`.
 *
 * The lock check sits here rather than in a route guard so that locking, from
 * anywhere including the idle timer, immediately replaces whatever page is open
 * with the unlock screen.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, UnlockScreen],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly vault = inject(VaultService);
  private readonly autoLock = inject(AutoLockService);

  constructor() {
    void this.handleOAuthRedirect();
    this.autoLock.start();
  }

  /**
   * Complete an OAuth redirect if this page load is one.
   *
   * The authorization code is stripped from the URL immediately afterwards.
   * Leaving it in the address bar would write it into browser history and into
   * any Referer header the page later sends — and a code is redeemable exactly
   * once by whoever holds it and the matching verifier.
   */
  private async handleOAuthRedirect(): Promise<void> {
    const { search, pathname } = globalThis.location;
    if (!search) {
      return;
    }

    if (await this.vault.completeCloudSignIn(search)) {
      const clean = pathname === '/auth/callback' ? '/' : pathname;
      globalThis.history.replaceState({}, '', clean);
    }
  }
}
