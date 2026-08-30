package bridge_test

import (
	"encoding/json"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/kirathecat/kira-studio/shell/internal/bridge"
	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func TestSettingsSetBroadcasts(t *testing.T) {
	// newTestDeps leaves EngineHost nil: this patch never touches cache.l2BudgetMb, so Set must
	// not need a host to succeed.
	deps, _, rec := newTestDeps(t)
	svc := &bridge.SettingsService{Deps: deps}

	rowDensity := "compact"
	merged, err := svc.Set(bridge.SettingsSetArgs{
		Patch: model.SettingsPatch{Appearance: &model.AppearancePatch{RowDensity: &rowDensity}},
	})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}

	got := rec.all()
	if len(got) != 1 {
		t.Fatalf("got %d emissions, want exactly 1", len(got))
	}
	if got[0].name != bridge.ChannelSettingsChanged {
		t.Errorf("emission name = %q, want %q", got[0].name, bridge.ChannelSettingsChanged)
	}
	if diff := cmp.Diff(merged, got[0].data); diff != "" {
		t.Errorf("broadcast settings mismatch (-returned +broadcast):\n%s", diff)
	}
}

func TestSettingsSetPushesCacheConfigOnlyWhenBudgetChanges(t *testing.T) {
	deps, _, host := newTestDepsWithHost(t)
	svc := &bridge.SettingsService{Deps: deps}

	requestCount := func() int {
		payload, err := host.Call("fixture:request-count", map[string]any{"op": "cache:configure"})
		if err != nil {
			t.Fatalf("fixture:request-count: %v", err)
		}
		var got struct {
			Count int `json:"count"`
		}
		if err := json.Unmarshal(payload, &got); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return got.Count
	}

	rowDensity := "compact"
	if _, err := svc.Set(bridge.SettingsSetArgs{
		Patch: model.SettingsPatch{Appearance: &model.AppearancePatch{RowDensity: &rowDensity}},
	}); err != nil {
		t.Fatalf("Set (no cache patch): %v", err)
	}
	if got := requestCount(); got != 0 {
		t.Errorf("cache:configure called %d times for a patch without cache.l2BudgetMb, want 0", got)
	}

	budget := 128
	if _, err := svc.Set(bridge.SettingsSetArgs{
		Patch: model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: &budget}},
	}); err != nil {
		t.Fatalf("Set (cache patch): %v", err)
	}
	if got := requestCount(); got != 1 {
		t.Errorf("cache:configure called %d times for a patch with cache.l2BudgetMb, want exactly 1", got)
	}
}

func TestSettingsSetReturnsMerged(t *testing.T) {
	deps, _, _ := newTestDeps(t)
	svc := &bridge.SettingsService{Deps: deps}

	fontSize := 16
	merged, err := svc.Set(bridge.SettingsSetArgs{
		Patch: model.SettingsPatch{Appearance: &model.AppearancePatch{FontSize: &fontSize}},
	})
	if err != nil {
		t.Fatalf("Set: %v", err)
	}

	fresh, err := svc.GetAll()
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if diff := cmp.Diff(fresh, merged); diff != "" {
		t.Errorf("Set()'s return value differs from a fresh GetAll() (-GetAll +Set):\n%s", diff)
	}
}
