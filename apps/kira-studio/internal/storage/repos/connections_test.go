package repos_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/repos"
)

// TestThrottlePerSecRoundTrips is P28 §7's storage-tier check: 0005_p28_throttle.sql applies on a
// fresh DB (newRepos runs every migration for real, P52 §13) and the new column round-trips
// through both Insert and Update, not just the zero value a naive ALTER TABLE default could mask.
func TestThrottlePerSecRoundTrips(t *testing.T) {
	connRepo := &repos.ConnectionsRepo{DB: newRepos(t).DB}

	fields := model.ConnectionFields{
		Name: "throttled", Kind: "postgres", Color: "blue", Mode: "fields",
		Options: map[string]any{}, ThrottlePerSec: 2.5,
	}
	created, err := connRepo.Insert("conn-throttle", fields, model.NowISO())
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if created.ThrottlePerSec != 2.5 {
		t.Errorf("Insert result ThrottlePerSec = %v, want 2.5", created.ThrottlePerSec)
	}

	got, err := connRepo.Get("conn-throttle")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil || got.ThrottlePerSec != 2.5 {
		t.Fatalf("Get().ThrottlePerSec = %v, want 2.5", got)
	}

	fields.ThrottlePerSec = 0
	updated, err := connRepo.Update("conn-throttle", fields, model.NowISO())
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.ThrottlePerSec != 0 {
		t.Errorf("Update result ThrottlePerSec = %v, want 0", updated.ThrottlePerSec)
	}

	// A connection created before this column existed is exactly what the migration's own
	// NOT NULL DEFAULT 0 covers — every row this suite creates already goes through the ALTER
	// TABLE, so a connection with no explicit ThrottlePerSec set is the closest in-suite
	// equivalent.
	defaulted, err := connRepo.Insert("conn-throttle-default", model.ConnectionFields{
		Name: "unthrottled", Kind: "postgres", Color: "blue", Mode: "fields", Options: map[string]any{},
	}, model.NowISO())
	if err != nil {
		t.Fatalf("Insert (default): %v", err)
	}
	if defaulted.ThrottlePerSec != 0 {
		t.Errorf("default ThrottlePerSec = %v, want 0", defaulted.ThrottlePerSec)
	}
}
