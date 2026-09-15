// P60b §3.1: the quote/comment/dollar-quote scanning rules `sql-split.ts` and `sql-lint.ts` each
// carried as their own independent copy (the duplication `sql-lint.ts`'s own header comment
// already named: "Sibling of sql-split.ts: same lexical states … reused here"), hoisted into one
// shared scanner both now call — closing that duplication, and giving `sql-tokens.ts` a third,
// identical caller rather than a third independent copy (D1's own reasoning).
export interface SqlLexOptions {
  /** See `sql-split.ts`'s own `SplitSqlOptions.backslashEscapes` doc comment — mirrored exactly. */
  backslashEscapes: boolean;
  /** See `sql-split.ts`'s own `SplitSqlOptions.dollarQuoting` doc comment — mirrored exactly. */
  dollarQuoting: boolean;
}

export type SqlLexSpanKind = 'lineComment' | 'blockComment' | 'quote' | 'dollarQuote';

export interface SqlLexSpan {
  kind: SqlLexSpanKind;
  /** Inclusive start (the opening delimiter's own first character). */
  start: number;
  /** Exclusive end — one past the closing delimiter, or the source length when unterminated. */
  end: number;
  /** False only when the span ran to EOF without a closing delimiter — never a thrown error
   *  (R2): the caller decides what, if anything, that means (sql-lint.ts reports it; sql-split.ts
   *  and sql-tokens.ts simply treat `end` as the span's own boundary either way). */
  closed: boolean;
  /** `kind === 'quote'` only — which of `'`/`"`/`` ` `` opened it, so a caller that cares which
   *  quote character was used (sql-tokens.ts's String-vs-QuotedIdentifier classification) doesn't
   *  have to re-read `source[start]` itself. */
  quoteChar?: string;
}

/** Recognises and scans one of the four lexical spans this SQL lexer family agrees on — a line
 *  comment, a block comment, a quoted run (`'...'`/`"..."`/`` `...` ``), or a Postgres-style
 *  dollar-quoted string — starting at `source[i]`. Returns `null` when `i` doesn't start one of
 *  these (the caller handles the character itself: punctuation, an identifier, a paren, …). Never
 *  throws: an unterminated comment/quote/dollar-quote spans to EOF with `closed: false`. */
export function scanSqlSpan(source: string, i: number, options: SqlLexOptions): SqlLexSpan | null {
  const n = source.length;
  const c = source[i];

  if (c === '-' && source[i + 1] === '-') {
    let j = i + 2;
    while (j < n && source[j] !== '\n') j++;
    return { kind: 'lineComment', start: i, end: j, closed: true };
  }
  if (c === '/' && source[i + 1] === '*') {
    let j = i + 2;
    while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
    if (j >= n) return { kind: 'blockComment', start: i, end: n, closed: false };
    return { kind: 'blockComment', start: i, end: j + 2, closed: true };
  }
  // Single/double/back-quoted runs: '' or "" or `` doubles the quote as an escape (every SQL
  // dialect here honours that); a backslash escaping the next character too is dialect-specific
  // (sql-split.ts's own SplitSqlOptions.backslashEscapes doc comment).
  if (c === "'" || c === '"' || c === '`') {
    const quote = c;
    let j = i + 1;
    let closed = false;
    while (j < n) {
      if (options.backslashEscapes && source[j] === '\\') {
        j += 2;
        continue;
      }
      if (source[j] === quote) {
        if (source[j + 1] === quote) {
          j += 2;
          continue;
        }
        j++;
        closed = true;
        break;
      }
      j++;
    }
    // A trailing backslash-escape at the very end of source (j at n-1) steps j to n+1 above —
    // clamp back to n (finding #15, M6): end must never exceed source.length, the same "the
    // source length when unterminated" contract every other arm here already honours.
    return { kind: 'quote', start: i, end: Math.min(j, n), closed, quoteChar: quote };
  }
  // Postgres dollar-quoting: $$ ... $$ or $tag$ ... $tag$.
  if (c === '$' && options.dollarQuoting) {
    const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
    if (match) {
      const tag = match[0];
      const closeIdx = source.indexOf(tag, i + tag.length);
      if (closeIdx < 0) return { kind: 'dollarQuote', start: i, end: n, closed: false };
      return { kind: 'dollarQuote', start: i, end: closeIdx + tag.length, closed: true };
    }
  }
  return null;
}
