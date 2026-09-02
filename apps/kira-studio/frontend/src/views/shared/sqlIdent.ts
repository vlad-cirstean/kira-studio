// D7 (P18): quoteIdent moves here from grid/menu.ts to gain a second consumer
// (grid/filterCompletion.ts) — one shared definition beats two that can drift on the
// backtick/double-quote split. Same trust boundary grid/menu.ts's own comment already states:
// generated as literal SQL text once, never validated against the column's type.
//
// P34 D17: a quoting-and-grammar *family*, not a product — MariaDB and MySQL share one dialect
// ('mysql', since languages.ts already maps MariaDB to CodeMirror's own `MySQL` lang-sql dialect;
// the family is the concept the code was already reaching for). Before this, the twelve call
// sites across the renderer each hand-wrote
// `record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined`, and any
// kind missing from that inline check silently fell to `undefined` — which quoteIdent below reads
// as "double-quote it", not "this isn't SQL". A MySQL connection that wasn't added to every one
// of those twelve sites would emit invalid double-quoted identifiers into `grid/menu.ts`'s
// generated *Filter by this value* and FK-navigation predicates (P34 F22). sqlDialectFor is the
// one place that decision is made now.
import type { ConnectionKind } from '@shared/domain/connection';

// P35 D28: SQLite is its own member, not folded into 'mysql' — it double-quotes identifiers
// (already quoteIdent's own default branch below) but is a genuinely different grammar with its
// own CodeMirror lang-sql dialect (languages.ts), so mapping it to 'postgres' would be a lie the
// next reader has to decode.
// P36 D29: ClickHouse is a fourth member for the same reason SQLite is — it backtick-quotes like
// mysql (BACKTICK_DIALECTS below) but is its own grammar, with its own languages.ts dialect.
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite' | 'clickhouse';

/** undefined for a kind with no SQL surface (mongodb, redis, kafka, sqs, s3) or no connection. */
export function sqlDialectFor(kind: ConnectionKind | undefined): SqlDialect | undefined {
  if (kind === 'postgres') return 'postgres';
  if (kind === 'mariadb' || kind === 'mysql') return 'mysql';
  if (kind === 'sqlite') return 'sqlite';
  if (kind === 'clickhouse') return 'clickhouse';
  return undefined;
}

// P36 D29: ClickHouse quotes identifiers with backticks too (its own create_table_query output
// confirms it, F28) — a set rather than a second `=== 'mysql'` check, so a future backtick dialect
// only ever needs one line added here.
const BACKTICK_DIALECTS = new Set<SqlDialect>(['mysql', 'clickhouse']);

export function quoteIdent(dialect: SqlDialect | undefined, name: string): string {
  if (dialect && BACKTICK_DIALECTS.has(dialect)) return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

// P2 R2: a backslash inside a standard SQL single-quoted string literal is just an ordinary
// character — only MySQL/MariaDB (and ClickHouse, F27) treat it as an escape character by
// default. sql-split.ts/sql-lint.ts's shared quote-scanning loop needs to know which regime it's
// in, or a Postgres/SQLite literal ending in a literal backslash (e.g. `'foo\'`) gets its closing
// quote mistaken for an escaped character and the scan runs on past the literal's real end.
const BACKSLASH_ESCAPE_DIALECTS = new Set<SqlDialect>(['mysql', 'clickhouse']);

/** true when `dialect`'s string literals treat a backslash as an escape character — undefined
 *  (no SQL dialect, e.g. a Mongo/Redis console) keeps the pre-P2-R2 default of `true` since
 *  nothing about that case was in scope for this fix. */
export function backslashEscapesFor(dialect: SqlDialect | undefined): boolean {
  return dialect === undefined || BACKSLASH_ESCAPE_DIALECTS.has(dialect);
}

// A short, curated set of the reserved words most likely to collide with a real column name —
// not exhaustive (a full per-dialect reserved-word list runs to hundreds of entries and shifts
// with engine version); the same "curated, not exhaustive" call P18's own WHERE/ORDER BY
// vocabularies make (docs/v1/plans/P18-autocomplete.md D8).
const COMMON_RESERVED = new Set([
  'select',
  'from',
  'where',
  'order',
  'group',
  'by',
  'and',
  'or',
  'not',
  'null',
  'table',
  'index',
  'key',
  'primary',
  'foreign',
  'references',
  'default',
  'check',
  'as',
  'in',
  'is',
  'like',
  'between',
  'exists',
  'union',
  'all',
  'distinct',
  'insert',
  'update',
  'delete',
  'create',
  'drop',
  'alter',
  'grant',
  'revoke',
  'user',
  'column',
  'value',
  'values',
  'limit',
  'offset',
  'join',
  'on',
  'case',
  'when',
  'then',
  'else',
  'end',
  'true',
  'false',
]);

const BARE_SAFE_RE = /^[a-z_][a-z0-9_]*$/;

/** False for a bare-safe, non-reserved lowercase identifier — those are inserted unquoted by a
 *  completion accept. The bare-identifier grammar itself doesn't vary between postgres/mysql
 *  (only the quote character quoteIdent picks does), so `dialect` is accepted for symmetry with
 *  quoteIdent and future divergence, not used today. */
export function identNeedsQuoting(_dialect: SqlDialect | undefined, name: string): boolean {
  return !BARE_SAFE_RE.test(name) || COMMON_RESERVED.has(name.toLowerCase());
}
