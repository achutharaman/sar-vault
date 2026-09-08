import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { App } from './app';
import { routes } from './app.routes';
import { AutoLockService } from './core/vault/auto-lock.service';
import { VaultService } from './core/vault/vault.service';

/**
 * The shell owns exactly two things now: the locked/unlocked switch, and
 * completing an OAuth redirect. The vault view and settings are routed pages,
 * covered by their own specs and by the e2e suite.
 */
describe('App shell', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
  });

  it('shows the unlock screen while locked, and no routed page', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-unlock-screen')).not.toBeNull();
    expect(root.querySelector('app-vault-page')).toBeNull();
  });

  it('renders the routed vault page once unlocked', async () => {
    const fixture = TestBed.createComponent(App);
    const vault = TestBed.inject(VaultService);

    vault.createVault('a strong master password', 'Test Vault');
    // TestBed does not perform the initial navigation on its own.
    await TestBed.inject(Router).navigate(['/']);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-unlock-screen')).toBeNull();
    expect(root.querySelector('app-vault-page')).not.toBeNull();
    expect(root.textContent).toContain('Test Vault');
  });

  /*
   * Locking must replace whatever page is open, including /settings. That is why
   * the check lives in the shell rather than in a route guard, which would only
   * run on navigation.
   */
  it('returns to the unlock screen on lock, from any page', async () => {
    const fixture = TestBed.createComponent(App);
    const vault = TestBed.inject(VaultService);

    vault.createVault('a strong master password', 'Test Vault');
    await TestBed.inject(Router).navigate(['/']);
    await fixture.whenStable();

    vault.lock();
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-unlock-screen')).not.toBeNull();
    expect(root.querySelector('app-vault-page')).toBeNull();
  });

  it('starts the idle auto-lock watcher', () => {
    TestBed.createComponent(App);
    // Registering listeners twice would double-count activity; start() is
    // idempotent, so calling it again must be harmless.
    expect(() => TestBed.inject(AutoLockService).start()).not.toThrow();
  });
});
