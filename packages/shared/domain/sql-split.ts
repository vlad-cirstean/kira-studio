// A quote/comment-aware SQL statement splitter for the query console (§8.14): "Run statement"
// and "Run all" both reduce to "send N statements in one execute() call" (P5.5 D-plan), so both
// need to split on `;` without being fooled by a semicolon inside a string literal, a quoted
// identifier, or a comment. This is a splitter, not a parser — it tracks just enough lexical
// state (which kind of quote/comment it is inside) to find statement boundaries; it never
// validates SQL syntax.
//
// P60b §3.1: the quote/comment/dollar-quote scanning itself is `sql-lex.ts`'s `scanSqlSpan` —
// hoisted out of here (and `sql-lint.ts`) into one shared scanner both now call. No behaviour
// change: this file keeps its own `;`-splitting/backslash-escape/dollar-quoting semantics exactly.
import { resolveLexOptions, type SqlScanOptions, scanSqlSpan } from './sql-lex';

export interface SqlStatement {
  text: string;
  /** Offsets into the original source, not `text` — `text` is trimmed, these are not. */
  start: number;
  end: number;
}

/** See `sql-lex.ts`'s own `SqlLexOptions` field doc comments (P115 H5: this used to carry its own
 *  copy of them) — kept under this file's historical name for its own callers. */
export type SplitSqlOptions = SqlScanOptions;

export function splitSqlStatements(source: string, options?: SplitSqlOptions): SqlStatement[] {
  const lexOptions = resolveLexOptions(options);
  const statements: SqlStatement[] = [];
  const n = source.length;
  let i = 0;
  let stmtStart = 0;

  const pushIfNonEmpty = (end: number): void => {
    const text = source.slice(stmtStart, end).trim();
    if (text.length > 0) statements.push({ text, start: stmtStart, end });
  };

  while (i < n) {
    const span = scanSqlSpan(source, i, lexOptions);
    if (span) {
      i = span.end;
      continue;
    }
    const c = source[i];
    if (c === ';') {
      pushIfNonEmpty(i);
      i++;
      stmtStart = i;
      continue;
    }
    i++;
  }
  pushIfNonEmpty(n);
  return statements;
}

/** Where `s`'s own trimmed text actually starts within its raw (untrimmed) `[start, end)` span —
 *  `s.start` alone is not that boundary: it sits right after the *previous* statement's `;`, so it
 *  still includes any blank line/whitespace between the two statements. Exported (as
 *  `trimmedStatementStart`) so a caret placed at a *statement's* own position — never `s.start`
 *  itself — lands somewhere `statementAtOffset` unambiguously attributes to that statement, not
 *  its predecessor (ConsoleView.vue's own onFormat, real-interaction fix: Format's `;\n\n` join
 *  separator is wide enough that `s.start` sits inside the gap `statementAtOffset` gives to the
 *  *previous* statement, where a typed `;\n` separator was narrow enough this never surfaced). */
export function trimmedStatementStart(source: string, s: SqlStatement): number {
  const raw = source.slice(s.start, s.end);
  return s.start + (raw.length - raw.trimStart().length);
}

/** The statement whose range contains `cursor`, over an already-split statement list — P108 Part
 *  11 F3: the position right after a statement's own `;`, and any whitespace up to the next
 *  statement's first non-space character (a blank line between two statements, or trailing
 *  whitespace at the end of the document), belongs to the *preceding* statement. That is where the
 *  caret lands after typing `;` or pressing End, and it must never silently resolve to the
 *  following statement instead. `source` must be the exact text `statements` was split from.
 *  Exported so a caller that already has its own cached split (`ConsoleView.vue`'s
 *  `statementAtCursorText`, kept cheap on every caret move by not re-splitting) can reuse this
 *  logic instead of duplicating it. */
export function statementAtOffset(
  statements: SqlStatement[],
  source: string,
  cursor: number,
): SqlStatement | null {
  for (let i = 0; i < statements.length; i++) {
    const s = statements[i];
    if (!s) continue;
    const next = statements[i + 1];
    const ownedEnd = next ? trimmedStatementStart(source, next) - 1 : source.length;
    if (cursor <= ownedEnd) return s;
  }
  return statements[statements.length - 1] ?? null;
}

/** The statement whose source range contains `cursor`, or the last statement past the end. */
export function statementAtCursor(
  source: string,
  cursor: number,
  options?: SplitSqlOptions,
): SqlStatement | null {
  return statementAtOffset(splitSqlStatements(source, options), source, cursor);
}
