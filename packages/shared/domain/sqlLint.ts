// Lexical-only SQL diagnostics — no grammar, no server round trip, and no
// dependency on anything renderer-only (this file is shared/domain, imported by main and engine
// too). Sibling of sql-split.ts: same lexical states (quotes, dollar-quotes, comments), reused
// here to find exactly the two defects a broken statement can have before it ever reaches the
// adapter — an unterminated quote/comment, and unbalanced parentheses. Deliberately not a real
// SQL grammar's error nodes: one lexer serves every dialect, so it never flags valid
// dialect-specific syntax a narrower grammar wouldn't model.
//
// The quote/comment/dollar-quote scanning itself is `sql-lex.ts`'s `scanSqlSpan` —
// hoisted out of here (and `sql-split.ts`) into one shared scanner both now call. No behaviour
// change: this file keeps its own paren-balance/issue-reporting logic exactly.
import { t } from '@theme/i18n';
import { resolveLexOptions, type SqlScanOptions, scanSqlSpan } from './sqlLex';

export interface LintIssue {
  from: number;
  to: number;
  severity: 'error' | 'warning';
  message: string;
}

/** See `sql-lex.ts`'s own `SqlLexOptions` field doc comments (P115 H5: this used to carry its own
 *  copy of them) — kept under this file's historical name for its own callers. */
export type LintSqlOptions = SqlScanOptions;

function spanMessage(
  kind: 'blockComment' | 'quote' | 'dollarQuote' | 'bracketIdent',
  quoteChar?: string,
): string {
  if (kind === 'blockComment') return t('shared.sqlLint.unterminatedBlockComment.error');
  if (kind === 'dollarQuote') return t('shared.sqlLint.unterminatedDollarQuote.error');
  if (kind === 'bracketIdent') return t('shared.sqlLint.unterminatedIdentifier.error');
  return quoteChar === '`'
    ? t('shared.sqlLint.unterminatedIdentifier.error')
    : t('shared.sqlLint.unterminatedString.error');
}

export function lintSql(source: string, options?: LintSqlOptions): LintIssue[] {
  const lexOptions = resolveLexOptions(options);
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
        message: t('shared.sqlLint.unbalancedParenthesis.error'),
      });
    }
    parenStack = [];
  };

  while (i < n) {
    const span = scanSqlSpan(source, i, lexOptions);
    if (span) {
      if (!span.closed && span.kind !== 'lineComment') {
        issues.push({
          from: span.start,
          to: span.end,
          severity: 'error',
          message: spanMessage(span.kind, span.quoteChar),
        });
        break;
      }
      i = span.end;
      continue;
    }
    const c = source[i];
    if (c === '(') {
      parenStack.push(i);
      i++;
      continue;
    }
    if (c === ')') {
      if (parenStack.length > 0) parenStack.pop();
      else
        issues.push({
          from: i,
          to: i + 1,
          severity: 'error',
          message: t('shared.sqlLint.unmatchedParenthesis.error'),
        });
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
