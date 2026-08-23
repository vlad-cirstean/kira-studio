// D7 (P18): quoteIdent moves here from grid/gridMenu.ts to gain a second consumer
// (grid/filterCompletion.ts) — one shared definition beats two that can drift on the
// backtick/double-quote split. Same trust boundary gridMenu.ts's own comment already states:
// generated as literal SQL text once, never validated against the column's type.
export type Dialect = 'postgres' | 'mariadb' | undefined;

export function quoteIdent(dialect: Dialect, name: string): string {
  if (dialect === 'mariadb') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

// A short, curated set of the reserved words most likely to collide with a real column name —
// not exhaustive (a full per-dialect reserved-word list runs to hundreds of entries and shifts
// with engine version); the same "curated, not exhaustive" call P18's own WHERE/ORDER BY
// vocabularies make (docs/plans/P18-autocomplete.md D8).
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
 *  completion accept. The bare-identifier grammar itself doesn't vary between postgres/mariadb
 *  (only the quote character quoteIdent picks does), so `dialect` is accepted for symmetry with
 *  quoteIdent and future divergence, not used today. */
export function identNeedsQuoting(_dialect: Dialect, name: string): boolean {
  return !BARE_SAFE_RE.test(name) || COMMON_RESERVED.has(name.toLowerCase());
}
