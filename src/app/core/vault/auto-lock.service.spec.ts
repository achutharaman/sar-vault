import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoLockService } from './auto-lock.service';
import { ClipboardService, CLIPBOARD_CLEAR_SECONDS } from './clipboard.service';
import { VaultService } from './vault.service';

describe('AutoLockService', () => {
  let autoLock: AutoLockService;
  let vault: VaultService;

  const MINUTE = 60_000;
  const start = 1_700_000_000_000;

  beforeEach(() => {
    autoLock = TestBed.inject(AutoLockService);
    vault = TestBed.inject(VaultService);
    vi.spyOn(Date, 'now').mockReturnValue(start);
    autoLock.noteActivity();
  });

  afterEach(() => vi.restoreAllMocks());

  function unlockedVault(): void {
    vault.createVault('a strong master password', 'Test');
  }

  it('does nothing while the vault is locked', () => {
    autoLock.check(start + 60 * MINUTE);

    expect(vault.status()).toBe('locked');
    expect(autoLock.lockedByIdle()).toBe(false);
  });

  it('leaves an active vault alone before the timeout', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(15);

    autoLock.check(start + 14 * MINUTE);

    expect(vault.isUnlocked()).toBe(true);
  });

  it('locks once the idle period has elapsed', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(15);

    autoLock.check(start + 15 * MINUTE);

    expect(vault.isUnlocked()).toBe(false);
    // The UI needs to distinguish this from a manual lock, so it can explain
    // why the vault closed by itself.
    expect(autoLock.lockedByIdle()).toBe(true);
  });

  it('activity postpones the deadline', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(5);

    vi.spyOn(Date, 'now').mockReturnValue(start + 4 * MINUTE);
    autoLock.noteActivity();

    // 6 minutes after start, but only 2 since the last activity.
    autoLock.check(start + 6 * MINUTE);
    expect(vault.isUnlocked()).toBe(true);

    autoLock.check(start + 9 * MINUTE);
    expect(vault.isUnlocked()).toBe(false);
  });

  it('never locks when the timeout is disabled', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(0);

    autoLock.check(start + 24 * 60 * MINUTE);

    expect(autoLock.enabled()).toBe(false);
    expect(vault.isUnlocked()).toBe(true);
  });

  it('reports the countdown, and nothing when locked or disabled', () => {
    expect(autoLock.secondsUntilLock(start)).toBeUndefined();

    unlockedVault();
    autoLock.setTimeoutMinutes(5);
    expect(autoLock.secondsUntilLock(start)).toBe(300);
    expect(autoLock.secondsUntilLock(start + 2 * MINUTE)).toBe(180);
    // Clamped rather than going negative.
    expect(autoLock.secondsUntilLock(start + 10 * MINUTE)).toBe(0);

    autoLock.setTimeoutMinutes(0);
    expect(autoLock.secondsUntilLock(start)).toBeUndefined();
  });

  it('clears the idle flag once acknowledged', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(1);
    autoLock.check(start + 2 * MINUTE);
    expect(autoLock.lockedByIdle()).toBe(true);

    autoLock.acknowledgeIdleLock();
    expect(autoLock.lockedByIdle()).toBe(false);
  });

  it('treats a negative timeout as disabled rather than locking instantly', () => {
    unlockedVault();
    autoLock.setTimeoutMinutes(-5);

    autoLock.check(start + MINUTE);

    expect(autoLock.enabled()).toBe(false);
    expect(vault.isUnlocked()).toBe(true);
  });
});

describe('ClipboardService', () => {
  let clipboard: ClipboardService;
  let written: string[];

  beforeEach(() => {
    clipboard = TestBed.inject(ClipboardService);
    written = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: (value: string) => {
          written.push(value);
          return Promise.resolve();
        },
        readText: () => Promise.resolve(written[written.length - 1] ?? ''),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('copies a value and reports what was copied', async () => {
    expect(await clipboard.copy('hunter2', 'Password')).toBe(true);

    expect(written).toEqual(['hunter2']);
    expect(clipboard.copiedLabel()).toBe('Password');
    expect(clipboard.secondsLeft()).toBe(CLIPBOARD_CLEAR_SECONDS);
  });

  it('refuses to copy an empty value', async () => {
    expect(await clipboard.copy('', 'Password')).toBe(false);
    expect(written).toEqual([]);
  });

  it('reports failure when the platform refuses, rather than claiming success', async () => {
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });

    expect(await clipboard.copy('hunter2', 'Password')).toBe(false);
    expect(clipboard.copiedLabel()).toBeUndefined();
  });

  it('clears the clipboard when it still holds what we wrote', async () => {
    await clipboard.copy('hunter2', 'Password');
    await clipboard.clearNow();

    expect(written[written.length - 1]).toBe('');
    expect(clipboard.copiedLabel()).toBeUndefined();
  });

  /*
   * Without the read-back check, a pending clear from an earlier copy would
   * wipe whatever the user copied since — destroying their data with a feature
   * meant to protect it.
   */
  it('leaves the clipboard alone if the user copied something else meanwhile', async () => {
    await clipboard.copy('hunter2', 'Password');

    written.push('something the user copied themselves');
    await clipboard.clearNow();

    expect(written[written.length - 1]).toBe('something the user copied themselves');
  });

  it('clears anyway when the clipboard cannot be read back', async () => {
    const writes: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: {
        writeText: (v: string) => {
          writes.push(v);
          return Promise.resolve();
        },
        // Firefox refuses programmatic reads; leaving a password behind is the
        // worse outcome, so we clear regardless.
        readText: () => Promise.reject(new Error('not allowed')),
      },
    });

    await clipboard.copy('hunter2', 'Password');
    await clipboard.clearNow();

    expect(writes[writes.length - 1]).toBe('');
  });

  it('does nothing on a second clear', async () => {
    await clipboard.copy('hunter2', 'Password');
    await clipboard.clearNow();
    const afterFirst = written.length;

    await clipboard.clearNow();

    expect(written).toHaveLength(afterFirst);
  });
});
