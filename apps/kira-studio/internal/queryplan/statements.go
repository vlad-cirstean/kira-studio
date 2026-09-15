package queryplan

import (
	"regexp"
	"strings"
)

// leadingCommentRE strips leading SQL comments the same way explain.ts's own does (clickhouse/
// console.go's leadingCommentRE precedent) — a line comment or a block comment, repeated, before
// the leading keyword check.
var leadingCommentRE = regexp.MustCompile(`(?s)^\s*(?:--[^\n]*\n|/\*.*?\*/\s*)*`)

var explainableRE = regexp.MustCompile(`(?i)^(SELECT|WITH)\b`)

// Explainable ports explain.ts's isExplainable verbatim (P18 D12, M3 §8.1): strips leading
// comments, then requires a leading SELECT/WITH. Reused, not re-decided — see explain_query's own
// refusal of anything else (M3 §4.3/§8).
func Explainable(sql string) bool {
	stripped := strings.TrimLeft(leadingCommentRE.ReplaceAllString(sql, ""), " \t\r\n")
	return explainableRE.MatchString(stripped)
}

// StatementsFor ports explain.ts's explainStatementsFor verbatim (P18 D13), keyed on kind exactly
// as the TypeScript side is — MariaDB and MySQL share the 'mysql' dialect elsewhere in this app,
// but report two genuinely different EXPLAIN FORMAT=JSON schemas (F13), so the finer-grained kind
// is required here too. Never composes ANALYZE on any dialect (§1.1/§8.3's own load-bearing
// property).
func StatementsFor(kind, sql string) []string {
	switch kind {
	case "postgres":
		return []string{"EXPLAIN (FORMAT JSON, COSTS TRUE, VERBOSE FALSE, SETTINGS FALSE, BUFFERS FALSE) " + sql}
	case "mysql", "mariadb":
		return []string{"EXPLAIN FORMAT=JSON " + sql}
	case "sqlite":
		return []string{"EXPLAIN QUERY PLAN " + sql}
	case "clickhouse":
		return []string{
			"EXPLAIN PLAN json = 1, indexes = 1, description = 1 " + sql,
			"EXPLAIN ESTIMATE " + sql,
		}
	default:
		return []string{}
	}
}

// Supported reports whether kind has an EXPLAIN this package can compose and parse — postgres,
// mysql, mariadb, sqlite, clickhouse (M3 §7). One function, no second list: it is exactly
// len(StatementsFor(kind, "x")) > 0.
func Supported(kind string) bool {
	return len(StatementsFor(kind, "x")) > 0
}
