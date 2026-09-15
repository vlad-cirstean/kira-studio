package model

import "fmt"

// CodeRepo is one row of `code_repos` (C5 §3.1) — a repository this app has imported into the
// native code workspace, distinct from a `connections` row (D1: it carries none of that table's
// sixteen fields but `name`).
type CodeRepo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Root      string `json:"root"`
	RepoID    string `json:"repoId"`
	SortOrder int    `json:"sortOrder"`
	CreatedAt string `json:"createdAt"`
	// McpEnabled is P67d's own per-repository grant: whether this repository is servable to an MCP
	// client while the Code intelligence server is running. Defaults to false for every existing
	// and future row — nothing is exposed until a user grants it explicitly.
	McpEnabled bool `json:"mcpEnabled"`
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
	return nil
}
