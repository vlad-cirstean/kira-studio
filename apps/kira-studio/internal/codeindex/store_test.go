package codeindex

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// TestReplaceFiles_RetriesOnSQLiteBusy is P64c §4.4: hold codeindex.db's write lock past the
// DSN's own busy_timeout (5s, db.go's buildDSN) from a second connection, and assert ReplaceFiles
// now succeeds once the lock releases — where, before §2.3's retry, a single attempt would have
// surfaced SQLITE_BUSY and discarded the whole batch (measured directly, P64c §1.5: a 6s hold
// against a 5s busy_timeout reproduces "database is locked (5) (SQLITE_BUSY)"). Deliberately
// asserts only eventual success, never an exact attempt count or duration, so it does not flake on
// a loaded box — the exact condition this phase studied.
func TestReplaceFiles_RetriesOnSQLiteBusy(t *testing.T) {
	home := t.TempDir()
	store := OpenStoreAt(home)
	t.Cleanup(func() { _ = store.Close() })

	// Force the schema (and the store's own pool) into existence before the second raw
	// connection below touches the same file.
	if _, err := store.conn(); err != nil {
		t.Fatalf("open store: %v", err)
	}

	lockerDB, err := sql.Open("sqlite", buildDSN(store.Path()))
	if err != nil {
		t.Fatalf("open second connection: %v", err)
	}
	t.Cleanup(func() { _ = lockerDB.Close() })
	lockerDB.SetMaxOpenConns(1)

	lockerTx, err := lockerDB.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("begin locker tx: %v", err)
	}
	// A real write inside the locker's own transaction — BEGIN alone (deferred) does not take
	// SQLite's write lock; the first write statement does.
	if _, err := lockerTx.Exec(
		`INSERT INTO meta (repo_id, key, value) VALUES ('busy-locker', 'k', 'v')`,
	); err != nil {
		t.Fatalf("locker write: %v", err)
	}

	// > the DSN's 5s busy_timeout (db.go), matching P64c §1.5's own reproduction (a single
	// unretried attempt fails past this point; the retry's second attempt should not).
	const holdFor = 6 * time.Second
	released := make(chan struct{})
	go func() {
		defer close(released)
		time.Sleep(holdFor)
		_ = lockerTx.Rollback()
	}()
	t.Cleanup(func() { <-released })

	ctx := context.Background()
	err = store.ReplaceFiles(ctx, []FileWrite{{
		RepoID: "repo-busy-retry", Path: "a.go", Language: "go",
		ParseStatus: StatusOK, ParsedAt: time.Now().UnixMilli(), ContentSHA: make([]byte, 32),
	}})
	if err != nil {
		t.Fatalf("ReplaceFiles under a held write lock: %v (want eventual success via the SQLITE_BUSY retry)", err)
	}

	row, ok, err := store.GetFile(ctx, "repo-busy-retry", "a.go")
	if err != nil || !ok {
		t.Fatalf("expected a.go's row to land: ok=%v err=%v", ok, err)
	}
	if row.ParseStatus != StatusOK {
		t.Fatalf("ParseStatus = %v, want ok", row.ParseStatus)
	}
}
