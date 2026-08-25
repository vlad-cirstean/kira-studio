import { createHash } from 'node:crypto';
import type { SortDirection } from '../../shared/domain/queries';
import type { ColumnMeta } from '../../shared/domain/tree';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
} from '../../shared/protocol/page';
import { AdapterError } from './errors';

// The genuinely shared, driver-agnostic glue the SQL adapters' read.ts modules call — kept out
// of the adapter folders because duplicating it would guarantee they drift (§5e). Everything
// dialect-shaped (quoting, LIMIT syntax, catalog SQL) stays in each adapter folder.

export function buildOrderBy(
  terms: { column: string; direction: SortDirection }[],
  quote: (s: string) => string,
): string {
  return terms.map((t) => `${quote(t.column)} ${t.direction.toUpperCase()}`).join(', ');
}

/**
 * Row-value comparison for a keyset boundary: `(col1, col2) > (p1, p2)`. `columns` are already
 * quoted identifiers. `direction`/`mode` select the operator (D7): 'after' compares forward in
 * the requested direction; 'before' — having flipped the ORDER BY and reversed the builder —
 * needs the mirror-image comparison for that same flip.
 */
export function buildKeysetPredicate(
  columns: string[],
  direction: SortDirection,
  mode: 'after' | 'before',
  firstParamIndex: number,
  placeholder: (i: number) => string,
): string {
  const operator = (mode === 'after') === (direction === 'asc') ? '>' : '<';
  const lhs = `(${columns.join(', ')})`;
  const rhs = `(${columns.map((_, i) => placeholder(firstParamIndex + i)).join(', ')})`;
  return `${lhs} ${operator} ${rhs}`;
}

interface PageTokenPayload {
  v: 1;
  k: string[];
  f: string;
}

export function encodePageToken(key: string[], fingerprint: string): string {
  const payload: PageTokenPayload = { v: 1, k: key, f: fingerprint };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function isPageTokenPayload(value: unknown): value is PageTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    Array.isArray(v.k) &&
    v.k.every((x) => typeof x === 'string') &&
    typeof v.f === 'string'
  );
}

/** Throws E_QUERY when the token is malformed or its fingerprint no longer matches. */
export function decodePageToken(token: string, expectedFingerprint: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new AdapterError('E_QUERY', 'malformed page token');
  }
  if (!isPageTokenPayload(parsed)) {
    throw new AdapterError('E_QUERY', 'malformed page token');
  }
  if (parsed.f !== expectedFingerprint) {
    throw new AdapterError(
      'E_QUERY',
      'keyset pagination is unavailable for this request: the token does not match the ' +
        'current filter/sort/projection/page size',
    );
  }
  return parsed.k;
}

export function requestFingerprint(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

// P39 F19: character-for-character the same in postgres/mysql-family/sqlite/clickhouse's read.ts
// (postgres's own copy carried two extra comment lines). Takes the column list rather than each
// adapter's own ReadTarget — this reads only ColumnMeta.name/.position, and the four ReadTargets
// genuinely differ otherwise.
export function resolveProjection(columns: ColumnMeta[], requested: string[] | null): ColumnMeta[] {
  if (requested === null) return columns;
  const byName = new Map(columns.map((c) => [c.name, c]));
  const resolved: ColumnMeta[] = [];
  for (const name of new Set(requested)) {
    const col = byName.get(name);
    if (!col) throw new AdapterError('E_NOT_FOUND', `unknown column in projection: ${name}`);
    resolved.push(col);
  }
  // Ordinal order, not request order — display order is a renderer concern, and each adapter's
  // own D12-style normalisation depends on the projection being treated as a set.
  resolved.sort((a, b) => a.position - b.position);
  return resolved;
}

// App-generated integers only (pageSize+1, a port-validated offset) — inlined into SQL rather
// than bound, per each adapter's own note.
export function safeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AdapterError('E_QUERY', `invalid ${label}: ${value}`);
  }
  return value;
}

// P39 iter2 F13: character-for-character the same in clickhouse/mysql-family/postgres/sqlite's
// definition.ts — nothing in it is dialect-shaped, a `;` terminates a statement in every SQL
// dialect this app speaks.
export function stripOneTrailingSemicolon(text: string): string {
  const match = /;\s*$/.exec(text);
  return match ? text.slice(0, text.length - match[0].length) : text;
}

// P39 iter2 F14: the one-column, one-row "status" page a console statement with no result set
// returns — identical in clickhouse/mysql-family/postgres/sqlite's console.ts except `dataType`,
// which really does vary: 'text' for the other three, but ClickHouse's own type vocabulary spells
// it 'String', and this string reaches the grid's type tooltip verbatim.
export function singleStatusPage(text: string, dataType: string): TabularPage {
  const columns: ColumnDescriptor[] = [
    {
      name: 'status',
      dataType,
      typeClass: 'text',
      nullable: false,
      isPrimaryKey: false,
      generated: false,
    },
  ];
  const builder = createTabularPageBuilder(columns);
  builder.appendRow([text]);
  const position: PagePosition = {
    offset: 0,
    pageSize: 1,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}
