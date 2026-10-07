// Package quickcommands is the one quick-command (custom_scripts) store and bound surface both
// apps share: the record type and its validation, the SQL repo, and the Wails service each app
// embeds under its own binding name (windowsvc's precedent).
package quickcommands

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// MaxCollectionRunes caps a quick-command collection name.
const MaxCollectionRunes = 64

// ValidationError marks a caller-input failure, answered as E_BAD_REQUEST.
type ValidationError struct{ Msg string }

func (e *ValidationError) Error() string { return e.Msg }

func invalid(format string, args ...any) error {
	return &ValidationError{Msg: fmt.Sprintf(format, args...)}
}

// IsCallerError reports whether err is the caller's fault: a validation failure or an unknown id.
func IsCallerError(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve) || errors.Is(err, sql.ErrNoRows)
}

// paletteColors mirrors packages/shared/domain/color.ts's paletteColorSchema (the whole storable
// set).
var paletteColors = map[string]bool{
	"none": true, "red": true, "orange": true, "amber": true, "olive": true, "green": true,
	"teal": true, "cyan": true, "blue": true, "indigo": true, "violet": true, "magenta": true,
	"grey": true,
}

// CustomScript mirrors packages/shared/domain/scripts.ts's customScriptSchema: one custom_scripts
// row, listed in the Terminal module's Quick commands panel.
type CustomScript struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
	Collection string `json:"collection"`
	SortOrder  int    `json:"sortOrder"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

// CustomScriptFields is what Create/Update accept (customScriptFieldsSchema).
type CustomScriptFields struct {
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
	// Collection groups quick commands in the panel; "" means ungrouped.
	Collection string `json:"collection"`
}

// Validate is the complete rule set: the Go check is the authority, the mirrored zod schema is
// only the dialog's affordance. A pointer receiver: name, command and collection are trimmed in
// place (leading/trailing only) so Create/Update persist the trimmed values.
func (f *CustomScriptFields) Validate() error {
	f.Name = strings.TrimSpace(f.Name)
	f.Command = strings.TrimSpace(f.Command)
	f.Collection = strings.TrimSpace(f.Collection)
	if f.Name == "" {
		return invalid("quickcommands: name is required")
	}
	if f.Command == "" {
		return invalid("quickcommands: command is required")
	}
	if f.WorkingDir != "" && !filepath.IsAbs(f.WorkingDir) {
		return invalid("quickcommands: working directory must be an absolute path")
	}
	if utf8.RuneCountInString(f.Collection) > MaxCollectionRunes {
		return invalid("quickcommands: collection is too long")
	}
	if !paletteColors[f.Color] {
		return invalid("quickcommands: invalid colour")
	}
	return nil
}
