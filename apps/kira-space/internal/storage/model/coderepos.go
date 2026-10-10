package model

import (
	"fmt"

	"github.com/kirathecat/kira-studio/internal/palette"
)

// CodeRepo is one row of `code_repos` (C5 §3.1) — a repository this app has imported into the
// native code workspace, distinct from a `connections` row (D1: it carries none of that table's
// sixteen fields but `name`).
type CodeRepo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Root      string `json:"root"`
	RepoID    string `json:"repoId"`
	SortOrder int    `json:"sortOrder"`
	Color     string `json:"color"`
	CreatedAt string `json:"createdAt"`
	Hidden    bool   `json:"hidden"`
}

// Validate asserts the identity fields no SQL constraint covers, the same discipline
// TabRecord.Validate already follows.
func (r CodeRepo) Validate() error {
	if r.ID == "" {
		return fmt.Errorf("model: code repo: id is required")
	}
	if r.Name == "" {
		return fmt.Errorf("model: code repo %q: name is required", r.ID)
	}
	if r.Root == "" {
		return fmt.Errorf("model: code repo %q: root is required", r.ID)
	}
	if r.RepoID == "" {
		return fmt.Errorf("model: code repo %q: repoId is required", r.ID)
	}
	if !palette.Valid(r.Color) {
		return fmt.Errorf("model: code repo %q: invalid colour %q", r.ID, r.Color)
	}
	return nil
}
