import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';

import { EMPTY_ENTRY_DRAFT, type VaultEntry, type VaultEntryDraft } from '../../core/model/vault';

/** Form for a single entry. Emits drafts; it never touches storage itself. */
@Component({
  selector: 'app-entry-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form (submit)="submit($event)">
      <label>
        <span>Title</span>
        <input
          type="text"
          [value]="draft().title"
          (input)="patch('title', $any($event.target).value)"
          required
        />
      </label>

      <label>
        <span>Username</span>
        <input
          type="text"
          autocomplete="off"
          [value]="draft().username"
          (input)="patch('username', $any($event.target).value)"
        />
      </label>

      <!-- The reveal button sits outside the label: a label that wraps it would
           take its text into the field's accessible name ("Password Show"). -->
      <div class="field">
        <label for="entry-password">Password</label>
        <div class="with-action">
          <input
            id="entry-password"
            [type]="revealed() ? 'text' : 'password'"
            autocomplete="off"
            [value]="draft().password"
            (input)="patch('password', $any($event.target).value)"
          />
          <button
            type="button"
            class="secondary"
            [attr.aria-label]="revealed() ? 'Hide password' : 'Show password'"
            (click)="revealed.set(!revealed())"
          >
            {{ revealed() ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>

      <label>
        <span>URL</span>
        <input type="url" [value]="draft().url" (input)="patch('url', $any($event.target).value)" />
      </label>

      <label>
        <span>Notes</span>
        <textarea
          rows="4"
          [value]="draft().notes"
          (input)="patch('notes', $any($event.target).value)"
        ></textarea>
      </label>

      <div class="actions">
        <button type="submit">{{ entry() ? 'Apply changes' : 'Add entry' }}</button>
        @if (entry(); as existing) {
          <button type="button" class="danger" (click)="deleted.emit(existing.id)">Delete</button>
        }
        <button type="button" class="secondary" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    label,
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      font-size: 0.85rem;
    }
    label > span,
    .field > label {
      color: var(--muted);
    }
    .with-action {
      display: flex;
      gap: 0.5rem;
    }
    .with-action input {
      flex: 1;
      min-width: 0;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
    textarea {
      resize: vertical;
      font: inherit;
    }
  `,
})
export class EntryEditor {
  readonly entry = input<VaultEntry | undefined>(undefined);

  readonly submitted = output<VaultEntryDraft>();
  readonly deleted = output<string>();
  readonly cancelled = output<void>();

  protected readonly draft = signal<VaultEntryDraft>({ ...EMPTY_ENTRY_DRAFT });
  protected readonly revealed = signal(false);

  constructor() {
    // Reset the form whenever a different entry is selected. Passwords are
    // re-hidden on every switch so one entry's password is never left visible
    // while another is being viewed.
    effect(() => {
      const current = this.entry();
      this.draft.set(
        current
          ? {
              title: current.title,
              username: current.username,
              password: current.password,
              url: current.url,
              notes: current.notes,
            }
          : { ...EMPTY_ENTRY_DRAFT },
      );
      this.revealed.set(false);
    });
  }

  protected patch<K extends keyof VaultEntryDraft>(key: K, value: VaultEntryDraft[K]): void {
    this.draft.update((current) => ({ ...current, [key]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.emit(this.draft());
  }
}
