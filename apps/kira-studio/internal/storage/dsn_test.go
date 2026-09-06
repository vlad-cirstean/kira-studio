// P23 §4.2 case 6: pins two DSN pragmas (D5(a)/D6) against the real, pinned modernc.org/sqlite
// driver. What this actually guards is not a branch in this app's own code but a string parsed by
// a third-party driver, whose failure mode for an unrecognised top-level key is silent (F17):
// journal_size_limit has no _journal_size_limit shorthand in this driver, so the value only takes
// effect because it goes through the generic _pragma list. A driver upgrade that reorders or
// renames that handling would turn both fixes off with no error anywhere, and nothing else in the
// repo would notice.
package storage_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage"
)

func TestOpenSetsAutoVacuumAndJournalSizeLimit(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	var autoVacuum int
	if err := db.QueryRow(`PRAGMA auto_vacuum`).Scan(&autoVacuum); err != nil {
		t.Fatalf("read auto_vacuum: %v", err)
	}
	if autoVacuum != 2 {
		t.Errorf("PRAGMA auto_vacuum = %d, want 2 (INCREMENTAL)", autoVacuum)
	}

	var journalSizeLimit int
	if err := db.QueryRow(`PRAGMA journal_size_limit`).Scan(&journalSizeLimit); err != nil {
		t.Fatalf("read journal_size_limit: %v", err)
	}
	if journalSizeLimit != 4_194_304 {
		t.Errorf("PRAGMA journal_size_limit = %d, want 4194304 (4 MiB)", journalSizeLimit)
	}
}
