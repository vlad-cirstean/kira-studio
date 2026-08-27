import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
  type TypeClass,
} from '@shared/protocol/page';
import type { Client } from 'pg';
import type { OpCtx, ReadRequest } from '../adapter';
import { AdapterError } from '../errors';
import {
  assertKeysetSupported,
  buildKeysetPredicate,
  buildScanOrderBy,
  computeEffectiveOrder,
  decodePageToken,
  encodePageToken,
  requestFingerprint,
  resolveFetchColumns,
  resolveProjection,
} from '../sql-text';
import type { ReadTarget } from './catalog';
import { runQuery, type TrackQuery } from './query';

export function quoteIdent(name: string): string {
  if (name.includes('\0')) throw new AdapterError('E_QUERY', 'identifier contains a NUL byte');
  return `"${name.replace(/"/g, '""')}"`;
}

// §5d's Postgres mapping. Array types (`_`-prefixed / `[]`-suffixed `format_type()` output) are
// checked first since they would otherwise match a base-type prefix (e.g. `integer[]`).
export function typeClassFor(dataType: string): TypeClass {
  const base = dataType.toLowerCase();
  if (base.startsWith('_') || base.endsWith('[]')) return 'other';
  if (
    /^(int2|int4|int8|smallint|integer|bigint|numeric|decimal|real|double precision|float4|float8|money)\b/.test(
      base,
    )
  ) {
    return 'number';
  }
  if (base === 'boolean' || base === 'bool') return 'boolean';
  if (/^(date|time|timetz|timestamp|timestamptz|interval)\b/.test(base)) return 'temporal';
  if (base === 'json' || base === 'jsonb') return 'json';
  if (base === 'bytea') return 'binary';
  return 'text';
}

// bytea in text mode arrives as `\x…` (the `hex` bytea_output default since Postgres 9.0) —
// normalised to the app-wide `0x…` binary convention (D3, mirrored by MariaDB's blob handling).
// Exported so postgres/console.ts (P5.5) reuses the exact same normalisation for query results.
export function normalizeCellText(value: string, typeClass: TypeClass): string {
  if (typeClass === 'binary' && value.startsWith('\\x')) return `0x${value.slice(2)}`;
  return value;
}

export async function readPage(
  client: Client,
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

  // The tiebreaker's columns must be fetched even when the caller did not project them — a
  // page/prev token needs their values regardless of what the grid displays.
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
    // P36 D28: not detected here yet (definition.ts's own attgenerated is the only place this
    // adapter currently reads it) — false rather than a guess.
    generated: false,
  }));

  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.relation)}`;
  const selectList = fetchColumns.map((c) => quoteIdent(c.name)).join(', ');

  const params: unknown[] = [];
  const addParam = (value: unknown): number => {
    params.push(value);
    return params.length;
  };

  // The filter is always parenthesised (§5b step 4) — combined with a keyset predicate by a
  // bare AND, an unparenthesised `a = 1 OR b = 2` would silently change the user's meaning.
  let whereSql = req.filter && req.filter.trim() !== '' ? `WHERE (${req.filter})` : '';

  const fingerprint = requestFingerprint({
    path: target.qualifiedName,
    projection: req.projection,
    filter: req.filter,
    sort: req.sort,
    pageSize: req.pageSize,
  });

  // `before` flips every direction in the ORDER BY so the scan grabs the rows immediately
  // preceding the boundary; the page is reversed back to display order after fetching (D7).
  const reverseRows = req.cursor.mode === 'before' && order.keysetEligible;
  const orderBySql = buildScanOrderBy(req.sort, order, reverseRows, quoteIdent);

  if (wantsKeyset && req.cursor.mode !== 'offset') {
    const token = req.cursor.token;
    const keyValues = decodePageToken(token, fingerprint);
    if (keyValues.length !== order.keysetColumns.length) {
      throw new AdapterError('E_QUERY', 'page token key length does not match the sort key');
    }
    const firstIndex = params.length + 1;
    for (const v of keyValues) addParam(v);
    const quotedKeyColumns = order.keysetColumns.map((c) => quoteIdent(c));
    const predicate = buildKeysetPredicate(
      quotedKeyColumns,
      order.keysetDirection,
      req.cursor.mode,
      firstIndex,
      (i) => `$${i}`,
    );
    whereSql = whereSql ? `${whereSql} AND ${predicate}` : `WHERE ${predicate}`;
  }

  let offsetSql = '';
  if (req.cursor.mode === 'offset') {
    const idx = addParam(req.cursor.offset);
    offsetSql = ` OFFSET $${idx}`;
  }

  // D24: fetch pageSize + 1 to compute hasMore without a count.
  const limitIdx = addParam(req.pageSize + 1);

  const sql = [
    `SELECT ${selectList}`,
    `FROM ${relationSql}`,
    whereSql,
    orderBySql ? `ORDER BY ${orderBySql}` : '',
    `LIMIT $${limitIdx}${offsetSql}`,
  ]
    .filter(Boolean)
    .join('\n');

  const rawRows = await runQuery<(string | null)[]>(client, sql, params, ctx, track, {
    rowMode: 'array',
    textMode: true,
    logParams: true,
  });

  const probedExtra = rawRows.length > req.pageSize;
  const keptRows = probedExtra ? rawRows.slice(0, req.pageSize) : rawRows;

  const builder = createTabularPageBuilder(columns);
  for (const row of keptRows) {
    const visible = row.slice(0, projectedColumns.length);
    builder.appendRow(
      visible.map((v, i) => (v === null ? null : normalizeCellText(v, columns[i].typeClass))),
    );
  }
  if (reverseRows) builder.reverse();

  const displayRows = reverseRows ? [...keptRows].reverse() : keptRows;
  const rowCount = displayRows.length;

  const keysetValuesOf = (row: (string | null)[]): string[] =>
    order.keysetColumns.map((name) => {
      const idx = keysetColumnIndex.get(name) ?? -1;
      const v = idx >= 0 ? row[idx] : null;
      if (v === null) {
        throw new AdapterError('E_QUERY', `keyset tiebreaker column "${name}" was NULL`);
      }
      return v;
    });

  // Reflects whether keyset navigation is available from here, not which cursor mode this
  // particular fetch used — an eligible sort reports 'keyset' even on the very first (offset 0)
  // page, so the renderer can page forward/back by token from then on (§5c).
  const strategy: PagePosition['strategy'] = order.keysetEligible ? 'keyset' : 'offset';

  // hasMore answers "is there a next page forward" regardless of which direction this page was
  // fetched in: a 'before' fetch always has a forward page (we navigated back from it); an
  // 'after'/'offset' fetch has one iff the pageSize+1 probe row showed up.
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
  client: Client,
  ctx: OpCtx,
  track: TrackQuery,
  target: Pick<ReadTarget, 'qualifiedName'>,
  filter: string | null,
): Promise<{ value: number; exact: boolean }> {
  const relationSql = `${quoteIdent(target.qualifiedName.schema)}.${quoteIdent(target.qualifiedName.relation)}`;
  const whereSql = filter && filter.trim() !== '' ? `WHERE (${filter})` : '';
  const sql = [`SELECT count(*) AS n`, `FROM ${relationSql}`, whereSql].filter(Boolean).join('\n');

  const rows = await runQuery<[string]>(client, sql, [], ctx, track, {
    rowMode: 'array',
    textMode: true,
  });
  const raw = rows[0]?.[0];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) {
    throw new AdapterError('E_QUERY', `count returned a non-numeric result: ${String(raw)}`);
  }
  return { value, exact: true };
}
