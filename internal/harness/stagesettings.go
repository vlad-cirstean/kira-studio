package harness

import (
	"strconv"
	"strings"
)

// StageSettingKind is a stage setting's value type. Only int exists today.
type StageSettingKind string

const StageSettingInt StageSettingKind = "int"

// StageSetting is one setting a provider takes per workflow stage. Key is the YAML and wire key.
type StageSetting struct {
	Key      string
	Kind     StageSettingKind
	Min, Max int
	// LabelKey and HintKey are i18n message keys; HintKey takes {min} and {max}.
	LabelKey, HintKey string
}

// StageValues are one provider's validated values, key to canonical text; nil or empty is provider default.
type StageValues map[string]string

// Parse returns the canonical value of v, false when v is not valid for s.
func (s StageSetting) Parse(v string) (string, bool) {
	if s.Kind != StageSettingInt {
		return "", false
	}
	n, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || n < s.Min || n > s.Max {
		return "", false
	}
	return strconv.Itoa(n), true
}
