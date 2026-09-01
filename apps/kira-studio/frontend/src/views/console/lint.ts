import type { ConnectionKind } from '@shared/domain/connection';
import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import { lintSql } from '@shared/domain/sql-lint';
import type { ConsoleDiagnostic } from '../../editor/diagnostics';
import { tryParseShellText } from '../shared/document/ejson';
import { backslashEscapesFor, sqlDialectFor } from '../shared/sqlIdent';
import { findMatchingParen, MONGO_STATEMENT_RE, splitTopLevelArgs } from './mongoStatement';

function lintSqlConsole(kind: ConnectionKind | undefined): (text: string) => ConsoleDiagnostic[] {
  const backslashEscapes = backslashEscapesFor(sqlDialectFor(kind));
  return (text) => lintSql(text, { backslashEscapes });
}

const MONGO_BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

function lintMongoBrackets(text: string): ConsoleDiagnostic[] {
  const issues: ConsoleDiagnostic[] = [];
  const stack: Array<{ ch: string; pos: number }> = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        issues.push({
          from: start,
          to: n,
          severity: 'error',
          message: 'unterminated string literal',
        });
        return issues;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      stack.push({ ch: c, pos: i });
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      const top = stack[stack.length - 1];
      if (top && top.ch === MONGO_BRACKET_PAIRS[c]) stack.pop();
      else issues.push({ from: i, to: i + 1, severity: 'error', message: `unmatched ${c}` });
      i++;
      continue;
    }
    i++;
  }
  for (const { pos, ch } of stack) {
    issues.push({ from: pos, to: pos + 1, severity: 'error', message: `unbalanced ${ch}` });
  }
  return issues;
}

// D24: the shape check and the method-membership check reuse the exact same regex and the same
// MONGO_CONSOLE_METHODS list mongo/console.ts's own parser and SUPPORTED_METHODS are built from
// (D21), and the unsupported-method message matches mongo/console.ts's own wording verbatim so a
// diagnostic can never contradict the adapter.
//
// D12: once the shape and the method are known good, each top-level argument gets validated
// against this app's own Mongo shell-literal grammar (views/shared/document/ejson.ts's
// tryParseShellText) — not JSON.parse, which would reject valid shell input this console actually
// accepts (unquoted keys, single quotes, ObjectId(…)/ISODate(…) constructor calls).
function lintMongoConsole(text: string): ConsoleDiagnostic[] {
  if (text.trim().length === 0) return [];
  const bracketIssues = lintMongoBrackets(text);
  if (bracketIssues.length > 0) return bracketIssues;

  const match = MONGO_STATEMENT_RE.exec(text);
  if (!match) {
    return [
      {
        from: 0,
        to: text.length,
        severity: 'error',
        message: 'expected db.<collection>.<method>(...)',
      },
    ];
  }
  const [full, collection, method] = match;
  if (!MONGO_CONSOLE_METHODS.includes(method)) {
    const from = full.lastIndexOf(method);
    return [
      {
        from,
        to: from + method.length,
        severity: 'error',
        message: `unsupported console method: db.${collection}.${method}()`,
      },
    ];
  }

  const openParen = match.index + full.length - 1;
  const closeParen = findMatchingParen(text, openParen);
  for (const arg of splitTopLevelArgs(text, openParen + 1, closeParen)) {
    const leading = arg.text.search(/\S/);
    if (leading === -1) continue; // an empty argument (or trailing comma) is not this check's job
    const trimmed = arg.text.trim();
    const result = tryParseShellText(trimmed);
    if (!result.ok) {
      const from = arg.from + leading;
      return [
        {
          from,
          to: from + trimmed.length,
          severity: 'error',
          message: `invalid argument at offset ${result.offset}`,
        },
      ];
    }
  }
  return [];
}

// D24's Redis rule set: an unterminated quoted string reuses redis/console.ts's own tokenizer
// error wording; the multi-line warning documents F10's splitter bug (out of scope to fix here)
// rather than pretending the console already handles it.
function lintRedisConsole(text: string): ConsoleDiagnostic[] {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      let closed = false;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return [{ from: start, to: n, severity: 'error', message: 'unterminated quoted string' }];
      }
      continue;
    }
    i++;
  }

  const issues: ConsoleDiagnostic[] = [];
  let offset = 0;
  for (const stmt of text.split(';')) {
    const nonEmptyLines = stmt.split('\n').filter((l) => l.trim().length > 0);
    if (nonEmptyLines.length > 1) {
      issues.push({
        from: offset,
        to: offset + stmt.length,
        severity: 'warning',
        message:
          'statements are separated by ; not newlines — this spans multiple lines and will run as one command',
      });
    }
    offset += stmt.length + 1;
  }
  return issues;
}

/** undefined for any connection kind with no console at all — a mounted ConsoleView never has
 *  one (caps.sql gates the tab), so this only ever actually returns a function. */
export function consoleLintSource(
  kind: ConnectionKind | undefined,
): ((doc: string) => ConsoleDiagnostic[]) | undefined {
  if (kind === 'mongodb') return lintMongoConsole;
  if (kind === 'redis') return lintRedisConsole;
  if (sqlDialectFor(kind)) return lintSqlConsole(kind);
  return undefined;
}
