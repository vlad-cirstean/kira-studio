import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type TabularPage,
  type TypeClass,
} from '@shared/protocol/page';
import type { Connection } from 'mariadb';
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
import { runQuery, type TrackQuery } from './query';

export function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL byte');
  return `\`${name.replace(/`/g, '``')}\``;
}

// §5d's MariaDB mapping. tinyint(1) is checked ahead of the general number match — it is how
// MariaDB spells boolean.
export function typeClassFor(dataType: string): TypeClass {
  const base = dataType.toLowerCase();
  if (/^tinyint\(1\)/.test(base)) return 'boolean';
  if (
    /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|bit)\b/.test(base)
  ) {
    return 'number';
  }
  if (/^(date|datetime|timestamp|time|year)\b/.test(base)) return 'temporal';
  if (base.startsWith('json')) return 'json';
  if (/^(binary|varbinary|tinyblob|blob|mediumblob|longblob|geometry)\b/.test(base))
    return 'binary';
  return 'text';
}

export async function readPage(
  conn: Connection,
  ctx: OpCtx,
  track: TrackQuery,
  target: ReadTarget,
  req: Omit<ReadRequest, 'path'>,
): Promise<TabularPage> {
  const projectedColumns = resolveProjection(target.columns, req.projection);
  const order = computeEffectiveOrder(
    req.sort,
    target.columns,
    target.primaryKey ?? target.uniqueKeys[0] ?? null,
  );
  const isTextSort = req.sort?.kind === 'text';
  const wantsKeyset = req.cursor.mode === 'after' || req.cursor.mode === 'before';
  assertKeysetSupported(wantsKeyset, isTextSort, order.keysetEligible);

  const { fetchColumns, keysetColumnIndex } = resolveFetchColumns(
    projectedColumns,
    target.columns,
    order,
  );

  const columns: ColumnDescriptor[] = projectedColumns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    typeClass: typeClassFor(c.dataType),
    nullable: c.nullable,
    isPrimaryKey: c.isPrimaryKey,
    // P36 D28: not detected here yet — false rather than a guess.
    generated: false,
  }));

  const relationSql = `${quoteIdent(target.qualifiedName.database)}.${quoteIdent(target.qualifiedName.table)}`;
  const selectList = fetchColumns.map((c) => quoteIdent(c.name)).join(', ');

  const params: unknown[] = [];
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

  const limit = safeInt(req.pageSize + 1, 'page size'); // D24's +1 probe
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

  // Never `prepared` here: mariadb.js's binary/prepared protocol (conn.execute) combined with
  // the textMode typeCast callback corrupts row data (buffer/field misalignment), confirmed with
  // real bound keyset params, not just the zero-param case. conn.query() already binds `?`
  // placeholders client-side (its own escaping, not string interpolation), so keyset params are
  // still safely bound over the text protocol.
  const rawRows = await runQuery<(string | null)[]>(conn, sql, params, ctx, track, {
    rowsAsArray: true,
    textMode: true,
    logParams: true,
  });

  const probedExtra = rawRows.length > req.pageSize;
  const keptRows = probedExtra ? rawRows.slice(0, req.pageSize) : rawRows;

  const builder = createTabularPageBuilder(columns);
  for (const row of keptRows) {
    builder.appendRow(row.slice(0, projectedColumns.length));
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
    cellAt: (row, i) => row[i],
  });

  return builder.finish(position);
}

export async function countRows(
  conn: Connection,
  ctx: OpCtx,
  track: TrackQuery,
  target: Pick<ReadTarget, 'qualifiedName'>,
  filter: string | null,
): Promise<{ value: number; exact: boolean }> {
  const relationSql = `${quoteIdent(target.qualifiedName.database)}.${quoteIdent(target.qualifiedName.table)}`;
  const sql = [`SELECT count(*) AS n`, `FROM ${relationSql}`, whereClause(filter)]
    .filter(Boolean)
    .join('\n');

  const rows = await runQuery<[string]>(conn, sql, [], ctx, track, {
    rowsAsArray: true,
    textMode: true,
  });
  return { value: parseCountValue(rows[0]?.[0]), exact: true };
}
