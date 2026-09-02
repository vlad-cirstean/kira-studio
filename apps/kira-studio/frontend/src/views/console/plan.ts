import type { ConnectionKind } from '@shared/domain/connection';
import { cellText, isNull, type Page, type TabularPage } from '@shared/protocol/page';
import type { QueryPlan } from './planModel';
import { parseClickhousePlan } from './planParsers/clickhouse';
import { parseMariadbPlan } from './planParsers/mariadb';
import { parseMysqlPlan } from './planParsers/mysql';
import { parsePostgresPlan } from './planParsers/postgres';
import { parseSqlitePlan, type SqliteExplainRow } from './planParsers/sqlite';

const decoder = new TextDecoder();

function cellAt(page: TabularPage, row: number, col: number): string | null {
  const chunk = page.chunks[col];
  if (col < 0 || !chunk || isNull(chunk, row)) return null;
  return cellText(chunk, row, decoder);
}

function columnIndex(page: TabularPage, name: string): number {
  return page.columns.findIndex((c) => c.name === name);
}

/** D13/D16: turns the `TabularPage`(s) `explain()`'s own `data.execute` call returned back into
 *  one normalized `QueryPlan` — the glue between C9's statement composer and C10's per-dialect
 *  parsers. Throws on a page shape that doesn't match what the plan's F11-F15 verified against
 *  real servers; both callers (the Explain button, auto-explain) run this inside a try/catch —
 *  D19 rule 6 is explicit that a failure here must never surface as an error for the auto-explain
 *  path, only degrade silently to "run normally". */
export function parseExplainPages(
  kind: ConnectionKind,
  pages: Page[],
  thresholdRows: number,
): QueryPlan {
  const first = pages[0];
  if (first?.kind !== 'tabular') {
    throw new Error('EXPLAIN did not return a tabular result');
  }

  switch (kind) {
    case 'postgres':
      return parsePostgresPlan(cellAt(first, 0, 0) ?? '', thresholdRows);
    case 'mysql':
      return parseMysqlPlan(cellAt(first, 0, 0) ?? '', thresholdRows);
    case 'mariadb':
      return parseMariadbPlan(cellAt(first, 0, 0) ?? '', thresholdRows);
    case 'sqlite': {
      const idCol = columnIndex(first, 'id');
      const parentCol = columnIndex(first, 'parent');
      const detailCol = columnIndex(first, 'detail');
      const rows: SqliteExplainRow[] = [];
      for (let r = 0; r < first.rowCount; r++) {
        rows.push({
          id: Number(cellAt(first, r, idCol) ?? 0),
          parent: Number(cellAt(first, r, parentCol) ?? 0),
          detail: cellAt(first, r, detailCol) ?? '',
        });
      }
      return parseSqlitePlan(rows);
    }
    case 'clickhouse': {
      // D13: the second Execute page is EXPLAIN ESTIMATE's own result — absent only if the
      // server returned fewer pages than requested, which parseExplainPages treats as "no
      // estimate" rather than throwing (§7.3: page order is asserted in the unit test, not
      // trusted blindly at runtime).
      const estimatePage = pages[1];
      const estimateRows: Array<{ rows: number }> = [];
      if (estimatePage?.kind === 'tabular') {
        const rowsCol = columnIndex(estimatePage, 'rows');
        for (let r = 0; r < estimatePage.rowCount; r++) {
          estimateRows.push({ rows: Number(cellAt(estimatePage, r, rowsCol) ?? 0) });
        }
      }
      return parseClickhousePlan(cellAt(first, 0, 0) ?? '', estimateRows, thresholdRows);
    }
    default:
      throw new Error(`no EXPLAIN parser for connection kind "${kind}"`);
  }
}
