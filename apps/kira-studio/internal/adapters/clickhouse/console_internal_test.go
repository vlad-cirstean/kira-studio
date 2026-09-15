// console_internal_test.go guards M7 finding #10: run_query classified any bare (non-ANALYZE)
// EXPLAIN as ClassRead via the shared, dialect-agnostic adapters.ClassifySQL — safe on
// Postgres/MySQL/MariaDB/SQLite, whose plain EXPLAIN never executes its target, but not confirmed
// safe on ClickHouse (docs/v1.7/plans/M3 §8.1's own "the one it does not clear"). A connection with
// write:deny could otherwise run a write through `EXPLAIN <DELETE ...>` typed straight into
// run_query's raw SQL argument.
package clickhouse

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
)

func TestClassifyClickHouseSQLReclassifiesBareExplainByTarget(t *testing.T) {
	cases := []struct {
		name      string
		statement string
		want      adapters.OpClass
	}{
		{"explain select stays read", "EXPLAIN SELECT * FROM t", adapters.ClassRead},
		{"explain delete is a write, not a read", "EXPLAIN DELETE FROM t WHERE id = 1", adapters.ClassWrite},
		{"explain insert is a write", "EXPLAIN INSERT INTO t VALUES (1)", adapters.ClassWrite},
		{"explain alter is ddl", "EXPLAIN ALTER TABLE t DELETE WHERE id = 1", adapters.ClassDDL},
		{"explain analyze select still classifies its target", "EXPLAIN ANALYZE SELECT * FROM t", adapters.ClassRead},
		{
			"explain analyze delete classifies as write, same as without analyze",
			"EXPLAIN ANALYZE DELETE FROM t WHERE id = 1",
			adapters.ClassWrite,
		},
		{"plain select is unaffected", "SELECT * FROM t", adapters.ClassRead},
		{"plain delete is unaffected", "DELETE FROM t WHERE id = 1", adapters.ClassWrite},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyClickHouseSQL(tc.statement); got != tc.want {
				t.Fatalf("classifyClickHouseSQL(%q) = %s, want %s", tc.statement, got, tc.want)
			}
		})
	}
}
