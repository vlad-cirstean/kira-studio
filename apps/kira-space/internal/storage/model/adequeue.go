package model

import "fmt"

// AdeBranchKindMine/Review/Parked are ade_branches.kind's own CHECK constraint values (P129 Part 2
// §2.1) — §0.11: AddBranch defaults to Mine when the tip commit's author is the local git user,
// else Review; SetBranchMeta only ever toggles between Mine and Parked.
const (
	AdeBranchKindMine   = "mine"
	AdeBranchKindReview = "review"
	AdeBranchKindParked = "parked"
)

// ValidAdeBranchKind mirrors ade_branches.kind's own CHECK constraint.
func ValidAdeBranchKind(v string) bool {
	switch v {
	case AdeBranchKindMine, AdeBranchKindReview, AdeBranchKindParked:
		return true
	default:
		return false
	}
}

// AdeBranch is one row of `ade_branches` (P129 Part 2 §2.1) — a queued branch's own meta: kind,
// title override, links, estimate, notes (Markdown), and lifecycle timestamps. Keyed
// (CodeRepoID, Branch), never a synthetic id — a branch's own short name is stable, and git's own
// ban on `:` inside a ref name keeps it from ever colliding with a new-work id ("nw:<uuid>").
type AdeBranch struct {
	CodeRepoID string `json:"codeRepoId"`
	Branch     string `json:"branch"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	DraftTitle string `json:"draftTitle"`
	StartFrom  string `json:"startFrom"`
	JiraKey    string `json:"jiraKey"`
	JiraURL    string `json:"jiraUrl"`
	PrURL      string `json:"prUrl"`
	Est        string `json:"est"`
	Notes      string `json:"notes"`
	AddedAt    int64  `json:"addedAt"`
	HadCommits bool   `json:"hadCommits"`
	MergedAt   *int64 `json:"mergedAt,omitempty"`
	ArchivedAt *int64 `json:"archivedAt,omitempty"`
}

// Validate asserts the identity/shape fields no SQL constraint covers by itself, the same
// discipline AdeSession.Validate already follows.
func (b AdeBranch) Validate() error {
	if b.CodeRepoID == "" {
		return fmt.Errorf("model: ade branch: codeRepoId is required")
	}
	if b.Branch == "" {
		return fmt.Errorf("model: ade branch: branch is required")
	}
	if !ValidAdeBranchKind(b.Kind) {
		return fmt.Errorf("model: ade branch %q: invalid kind %q", b.Branch, b.Kind)
	}
	return nil
}

// AdeNewWork is one row of `ade_new_work` (P129 Part 2 §0.10) — a piece of work with no branch
// yet. CHECK (title <> ” OR jira_key <> ”) mirrors the table's own constraint so a caller catches
// the mistake before the DB does.
type AdeNewWork struct {
	ID         string `json:"id"`
	CodeRepoID string `json:"codeRepoId"`
	Title      string `json:"title"`
	JiraKey    string `json:"jiraKey"`
	JiraURL    string `json:"jiraUrl"`
	StartFrom  string `json:"startFrom"`
	Notes      string `json:"notes"`
	Est        string `json:"est"`
	// BranchName is Part 4's own optional name typed at launch (§0.10 rule 1: bind that name once
	// the branch exists).
	BranchName string `json:"branchName"`
	CreatedAt  int64  `json:"createdAt"`
	ArchivedAt *int64 `json:"archivedAt,omitempty"`
}

func (w AdeNewWork) Validate() error {
	if w.ID == "" {
		return fmt.Errorf("model: ade new work: id is required")
	}
	if w.CodeRepoID == "" {
		return fmt.Errorf("model: ade new work %q: codeRepoId is required", w.ID)
	}
	if w.Title == "" && w.JiraKey == "" {
		return fmt.Errorf("model: ade new work %q: title or jiraKey is required", w.ID)
	}
	return nil
}

// AdePlanRow is one row of `ade_plan` — an item's day bucket, position within it, and optional
// queued-after override. Day nil means "Later" (the table's own NULL).
type AdePlanRow struct {
	CodeRepoID  string  `json:"codeRepoId"`
	Item        string  `json:"item"`
	Day         *string `json:"day,omitempty"`
	Position    int     `json:"position"`
	QueuedAfter string  `json:"queuedAfter"`
}

// AdeColor is one row of `ade_colors` — an item's assigned slot (0-19, §0.13), assigned once and
// never reassigned; archiving an item keeps its row (history keeps the color).
type AdeColor struct {
	CodeRepoID string `json:"codeRepoId"`
	Item       string `json:"item"`
	Slot       int    `json:"slot"`
}

// AdeBranchMetaPatch is SetBranchMeta's own patch shape (§5.3) — pointer fields, present only when
// the caller means to change them. Kind is only ever "mine"/"parked" here (§0.11) — SetBranchMeta
// never turns a branch back into "review".
type AdeBranchMetaPatch struct {
	Name    *string `json:"name,omitempty"`
	Kind    *string `json:"kind,omitempty"`
	JiraKey *string `json:"jiraKey,omitempty"`
	JiraURL *string `json:"jiraUrl,omitempty"`
	PrURL   *string `json:"prUrl,omitempty"`
	Est     *string `json:"est,omitempty"`
	Notes   *string `json:"notes,omitempty"`
}

// AdeNewWorkPatch is UpdateNewWork's own patch shape (§5.3).
type AdeNewWorkPatch struct {
	Title      *string `json:"title,omitempty"`
	JiraKey    *string `json:"jiraKey,omitempty"`
	JiraURL    *string `json:"jiraUrl,omitempty"`
	StartFrom  *string `json:"startFrom,omitempty"`
	Notes      *string `json:"notes,omitempty"`
	Est        *string `json:"est,omitempty"`
	BranchName *string `json:"branchName,omitempty"`
}
