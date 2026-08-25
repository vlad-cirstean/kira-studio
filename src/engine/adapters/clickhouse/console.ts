import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
} from '../../../shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { singleStatusPage } from '../sql-text';
import type { ClickHouseHandle } from './client';
import { runCommand, streamQuery, type TrackQuery } from './query';
import { typeClassFor } from './read';

// D19: the HTTP interface gives no cheap "will this return rows" check before executing (unlike
// SQLite's StatementSync.columns() or MariaDB's OkPacket-vs-rows result shape) — a leading-keyword
// heuristic decides query() (row-returning) vs command() (not), skipping past leading `--`/`/* */`
// comments first. This matters beyond cosmetics: appending FORMAT to a non-SELECT statement via
// query() would be wrong for an INSERT, whose own FORMAT clause names the *input* data's format.
const LEADING_COMMENT_RE = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/;
const ROW_RETURNING_RE = /^\s*(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|EXISTS)\b/i;

function isRowReturning(sql: string): boolean {
  const stripped = sql.replace(LEADING_COMMENT_RE, '');
  return ROW_RETURNING_RE.test(stripped);
}

async function runRowReturning(
  h: ClickHouseHandle,
  ctx: OpCtx,
  sql: string,
  track: TrackQuery,
  nextQueryId: () => string,
): Promise<TabularPage> {
  let columns: ColumnDescriptor[] = [];
  let builder: ReturnType<typeof createTabularPageBuilder> | null = null;
  let rowCount = 0;
  await streamQuery(
    h,
    ctx,
    sql,
    { queryId: nextQueryId() },
    track,
    (names, types) => {
      // §8.14's console never consults the catalog — nullability/PK-ness are unknowable here;
      // console results are always read-only regardless (mirrors mysql-family/console.ts).
      columns = names.map((name, i) => ({
        name,
        dataType: types[i] ?? 'String',
        typeClass: typeClassFor(types[i] ?? 'String'),
        nullable: true,
        isPrimaryKey: false,
        generated: false,
      }));
      builder = createTabularPageBuilder(columns);
    },
    (values) => {
      builder?.appendRow(values);
      rowCount++;
    },
  );
  if (!builder) builder = createTabularPageBuilder(columns);
  const position: PagePosition = {
    offset: 0,
    pageSize: rowCount,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return (builder as ReturnType<typeof createTabularPageBuilder>).finish(position);
}

export async function execute(
  h: ClickHouseHandle,
  ctx: OpCtx,
  track: TrackQuery,
  statements: string[],
  nextQueryId: () => string,
): Promise<TabularPage[]> {
  if (statements.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  // One op-log row for the whole batch (P5 D9's precedent) — streamQuery/runCommand deliberately
  // never call ctx.setCommand() themselves so this one call is authoritative.
  ctx.setCommand(statements.join(';\n'));

  const pages: TabularPage[] = [];
  for (const sql of statements) {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    if (isRowReturning(sql)) {
      pages.push(await runRowReturning(h, ctx, sql, track, nextQueryId));
    } else {
      const { writtenRows } = await runCommand(h, ctx, sql, { queryId: nextQueryId() }, track);
      pages.push(singleStatusPage(`${writtenRows} row(s) written`, 'String'));
    }
  }
  return pages;
}
