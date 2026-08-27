import type { ColumnMeta } from '@shared/domain/tree';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type TabularPage,
  type TypeClass,
} from '@shared/protocol/page';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import {
  assertKeysetSupported,
  buildKeysetPosition,
  buildKeysetPredicate,
  buildScanOrderBy,
  computeEffectiveOrder,
  decodePageToken,
  parseCountValue,
  requestFingerprint,
  resolveFetchColumns,
  resolveProjection,
  safeInt,
  whereClause,
} from '../sql-text';
import type { ReadTarget } from './catalog';
import type { SqliteHandle } from './client';
import { runQuery, type SqliteParam } from './query';

export function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL byte');
  return `"${name.replace(/"/g, '""')}"`;
}

// F21/D21: SQLite's own five type-affinity rules over the *declared* type string, plus three
// sugar cases no affinity rule covers on its own — BOOLEAN, the DATE family, and JSON are all
// genuine conventions real schemas use even though SQLite has no such storage classes. 'other'
// for an undeclared or STRICT-table ANY column: the declared type is a hint at best (F21), so
// guessing binary-vs-text for a column that declares neither would be less honest than admitting
// it isn't known.
export function typeClassFor(declaredType: string | null): TypeClass {
  const base = (declaredType ?? '').trim().toUpperCase();
  if (base === '' || base === 'ANY') return 'other';
  if (/^BOOL/.test(base)) return 'boolean';
  if (/^(DATE|DATETIME|TIMESTAMP)$/.test(base)) return 'temporal';
  if (base === 'JSON') return 'json';
  if (base.includes('INT')) return 'number';
  if (base.includes('CHAR') || base.includes('CLOB') || base.includes('TEXT')) return 'text';
  if (base.includes('BLOB')) return 'binary';
  if (base.includes('REAL') || base.includes('FLOA') || base.includes('DOUB')) return 'number';
  return 'number'; // NUMERIC affinity catch-all: DECIMAL, NUMERIC, and anything else undeclared
}

// D22/F23: a rowid table's own rowid is not a declared column, so it needs a synthetic ColumnMeta
// only for fetch purposes when it's the chosen tiebreaker — it is never added to `target.columns`
// and never shown as a page column (D23: it is not, and never becomes, mutation identity).
function resolveKeysetColumnMeta(target: ReadTarget, name: string): ColumnMeta {
  const col = target.columns.find((c) => c.name === name);
  if (col) return col;
  if (name === target.rowidColumn) {
    return {
      name,
      position: -1,
      dataType: 'INTEGER',
      nullable: false,
      defaultExpr: null,
      isPrimaryKey: false,
      comment: null,
    };
  }
  throw new AdapterError('E_QUERY', `keyset tiebreaker column not found: ${name}`);
}

export function readPage(
  h: SqliteHandle,
  ctx: OpCtx,
  target: ReadTarget,
  req: Omit<ReadRequest, 'path'>,
): TabularPage {
  const projectedColumns = resolveProjection(target.columns, req.projection);
  // D22: the fallback chain is primary key, else a unique (all-NOT-NULL) index, else — a step
  // further than the other SQL adapters can offer — the table's own implicit rowid (F23), which
  // every rowid table has for free regardless of whether it declares a primary key at all.
  const tiebreaker =
    target.primaryKey ?? target.uniqueKeys[0] ?? (target.rowidColumn ? [target.rowidColumn] : null);
  const order = computeEffectiveOrder(req.sort, target.columns, tiebreaker);
  const isTextSort = req.sort?.kind === 'text';
  const wantsKeyset = req.cursor.mode === 'after' || req.cursor.mode === 'before';
  assertKeysetSupported(wantsKeyset, isTextSort, order.keysetEligible);

  const { fetchColumns, keysetColumnIndex } = resolveFetchColumns(
    projectedColumns,
    target.columns,
    order,
    (name) => resolveKeysetColumnMeta(target, name),
  );

  const columns: ColumnDescriptor[] = projectedColumns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    typeClass: typeClassFor(c.dataType),
    nullable: c.nullable,
    isPrimaryKey: c.isPrimaryKey,
    generated: target.generatedColumns.has(c.name),
  }));

  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.table)}`;
  const selectList = fetchColumns.map((c) => quoteIdent(c.name)).join(', ');

  const params: SqliteParam[] = [];
  let whereSql = whereClause(req.filter);

  const fingerprint = requestFingerprint({
    path: target.qualifiedName,
    projection: req.projection,
    filter: req.filter,
    sort: req.sort,
    pageSize: req.pageSize,
  });

  const reverseRows = req.cursor.mode === 'before' && order.keysetEligible;
  const orderBySql = buildScanOrderBy(req.sort, order, reverseRows, quoteIdent);

  if (wantsKeyset && req.cursor.mode !== 'offset') {
    const token = req.cursor.token;
    const keyValues = decodePageToken(token, fingerprint);
    if (keyValues.length !== order.keysetColumns.length) {
      throw new AdapterError('E_QUERY', 'page token key length does not match the sort key');
    }
    const quotedKeyColumns = order.keysetColumns.map((c) => quoteIdent(c));
    const predicate = buildKeysetPredicate(
      quotedKeyColumns,
      order.keysetDirection,
      req.cursor.mode,
      1,
      () => '?',
    );
    params.push(...keyValues);
    whereSql = whereSql ? `${whereSql} AND ${predicate}` : `WHERE ${predicate}`;
  }

  const limit = safeInt(req.pageSize + 1, 'page size');
  const offsetSql =
    req.cursor.mode === 'offset' ? ` OFFSET ${safeInt(req.cursor.offset, 'offset')}` : '';

  const sql = [
    `SELECT ${selectList}`,
    `FROM ${relationSql}`,
    whereSql,
    orderBySql ? `ORDER BY ${orderBySql}` : '',
    `LIMIT ${limit}${offsetSql}`,
  ]
    .filter(Boolean)
    .join('\n');

  const rawRows = runQuery<unknown[]>(h, sql, params, ctx, {
    rowsAsArray: true,
    logParams: true,
    readBigInts: true,
  });

  const probedExtra = rawRows.length > req.pageSize;
  const keptRows = probedExtra ? rawRows.slice(0, req.pageSize) : rawRows;

  const builder = createTabularPageBuilder(columns);
  for (const row of keptRows) {
    builder.appendRow(row.slice(0, projectedColumns.length).map(toCellText));
  }
  if (reverseRows) builder.reverse();

  const displayRows = reverseRows ? [...keptRows].reverse() : keptRows;

  const position = buildKeysetPosition({
    cursor: req.cursor,
    pageSize: req.pageSize,
    displayRows,
    probedExtra,
    order,
    keysetColumnIndex,
    fingerprint,
    cellAt: (row, i) => toCellText(row[i]),
  });

  return builder.finish(position);
}

export function countRows(
  h: SqliteHandle,
  ctx: OpCtx,
  target: Pick<ReadTarget, 'qualifiedName'>,
  filter: string | null,
): { value: number; exact: boolean } {
  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.table)}`;
  const sql = [`SELECT count(*) AS n`, `FROM ${relationSql}`, whereClause(filter)]
    .filter(Boolean)
    .join('\n');

  const rows = runQuery<unknown[]>(h, sql, [], ctx, { rowsAsArray: true, readBigInts: true });
  return { value: parseCountValue(rows[0]?.[0]), exact: true };
}

// D3/D21: the value->text codec. Switches on the *value's* own JS type, never the column's
// declared type — SQLite is dynamically typed (F21), so a TEXT-declared column is free to hold a
// BLOB value and vice versa. The `0x<hex>` spelling is mysql-family/query.ts's own convention
// (D21), not a new one — the cell editor's hex pane behaves identically across every engine.
export function toCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString('hex')}`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return String(value);
  return value as string;
}
