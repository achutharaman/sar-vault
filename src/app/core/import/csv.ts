/**
 * A minimal RFC 4180 CSV reader.
 *
 * Exported password files routinely contain commas, quotes and newlines inside
 * fields — a note wrapping two lines, a password containing a comma. Splitting
 * on commas would shred exactly those rows, so this is a real parser rather than
 * a `split(',')`. Writing one is cheaper than a dependency (hard rule 4), and a
 * CSV reader is small enough to be obviously correct.
 */

export class CsvError extends Error {
  override readonly name = 'CsvError';
}

/** Parse CSV into rows of raw cell strings. */
export function parseCsv(input: string): string[][] {
  // Strip a UTF-8 BOM: Excel writes one, and it would otherwise become part of
  // the first header name and break column matching.
  const text = input.replace(/^\uFEFF/, '');

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    // Skip rows that are entirely empty, which trailing newlines produce.
    if (row.length > 1 || row[0] !== '') {
      rows.push(row);
    }
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'; // Escaped quote.
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += char;
      i++;
      continue;
    }

    if (char === '"') {
      if (cell !== '') {
        throw new CsvError(`Unexpected quote at position ${i}.`);
      }
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      endCell();
      i++;
      continue;
    }
    if (char === '\r') {
      i++;
      continue;
    }
    if (char === '\n') {
      endRow();
      i++;
      continue;
    }

    cell += char;
    i++;
  }

  if (inQuotes) {
    throw new CsvError('The file ends inside a quoted value — it may be truncated.');
  }
  if (cell !== '' || row.length > 0) {
    endRow();
  }

  return rows;
}

/**
 * Parse CSV with a header row into objects keyed by lower-cased column name.
 *
 * Header matching is case-insensitive because exporters disagree on casing
 * ("Login Name" vs "login name" vs "username").
 */
export function parseCsvWithHeader(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  const header = rows[0];

  if (!header || header.length === 0) {
    throw new CsvError('The file has no header row.');
  }

  const columns = header.map((name) => name.trim().toLowerCase());

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    columns.forEach((column, index) => {
      record[column] = row[index] ?? '';
    });
    return record;
  });
}
