import type { VaultCustomField, VaultEntryDraft } from '../model/vault';

import { CsvError, parseCsvWithHeader } from './csv';

/**
 * Importers for the formats people actually leave other managers with.
 *
 * Every importer returns drafts; nothing here touches a vault. Two rules apply
 * throughout:
 *
 *  - **Fail loudly on a file we cannot understand.** A half-import is worse than
 *    a refusal, because the user believes their credentials moved across and
 *    only discovers otherwise when they need one.
 *  - **Never drop a field silently.** Anything recognised but unmodelled becomes
 *    a custom field rather than being discarded.
 */

export type ImportFormat = 'keepass-csv' | 'bitwarden-json' | 'browser-csv' | 'keepass-xml';

export interface ImportResult {
  readonly format: ImportFormat;
  readonly entries: readonly VaultEntryDraft[];
  /** Rows that were recognised but skipped, with the reason. */
  readonly skipped: readonly string[];
}

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
  'keepass-csv': 'KeePass CSV',
  'bitwarden-json': 'Bitwarden JSON',
  'browser-csv': 'Browser CSV',
  'keepass-xml': 'KeePass XML',
};

export function formatLabel(format: ImportFormat): string {
  return FORMAT_LABELS[format];
}

const pick = (row: Record<string, string>, ...names: string[]): string => {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return '';
};

/**
 * Choose an importer from the file's own content, not its extension.
 *
 * A `.csv` from Chrome and one from KeePass have different columns, and users
 * rename files.
 */
export function detectFormat(content: string, fileName = ''): ImportFormat {
  const trimmed = content.trimStart();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'bitwarden-json';
  }
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<KeePassFile')) {
    return 'keepass-xml';
  }

  const header = (trimmed.split(/\r?\n/, 1)[0] ?? '').toLowerCase();

  // KeePass exports "Account"/"Login Name"; browsers export "name"/"username".
  if (header.includes('login name') || header.includes('account')) {
    return 'keepass-csv';
  }
  if (header.includes('username') || header.includes('password')) {
    return 'browser-csv';
  }

  throw new ImportError(
    `Could not tell what kind of file ${fileName || 'this'} is. ` +
      'Supported: KeePass CSV or XML, Bitwarden JSON, and browser CSV exports.',
  );
}

export function importEntries(content: string, fileName = ''): ImportResult {
  const format = detectFormat(content, fileName);

  switch (format) {
    case 'keepass-csv':
      return importKeePassCsv(content);
    case 'browser-csv':
      return importBrowserCsv(content);
    case 'bitwarden-json':
      return importBitwardenJson(content);
    case 'keepass-xml':
      return importKeePassXml(content);
  }
}

/** KeePass 2 CSV: "Account","Login Name","Password","Web Site","Comments". */
export function importKeePassCsv(content: string): ImportResult {
  const rows = readCsv(content);
  const entries: VaultEntryDraft[] = [];
  const skipped: string[] = [];

  rows.forEach((row, index) => {
    const title = pick(row, 'account', 'title', 'name', 'group');
    const password = pick(row, 'password');

    if (!title && !password) {
      skipped.push(`Row ${index + 2}: no title or password.`);
      return;
    }

    entries.push({
      title: title || '(untitled)',
      username: pick(row, 'login name', 'username', 'user name', 'login'),
      password,
      url: pick(row, 'web site', 'url', 'website'),
      notes: pick(row, 'comments', 'notes'),
      tags: [],
      customFields: [],
      totpUri: pick(row, 'totp', 'otp'),
    });
  });

  return { format: 'keepass-csv', entries, skipped };
}

/** Chrome/Edge/Firefox CSV: name,url,username,password[,note]. */
export function importBrowserCsv(content: string): ImportResult {
  const rows = readCsv(content);
  const entries: VaultEntryDraft[] = [];
  const skipped: string[] = [];

  rows.forEach((row, index) => {
    const password = pick(row, 'password');
    const title = pick(row, 'name', 'title');
    const url = pick(row, 'url', 'origin', 'login_uri');

    if (!password && !title && !url) {
      skipped.push(`Row ${index + 2}: empty.`);
      return;
    }

    entries.push({
      title: title || hostOf(url) || '(untitled)',
      username: pick(row, 'username', 'login', 'login_username'),
      password,
      url,
      notes: pick(row, 'note', 'notes', 'comment'),
      tags: [],
      customFields: [],
      totpUri: pick(row, 'otpauth', 'totp'),
    });
  });

  return { format: 'browser-csv', entries, skipped };
}

interface BitwardenItem {
  type?: number;
  name?: string;
  notes?: string | null;
  favorite?: boolean;
  login?: {
    username?: string | null;
    password?: string | null;
    totp?: string | null;
    uris?: { uri?: string | null }[] | null;
  } | null;
  fields?: { name?: string | null; value?: string | null; type?: number }[] | null;
}

/**
 * Bitwarden's unencrypted JSON export.
 *
 * Only login items are imported. Secure notes, cards and identities have no
 * equivalent in a KDBX entry, and inventing one would misrepresent the data —
 * they are reported as skipped so the count is honest.
 */
export function importBitwardenJson(content: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new ImportError('That is not valid JSON.');
  }

  const container = parsed as { items?: unknown; encrypted?: boolean };

  if (container.encrypted === true) {
    throw new ImportError(
      'This is an encrypted Bitwarden export. Re-export without encryption, or decrypt it first.',
    );
  }

  const items = Array.isArray(container.items)
    ? (container.items as BitwardenItem[])
    : Array.isArray(parsed)
      ? (parsed as BitwardenItem[])
      : undefined;

  if (!items) {
    throw new ImportError('This JSON has no "items" array — it may not be a Bitwarden export.');
  }

  const entries: VaultEntryDraft[] = [];
  const skipped: string[] = [];

  for (const item of items) {
    // Bitwarden type 1 is a login; 2 note, 3 card, 4 identity.
    if (item.type !== undefined && item.type !== 1) {
      skipped.push(`"${item.name ?? 'untitled'}" is not a login (type ${item.type}).`);
      continue;
    }

    const login = item.login ?? {};
    const customFields: VaultCustomField[] = (item.fields ?? [])
      .filter((field) => field?.name)
      .map((field) => ({
        name: field.name ?? '',
        value: field.value ?? '',
        // Bitwarden field type 1 is "hidden", i.e. a secret.
        protected: field.type === 1,
      }));

    entries.push({
      title: item.name ?? '(untitled)',
      username: login.username ?? '',
      password: login.password ?? '',
      url: login.uris?.[0]?.uri ?? '',
      notes: item.notes ?? '',
      tags: item.favorite ? ['favourite'] : [],
      customFields,
      totpUri: login.totp ?? '',
    });
  }

  return { format: 'bitwarden-json', entries, skipped };
}

/**
 * KeePass 2 XML export.
 *
 * Parsed with the browser's own DOMParser — no dependency, and the same engine
 * kdbxweb uses. `DOMParser` does not execute scripts or resolve external
 * entities, so an XXE payload in an untrusted export has nothing to act on.
 */
export function importKeePassXml(content: string): ImportResult {
  const doc = new DOMParser().parseFromString(content, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new ImportError('That XML could not be parsed — the file may be corrupt.');
  }

  const entryNodes = [...doc.querySelectorAll('Entry')];
  if (entryNodes.length === 0) {
    throw new ImportError('No <Entry> elements found — this may not be a KeePass XML export.');
  }

  const entries: VaultEntryDraft[] = [];
  const skipped: string[] = [];

  entryNodes.forEach((node, index) => {
    // Skip history entries, which are nested inside their parent <Entry>.
    if (node.parentElement?.tagName === 'History') {
      return;
    }

    const values = new Map<string, string>();
    for (const stringNode of node.querySelectorAll(':scope > String')) {
      const key = stringNode.querySelector('Key')?.textContent?.trim();
      const value = stringNode.querySelector('Value')?.textContent ?? '';
      if (key) {
        values.set(key, value);
      }
    }

    const standard = new Set(['Title', 'UserName', 'Password', 'URL', 'Notes']);
    const title = values.get('Title') ?? '';
    const password = values.get('Password') ?? '';

    if (!title && !password) {
      skipped.push(`Entry ${index + 1}: no title or password.`);
      return;
    }

    const customFields: VaultCustomField[] = [...values]
      .filter(([key]) => !standard.has(key) && key !== 'otp')
      .map(([name, value]) => ({ name, value, protected: false }));

    entries.push({
      title: title || '(untitled)',
      username: values.get('UserName') ?? '',
      password,
      url: values.get('URL') ?? '',
      notes: values.get('Notes') ?? '',
      tags:
        node
          .querySelector(':scope > Tags')
          ?.textContent?.split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean) ?? [],
      customFields,
      totpUri: values.get('otp') ?? '',
    });
  });

  return { format: 'keepass-xml', entries, skipped };
}

function readCsv(content: string): Record<string, string>[] {
  try {
    const rows = parseCsvWithHeader(content);
    if (rows.length === 0) {
      throw new ImportError('The file has a header but no rows.');
    }
    return rows;
  } catch (error) {
    if (error instanceof CsvError) {
      throw new ImportError(`The CSV could not be read: ${error.message}`);
    }
    throw error;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
