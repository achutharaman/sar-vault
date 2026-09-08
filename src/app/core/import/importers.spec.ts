import { describe, expect, it } from 'vitest';

import { CsvError, parseCsv, parseCsvWithHeader } from './csv';
import { detectFormat, ImportError, importEntries } from './importers';

describe('CSV reader', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  /*
   * The reason this is a parser and not `split(',')`. Password exports routinely
   * contain commas in notes and quotes in passwords; splitting would shred
   * exactly the rows that matter.
   */
  it('handles commas, quotes and newlines inside quoted fields', () => {
    const rows = parseCsv('title,notes\n"Bank","Call, then ask for ""Sam""\nsecond line"');

    expect(rows[1]).toEqual(['Bank', 'Call, then ask for "Sam"\nsecond line']);
  });

  it('tolerates CRLF and trailing newlines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM so the first column name still matches', () => {
    const rows = parseCsvWithHeader('\uFEFFname,password\nGitHub,pw');
    expect(rows[0]?.['name']).toBe('GitHub');
  });

  it('reports a truncated file instead of returning partial data', () => {
    expect(() => parseCsv('a,b\n"unterminated')).toThrow(CsvError);
    expect(() => parseCsv('a,b\n"unterminated')).toThrow(/truncated/i);
  });

  it('matches header names case-insensitively', () => {
    const rows = parseCsvWithHeader('Login Name,PASSWORD\nme,pw');
    expect(rows[0]?.['login name']).toBe('me');
    expect(rows[0]?.['password']).toBe('pw');
  });
});

describe('format detection', () => {
  it.each([
    ['{"items":[]}', 'bitwarden-json'],
    ['<?xml version="1.0"?><KeePassFile/>', 'keepass-xml'],
    ['"Account","Login Name","Password","Web Site","Comments"\n', 'keepass-csv'],
    ['name,url,username,password\n', 'browser-csv'],
  ])('detects %s', (content, expected) => {
    expect(detectFormat(content)).toBe(expected);
  });

  it('refuses a file it does not recognise rather than guessing', () => {
    expect(() => detectFormat('just some prose', 'notes.txt')).toThrow(ImportError);
    expect(() => detectFormat('just some prose', 'notes.txt')).toThrow(/notes\.txt/);
  });
});

describe('KeePass CSV', () => {
  const csv = [
    '"Account","Login Name","Password","Web Site","Comments"',
    '"GitHub","achutharaman","hunter2","https://github.com","primary"',
    '"Bank","me","p,with,commas","https://bank.example","Call, then ask"',
  ].join('\n');

  it('maps KeePass column names', () => {
    const { entries, format } = importEntries(csv);

    expect(format).toBe('keepass-csv');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'achutharaman',
      password: 'hunter2',
      url: 'https://github.com',
      notes: 'primary',
    });
    expect(entries[1]?.password).toBe('p,with,commas');
  });

  it('skips rows with neither title nor password, and says so', () => {
    const { entries, skipped } = importEntries(
      '"Account","Login Name","Password"\n"","",""\n"Real","me","pw"',
    );

    expect(entries).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatch(/Row 2/);
  });
});

describe('browser CSV', () => {
  it('maps Chrome-style columns', () => {
    const { entries, format } = importEntries(
      'name,url,username,password,note\nGitHub,https://github.com,me,pw,a note',
    );

    expect(format).toBe('browser-csv');
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      url: 'https://github.com',
      username: 'me',
      password: 'pw',
      notes: 'a note',
    });
  });

  it('falls back to the URL host when a row has no name', () => {
    const { entries } = importEntries('name,url,username,password\n,https://example.com,me,pw');
    expect(entries[0]?.title).toBe('example.com');
  });
});

describe('Bitwarden JSON', () => {
  const exportJson = JSON.stringify({
    encrypted: false,
    items: [
      {
        type: 1,
        name: 'GitHub',
        notes: 'primary account',
        favorite: true,
        login: {
          username: 'me',
          password: 'pw',
          totp: 'otpauth://totp/GitHub?secret=MZXW6YTBOI',
          uris: [{ uri: 'https://github.com' }],
        },
        fields: [
          { name: 'Recovery', value: 'abc', type: 1 },
          { name: 'Account no', value: '123', type: 0 },
        ],
      },
      { type: 2, name: 'A secure note', notes: 'nothing to see' },
    ],
  });

  it('imports login items with their fields and TOTP', () => {
    const { entries, skipped } = importEntries(exportJson);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'me',
      password: 'pw',
      url: 'https://github.com',
      notes: 'primary account',
    });
    expect(entries[0]?.totpUri).toContain('otpauth://');
    expect(entries[0]?.tags).toEqual(['favourite']);

    // Bitwarden field type 1 is "hidden", which must stay protected.
    expect(entries[0]?.customFields).toEqual([
      { name: 'Recovery', value: 'abc', protected: true },
      { name: 'Account no', value: '123', protected: false },
    ]);

    // Non-login items are reported, not silently dropped.
    expect(skipped[0]).toMatch(/secure note/i);
  });

  /*
   * An encrypted export parses as valid JSON but contains ciphertext. Importing
   * it would produce entries whose "passwords" are base64 blobs — a silent,
   * confusing failure. Refusing is the only honest outcome.
   */
  it('refuses an encrypted export instead of importing ciphertext', () => {
    expect(() => importEntries(JSON.stringify({ encrypted: true, items: [] }))).toThrow(
      /encrypted Bitwarden export/i,
    );
  });

  it('rejects JSON that is not a Bitwarden export', () => {
    expect(() => importEntries('{"something":"else"}')).toThrow(/no "items" array/i);
  });

  it('reports invalid JSON clearly', () => {
    expect(() => importEntries('{ not json')).toThrow(ImportError);
  });
});

describe('KeePass XML', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<KeePassFile><Root><Group><Name>General</Name>
  <Entry>
    <Tags>work;critical</Tags>
    <String><Key>Title</Key><Value>GitHub</Value></String>
    <String><Key>UserName</Key><Value>me</Value></String>
    <String><Key>Password</Key><Value ProtectInMemory="True">pw</Value></String>
    <String><Key>URL</Key><Value>https://github.com</Value></String>
    <String><Key>Notes</Key><Value>a note</Value></String>
    <String><Key>Recovery</Key><Value>abc</Value></String>
    <History>
      <Entry><String><Key>Title</Key><Value>Old title</Value></String></Entry>
    </History>
  </Entry>
</Group></Root></KeePassFile>`;

  it('imports entries with tags and custom fields', () => {
    const { entries, format } = importEntries(xml);

    expect(format).toBe('keepass-xml');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'GitHub',
      username: 'me',
      password: 'pw',
      url: 'https://github.com',
      notes: 'a note',
    });
    expect(entries[0]?.tags).toEqual(['work', 'critical']);
    expect(entries[0]?.customFields).toEqual([
      { name: 'Recovery', value: 'abc', protected: false },
    ]);
  });

  /*
   * KeePass nests past versions as <Entry> inside <History>. A naive
   * querySelectorAll('Entry') would import every old revision as a separate
   * live credential.
   */
  it('does not import history revisions as separate entries', () => {
    const { entries } = importEntries(xml);
    expect(entries.map((e) => e.title)).toEqual(['GitHub']);
  });

  it('reports malformed XML rather than importing nothing silently', () => {
    expect(() => importEntries('<?xml version="1.0"?><KeePassFile><unclosed>')).toThrow(
      ImportError,
    );
  });

  it('reports XML with no entries', () => {
    expect(() => importEntries('<?xml version="1.0"?><KeePassFile><Root/></KeePassFile>')).toThrow(
      /no <Entry> elements/i,
    );
  });
});
