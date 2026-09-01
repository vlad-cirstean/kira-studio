import type { ConnectionKind } from '@shared/domain/connection';
import { MONGO_CONSOLE_METHODS } from '@shared/domain/console';
import { splitSqlStatements } from '@shared/domain/sql-split';
import type { BeautifyResult } from '../../beautify';
import { beautifyShellText } from '../shared/document/ejson';
import { sqlDialectFor } from '../shared/sqlIdent';
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

async function formatSql(kind: ConnectionKind, text: string): Promise<BeautifyResult> {
  const mod = await loadSqlFormatter();
  const dialect = formatterDialectFor(mod, kind);
  if (!dialect) return { text, ok: false, reason: 'this console has nothing to format' };
  try {
    return { text: mod.formatDialect(text, { dialect, ...SQL_FORMAT_OPTIONS }), ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { text, ok: false, reason: firstLine(message) };
  }
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

function formatMongo(text: string): BeautifyResult {
  const statements = splitSqlStatements(text, { backslashEscapes: true });
  const formatted: string[] = [];
  for (const stmt of statements) {
    const result = formatMongoStatement(stmt.text);
    if (result.reason !== undefined) return { text, ok: false, reason: result.reason };
    formatted.push(result.text);
  }
  return { text: formatted.join(';\n\n'), ok: true };
}

/** Reformats `text` for `kind`'s own console language. Only ever called for a kind
 *  `canFormatConsole` accepted. Whitespace-only input is left unchanged. */
export async function formatConsoleText(
  kind: ConnectionKind,
  text: string,
): Promise<BeautifyResult> {
  if (text.trim().length === 0) return { text, ok: true };
  if (kind === 'mongodb') return formatMongo(text);
  return formatSql(kind, text);
}
