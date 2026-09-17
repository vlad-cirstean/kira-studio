package model

import (
	"fmt"
	"path/filepath"
	"strings"
)

// CustomScript mirrors packages/shared/domain/scripts.ts's customScriptSchema — one custom_scripts
// row (P85 §8.1): a user-configured launch target shown in the tab strip's "+" dropdown.
type CustomScript struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
	SortOrder  int    `json:"sortOrder"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// CustomScriptFields is what CustomScriptsRepo.Create/Update accept — mirrors
// customScriptFieldsSchema, the same "Fields struct omits id/timestamps/order" shape
// MaskRuleFields uses relative to MaskRule.
type CustomScriptFields struct {
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
}

// Validate is P85 §10.3's complete rule set — the Go check is the authority, the mirrored zod
// schema is only the dialog's own affordance. A pointer receiver: name/command are trimmed in
// place (leading/trailing only — never the interior) so the caller's own fields are what
// Create/Update actually persist, matching "stored trimmed" in the plan.
func (f *CustomScriptFields) Validate() error {
	f.Name = strings.TrimSpace(f.Name)
	f.Command = strings.TrimSpace(f.Command)
	if f.Name == "" {
		return fmt.Errorf("model: custom script: name is required")
	}
	if f.Command == "" {
		return fmt.Errorf("model: custom script: command is required")
	}
	if f.WorkingDir != "" && !filepath.IsAbs(f.WorkingDir) {
		return fmt.Errorf("model: custom script: working directory must be an absolute path")
	}
	if !ValidPaletteColor(f.Color) {
		return fmt.Errorf("model: custom script: invalid colour")
	}
	return nil
}
