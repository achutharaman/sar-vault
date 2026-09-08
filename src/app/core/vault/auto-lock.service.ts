import { computed, DestroyRef, inject, Injectable, NgZone, signal } from '@angular/core';

import { VaultService } from './vault.service';

/** Activity that counts as "the user is still here". */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export const AUTO_LOCK_OPTIONS = [
  { label: 'Never', minutes: 0 },
  { label: '1 minute', minutes: 1 },
  { label: '5 minutes', minutes: 5 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
] as const;

/**
 * Locks the vault after a period of inactivity.
 *
 * SECURITY.md is honest that locking cannot guarantee key material leaves
 * memory. What it does address is the ordinary case this app will actually
 * face: an unlocked vault left open on a screen someone else can reach.
 *
 * Deliberately separate from `VaultService` so the vault has no dependency on
 * DOM events, and so the timeout policy can be tested without a real clock.
 */
@Injectable({ providedIn: 'root' })
export class AutoLockService {
  private readonly vault = inject(VaultService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly timeoutMinutesSignal = signal(15);
  private readonly lastActivitySignal = signal(Date.now());
  private readonly lockedByIdleSignal = signal(false);

  readonly timeoutMinutes = this.timeoutMinutesSignal.asReadonly();
  readonly enabled = computed(() => this.timeoutMinutesSignal() > 0);
  /** True when the most recent lock was automatic, so the UI can explain it. */
  readonly lockedByIdle = this.lockedByIdleSignal.asReadonly();

  private intervalId: ReturnType<typeof setInterval> | undefined;
  private listenersAttached = false;

  /** Begin watching. Safe to call more than once. */
  start(): void {
    if (this.listenersAttached) {
      return;
    }
    this.listenersAttached = true;

    const onActivity = () => this.noteActivity();
    for (const event of ACTIVITY_EVENTS) {
      document.addEventListener(event, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onActivity);

    // Outside Angular: a 1s tick that usually changes nothing should not drive
    // change detection. `lock()` re-enters the zone when it actually fires.
    this.zone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => this.check(), 1000);
    });

    this.destroyRef.onDestroy(() => {
      for (const event of ACTIVITY_EVENTS) {
        document.removeEventListener(event, onActivity);
      }
      document.removeEventListener('visibilitychange', onActivity);
      if (this.intervalId !== undefined) {
        clearInterval(this.intervalId);
      }
      this.listenersAttached = false;
    });
  }

  /** 0 disables auto-locking. */
  setTimeoutMinutes(minutes: number): void {
    this.timeoutMinutesSignal.set(Math.max(0, minutes));
    this.noteActivity();
  }

  noteActivity(): void {
    this.lastActivitySignal.set(Date.now());
  }

  acknowledgeIdleLock(): void {
    this.lockedByIdleSignal.set(false);
  }

  /** Seconds until an idle lock, or undefined when disabled or locked. */
  secondsUntilLock(now: number = Date.now()): number | undefined {
    if (!this.enabled() || !this.vault.isUnlocked()) {
      return undefined;
    }
    const deadline = this.lastActivitySignal() + this.timeoutMinutesSignal() * 60_000;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }

  /**
   * One evaluation of the policy. Exposed so tests can drive it directly rather
   * than waiting on a real interval.
   */
  check(now: number = Date.now()): void {
    if (!this.enabled() || !this.vault.isUnlocked()) {
      return;
    }
    if (now - this.lastActivitySignal() < this.timeoutMinutesSignal() * 60_000) {
      return;
    }
    this.zone.run(() => {
      this.lockedByIdleSignal.set(true);
      this.vault.lock();
    });
  }
}
