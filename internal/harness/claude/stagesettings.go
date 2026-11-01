package claude

import "github.com/kirathecat/kira-studio/internal/harness"

// SettingAutoCompactWindow is the stage setting mapped onto --autocompact.
const SettingAutoCompactWindow = "auto_compact_window"

// Bounds of --autocompact in tokens (Claude Code 2.1.316).
const (
	autoCompactMin = 100_000
	autoCompactMax = 1_000_000
)

// StageSettings: one per-stage setting, the auto compact window.
func (*Provider) StageSettings() []harness.StageSetting {
	return []harness.StageSetting{{
		Key:      SettingAutoCompactWindow,
		Kind:     harness.StageSettingInt,
		Min:      autoCompactMin,
		Max:      autoCompactMax,
		LabelKey: "backend.space.ade.stageSettings.autoCompactWindow.label",
		HintKey:  "backend.space.ade.stageSettings.autoCompactWindow.hint",
	}}
}

// stageArgs maps validated stage values onto CLI words, each passed through quote. Unknown keys are
// ignored: parse validates them.
func stageArgs(v harness.StageValues, quote func(string) string) []string {
	if n := v[SettingAutoCompactWindow]; n != "" {
		return []string{"--autocompact", quote(n)}
	}
	return nil
}
