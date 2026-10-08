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

	"github.com/kirathecat/kira-studio/internal/palette"
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

// CustomScript mirrors packages/shared/domain/scripts.ts's customScriptSchema: one custom_scripts
// row, listed in the Terminal module's Quick commands panel.
type CustomScript struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
	// CollectionID is nil for an ungrouped command.
	CollectionID *string `json:"collectionId"`
	SortOrder    int     `json:"sortOrder"`
	CreatedAt    string  `json:"createdAt"`
	UpdatedAt    string  `json:"updatedAt"`
}

// Collection mirrors packages/shared/domain/scripts.ts's scriptCollectionSchema: one
// custom_script_collections row, the group a quick command lives under.
type Collection struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

// Snapshot is the whole panel state: List answers it and every mutation broadcasts it.
type Snapshot struct {
	Collections []Collection   `json:"collections"`
	Scripts     []CustomScript `json:"scripts"`
}

// CustomScriptFields is what Create/Update accept (customScriptFieldsSchema).
type CustomScriptFields struct {
	Name       string `json:"name"`
	Command    string `json:"command"`
	WorkingDir string `json:"workingDir"`
	Color      string `json:"color"`
	// CollectionID groups the command in the panel; nil means ungrouped.
	CollectionID *string `json:"collectionId"`
}

// Validate is the complete rule set: the Go check is the authority, the mirrored zod schema is
// only the dialog's affordance. A pointer receiver: name and command are trimmed in
// place (leading/trailing only) so Create/Update persist the trimmed values.
func (f *CustomScriptFields) Validate() error {
	f.Name = strings.TrimSpace(f.Name)
	f.Command = strings.TrimSpace(f.Command)
	if f.Name == "" {
		return invalid("quickcommands: name is required")
	}
	if f.Command == "" {
		return invalid("quickcommands: command is required")
	}
	if f.WorkingDir != "" && !filepath.IsAbs(f.WorkingDir) {
		return invalid("quickcommands: working directory must be an absolute path")
	}
	if !palette.Valid(f.Color) {
		return invalid("quickcommands: invalid colour")
	}
	return nil
}

// validCollectionName trims name and enforces non-empty and MaxCollectionRunes.
func validCollectionName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", invalid("quickcommands: collection name is required")
	}
	if utf8.RuneCountInString(name) > MaxCollectionRunes {
		return "", invalid("quickcommands: collection name is too long")
	}
	return name, nil
}
