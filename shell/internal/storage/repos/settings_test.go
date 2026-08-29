package repos_test

import (
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestSettingsGetAllDefaults(t *testing.T) {
	r := newSettingsRepo(t)
	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if diff := cmp.Diff(model.DefaultSettings(), got); diff != "" {
		t.Errorf("GetAll() on empty db (-want +got):\n%s", diff)
	}
}

func TestSettingsGetAllPerLeafFallback(t *testing.T) {
	r := newSettingsRepo(t)
	if _, err := r.DB.Exec(`INSERT INTO settings (key, value) VALUES ('appearance.fontSize', '99')`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	got, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	want := model.DefaultSettings()
	want.Appearance.FontSize = 99
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("GetAll() with one seeded leaf (-want +got):\n%s", diff)
	}
}

func ptrTo[T any](v T) *T { return &v }

func TestSettingsSetRoundTrip(t *testing.T) {
	r := newSettingsRepo(t)
	got, err := r.Set(model.SettingsPatch{
		Cache: &model.CachePatch{L2BudgetMb: ptrTo(128)},
	})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}
	want := model.DefaultSettings()
	want.Cache.L2BudgetMb = 128
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("Set() result (-want +got):\n%s", diff)
	}

	got2, err := r.GetAll()
	if err != nil {
		t.Fatalf("GetAll after Set: %v", err)
	}
	if diff := cmp.Diff(want, got2); diff != "" {
		t.Errorf("GetAll() after Set (-want +got):\n%s", diff)
	}
}

func TestSettingsSetWritesOnlyPatchedLeaves(t *testing.T) {
	r := newSettingsRepo(t)
	if _, err := r.Set(model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: ptrTo(128)}}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	var count int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM settings`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Errorf("settings row count after one-leaf Set = %d, want 1", count)
	}
}

func TestSettingsGetAllDropsInvalidStoredLeaves(t *testing.T) {
	tests := []struct {
		name string
		key  string
		val  string
	}{
		{"invalid rowDensity", "appearance.rowDensity", `"banana"`},
		{"invalid l2BudgetMb", "cache.l2BudgetMb", `2000`},
		{"invalid pageSize", "data.defaultPageSize", `"12"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := newSettingsRepo(t)
			if _, err := r.DB.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)`, tt.key, tt.val); err != nil {
				t.Fatalf("seed: %v", err)
			}
			got, err := r.GetAll()
			if err != nil {
				t.Fatalf("GetAll: %v", err)
			}
			if diff := cmp.Diff(model.DefaultSettings(), got); diff != "" {
				t.Errorf("GetAll() with invalid leaf %s (-want default +got):\n%s", tt.key, diff)
			}
		})
	}
}

func TestSettingsSetRejectsOutOfRangePatches(t *testing.T) {
	r := newSettingsRepo(t)
	_, err := r.Set(model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: ptrTo(99999)}})
	if err == nil {
		t.Error("Set with out-of-range l2BudgetMb = nil error, want an error")
	}
}
