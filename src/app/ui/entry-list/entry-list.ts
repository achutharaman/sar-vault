import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { VaultEntry } from '../../core/model/vault';

/** The list of entries. Selection only — no editing, no secrets displayed. */
@Component({
  selector: 'app-entry-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entries().length === 0) {
      <p class="empty">
        {{ searching() ? 'No entries match that search.' : 'This vault has no entries yet.' }}
      </p>
    } @else {
      <ul>
        @for (entry of entries(); track entry.id) {
          <li>
            <button
              type="button"
              [class.selected]="entry.id === selectedId()"
              (click)="selected.emit(entry.id)"
            >
              <span class="title">{{ entry.title || '(untitled)' }}</span>
              @if (entry.username) {
                <span class="username">{{ entry.username }}</span>
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    li button {
      width: 100%;
      text-align: left;
      background: none;
      border: 1px solid transparent;
      border-radius: 0.4rem;
      padding: 0.5rem 0.6rem;
      cursor: pointer;
      color: inherit;
      font: inherit;
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
    }
    li button:hover {
      background: var(--surface-hover);
    }
    li button.selected {
      background: var(--surface-active);
      border-color: var(--accent);
    }
    .title {
      font-size: 0.9rem;
    }
    .username {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .empty {
      color: var(--muted);
      font-size: 0.85rem;
      padding: 0.5rem 0.1rem;
    }
  `,
})
export class EntryList {
  readonly entries = input.required<readonly VaultEntry[]>();
  readonly selectedId = input<string | undefined>(undefined);
  readonly searching = input(false);

  readonly selected = output<string>();
}
