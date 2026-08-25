import type { ColumnMeta } from '../../../shared/domain/tree';
import type { SortSpec } from '../../../shared/protocol/data-ops';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
  type TypeClass,
} from '../../../shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import { buildOrderBy } from '../sql-text';
import type { ReadTarget } from './catalog';
import type { ClickHouseHandle } from './client';
import { runCatalogQuery, streamQuery, type TrackQuery } from './query';

// F28/D29: ClickHouse quotes identifiers with backticks — the same character its own
// `create_table_query` output uses (F14's example), so this is what the app emits back.
export function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

// D17: unwraps Nullable(...) and LowCardinality(...) — recursively, in either nesting order,
// since `LowCardinality(Nullable(String))` and `Nullable(LowCardinality(String))` are both real,
// common column types (F24) — before classifying the inner type name.
export function unwrapType(declared: string): { inner: string; nullable: boolean } {
  let inner = declared.trim();
  let nullable = false;
  for (;;) {
    const nullableMatch = /^Nullable\((.*)\)$/s.exec(inner);
    if (nullableMatch?.[1] !== undefined) {
      nullable = true;
      inner = nullableMatch[1].trim();
      continue;
    }
    const lowCardMatch = /^LowCardinality\((.*)\)$/s.exec(inner);
    if (lowCardMatch?.[1] !== undefined) {
      inner = lowCardMatch[1].trim();
      continue;
    }
    break;
  }
  return { inner, nullable };
}

function baseTypeName(inner: string): string {
  const match = /^[A-Za-z][A-Za-z0-9]*/.exec(inner);
  return match ? match[0] : inner;
}

const TEXT_TYPES = new Set(['String', 'FixedString', 'UUID', 'IPv4', 'IPv6', 'Enum8', 'Enum16']);
const TEMPORAL_TYPES = new Set(['Date', 'Date32', 'DateTime', 'DateTime64', 'Time', 'Time64']);
const JSON_TYPES = new Set([
  'JSON',
  'Dynamic',
  'Variant',
  'Array',
  'Tuple',
  'Map',
  'Nested',
  'Point',
  'Ring',
  'Polygon',
  'MultiPolygon',
]);

// D17: 'String' -> text, never 'binary' — ClickHouse's own docs describe it as replacing
// VARCHAR, BLOB and CLOB alike (F24), and there is no per-column signal to tell them apart;
// guessing binary would put every text column behind the cell editor's hex pane. The composite
// and semi-structured types -> 'json': ClickHouse renders Array/Tuple/Map/the geo types as JSON
// arrays/objects in this adapter's own wire format (D16), so the cell editor's JSON pane is
// already the right rendering for them (the same "sugar" judgement P35 D21 made for three types,
// applied to five families here). 'other' is the honest answer for AggregateFunction,
// SimpleAggregateFunction, Nothing, Interval and anything unrecognised — never guessed at.
export function typeClassFor(declared: string): TypeClass {
  const { inner } = unwrapType(declared);
  const name = baseTypeName(inner);
  if (name === 'Bool') return 'boolean';
  if (/^(Int|UInt|Float|Decimal)/.test(name)) return 'number';
  if (TEMPORAL_TYPES.has(name)) return 'temporal';
  if (TEXT_TYPES.has(name)) return 'text';
  if (JSON_TYPES.has(name)) return 'json';
  return 'other';
}

// App-generated integers only (pageSize+1, an offset already validated at the port boundary) —
// inlined rather than bound, mirroring every other SQL adapter's identical discipline.
function safeInt(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AdapterError('E_QUERY', `invalid ${label}: ${value}`);
  }
  return value;
}

function resolveProjection(target: ReadTarget, requested: string[] | null): ColumnMeta[] {
  if (requested === null) return target.columns;
  const byName = new Map(target.columns.map((c) => [c.name, c]));
  const resolved: ColumnMeta[] = [];
  for (const name of new Set(requested)) {
    const col = byName.get(name);
    if (!col) throw new AdapterError('E_NOT_FOUND', `unknown column in projection: ${name}`);
    resolved.push(col);
  }
  resolved.sort((a, b) => a.position - b.position);
  return resolved;
}

// D21: a requested sort is honoured as given; with none, the table's own sorting key is used
// verbatim (F31 — the one ORDER BY ClickHouse can serve straight out of the parts' existing
// order), rather than re-deriving a column list from is_in_sorting_key flags, which would be a
// different, slower order the engine could no longer read in place. Still not a *total* order:
// duplicate sorting-key values tie arbitrarily (§5.1's own note).
function computeOrderBySql(sort: SortSpec | null, target: ReadTarget): string {
  if (sort?.kind === 'text') return sort.text;
  if (sort?.kind === 'structured' && sort.terms.length > 0) {
    const byName = new Set(target.columns.map((c) => c.name));
    for (const t of sort.terms) {
      if (!byName.has(t.column))
        throw new AdapterError('E_NOT_FOUND', `unknown column in sort: ${t.column}`);
    }
    return buildOrderBy(sort.terms, quoteIdent);
  }
  return target.sortingKey.trim();
}

const NO_KEYSET_MESSAGE =
  'keyset pagination is unavailable for ClickHouse: a MergeTree PRIMARY KEY is a sparse index, ' +
  'not a unique key, so there is no total order to build a keyset cursor on — use an offset cursor.';

// D20: caps.pagination is 'offset' — every page is offset-strategy, unconditionally. A cursor in
// 'after'/'before' mode is refused outright rather than silently falling back, since silently
// switching strategies out from under a caller expecting keyset semantics would be its own kind
// of dishonesty.
export async function readPage(
  h: ClickHouseHandle,
  ctx: OpCtx,
  target: ReadTarget,
  req: Omit<ReadRequest, 'path'>,
  track: TrackQuery,
  nextQueryId: () => string,
): Promise<TabularPage> {
  if (req.cursor.mode !== 'offset') {
    throw new AdapterError('E_UNSUPPORTED', NO_KEYSET_MESSAGE);
  }

  const projectedColumns = resolveProjection(target, req.projection);
  const columns: ColumnDescriptor[] = projectedColumns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    typeClass: typeClassFor(c.dataType),
    nullable: c.nullable,
    isPrimaryKey: c.isPrimaryKey,
  }));

  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.table)}`;
  const selectList = projectedColumns.map((c) => quoteIdent(c.name)).join(', ');
  const whereSql = req.filter && req.filter.trim() !== '' ? `WHERE (${req.filter})` : '';
  const orderBySql = computeOrderBySql(req.sort, target);
  const limit = safeInt(req.pageSize + 1, 'page size');
  const offset = safeInt(req.cursor.offset, 'offset');

  const sql = [
    `SELECT ${selectList}`,
    `FROM ${relationSql}`,
    whereSql,
    orderBySql ? `ORDER BY ${orderBySql}` : '',
    `LIMIT ${limit} OFFSET ${offset}`,
  ]
    .filter(Boolean)
    .join('\n');

  ctx.setCommand(sql);
  const builder = createTabularPageBuilder(columns);
  let rowCount = 0;
  let hasMore = false;
  await streamQuery(
    h,
    ctx,
    sql,
    { queryId: nextQueryId() },
    track,
    () => {},
    (values) => {
      if (rowCount >= req.pageSize) {
        hasMore = true;
        return;
      }
      builder.appendRow(values);
      rowCount++;
    },
  );

  const position: PagePosition = {
    offset: req.cursor.offset,
    pageSize: req.pageSize,
    hasMore,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

export async function countRows(
  h: ClickHouseHandle,
  ctx: OpCtx,
  target: Pick<ReadTarget, 'qualifiedName'>,
  filter: string | null,
  track: TrackQuery,
  nextQueryId: () => string,
): Promise<{ value: number; exact: boolean }> {
  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.table)}`;
  const whereSql = filter && filter.trim() !== '' ? `WHERE (${filter})` : '';
  const sql = [`SELECT count() AS n`, `FROM ${relationSql}`, whereSql].filter(Boolean).join('\n');

  const rows = await runCatalogQuery<{ n: string }>(h, ctx, sql, { queryId: nextQueryId() }, track);
  const raw = rows[0]?.n;
  const value = Number(raw ?? '0');
  if (!Number.isFinite(value)) {
    throw new AdapterError('E_QUERY', `count returned a non-numeric result: ${String(raw)}`);
  }
  return { value, exact: true };
}
