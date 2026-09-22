package appsettings

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

// UpsertLeaf mirrors both apps' own upsertSettingsLeaf verbatim — the settings table's own
// per-leaf-row upsert (`${section}.${key}`, never a blob per section), so a row written before a
// key existed still parses on the next read (P52 §4.3).
func UpsertLeaf(tx *sql.Tx, key string, value any) error {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("appsettings: encode %s: %w", key, err)
	}
	if _, err := tx.Exec(
		`INSERT INTO settings (key, value) VALUES (?, ?)
		   ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		key, string(encoded),
	); err != nil {
		return fmt.Errorf("appsettings: upsert %s: %w", key, err)
	}
	return nil
}

// UpsertAppearance mirrors both apps' own former upsertAppearanceSection verbatim.
func UpsertAppearance(tx *sql.Tx, a *AppearancePatch) error {
	if a == nil {
		return nil
	}
	if a.FontFamily != nil {
		if err := UpsertLeaf(tx, "appearance.fontFamily", *a.FontFamily); err != nil {
			return err
		}
	}
	if a.FontSize != nil {
		if err := UpsertLeaf(tx, "appearance.fontSize", *a.FontSize); err != nil {
			return err
		}
	}
	if a.RowDensity != nil {
		if err := UpsertLeaf(tx, "appearance.rowDensity", *a.RowDensity); err != nil {
			return err
		}
	}
	if a.WordWrap != nil {
		if err := UpsertLeaf(tx, "appearance.wordWrap", *a.WordWrap); err != nil {
			return err
		}
	}
	if a.RowColoring != nil {
		if err := UpsertLeaf(tx, "appearance.rowColoring", *a.RowColoring); err != nil {
			return err
		}
	}
	if a.InlineBlame != nil {
		if err := UpsertLeaf(tx, "appearance.inlineBlame", *a.InlineBlame); err != nil {
			return err
		}
	}
	if a.DateFormat != nil {
		if err := UpsertLeaf(tx, "appearance.dateFormat", *a.DateFormat); err != nil {
			return err
		}
	}
	return nil
}

// UpsertGit mirrors both apps' own former upsertGitSection verbatim — "git.path" (not
// "git.gitPath") is the stored key for GitPath, matching both apps' own pre-existing row shape.
func UpsertGit(tx *sql.Tx, g *GitPatch) error {
	if g == nil {
		return nil
	}
	if g.ProtectedBranches != nil {
		if err := UpsertLeaf(tx, "git.protectedBranches", *g.ProtectedBranches); err != nil {
			return err
		}
	}
	if g.FetchAutoIntervalMinutes != nil {
		if err := UpsertLeaf(tx, "git.fetchAutoIntervalMinutes", *g.FetchAutoIntervalMinutes); err != nil {
			return err
		}
	}
	if g.GitPath != nil {
		if err := UpsertLeaf(tx, "git.path", *g.GitPath); err != nil {
			return err
		}
	}
	if g.GraphFontSize != nil {
		if err := UpsertLeaf(tx, "git.graphFontSize", *g.GraphFontSize); err != nil {
			return err
		}
	}
	return nil
}

// Leaf mirrors both apps' own former leaf[T] verbatim: overwrites *dst with the stored value for
// key if present, leaving the caller's default in place otherwise. An unparseable stored value is
// a hand-edited or stale-shape row; it is left at its default rather than propagated, the same
// "fail closed to a known-good value" discipline the TS build's zod parse enforces.
func Leaf[T any](stored map[string]json.RawMessage, key string, dst *T) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	*dst = v
}

// LeafValid mirrors both apps' own former leafValid[T]: Leaf plus semantic validation — a stored
// value that parses but fails valid falls back to the default too.
func LeafValid[T any](stored map[string]json.RawMessage, key string, dst *T, valid func(T) bool) {
	raw, ok := stored[key]
	if !ok {
		return
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return
	}
	if !valid(v) {
		return
	}
	*dst = v
}

// AlwaysValid mirrors both apps' own former alwaysValid[T] — appearance.fontSize's own "no bound
// in the TS schema either" validator.
func AlwaysValid[T any](T) bool { return true }

// ReadAppearance reads every appearance.* leaf from stored on top of DefaultAppearance(), mirroring
// both apps' own former GetAll's appearance.* block verbatim.
func ReadAppearance(stored map[string]json.RawMessage) Appearance {
	result := DefaultAppearance()
	Leaf(stored, "appearance.fontFamily", &result.FontFamily)
	LeafValid(stored, "appearance.fontSize", &result.FontSize, AlwaysValid[int])
	LeafValid(stored, "appearance.rowDensity", &result.RowDensity, ValidRowDensity)
	Leaf(stored, "appearance.wordWrap", &result.WordWrap)
	Leaf(stored, "appearance.rowColoring", &result.RowColoring)
	Leaf(stored, "appearance.inlineBlame", &result.InlineBlame)
	LeafValid(stored, "appearance.dateFormat", &result.DateFormat, ValidDateFormat)
	return result
}

// ReadGit reads every git.* leaf from stored on top of DefaultGit(), mirroring both apps' own
// former GetAll's git.* block verbatim.
func ReadGit(stored map[string]json.RawMessage) Git {
	result := DefaultGit()
	Leaf(stored, "git.protectedBranches", &result.ProtectedBranches)
	LeafValid(stored, "git.fetchAutoIntervalMinutes", &result.FetchAutoIntervalMinutes, validFetchAutoIntervalMinutes)
	Leaf(stored, "git.path", &result.GitPath)
	LeafValid(stored, "git.graphFontSize", &result.GraphFontSize, validGraphFontSize)
	return result
}
