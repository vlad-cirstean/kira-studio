package appstorage

import "encoding/json"

// IsJSONObject reports whether raw is valid JSON whose top-level value is an object — both apps'
// own storage/model.TabRecord require their own `state` column to round-trip a Record<...>-shaped
// value, never a bare array or scalar.
func IsJSONObject(raw []byte) bool {
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return false
	}
	_, ok := v.(map[string]any)
	return ok
}
