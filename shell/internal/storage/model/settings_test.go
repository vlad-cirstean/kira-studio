package model_test

import (
	"testing"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

func ptr[T any](v T) *T { return &v }

func TestSettingsPatchValidate(t *testing.T) {
	tests := []struct {
		name    string
		patch   model.SettingsPatch
		wantErr bool
	}{
		{"empty patch is valid", model.SettingsPatch{}, false},
		{"valid rowDensity", model.SettingsPatch{Appearance: &model.AppearancePatch{RowDensity: ptr("compact")}}, false},
		{"invalid rowDensity", model.SettingsPatch{Appearance: &model.AppearancePatch{RowDensity: ptr("banana")}}, true},
		{"valid pageSize", model.SettingsPatch{Data: &model.DataPatch{DefaultPageSize: ptr(1000)}}, false},
		{"invalid pageSize", model.SettingsPatch{Data: &model.DataPatch{DefaultPageSize: ptr(12)}}, true},
		{"valid l2BudgetMb", model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: ptr(128)}}, false},
		{"l2BudgetMb too low", model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: ptr(4)}}, true},
		{"l2BudgetMb too high", model.SettingsPatch{Cache: &model.CachePatch{L2BudgetMb: ptr(2048)}}, true},
		{"valid engineMemoryCapMb", model.SettingsPatch{Advanced: &model.AdvancedPatch{EngineMemoryCapMb: ptr(1024)}}, false},
		{"engineMemoryCapMb too low", model.SettingsPatch{Advanced: &model.AdvancedPatch{EngineMemoryCapMb: ptr(128)}}, true},
		{"engineMemoryCapMb too high", model.SettingsPatch{Advanced: &model.AdvancedPatch{EngineMemoryCapMb: ptr(8192)}}, true},
		{"valid opLogRetentionDays", model.SettingsPatch{Advanced: &model.AdvancedPatch{OpLogRetentionDays: ptr(90)}}, false},
		{"opLogRetentionDays too low", model.SettingsPatch{Advanced: &model.AdvancedPatch{OpLogRetentionDays: ptr(0)}}, true},
		{"opLogRetentionDays too high", model.SettingsPatch{Advanced: &model.AdvancedPatch{OpLogRetentionDays: ptr(400)}}, true},
		{"fontFamily unbounded", model.SettingsPatch{Appearance: &model.AppearancePatch{FontFamily: ptr("anything")}}, false},
		{"fontSize unbounded", model.SettingsPatch{Appearance: &model.AppearancePatch{FontSize: ptr(999)}}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.patch.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestValidRowDensity(t *testing.T) {
	for _, v := range []string{"compact", "comfortable"} {
		if !model.ValidRowDensity(v) {
			t.Errorf("ValidRowDensity(%q) = false, want true", v)
		}
	}
	if model.ValidRowDensity("banana") {
		t.Error("ValidRowDensity(banana) = true, want false")
	}
}

func TestValidPageSize(t *testing.T) {
	for _, v := range []int{10, 100, 1000, 10000} {
		if !model.ValidPageSize(v) {
			t.Errorf("ValidPageSize(%d) = false, want true", v)
		}
	}
	for _, v := range []int{0, 12, 99999} {
		if model.ValidPageSize(v) {
			t.Errorf("ValidPageSize(%d) = true, want false", v)
		}
	}
}
