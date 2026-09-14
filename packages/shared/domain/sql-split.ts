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
import { scanSqlSpan } from './sql-lex';

export interface SqlStatement {
  text: string;
  /** Offsets into the original source, not `text` — `text` is trimmed, these are not. */
  start: number;
  end: number;
}

export interface SplitSqlOptions {
  /** Whether a backslash escapes the next character inside a '...'/"..."/`...` run — true for
   *  MySQL/MariaDB/ClickHouse, false for standard-SQL dialects (Postgres, SQLite) where a bare
   *  backslash is not special and only a doubled quote escapes (P2 R2). Defaults to true, the
   *  pre-P2-R2 universal behaviour, for any caller that doesn't know its dialect. */
  backslashEscapes?: boolean;
  /** Whether `$$.../$tag$...$tag$` opens a Postgres-style dollar-quoted string — a Postgres-only
   *  convention. `$` is a legal (if unusual) identifier character on MySQL/MariaDB, so an
   *  identifier containing two of them reads as an unterminated dollar-quote open tag there and
   *  swallows the rest of the document into one statement. Defaults to true, the pre-fix universal
   *  behaviour, for any caller that doesn't know its dialect. */
  dollarQuoting?: boolean;
}

export function splitSqlStatements(source: string, options?: SplitSqlOptions): SqlStatement[] {
  const backslashEscapes = options?.backslashEscapes ?? true;
  const dollarQuoting = options?.dollarQuoting ?? true;
  const lexOptions = { backslashEscapes, dollarQuoting };
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

/** The statement whose source range contains `cursor`, or the last statement past the end. */
export function statementAtCursor(
  source: string,
  cursor: number,
  options?: SplitSqlOptions,
): SqlStatement | null {
  const statements = splitSqlStatements(source, options);
  for (const s of statements) {
    if (cursor >= s.start && cursor <= s.end) return s;
  }
  return statements[statements.length - 1] ?? null;
}
