import type { ConnectionKind } from '@shared/domain/connection';
import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import { splitSqlStatements } from '@shared/domain/sql-split';
import { beautifyShellText } from '../shared/document/ejson';
import { backslashEscapesFor, sqlDialectFor } from '../shared/sqlIdent';
import { findMatchingParen, MONGO_STATEMENT_RE, splitTopLevelArgs } from './mongoStatement';

/** true for the five SQL kinds and MongoDB — the only consoles with a real formatter behind
 *  them (D1/D6). Redis's statements are a flat token list with nothing to reformat, and
 *  kafka/sqs/s3 have no console at all. */
export function canFormatConsole(kind: ConnectionKind | undefined): boolean {
  return kind === 'mongodb' || sqlDialectFor(kind) !== undefined;
}

type SqlFormatterModule = typeof import('./sqlFormatterEntry');

// D2: memoised so only the first Format press ever pays the import cost.
let sqlFormatterModule: Promise<SqlFormatterModule> | undefined;
function loadSqlFormatter(): Promise<SqlFormatterModule> {
  if (!sqlFormatterModule) sqlFormatterModule = import('./sqlFormatterEntry');
  return sqlFormatterModule;
}

// D3: keyed on ConnectionKind, not on sqlIdent.ts's own SqlDialect union — that union
// deliberately collapses MariaDB and MySQL into one 'mysql' member for quoting/grammar reasons
// (sqlIdent.ts:6-15) that don't apply to a formatter, and sql-formatter ships them as separate
// dialects.
function formatterDialectFor(mod: SqlFormatterModule, kind: ConnectionKind) {
  switch (kind) {
    case 'postgres':
      return mod.postgresql;
    case 'mariadb':
      return mod.mariadb;
    case 'mysql':
      return mod.mysql;
    case 'sqlite':
      return mod.sqlite;
    case 'clickhouse':
      return mod.clickhouse;
    default:
      return undefined;
  }
}

// D4: keywordCase stays at the library default 'preserve' rather than the app's own uppercase
// completion house style (languages.ts) — 'upper' rewrites an unquoted identifier that collides
// with a keyword (e.g. a `database` column becomes `DATABASE`), which is silently wrong for
// ClickHouse's case-sensitive identifiers (F6).
const SQL_FORMAT_OPTIONS = {
  tabWidth: 2,
  useTabs: false,
  keywordCase: 'preserve',
  identifierCase: 'preserve',
  linesBetweenQueries: 1,
} as const;

// F5: a parse failure throws an Error whose message is a multi-thousand-character nearley
// expectation dump — only its first line ("Parse error at token: «EOF» at line 1 column 23") is
// ever fit to show a user.
function firstLine(message: string): string {
  const idx = message.indexOf('\n');
  return idx === -1 ? message : message.slice(0, idx);
}

// D5: one statement's own text, matched, method-checked and argument-beautified the same way
// lintMongoConsole (lint.ts) already walks it — a format refusal here uses the linter's own
// wording so a diagnostic and a format refusal never contradict each other.
function formatMongoStatement(
  stmt: string,
): { text: string; reason?: undefined } | { reason: string } {
  const match = MONGO_STATEMENT_RE.exec(stmt);
  if (!match) return { reason: 'expected db.<collection>.<method>(...)' };
  const [full, collection, method] = match;
  if (!MONGO_CONSOLE_METHODS.includes(method)) {
    return { reason: `unsupported console method: db.${collection}.${method}()` };
  }

  const openParen = match.index + full.length - 1;
  const closeParen = findMatchingParen(stmt, openParen);
  const rawArgs = splitTopLevelArgs(stmt, openParen + 1, closeParen)
    .map((a) => a.text.trim())
    .filter((t) => t.length > 0);

  const args: string[] = [];
  for (const raw of rawArgs) {
    const result = beautifyShellText(raw, 'indented');
    if (!result.ok) return { reason: result.reason ?? 'invalid argument' };
    args.push(result.text);
  }

  if (args.length === 0) return { text: `db.${collection}.${method}()` };
  if (args.length === 1) return { text: `db.${collection}.${method}(${args[0]})` };

  // Two or more arguments: one per line at indent 2, each argument's own continuation lines
  // shifted by the same two spaces (mongosh's own rendering of an updateOne/aggregate call).
  const indented = args
    .map((arg) =>
      arg
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
    )
    .join(',\n');
  return { text: `db.${collection}.${method}(\n${indented}\n)` };
}

export interface FormatFailure {
  /** Which statement, 0-based — the same index D12's caret mapping walks the before/after split
   *  by. */
  index: number;
  reason: string;
}

export interface FormatResult {
  text: string;
  /** False only when NOTHING formatted (P13's own all-broken behaviour, preserved for
   *  tests/ui/console-format.spec.ts's all-broken case: text untouched, one reason shown). True
   *  whenever at least one statement formatted, even if others didn't — D13's own reopening of
   *  P13 §3: a broken neighbour no longer takes the whole press down with it. */
  ok: boolean;
  /** Present only when `ok` is false, mirroring BeautifyResult's own `reason` — the P13-era
   *  single-statement callers (formatConsoleText's own unit tests) still read this. */
  reason?: string;
  /** One entry per statement Format could not touch — empty when every statement formatted (the
   *  common case) or when the whole document is whitespace-only. */
  failures: FormatFailure[];
}

// P19 D13 (reopening P13 §3's declined statement-by-statement alternative): every statement that
// formats, formats; one the grammar rejects is emitted VERBATIM, in place, never dropped — which
// is what keeps D12's caret-by-index mapping exact (the statement count survives regardless of
// how many failed). Splits with the same splitter and options Run all already uses
// (ConsoleView.runAll's own splitSqlStatements call), so "what Format treats as a statement" and
// "what Run all treats as a statement" can never disagree, and rejoins with `;\n\n` — the same
// separator formatMongo already produced and what sql-formatter's own linesBetweenQueries: 1
// produces for a single multi-statement call.
export async function formatConsoleText(kind: ConnectionKind, text: string): Promise<FormatResult> {
  if (text.trim().length === 0) return { text, ok: true, failures: [] };

  const dialect = sqlDialectFor(kind);
  const statements = splitSqlStatements(text, {
    backslashEscapes: backslashEscapesFor(dialect),
  });
  if (statements.length === 0) return { text, ok: true, failures: [] };

  // One statement's own text in, its formatted text or a failure reason out — resolved once,
  // outside the map below, so the SQL branch's mod/dialect lookup (an async import, a per-kind
  // table lookup) happens exactly once regardless of how many statements there are.
  let formatOne: (stmtText: string) => { text: string; reason?: undefined } | { reason: string };
  if (kind === 'mongodb') {
    formatOne = formatMongoStatement;
  } else {
    const mod = await loadSqlFormatter();
    const sqlDialectObject = formatterDialectFor(mod, kind);
    if (!sqlDialectObject) {
      return {
        text,
        ok: false,
        reason: 'this console has nothing to format',
        failures: statements.map((_, index) => ({
          index,
          reason: 'this console has nothing to format',
        })),
      };
    }
    formatOne = (stmtText) => {
      try {
        return {
          text: mod.formatDialect(stmtText, { dialect: sqlDialectObject, ...SQL_FORMAT_OPTIONS }),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { reason: firstLine(message) };
      }
    };
  }

  const failures: FormatFailure[] = [];
  const out = statements.map((stmt, index) => {
    const result = formatOne(stmt.text);
    if (result.reason !== undefined) {
      failures.push({ index, reason: result.reason });
      return stmt.text;
    }
    return result.text;
  });

  if (failures.length === statements.length) {
    return { text, ok: false, reason: failures[0]?.reason, failures };
  }
  return { text: out.join(';\n\n'), ok: true, failures };
}
