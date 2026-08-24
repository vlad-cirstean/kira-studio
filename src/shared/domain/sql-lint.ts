// Lexical-only SQL diagnostics (P18 addendum D24) — no grammar, no server round trip, and no
// dependency on anything renderer-only (this file is shared/domain, imported by main and engine
// too). Sibling of sql-split.ts: same lexical states (quotes, dollar-quotes, comments), reused
// here to find exactly the two defects a broken statement can have before it ever reaches the
// adapter — an unterminated quote/comment, and unbalanced parentheses. Deliberately not the
// Lezer SQL tree's error nodes: one grammar serves every dialect, so its error nodes would flag
// valid dialect-specific syntax the grammar doesn't model (D24's own rationale).
export interface LintIssue {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

export function lintSql(source: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const n = source.length;
  let i = 0;
  let parenStack: number[] = [];

  const flushParens = (): void => {
    for (const pos of parenStack) {
      issues.push({
        from: pos,
        to: pos + 1,
        severity: 'error',
        message: 'unbalanced parenthesis',
      });
    }
    parenStack = [];
  };

  while (i < n) {
    const c = source[i];

    if (c === '-' && source[i + 1] === '-') {
      i += 2;
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      if (i >= n) {
        issues.push({
          from: start,
          to: n,
          severity: 'error',
          message: 'unterminated block comment',
        });
        break;
      }
      i += 2;
      continue;
    }
    // Single/double/back-quoted runs: '' or "" or `` doubles the quote as an escape, matching
    // sql-split.ts's own handling.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          if (source[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        const kind = quote === '`' ? 'quoted identifier' : 'string literal';
        issues.push({ from: start, to: n, severity: 'error', message: `unterminated ${kind}` });
        break;
      }
      continue;
    }
    // Postgres dollar-quoting: $$ ... $$ or $tag$ ... $tag$.
    if (c === '$') {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (match) {
        const start = i;
        const tag = match[0];
        const closeIdx = source.indexOf(tag, i + tag.length);
        if (closeIdx < 0) {
          issues.push({
            from: start,
            to: n,
            severity: 'error',
            message: 'unterminated dollar-quoted string',
          });
          break;
        }
        i = closeIdx + tag.length;
        continue;
      }
    }
    if (c === '(') {
      parenStack.push(i);
      i++;
      continue;
    }
    if (c === ')') {
      if (parenStack.length > 0) parenStack.pop();
      else issues.push({ from: i, to: i + 1, severity: 'error', message: 'unmatched )' });
      i++;
      continue;
    }
    // A statement boundary resets paren tracking — an unbalanced `(` in one statement is that
    // statement's own defect, not carried into the next.
    if (c === ';') {
      flushParens();
      i++;
      continue;
    }
    i++;
  }
  flushParens();
  return issues;
}
