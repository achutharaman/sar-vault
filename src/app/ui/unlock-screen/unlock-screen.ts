import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { VaultService } from '../../core/vault/vault.service';

/**
 * The unlock screen.
 *
 * Contains no security logic beyond input handling — deriving the key, reading
 * the file and decrypting all happen behind `VaultService`.
 */
@Component({
  selector: 'app-unlock-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="unlock">
      <header>
        <h1>sar-vault</h1>
        <p class="tagline">Your passwords, your encryption, your storage.</p>
      </header>

      <div class="warning" role="note">
        <strong>Unaudited and pre-alpha.</strong> Don't put credentials in here that you can't
        afford to lose or have exposed.
      </div>

      @if (vault.connecting()) {
        <p class="hint">Connecting…</p>
      }

      @if (vault.cloudProviders.length > 0) {
        <div class="providers">
          <span class="providers-label">Open from</span>
          <div class="provider-buttons">
            @for (provider of vault.cloudProviders; track provider.id) {
              @if (vault.isCloudConnected(provider.id)) {
                <button
                  type="button"
                  class="secondary"
                  (click)="vault.disconnectCloud(provider.id)"
                >
                  Disconnect {{ provider.displayName }}
                </button>
              } @else {
                <button type="button" class="secondary" (click)="vault.connectCloud(provider.id)">
                  {{ provider.displayName }}
                </button>
              }
            }
          </div>
        </div>
      }

      @if (mode() === 'open') {
        @if (vault.cloudFiles().length > 0) {
          <div class="providers">
            <span class="providers-label">Vaults found</span>
            <div class="provider-buttons">
              @for (file of vault.cloudFiles(); track file.id) {
                <button type="button" class="secondary" (click)="vault.selectCloudFile(file)">
                  {{ file.name }}
                </button>
              }
            </div>
          </div>
        }

        <form (submit)="unlock($event)">
          @if (vault.canWriteBack()) {
            <div class="field">
              <span id="vault-file-label">Vault file</span>
              <button
                type="button"
                class="secondary"
                aria-describedby="vault-file-label"
                (click)="pick()"
              >
                {{ vault.fileName() ?? 'Choose a .kdbx file…' }}
              </button>
            </div>
          } @else {
            <label>
              <span>Vault file</span>
              <input type="file" accept=".kdbx" (change)="onFileSelected($event)" />
            </label>
          }

          <label>
            <span>Master password</span>
            <input
              type="password"
              autocomplete="current-password"
              [value]="password()"
              (input)="password.set($any($event.target).value)"
              [disabled]="vault.isBusy()"
              required
            />
          </label>

          <button type="submit" [disabled]="vault.isBusy() || !vault.fileName()">
            {{ vault.status() === 'unlocking' ? 'Deriving key…' : 'Unlock' }}
          </button>

          @if (vault.status() === 'unlocking') {
            <p class="hint">
              Argon2id is deliberately slow — this takes a moment, and that's what makes a stolen
              vault expensive to crack.
            </p>
          }
        </form>

        <button type="button" class="link" (click)="mode.set('create')">
          Create a new vault instead
        </button>
      } @else {
        <form (submit)="create($event)">
          <label>
            <span>Vault name</span>
            <input
              type="text"
              [value]="newName()"
              (input)="newName.set($any($event.target).value)"
              required
            />
          </label>

          <label>
            <span>Master password</span>
            <input
              type="password"
              autocomplete="new-password"
              [value]="password()"
              (input)="password.set($any($event.target).value)"
              required
            />
          </label>

          @if (vault.newVaultTargets().length > 1) {
            <div class="field">
              <span>Save it to</span>
              <div class="provider-buttons">
                @for (target of vault.newVaultTargets(); track target.id) {
                  <button
                    type="button"
                    class="secondary"
                    [class.chosen]="vault.saveTarget() === target.id"
                    [attr.aria-pressed]="vault.saveTarget() === target.id"
                    (click)="vault.setSaveTarget(target.id)"
                  >
                    {{ target.displayName }}
                  </button>
                }
              </div>
            </div>
          } @else {
            <p class="hint">
              Connect Google Drive or OneDrive above to save a new vault straight to the cloud.
              Otherwise it downloads to this device.
            </p>
          }

          <p class="hint">
            There is no recovery. If you forget this password the vault is gone — that is what
            zero-knowledge means.
          </p>

          <button type="submit" [disabled]="!password() || !newName()">Create vault</button>
        </form>

        <button type="button" class="link" (click)="mode.set('open')">
          Open an existing vault instead
        </button>
      }

      @if (vault.error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 2rem 1rem;
    }
    .unlock {
      width: min(28rem, 100%);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    h1 {
      margin: 0;
      font-size: 1.75rem;
      letter-spacing: -0.02em;
    }
    .tagline {
      margin: 0.25rem 0 0;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .warning {
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--warn-border);
      background: var(--warn-bg);
      border-radius: 0.5rem;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    label,
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.85rem;
    }
    label > span,
    .field > span {
      color: var(--muted);
    }
    .providers {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .providers-label {
      color: var(--muted);
      font-size: 0.85rem;
    }
    .provider-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .provider-buttons .chosen {
      border-color: var(--accent);
      background: var(--surface-active);
    }
    .link {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: 0.85rem;
      padding: 0;
      text-align: left;
      text-decoration: underline;
    }
    .hint {
      margin: 0;
      color: var(--muted);
      font-size: 0.8rem;
      line-height: 1.45;
    }
    .error {
      margin: 0;
      padding: 0.65rem 0.8rem;
      border-radius: 0.5rem;
      background: var(--error-bg);
      color: var(--error-fg);
      font-size: 0.85rem;
    }
  `,
})
export class UnlockScreen {
  protected readonly vault = inject(VaultService);
  protected readonly password = signal('');
  protected readonly mode = signal<'open' | 'create'>('open');
  protected readonly newName = signal('My Vault');

  protected onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.vault.selectFile(file);
    }
  }

  protected async pick(): Promise<void> {
    await this.vault.pickFile();
  }

  protected async unlock(event: Event): Promise<void> {
    event.preventDefault();
    const ok = await this.vault.unlock(this.password());
    if (ok) {
      this.password.set('');
    }
  }

  protected create(event: Event): void {
    event.preventDefault();
    this.vault.createVault(this.password(), this.newName());
    this.password.set('');
  }
}
