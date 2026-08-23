// D6/D13: clipboard formatting for grid row copy and paste. A row is captured as its *display*
// column order plus effective (possibly-staged) values — never the raw page/decode cache — so
// what gets copied always matches what's on screen (D6's rationale).
export interface RowSnapshot {
  columns: string[];
  values: Record<string, string | null>;
}

export function rowsToTsv(rows: RowSnapshot[]): string {
  return rows.map((r) => r.columns.map((c) => r.values[c] ?? '').join('\t')).join('\n');
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function rowsToCsv(rows: RowSnapshot[]): string {
  return rows.map((r) => r.columns.map((c) => csvField(r.values[c] ?? '')).join(',')).join('\r\n');
}

export function rowsToJson(rows: RowSnapshot[]): string {
  return JSON.stringify(
    rows.map((r) => Object.fromEntries(r.columns.map((c) => [c, r.values[c] ?? null]))),
    null,
    2,
  );
}

// A generated statement for the user to review/edit, same trust boundary as D5's WHERE clause —
// every value is quoted text (or bare NULL), never a typed literal (P5's "never a typed JS
// value" ground rule applies here too).
export function rowsToInsert(qualifiedName: string, rows: RowSnapshot[]): string {
  if (rows.length === 0) return '';
  const columns = rows[0].columns;
  const columnList = columns.map((c) => `"${c}"`).join(', ');
  const valueLines = rows.map((r) => {
    const values = columns.map((c) => {
      const v = r.values[c];
      return v === null || v === undefined ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
    });
    return `  (${values.join(', ')})`;
  });
  return `INSERT INTO ${qualifiedName} (${columnList})\nVALUES\n${valueLines.join(',\n')};`;
}

/** TSV if `text` contains a tab character, else CSV (quoted-field aware). */
export function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('\t')) {
    return normalized.split('\n').map((line) => line.split('\t'));
  }
  return parseCsv(normalized);
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  row.push(field);
  rows.push(row);
  // A trailing newline in the source produces one bogus all-empty trailing row — drop it.
  if (rows.length > 1) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
  }
  return rows;
}
