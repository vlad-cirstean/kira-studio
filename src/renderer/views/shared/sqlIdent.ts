// D7 (P18): quoteIdent moves here from grid/gridMenu.ts to gain a second consumer
// (grid/filterCompletion.ts) — one shared definition beats two that can drift on the
// backtick/double-quote split. Same trust boundary gridMenu.ts's own comment already states:
// generated as literal SQL text once, never validated against the column's type.
//
// P34 D17: a quoting-and-grammar *family*, not a product — MariaDB and MySQL share one dialect
// ('mysql', since languages.ts already maps MariaDB to CodeMirror's own `MySQL` lang-sql dialect;
// the family is the concept the code was already reaching for). Before this, the twelve call
// sites across the renderer each hand-wrote
// `record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined`, and any
// kind missing from that inline check silently fell to `undefined` — which quoteIdent below reads
// as "double-quote it", not "this isn't SQL". A MySQL connection that wasn't added to every one
// of those twelve sites would emit invalid double-quoted identifiers into `gridMenu.ts`'s
// generated *Filter by this value* and FK-navigation predicates (P34 F22). sqlDialectFor is the
// one place that decision is made now.
import type { ConnectionKind } from '@shared/domain/connection';

// P35 D28: SQLite is its own member, not folded into 'mysql' — it double-quotes identifiers
// (already quoteIdent's own default branch below) but is a genuinely different grammar with its
// own CodeMirror lang-sql dialect (languages.ts), so mapping it to 'postgres' would be a lie the
// next reader has to decode.
export type SqlDialect = 'postgres' | 'mysql' | 'sqlite';

/** undefined for a kind with no SQL surface (mongodb, redis, kafka, sqs, s3) or no connection. */
export function sqlDialectFor(kind: ConnectionKind | undefined): SqlDialect | undefined {
  if (kind === 'postgres') return 'postgres';
  if (kind === 'mariadb' || kind === 'mysql') return 'mysql';
  if (kind === 'sqlite') return 'sqlite';
  return undefined;
}

export function quoteIdent(dialect: SqlDialect | undefined, name: string): string {
  if (dialect === 'mysql') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
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
