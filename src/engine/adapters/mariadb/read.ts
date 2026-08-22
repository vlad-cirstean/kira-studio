import type { Connection } from 'mariadb';
import type { SortDirection } from '../../../shared/domain/queries';
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
import {
  buildKeysetPredicate,
  buildOrderBy,
  decodePageToken,
  encodePageToken,
  requestFingerprint,
} from '../sql-text';
import type { ReadTarget } from './catalog';
import { type RunningQuery, runQuery } from './query';

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

// App-generated integers only (pageSize+1, an offset already validated at the port boundary) —
// inlined rather than bound, sidestepping any uncertainty about a `?` placeholder in LIMIT/OFFSET
// on a given server version (§5b step 5's documented fallback).
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

interface EffectiveOrder {
  terms: { column: string; direction: SortDirection }[];
  keysetEligible: boolean;
  keysetColumns: string[];
  keysetDirection: SortDirection;
}

// D7, identical logic to postgres/read.ts's computeEffectiveOrder — kept as a sibling copy
// rather than a shared helper because it depends on each adapter's own ReadTarget shape.
function computeEffectiveOrder(sort: SortSpec | null, target: ReadTarget): EffectiveOrder {
  if (sort?.kind === 'text') {
    return { terms: [], keysetEligible: false, keysetColumns: [], keysetDirection: 'asc' };
  }

  const requestedTerms = sort?.kind === 'structured' ? sort.terms : [];
  if (requestedTerms.length > 0) {
    const byName = new Set(target.columns.map((c) => c.name));
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

  const tiebreaker = target.primaryKey ?? target.uniqueKeys[0] ?? null;
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

export async function readPage(
  conn: Connection,
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
  target: ReadTarget,
  req: Omit<ReadRequest, 'path'>,
): Promise<TabularPage> {
  const projectedColumns = resolveProjection(target, req.projection);
  const order = computeEffectiveOrder(req.sort, target);
  const isTextSort = req.sort?.kind === 'text';
  const wantsKeyset = req.cursor.mode === 'after' || req.cursor.mode === 'before';

  if (wantsKeyset && (isTextSort || !order.keysetEligible)) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'keyset pagination is unavailable for this sort; the client must use an offset cursor',
    );
  }

  const projectedNames = new Set(projectedColumns.map((c) => c.name));
  const columnByName = new Map(target.columns.map((c) => [c.name, c]));
  const hiddenColumns = order.keysetEligible
    ? order.keysetColumns
        .filter((name) => !projectedNames.has(name))
        .map((name) => {
          const col = columnByName.get(name);
          if (!col)
            throw new AdapterError('E_QUERY', `keyset tiebreaker column not found: ${name}`);
          return col;
        })
    : [];
  const fetchColumns = [...projectedColumns, ...hiddenColumns];
  const keysetColumnIndex = new Map(
    order.keysetColumns.map((name) => [name, fetchColumns.findIndex((c) => c.name === name)]),
  );

  const columns: ColumnDescriptor[] = projectedColumns.map((c) => ({
    name: c.name,
    dataType: c.dataType,
    typeClass: typeClassFor(c.dataType),
    nullable: c.nullable,
    isPrimaryKey: c.isPrimaryKey,
  }));

  const relationSql = `${quoteIdent(target.qualifiedName.database)}.${quoteIdent(target.qualifiedName.table)}`;
  const selectList = fetchColumns.map((c) => quoteIdent(c.name)).join(', ');

  const params: unknown[] = [];
  let whereSql = req.filter && req.filter.trim() !== '' ? `WHERE (${req.filter})` : '';

  const fingerprint = requestFingerprint({
    path: target.qualifiedName,
    projection: req.projection,
    filter: req.filter,
    sort: req.sort,
    pageSize: req.pageSize,
  });

  const reverseRows = req.cursor.mode === 'before' && order.keysetEligible;
  let orderBySql = '';
  if (isTextSort && req.sort?.kind === 'text') {
    orderBySql = req.sort.text;
  } else if (order.terms.length > 0) {
    const scanTerms = reverseRows
      ? order.terms.map((t) => ({
          column: t.column,
          direction: (t.direction === 'asc' ? 'desc' : 'asc') as SortDirection,
        }))
      : order.terms;
    orderBySql = buildOrderBy(scanTerms, quoteIdent);
  }

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
  const rowCount = displayRows.length;

  const keysetValuesOf = (row: (string | null)[]): string[] =>
    order.keysetColumns.map((name) => {
      const idx = keysetColumnIndex.get(name) ?? -1;
      const v = idx >= 0 ? row[idx] : null;
      if (v === null)
        throw new AdapterError('E_QUERY', `keyset tiebreaker column "${name}" was NULL`);
      return v;
    });

  // Reflects whether keyset navigation is available from here, not which cursor mode this
  // particular fetch used — an eligible sort reports 'keyset' even on the very first (offset 0)
  // page, so the renderer can page forward/back by token from then on (§5c).
  const strategy: PagePosition['strategy'] = order.keysetEligible ? 'keyset' : 'offset';
  const hasMore = rowCount === 0 ? false : req.cursor.mode === 'before' ? true : probedExtra;

  let nextToken: string | null = null;
  let prevToken: string | null = null;
  if (order.keysetEligible && rowCount > 0) {
    const hasForward = req.cursor.mode === 'before' ? true : probedExtra;
    const hasBackward =
      req.cursor.mode === 'before'
        ? probedExtra
        : req.cursor.mode === 'after'
          ? true
          : req.cursor.offset > 0;
    if (hasForward)
      nextToken = encodePageToken(keysetValuesOf(displayRows[rowCount - 1]), fingerprint);
    if (hasBackward) prevToken = encodePageToken(keysetValuesOf(displayRows[0]), fingerprint);
  }

  const position: PagePosition = {
    offset: req.cursor.mode === 'offset' ? req.cursor.offset : null,
    pageSize: req.pageSize,
    hasMore,
    nextToken,
    prevToken,
    strategy,
  };

  return builder.finish(position);
}

export async function countRows(
  conn: Connection,
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
  target: Pick<ReadTarget, 'qualifiedName'>,
  filter: string | null,
): Promise<{ value: number; exact: boolean }> {
  const relationSql = `${quoteIdent(target.qualifiedName.database)}.${quoteIdent(target.qualifiedName.table)}`;
  const whereSql = filter && filter.trim() !== '' ? `WHERE (${filter})` : '';
  const sql = [`SELECT count(*) AS n`, `FROM ${relationSql}`, whereSql].filter(Boolean).join('\n');

  const rows = await runQuery<[string]>(conn, sql, [], ctx, track, {
    rowsAsArray: true,
    textMode: true,
  });
  const raw = rows[0]?.[0];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new AdapterError('E_QUERY', `count returned a non-numeric result: ${String(raw)}`);
  }
  return { value, exact: true };
}
