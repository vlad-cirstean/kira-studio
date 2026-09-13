// D6/D13: clipboard formatting for grid row copy and paste. A row is captured as its *display*
// column order plus effective (possibly-staged) values — never the raw page/decode cache — so
// what gets copied always matches what's on screen (D6's rationale).
import { quoteIdent, quoteLiteral, type SqlDialect } from './sqlIdent';

export interface RowSnapshot {
  columns: string[];
  values: Record<string, string | null>;
  // F2/P21 round 1: which of `values` came from a cell the engine truncated (its 64 KiB display
  // cap) — so a format that generates something meant to be *run* (rowsToInsert) can refuse to
  // treat the truncated prefix as the real value, the same reason P24 D27 makes such a cell
  // non-editable in the grid itself. Optional: most snapshot builders have no truncation to report.
  truncated?: ReadonlySet<string>;
}

// P21 round 3 finding 10 (architecture/security): a cell is untrusted database content — the same
// reason SlickGridHost.vue explicitly disables enableHtmlRendering — but every text clipboard
// format below used to hand it straight to a spreadsheet. A value whose first character is one of
// `= + - @` TAB CR is evaluated as a formula the moment it's pasted into Excel/LibreOffice/Sheets
// (CWE-1236); prefixing it with a single quote is the standard mitigation. Applied before any
// other quoting/escaping below, so it survives a format's own quote-doubling untouched.
function neutralizeFormulaPrefix(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

// P21 round 3 finding 7 (functional): TSV has no native quoting, but real spreadsheet clipboard
// TSV does — a field carrying an embedded tab, quote or newline is wrapped in double quotes with
// `"` doubled, exactly CSV's own rule (csvField below). Without this, a `text` column holding an
// embedded tab or newline shifted every subsequent column (tab) or split one row into two
// (newline) on paste back into this app's own grid — copy→paste corrupted the very data it copied.
function tsvField(value: string): string {
  const guarded = neutralizeFormulaPrefix(value);
  if (/["\t\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

export function rowsToTsv(rows: RowSnapshot[]): string {
  return rows.map((r) => r.columns.map((c) => tsvField(r.values[c] ?? '')).join('\t')).join('\n');
}

interface CellText {
  text: string;
  isNull: boolean;
}

// A cell/range/column-selection copy reads the same displayed values a row copy does (D6's
// rationale, above) — `cellAt` is the grid's own `displayCell`, kept as a parameter rather than a
// second RowSnapshot pass because a range/column selection is addressed by (row, display column)
// pairs, not by whole rows. `rows` is an explicit, possibly-non-contiguous list (never a `[r0,r1]`
// bound walked internally) so a caller under an active filter can pass only the actually-visible
// rows within a range — finding 3 (round 2): a `range`-kind selection's own copy used to walk
// every page row between its two corners regardless of what the filter was hiding.
export function columnsToTsv(
  rows: readonly number[],
  cols: readonly number[],
  cellAt: (row: number, col: number) => CellText,
): string {
  const lines: string[] = [];
  for (const r of rows) {
    lines.push(
      cols
        .map((c) => {
          const dc = cellAt(r, c);
          return dc.isNull ? '' : tsvField(dc.text);
        })
        .join('\t'),
    );
  }
  return lines.join('\n');
}

function csvField(value: string): string {
  const guarded = neutralizeFormulaPrefix(value);
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
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
//
// F3/P21 round 1: the column list used to be hard-coded `"${c}"` regardless of dialect, which is a
// *string literal* in a column position on MySQL/MariaDB (without ANSI_QUOTES) and ClickHouse —
// this was the one clipboard format claiming to produce runnable SQL and unusable on 3 of 5
// engines. Values now go through quoteLiteral (backslash-aware where the dialect needs it, F3) and
// columns through quoteIdent, both dialect-driven like every other generated predicate in this
// app. F2: a value the engine truncated is never written as a literal — INSERTing its 64 KiB
// prefix as if it were the real value would silently corrupt the copy on execution — a comment
// names the column instead so the omission is visible, not silent.
export function rowsToInsert(
  qualifiedName: string,
  rows: RowSnapshot[],
  dialect: SqlDialect | undefined,
): string {
  if (rows.length === 0) return '';
  const columns = rows[0].columns;
  const columnList = columns.map((c) => quoteIdent(dialect, c)).join(', ');
  const truncatedColumns = new Set<string>();
  const valueLines = rows.map((r) => {
    const values = columns.map((c) => {
      if (r.truncated?.has(c)) {
        truncatedColumns.add(c);
        return 'NULL';
      }
      const v = r.values[c];
      return v === null || v === undefined ? 'NULL' : quoteLiteral(dialect, v);
    });
    return `  (${values.join(', ')})`;
  });
  const truncatedNote =
    truncatedColumns.size > 0
      ? `-- ${[...truncatedColumns].join(', ')} truncated in the grid — NULL substituted, not the real value\n`
      : '';
  return `${truncatedNote}INSERT INTO ${qualifiedName} (${columnList})\nVALUES\n${valueLines.join(',\n')};`;
}

/** TSV if `text` contains a tab character, else CSV (quoted-field aware). */
export function parseDelimited(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n');
  if (normalized.includes('\t')) {
    return parseDelimitedText(normalized, '\t');
  }
  return parseCsv(normalized);
}

function parseCsv(text: string): string[][] {
  return parseDelimitedText(text, ',');
}

// parseDelimitedText is the shared quoted-field-aware state machine behind both parseCsv and the
// TSV branch of parseDelimited — P21 round 3 finding 6 (functional): the TSV branch used to be a
// bare `split('\n').map(line => line.split('\t'))`, so it had neither the CSV branch's trailing-
// empty-row guard (every clipboard source puts a trailing newline on the clipboard, which produced
// a bogus extra row that silently blanked or inserted the row below whatever was pasted) nor any
// quote-awareness for reading back a value tsvField above wraps in quotes (an embedded tab or
// newline).
function parseDelimitedText(text: string, delimiter: string): string[][] {
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
    if (c === delimiter) {
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
