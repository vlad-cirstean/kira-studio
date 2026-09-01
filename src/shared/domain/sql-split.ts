// A quote/comment-aware SQL statement splitter for the query console (§8.14): "Run statement"
// and "Run all" both reduce to "send N statements in one execute() call" (P5.5 D-plan), so both
// need to split on `;` without being fooled by a semicolon inside a string literal, a quoted
// identifier, or a comment. This is a splitter, not a parser — it tracks just enough lexical
// state (which kind of quote/comment it is inside) to find statement boundaries; it never
// validates SQL syntax.
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
}

export function splitSqlStatements(source: string, options?: SplitSqlOptions): SqlStatement[] {
  const backslashEscapes = options?.backslashEscapes ?? true;
  const statements: SqlStatement[] = [];
  const n = source.length;
  let i = 0;
  let stmtStart = 0;

  const pushIfNonEmpty = (end: number): void => {
    const text = source.slice(stmtStart, end).trim();
    if (text.length > 0) statements.push({ text, start: stmtStart, end });
  };

  while (i < n) {
    const c = source[i];

    if (c === '-' && source[i + 1] === '-') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Single/double/back-quoted runs: '' or "" or `` doubles the quote as an escape (every SQL
    // dialect here honours that); a backslash escaping the next character too is dialect-specific
    // (P2 R2) — see SplitSqlOptions.backslashEscapes's own doc comment.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (backslashEscapes && source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          if (source[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Postgres dollar-quoting: $$ ... $$ or $tag$ ... $tag$ — a semicolon inside one is not a
    // statement boundary (function/procedure bodies rely on this).
    if (c === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (match) {
        const tag = match[0];
        const closeIdx = source.indexOf(tag, i + tag.length);
        i = closeIdx < 0 ? n : closeIdx + tag.length;
        continue;
      }
    }
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
