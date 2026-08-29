package secrets_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/secrets"
	"github.com/kirathecat/kira-studio/shell/internal/storage"
	"github.com/kirathecat/kira-studio/shell/internal/storage/repos"
)

// var _ repos.Cipher = (*secrets.Cipher)(nil) confirms the interface satisfaction at compile
// time, without needing a value.
var _ repos.Cipher = (*secrets.Cipher)(nil)

func TestSatisfiesReposCipherRoundTrip(t *testing.T) {
	t.Setenv("KIRA_HOME", t.TempDir())
	t.Setenv("KIRA_INSECURE_SECRETS", "1") // this sandbox is Linux; force the available fallback

	db, err := storage.Open()
	if err != nil {
		t.Fatalf("storage.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	now := "2026-01-01T00:00:00.000Z"
	if _, err := db.Exec(
		`INSERT INTO connections (id, name, kind, color, mode, read_only, created_at, updated_at, sort_order)
		 VALUES ('c1', 'c1', 'postgres', 'blue', 'fields', 0, ?, ?, 0)`,
		now, now,
	); err != nil {
		t.Fatalf("seed connection: %v", err)
	}

	cipher := secrets.New()
	if !cipher.Status().Available {
		t.Fatalf("cipher unavailable: %+v", cipher.Status())
	}

	sr := repos.NewSecrets(db.DB, cipher)
	secret := "hunter2"
	if err := sr.Set("c1", &secret); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err := sr.Get("c1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil || *got != secret {
		t.Errorf("Get() = %v, want %q", got, secret)
	}
}
