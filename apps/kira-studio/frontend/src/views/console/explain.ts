import type { ConnectionKind } from '@shared/domain/connection';

// P18 (v1.1) D12: strips leading comments the same way clickhouse/console.go's own
// leadingCommentRE does, then requires a leading SELECT/WITH. Explain targets the statement at
// the cursor (statementAtCursor, same call *Run statement* makes) and only that shape — DML is
// genuinely safe to EXPLAIN without ANALYZE on four of the five dialects (OQ-4), but one
// explainability rule is simpler than two, and auto-explain's own SPEC wording is "every SELECT
// query".
const LEADING_COMMENT_RE = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/;
const EXPLAINABLE_RE = /^(SELECT|WITH)\b/i;

export function isExplainable(sql: string): boolean {
  const stripped = sql.replace(LEADING_COMMENT_RE, '').trimStart();
  return EXPLAINABLE_RE.test(stripped);
}

// P18 D13: per-dialect EXPLAIN, decided against real servers (the plan's F11-F15) — never an
// ANALYZE/execute variant anywhere (F16: EXPLAIN alone is ~800x cheaper than running the query,
// which is the entire premise auto-explain rests on). Keyed on ConnectionKind, not sqlDialectFor's
// SqlDialect union: MariaDB and MySQL share the 'mysql' dialect for quoting/grammar, but F13 found
// they return two genuinely different JSON schemas under the identical EXPLAIN FORMAT=JSON
// spelling, so the statement composer (here) and the plan parser (planParsers/) both need the
// finer-grained kind.
export function explainStatementsFor(kind: ConnectionKind, sql: string): string[] {
  switch (kind) {
    case 'postgres':
      return [
        `EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, SETTINGS FALSE, BUFFERS FALSE) ${sql}`,
      ];
    case 'mysql':
    case 'mariadb':
      // F12/F13: FORMAT is always stated explicitly — MySQL's own explain_format session variable
      // can otherwise silently switch this to TRADITIONAL/TREE server-side.
      return [`EXPLAIN FORMAT=JSON ${sql}`];
    case 'sqlite':
      return [`EXPLAIN QUERY PLAN ${sql}`];
    case 'clickhouse':
      // F15: two statements, one Execute call — the plan carries no cost and no row estimate at
      // all, so ESTIMATE is the only source for either. adapter.go's own all-or-nothing/one-page-
      // per-statement contract (§1.4) makes this a single round trip.
      return [
        `EXPLAIN PLAN json = 1, indexes = 1, description = 1 ${sql}`,
        `EXPLAIN ESTIMATE ${sql}`,
      ];
    default:
      return [];
  }
}
