import { createHash } from 'node:crypto';
import type { SortDirection, SortSpec } from '@shared/domain/queries';
import type { ColumnMeta, IndexMeta } from '@shared/domain/tree';
import type { PageCursor } from '@shared/protocol/data-ops';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
  unpagedPosition,
} from '@shared/protocol/page';
import { AdapterError } from './errors';

// The genuinely shared, driver-agnostic glue the SQL adapters' read.ts and catalog.ts modules
// call — kept out of the adapter folders because duplicating it would guarantee they drift (§5e).
// Everything dialect-shaped (quoting, LIMIT syntax, catalog SQL) stays in each adapter folder.

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

// P48 F24: `WHERE (<filter>)` or '' — always parenthesised (§5b step 4), so a keyset predicate
// joined by a bare AND never silently changes the user's own filter's meaning (an unparenthesised
// `a = 1 OR b = 2` would). Byte-identical across postgres/mysql-family/sqlite/clickhouse's read.ts.
export function whereClause(filter: string | null): string {
  return filter && filter.trim() !== '' ? `WHERE (${filter})` : '';
}

// P48 F24: count(*)'s scalar, with the shared non-numeric refusal — identical modulo the relation
// name and the driver call across all four SQL adapters' countRows.
export function parseCountValue(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new AdapterError('E_QUERY', `count returned a non-numeric result: ${String(raw)}`);
  }
  return value;
}

// P48 F24: byte-identical in postgres/mysql-family's catalog.ts.
export function primaryKeyFromIndexes(indexes: IndexMeta[]): string[] | null {
  return indexes.find((idx) => idx.primary)?.columns ?? null;
}

// P48 F24: the seven lines after primaryKeyFromIndexes that derive columns/pkColumns/
// nullableByName/uniqueKeys, byte-identical in postgres/mysql-family's getReadTarget.
export function resolveKeyShape(
  rawColumns: ColumnMeta[],
  indexes: IndexMeta[],
): { columns: ColumnMeta[]; primaryKey: string[] | null; uniqueKeys: string[][] } {
  const primaryKey = primaryKeyFromIndexes(indexes);
  const pkColumns = new Set(primaryKey ?? []);
  const columns = rawColumns.map((col) => ({ ...col, isPrimaryKey: pkColumns.has(col.name) }));
  const nullableByName = new Map(columns.map((c) => [c.name, c.nullable]));
  const uniqueKeys = indexes
    .filter((idx) => idx.unique && idx.columns.every((c) => nullableByName.get(c) === false))
    .map((idx) => idx.columns);
  return { columns, primaryKey, uniqueKeys };
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
  return builder.finish(unpagedPosition(1));
}

// P48 F24: byte-identical in postgres/mysql-family/sqlite's read.ts, wantsKeyset/isTextSort
// computed one line above the call at every site.
export function assertKeysetSupported(
  wantsKeyset: boolean,
  isTextSort: boolean,
  eligible: boolean,
): void {
  if (wantsKeyset && (isTextSort || !eligible)) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'keyset pagination is unavailable for this sort; the client must use an offset cursor',
    );
  }
}

export interface EffectiveOrder {
  terms: { column: string; direction: SortDirection }[];
  keysetEligible: boolean;
  keysetColumns: string[];
  keysetDirection: SortDirection;
}

// P39 iter3 F14/D16: postgres/mysql-family/sqlite each declared this same D7 keyset-eligibility
// rule — byte-identical except for how each computes its own tiebreaker (a table's primary key,
// else a unique all-NOT-NULL index, plus — sqlite only — the implicit rowid fallback, F23). Takes
// the column list and the caller's already-resolved tiebreaker, mirroring resolveProjection's own
// signature transformation, rather than each adapter's own ReadTarget, which genuinely differs.
export function computeEffectiveOrder(
  sort: SortSpec | null,
  columns: ColumnMeta[],
  tiebreaker: string[] | null,
): EffectiveOrder {
  if (sort?.kind === 'text') {
    return { terms: [], keysetEligible: false, keysetColumns: [], keysetDirection: 'asc' };
  }

  const requestedTerms = sort?.kind === 'structured' ? sort.terms : [];
  if (requestedTerms.length > 0) {
    const byName = new Set(columns.map((c) => c.name));
    for (const t of requestedTerms) {
      if (!byName.has(t.column)) {
        throw new AdapterError('E_NOT_FOUND', `unknown column in sort: ${t.column}`);
      }
    }
  }

  const uniform =
    requestedTerms.length === 0 ||
    requestedTerms.every((t) => t.direction === requestedTerms[0].direction);
  if (!uniform) {
    return {
      terms: requestedTerms,
      keysetEligible: false,
      keysetColumns: [],
      keysetDirection: 'asc',
    };
  }
  const direction: SortDirection = requestedTerms[0]?.direction ?? 'asc';

  if (!tiebreaker) {
    return {
      terms: requestedTerms,
      keysetEligible: false,
      keysetColumns: [],
      keysetDirection: direction,
    };
  }

  const already = new Set(requestedTerms.map((t) => t.column));
  const extra = tiebreaker.filter((c) => !already.has(c));
  const terms = [...requestedTerms, ...extra.map((column) => ({ column, direction }))];
  return {
    terms,
    keysetEligible: true,
    keysetColumns: terms.map((t) => t.column),
    keysetDirection: direction,
  };
}

// P48 F24: postgres/mysql-family/sqlite's read.ts each resolved the same "tiebreaker columns not
// already projected must still be fetched" step, byte-identical except how each looks up a
// column by name — sqlite's rowid-aware resolver (resolveKeysetColumnMeta) doesn't have a plain
// column list to search, so it is passed in as `resolveHidden` rather than assumed.
export function resolveFetchColumns(
  projected: ColumnMeta[],
  all: ColumnMeta[],
  order: EffectiveOrder,
  resolveHidden?: (name: string) => ColumnMeta,
): { fetchColumns: ColumnMeta[]; keysetColumnIndex: Map<string, number> } {
  const projectedNames = new Set(projected.map((c) => c.name));
  const columnByName = new Map(all.map((c) => [c.name, c]));
  const resolve =
    resolveHidden ??
    ((name: string): ColumnMeta => {
      const col = columnByName.get(name);
      if (!col) throw new AdapterError('E_QUERY', `keyset tiebreaker column not found: ${name}`);
      return col;
    });
  const hiddenColumns = order.keysetEligible
    ? order.keysetColumns.filter((name) => !projectedNames.has(name)).map(resolve)
    : [];
  const fetchColumns = [...projected, ...hiddenColumns];
  const keysetColumnIndex = new Map(
    order.keysetColumns.map((name) => [name, fetchColumns.findIndex((c) => c.name === name)]),
  );
  return { fetchColumns, keysetColumnIndex };
}

// P48 F24: the scan ORDER BY — a text sort verbatim, else the effective terms with every
// direction flipped when the fetch runs backwards for a `before` cursor (D7's reversal),
// byte-identical across the three keyset-capable adapters.
export function buildScanOrderBy(
  sort: SortSpec | null,
  order: EffectiveOrder,
  reverseRows: boolean,
  quote: (s: string) => string,
): string {
  if (sort?.kind === 'text') return sort.text;
  if (order.terms.length === 0) return '';
  const scanTerms = reverseRows
    ? order.terms.map((t) => ({
        column: t.column,
        direction: (t.direction === 'asc' ? 'desc' : 'asc') as SortDirection,
      }))
    : order.terms;
  return buildOrderBy(scanTerms, quote);
}

// P48 F24: hasMore/nextToken/prevToken/strategy and the PagePosition they go into — D7's whole
// forward-and-backward token rule, a 28-line block byte-identical across postgres/mysql-family/
// sqlite's read.ts except how each turns a fetched row's cell into text (`cellAt`).
export function buildKeysetPosition<Row>(args: {
  cursor: PageCursor;
  pageSize: number;
  displayRows: Row[];
  probedExtra: boolean;
  order: EffectiveOrder;
  keysetColumnIndex: Map<string, number>;
  fingerprint: string;
  cellAt: (row: Row, index: number) => string | null;
}): PagePosition {
  const {
    cursor,
    pageSize,
    displayRows,
    probedExtra,
    order,
    keysetColumnIndex,
    fingerprint,
    cellAt,
  } = args;
  const rowCount = displayRows.length;

  // Reflects whether keyset navigation is available from here, not which cursor mode this
  // particular fetch used — an eligible sort reports 'keyset' even on the very first (offset 0)
  // page, so the renderer can page forward/back by token from then on (§5c).
  const strategy: PagePosition['strategy'] = order.keysetEligible ? 'keyset' : 'offset';

  // hasMore answers "is there a next page forward" regardless of which direction this page was
  // fetched in: a 'before' fetch always has a forward page (we navigated back from it); an
  // 'after'/'offset' fetch has one iff the pageSize+1 probe row showed up.
  const hasMore = rowCount === 0 ? false : cursor.mode === 'before' ? true : probedExtra;

  const keysetValuesOf = (row: Row): string[] =>
    order.keysetColumns.map((name) => {
      const idx = keysetColumnIndex.get(name) ?? -1;
      const v = idx >= 0 ? cellAt(row, idx) : null;
      if (v === null) {
        throw new AdapterError('E_QUERY', `keyset tiebreaker column "${name}" was NULL`);
      }
      return v;
    });

  let nextToken: string | null = null;
  let prevToken: string | null = null;
  if (order.keysetEligible && rowCount > 0) {
    const hasForward = cursor.mode === 'before' ? true : probedExtra;
    const hasBackward =
      cursor.mode === 'before' ? probedExtra : cursor.mode === 'after' ? true : cursor.offset > 0;
    if (hasForward) {
      nextToken = encodePageToken(keysetValuesOf(displayRows[rowCount - 1]), fingerprint);
    }
    if (hasBackward) prevToken = encodePageToken(keysetValuesOf(displayRows[0]), fingerprint);
  }

  return {
    offset: cursor.mode === 'offset' ? cursor.offset : null,
    pageSize,
    hasMore,
    nextToken,
    prevToken,
    strategy,
  };
}
