import { Injectable, signal } from '@angular/core';

/** How long a copied secret is left on the clipboard. */
export const CLIPBOARD_CLEAR_SECONDS = 20;

/**
 * Copying secrets, with a best-effort auto-clear.
 *
 * SECURITY.md states plainly that the clipboard is not private: other
 * applications, and on some platforms other devices via clipboard sync, can read
 * it. Clearing narrows the window; it does not close it, and anything that
 * already read the value is beyond reach. This service exists to keep that
 * window short and to be honest about it, not to pretend the risk is handled.
 */
@Injectable({ providedIn: 'root' })
export class ClipboardService {
  private readonly copiedLabelSignal = signal<string | undefined>(undefined);
  private readonly secondsLeftSignal = signal(0);

  /** What was most recently copied, for a UI confirmation. */
  readonly copiedLabel = this.copiedLabelSignal.asReadonly();
  readonly secondsLeft = this.secondsLeftSignal.asReadonly();

  private timerId: ReturnType<typeof setInterval> | undefined;
  /** The value we wrote, so we never clear something the user copied since. */
  private lastWritten: string | undefined;

  /**
   * Copy a secret and schedule a clear.
   *
   * Returns false when the platform refuses — the Clipboard API requires a
   * secure context and a user gesture, and Firefox historically rejects
   * programmatic writes. Reporting that is better than a UI that claims success
   * while the clipboard is untouched.
   */
  async copy(value: string, label: string): Promise<boolean> {
    if (!value) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return false;
    }

    this.lastWritten = value;
    this.copiedLabelSignal.set(label);
    this.startCountdown();
    return true;
  }

  /**
   * Clear the clipboard, but only if it still holds what we put there.
   *
   * Without the read-back check, a timer from an earlier copy would wipe
   * whatever the user has copied since — losing their data to a feature meant
   * to protect it. If reading is not permitted we clear anyway: leaving a
   * password behind is the worse outcome.
   */
  async clearNow(): Promise<void> {
    this.stopCountdown();

    const written = this.lastWritten;
    this.lastWritten = undefined;
    this.copiedLabelSignal.set(undefined);

    if (written === undefined) {
      return;
    }

    try {
      let current: string | undefined;
      try {
        current = await navigator.clipboard.readText();
      } catch {
        current = undefined;
      }
      if (current === undefined || current === written) {
        await navigator.clipboard.writeText('');
      }
    } catch {
      // Nothing further to do: the platform declined, and SECURITY.md already
      // records that clipboard hygiene is best-effort.
    }
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.secondsLeftSignal.set(CLIPBOARD_CLEAR_SECONDS);

    this.timerId = setInterval(() => {
      const next = this.secondsLeftSignal() - 1;
      this.secondsLeftSignal.set(next);
      if (next <= 0) {
        void this.clearNow();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.timerId !== undefined) {
      clearInterval(this.timerId);
      this.timerId = undefined;
    }
    this.secondsLeftSignal.set(0);
  }
}
