package migrations

import "testing"

// Catches a new *.sql file never added to names: LoadMigrations applies only the listed files.
func TestEveryEmbeddedFileIsRegistered(t *testing.T) {
	entries, err := files.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	listed := make(map[string]bool, len(names))
	for _, n := range names {
		listed[n.File] = true
	}
	for _, e := range entries {
		if !listed[e.Name()] {
			t.Errorf("%s is embedded but missing from names", e.Name())
		}
	}
	if len(entries) != len(names) {
		t.Errorf("%d embedded files, %d registered", len(entries), len(names))
	}
}
