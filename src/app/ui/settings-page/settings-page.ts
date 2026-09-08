import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AUTO_LOCK_OPTIONS, AutoLockService } from '../../core/vault/auto-lock.service';
import { CLIPBOARD_CLEAR_SECONDS } from '../../core/vault/clipboard.service';
import { VaultService } from '../../core/vault/vault.service';
import { GeneratorSettings } from '../generator-settings/generator-settings';

/** Settings, on its own route rather than a panel over the vault. */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GeneratorSettings, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage {
  protected readonly vault = inject(VaultService);
  protected readonly autoLock = inject(AutoLockService);

  protected readonly autoLockOptions = AUTO_LOCK_OPTIONS;
  protected readonly clipboardSeconds = CLIPBOARD_CLEAR_SECONDS;
}
