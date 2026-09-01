package mysqlfamily

import "testing"

// White-box (package mysqlfamily) coverage for groupForeignKeys — kept separate from the
// black-box mysqlfamily_test.go suite because the bug it guards against (P2 R2, task #91) is
// hard to reach deterministically over a real connection: MySQL sees it fine, but MariaDB's own
// information_schema.REFERENTIAL_CONSTRAINTS view does not surface a row for a database the
// connected user only holds a db-level wildcard GRANT SELECT on (a separate, pre-existing MariaDB
// limitation, unrelated to this fix — see mysqlfamily_test.go's "referencedBy" test for the live,
// MySQL-only reproduction). This test instead feeds groupForeignKeys the exact row shape the two
// engines' queries would have produced, so the grouping logic itself is verified unconditionally.

type fkRow struct {
	name, col, refDB, refTable, refCol, onDelete, onUpdate string
}

func fkRowGet(r fkRow) (name, col, refDatabase, refTable, refCol, onDelete, onUpdate string) {
	return r.name, r.col, r.refDB, r.refTable, r.refCol, r.onDelete, r.onUpdate
}

func TestGroupForeignKeys_SameNameDifferentSchemaNotMerged(t *testing.T) {
	rows := []fkRow{
		{name: "fk_dup", col: "id", refDB: "kira_test", refTable: "fk_collision_a", refCol: "customer_id", onDelete: "RESTRICT", onUpdate: "RESTRICT"},
		{name: "fk_dup", col: "id", refDB: "kira_analytics", refTable: "fk_collision_b", refCol: "customer_id", onDelete: "RESTRICT", onUpdate: "RESTRICT"},
	}
	got := groupForeignKeys(rows, fkRowGet)
	if len(got) != 2 {
		t.Fatalf("got %d ForeignKeyMeta, want 2 (a colliding constraint name in a different schema must not merge): %+v", len(got), got)
	}
	for _, fk := range got {
		if fk.Name != "fk_dup" {
			t.Errorf("Name = %q, want fk_dup", fk.Name)
		}
		if len(fk.Columns) != 1 || fk.Columns[0] != "id" {
			t.Errorf("Columns = %v, want [id] (not merged with the other schema's row)", fk.Columns)
		}
	}
	if got[0].ReferencedPath == got[1].ReferencedPath {
		t.Errorf("both entries share ReferencedPath %q, want one per schema", got[0].ReferencedPath)
	}
}

func TestGroupForeignKeys_SameNameSameSchemaCompositeKeyStillMerges(t *testing.T) {
	// A genuine multi-column constraint: two KEY_COLUMN_USAGE rows, same name/schema/table, one
	// per column — must still fold into a single ForeignKeyMeta with both columns, not two.
	rows := []fkRow{
		{name: "fk_composite", col: "a", refDB: "kira_test", refTable: "child", refCol: "parent_a", onDelete: "CASCADE", onUpdate: "CASCADE"},
		{name: "fk_composite", col: "b", refDB: "kira_test", refTable: "child", refCol: "parent_b", onDelete: "CASCADE", onUpdate: "CASCADE"},
	}
	got := groupForeignKeys(rows, fkRowGet)
	if len(got) != 1 {
		t.Fatalf("got %d ForeignKeyMeta, want 1 (same schema/table/name must still merge into one composite key): %+v", len(got), got)
	}
	if want := []string{"a", "b"}; len(got[0].Columns) != 2 || got[0].Columns[0] != want[0] || got[0].Columns[1] != want[1] {
		t.Errorf("Columns = %v, want %v", got[0].Columns, want)
	}
}
