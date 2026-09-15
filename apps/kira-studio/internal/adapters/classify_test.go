package adapters_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
)

func TestClassifySQL(t *testing.T) {
	tests := []struct {
		name      string
		statement string
		want      adapters.OpClass
	}{
		{"plain select", "SELECT * FROM t", adapters.ClassRead},
		{"lowercase select", "select * from t", adapters.ClassRead},
		{"select with leading line comment", "-- note\nSELECT 1", adapters.ClassRead},
		{"select with leading block comment", "/* c */ SELECT 1", adapters.ClassRead},
		{"line comment before a drop is still a drop", "-- c\nDROP TABLE t", adapters.ClassDDL},
		{"block comment before an update is still an update", "/* c */ UPDATE t SET x = 1", adapters.ClassWrite},
		{"nested block comments", "SELECT /* a /* b */ c */ 1", adapters.ClassRead},

		{"one trailing semicolon is stripped", "SELECT 1;", adapters.ClassRead},
		{"trailing semicolon with whitespace", "SELECT 1;   ", adapters.ClassRead},
		{"embedded semicolon is unknown", "SELECT 1; DROP TABLE t", adapters.ClassUnknown},
		{"embedded semicolon mid-statement", "DROP TABLE t; SELECT 1", adapters.ClassUnknown},

		{"with select body reads", "WITH x AS (SELECT * FROM t) SELECT * FROM x", adapters.ClassRead},
		{"with a data-modifying cte writes", "WITH x AS (DELETE FROM t RETURNING *) SELECT * FROM x", adapters.ClassWrite},
		{"with followed by insert writes", "WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x", adapters.ClassWrite},
		{"with followed by ddl is ddl", "WITH x AS (SELECT 1) CREATE TABLE t AS SELECT * FROM x", adapters.ClassDDL},

		{"select into writes", "SELECT * INTO newtable FROM t", adapters.ClassWrite},
		{"select with into as a column name substring is not into", "SELECT intoxicated FROM t", adapters.ClassRead},

		{"show is read", "SHOW TABLES", adapters.ClassRead},
		{"describe is read", "DESCRIBE t", adapters.ClassRead},
		{"desc is read", "DESC t", adapters.ClassRead},
		{"values is read", "VALUES (1, 2)", adapters.ClassRead},
		{"table is read", "TABLE t", adapters.ClassRead},

		{"explain select is read", "EXPLAIN SELECT * FROM t", adapters.ClassRead},
		{"explain analyze delete is a write", "EXPLAIN ANALYZE DELETE FROM t", adapters.ClassWrite},
		{"explain analyze select is a read", "EXPLAIN ANALYZE SELECT * FROM t", adapters.ClassRead},
		{"explain analyze create is ddl", "EXPLAIN ANALYZE CREATE TABLE t (id int)", adapters.ClassDDL},

		{"insert writes", "INSERT INTO t VALUES (1)", adapters.ClassWrite},
		{"update writes", "UPDATE t SET x = 1", adapters.ClassWrite},
		{"delete writes", "DELETE FROM t", adapters.ClassWrite},
		{"merge writes", "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1", adapters.ClassWrite},
		{"replace writes", "REPLACE INTO t VALUES (1)", adapters.ClassWrite},
		{"copy writes", "COPY t FROM STDIN", adapters.ClassWrite},
		{"load writes", "LOAD DATA INFILE 'x' INTO TABLE t", adapters.ClassWrite},

		{"create is ddl", "CREATE TABLE t (id int)", adapters.ClassDDL},
		{"alter is ddl", "ALTER TABLE t ADD COLUMN x int", adapters.ClassDDL},
		{"drop is ddl", "DROP TABLE t", adapters.ClassDDL},
		{"truncate is ddl, not write", "TRUNCATE TABLE t", adapters.ClassDDL},
		{"grant is ddl", "GRANT SELECT ON t TO u", adapters.ClassDDL},
		{"vacuum is ddl", "VACUUM t", adapters.ClassDDL},
		{"standalone analyze is ddl", "ANALYZE t", adapters.ClassDDL},

		{"pragma is unknown", "PRAGMA journal_mode=WAL", adapters.ClassUnknown},
		{"set is unknown", "SET SESSION x = 1", adapters.ClassUnknown},
		{"use is unknown", "USE mydb", adapters.ClassUnknown},
		{"begin is unknown", "BEGIN", adapters.ClassUnknown},
		{"commit is unknown", "COMMIT", adapters.ClassUnknown},
		{"rollback is unknown", "ROLLBACK", adapters.ClassUnknown},
		{"call is unknown", "CALL my_proc()", adapters.ClassUnknown},
		{"empty statement is unknown", "", adapters.ClassUnknown},
		{"whitespace-only statement is unknown", "   \n\t  ", adapters.ClassUnknown},
		{"comment-only statement is unknown", "-- just a comment", adapters.ClassUnknown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := adapters.ClassifySQL(tt.statement); got != tt.want {
				t.Fatalf("ClassifySQL(%q) = %q, want %q", tt.statement, got, tt.want)
			}
		})
	}
}
