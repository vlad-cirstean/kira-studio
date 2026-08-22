import { z } from 'zod';
import { nodeKindSchema } from './tree';

// The DDL wire format and the statement splitter (P4 D3, D4). SourceText is the edit-ready model:
// it carries the full DDL verbatim plus statement boundaries, so a future edit phase can target one
// statement and diff it against the original without re-deriving structure. It is validated at the
// same trust boundaries as every other metadata payload (main on the way out of the cache, main on
// the way back from the engine) — unlike TabularPage/CellPayload, which carry megabytes and are the
// documented exception to the Zod-at-every-boundary rule.

export type SqlDialect = 'postgres' | 'mariadb';

// The edit-ready model: one top-level statement with its position in `text`. The future edit phase
// targets a statement by index and diffs its text against `SourceText.text`.
export const sourceStatementSchema = z.object({
  /** 0-based line of the statement's first line in `text`. */
  startLine: z.number().int().min(0),
  /** 0-based line of the statement's last line in `text`. */
  endLine: z.number().int().min(0),
  /** First up-to-two significant tokens, e.g. "CREATE TABLE", "CREATE INDEX idx", "ALTER TABLE". */
  label: z.string(),
});
export type SourceStatement = z.infer<typeof sourceStatementSchema>;

// DDL-bearing kinds only: table, view, matview, function, sequence, routine. A column/schema/…
// path never produces a SourceText (D6).
export const ddlObjectKindSchema = nodeKindSchema.refine(
  (k) => ['table', 'view', 'matview', 'function', 'sequence', 'routine'].includes(k),
  'not a DDL-bearing object kind',
);

export const sourceTextSchema = z.object({
  kind: z.literal('ddl'),
  path: z.string(), // encoded NodePath of the object
  objectKind: ddlObjectKindSchema,
  name: z.string(),
  qualifiedName: z.string(),
  /** Full DDL, verbatim. Reconstructed for Postgres tables/matviews/sequences, exact otherwise (D5). */
  text: z.string(),
  statements: z.array(sourceStatementSchema),
  elapsedMs: z.number(),
  fromCache: z.boolean(),
});
export type SourceText = z.infer<typeof sourceTextSchema>;

// Pure, dialect-aware, Bun-testable. Returns top-level statements in order; a `;` inside a quoted
// string, a block/line comment, or (postgres) a dollar-quoted body is NOT a boundary. Consecutive
// separators (`;;`) and a trailing separator produce no empty statements.
export function splitSqlStatements(text: string, dialect: SqlDialect): SourceStatement[] {
  const statements: SourceStatement[] = [];
  const isPg = dialect === 'postgres';

  // 0-based line number of the current scan position.
  let line = 0;
  // Byte index where the current statement's first significant character sits; -1 while no
  // statement is open. Whitespace and comments before the first token do not open a statement.
  let stmtStart = -1;
  let stmtLine = 0;

  const flush = (end: number, endLine: number): void => {
    if (stmtStart < 0) return;
    const seg = text.slice(stmtStart, end).trim();
    if (seg.length > 0) {
      statements.push({ startLine: stmtLine, endLine: endLine, label: labelFor(seg) });
    }
    stmtStart = -1;
  };

  type LexState = 'code' | 'single' | 'double' | 'backtick' | 'line' | 'block' | 'dollar';
  let state: LexState = 'code';
  let blockDepth = 0;
  let dollarTag = '';

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1] ?? '';

    switch (state) {
      case 'code': {
        if (stmtStart < 0 && !isWhitespace(c)) {
          stmtStart = i;
          stmtLine = line;
        }
        if (c === "'") {
          state = 'single';
          i++;
        } else if (c === '"') {
          state = 'double';
          i++;
        } else if (c === '`') {
          state = 'backtick';
          i++;
        } else if (c === '-' && next === '-') {
          state = 'line';
          i += 2;
        } else if (c === '/' && next === '*') {
          state = 'block';
          blockDepth = 1;
          i += 2;
        } else if (c === ';') {
          flush(i, line);
          i++;
        } else if (c === '\n') {
          line++;
          i++;
        } else if (c === '$' && isPg) {
          const open = dollarQuoteTag(text, i);
          if (open) {
            dollarTag = open.tag;
            state = 'dollar';
            i = open.next;
          } else {
            i++;
          }
        } else {
          i++;
        }
        break;
      }
      case 'single': {
        if (c === "'" && next === "'") {
          i += 2; // `''` — an escaped quote inside the string
        } else if (c === "'") {
          state = 'code';
          i++;
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
      case 'double': {
        if (c === '"' && next === '"') {
          i += 2;
        } else if (c === '"') {
          state = 'code';
          i++;
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
      case 'backtick': {
        if (c === '`' && next === '`') {
          i += 2;
        } else if (c === '`') {
          state = 'code';
          i++;
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
      case 'line': {
        if (c === '\n') {
          line++;
          state = 'code';
        }
        i++;
        break;
      }
      case 'block': {
        if (c === '/' && next === '*') {
          blockDepth++;
          i += 2;
        } else if (c === '*' && next === '/') {
          blockDepth--;
          i += 2;
          if (blockDepth === 0) state = 'code';
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
      case 'dollar': {
        if (c === '$') {
          const open = dollarQuoteTag(text, i);
          if (open && open.tag === dollarTag) {
            state = 'code';
            i = open.next;
          } else {
            i++;
          }
        } else {
          if (c === '\n') line++;
          i++;
        }
        break;
      }
    }
  }
  flush(text.length, line);
  return statements;
}

function isWhitespace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\r' || c === '\n';
}

// At text[i] === '$', return the dollar-quote opener (`$$` or `$tag$`) when present. `$1` is not an
// opener — a tag must start with a letter or underscore, so a digit right after `$` rules it out.
// `tag` is '' for `$$`; `next` is the index just past the closing `$` of the opener.
function dollarQuoteTag(text: string, i: number): { tag: string; next: number } | null {
  let j = i + 1;
  if (j >= text.length) return null;
  if (text[j] === '$') return { tag: '', next: j + 1 };
  if (!/[A-Za-z_]/.test(text[j])) return null;
  const start = j;
  while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
  if (j >= text.length || text[j] !== '$') return null;
  return { tag: text.slice(start, j), next: j + 1 };
}

// First up-to-two significant tokens, stopped at `(`. Comment tokens are skipped so a leading
// comment cannot become the outline label.
function labelFor(seg: string): string {
  const tokens: string[] = [];
  for (const raw of seg.split(/\s+/)) {
    if (raw.startsWith('--') || raw.startsWith('/*')) continue;
    if (tokens.length >= 2) break;
    if (raw.includes('(')) break;
    tokens.push(raw);
  }
  return tokens.join(' ');
}
