import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { App } from './app';
import { VaultService } from './core/vault/vault.service';

describe('App shell', () => {
  it('shows the unlock screen while locked', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-unlock-screen')).not.toBeNull();
    expect(root.querySelector('.shell')).toBeNull();
  });

  it('shows the vault view once unlocked, and returns to locked on lock', async () => {
    const fixture = TestBed.createComponent(App);
    const vault = TestBed.inject(VaultService);

    vault.createVault('a strong master password', 'Test Vault');
    await fixture.whenStable();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.shell')).not.toBeNull();
    expect(root.textContent).toContain('Test Vault');

    vault.lock();
    await fixture.whenStable();
    expect(root.querySelector('app-unlock-screen')).not.toBeNull();
  });
});
