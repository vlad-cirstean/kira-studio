import type { ConnectionKind } from '@shared/domain/connection';

// P18 (v1.1) D12: strips leading comments the same way clickhouse/console.go's own
// leadingCommentRE does, then requires a leading SELECT/WITH. Explain targets the statement at
// the cursor (statementAtCursor, same call *Run statement* makes) and only that shape — DML is
// genuinely safe to EXPLAIN without ANALYZE on four of the five dialects (OQ-4), but one
// explainability rule is simpler than two, and auto-explain's own SPEC wording is "every SELECT
// query".
const LEADING_COMMENT_RE = /^\s*(?:--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/;
const EXPLAINABLE_RE = /^(SELECT|WITH)\b/i;
const TRAILING_SEMICOLON_RE = /;\s*$/;

export function isExplainable(sql: string): boolean {
  const stripped = sql.replace(LEADING_COMMENT_RE, '').trimStart();
  if (!EXPLAINABLE_RE.test(stripped)) return false;
  // P108 Part 11 F2: a leading SELECT/WITH says nothing about a second statement smuggled behind
  // it — the splitter that decided this was "one statement" can itself be fooled (F4: Postgres
  // E'...' strings, `$` inside an identifier), and Postgres's simple protocol runs every command in
  // one Query message, so a merged `SELECT ...; DELETE ...` would execute the DELETE too once
  // wrapped in EXPLAIN. Checked against the RAW text, after stripping at most one trailing `;` —
  // never the lexer's own span boundaries — mirroring adapters.ClassifySQL's own embedded-semicolon
  // guard (internal/adapters/classify.go), so no splitter bug can defeat it either way. A `;`
  // genuinely inside a string literal costs a disabled Explain button, never a write.
  const raw = sql.replace(TRAILING_SEMICOLON_RE, '');
  return !raw.includes(';');
}

// M3 §9.1: the switch below is the authority on which kinds get an EXPLAIN statement composed —
// EXPLAIN_SUPPORTED_KINDS (packages/shared/domain/connection.ts) names the same five kinds for
// project/ConnectionDialog.vue's own auto-explain checkbox, which cannot import this module
// directly (SPEC §11: project/ must not import views/). Keep both lists in sync by hand; a
// dialect added here belongs there too.

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
