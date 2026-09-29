package model

import (
	"fmt"
	"strings"
)

// AdeBranchKindMine/Review/Parked are ade_branches.kind's own CHECK constraint values (P129 Part 2
// §2.1) — §0.11: AddBranch defaults to Mine when the tip commit's author is the local git user,
// else Review; SetBranchMeta only ever toggles between Mine and Parked. SetWorkType (P136) is the
// one path into Review after add.
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

// AdeWorkType* are the user-chosen work types (P136), ade_branches.work_type's CHECK values.
// Investigate and Work pair with kind mine/parked; Review and Test pair with kind review.
const (
	AdeWorkTypeWork        = "work"
	AdeWorkTypeInvestigate = "investigate"
	AdeWorkTypeReview      = "review"
	AdeWorkTypeTest        = "test"
)

// ValidAdeWorkType mirrors ade_branches.work_type's own CHECK constraint.
func ValidAdeWorkType(v string) bool {
	switch v {
	case AdeWorkTypeWork, AdeWorkTypeInvestigate, AdeWorkTypeReview, AdeWorkTypeTest:
		return true
	default:
		return false
	}
}

// ValidAdeNewWorkType mirrors ade_new_work.work_type's own CHECK: a draft has no owner to review.
func ValidAdeNewWorkType(v string) bool {
	return v == AdeWorkTypeWork || v == AdeWorkTypeInvestigate
}

// DefaultAdeWorkType is the work type a freshly added item of kind gets.
func DefaultAdeWorkType(kind string) string {
	if kind == AdeBranchKindReview {
		return AdeWorkTypeReview
	}
	return AdeWorkTypeWork
}

// AdeWorkTypeFitsKind is the kind/work-type invariant: review and test pair with kind review,
// work and investigate with mine or parked.
func AdeWorkTypeFitsKind(workType, kind string) bool {
	if kind == AdeBranchKindReview {
		return workType == AdeWorkTypeReview || workType == AdeWorkTypeTest
	}
	return workType == AdeWorkTypeWork || workType == AdeWorkTypeInvestigate
}

// AdeBranch is one row of `ade_branches` (P129 Part 2 §2.1) — a queued branch's own meta: kind,
// title override, links, estimate, notes (Markdown), and lifecycle timestamps. Keyed
// (CodeRepoID, Branch), never a synthetic id — a branch's own short name is stable, and git's own
// ban on `:` inside a ref name keeps it from ever colliding with a new-work id ("nw:<uuid>").
type AdeBranch struct {
	CodeRepoID string `json:"codeRepoId"`
	Branch     string `json:"branch"`
	Kind       string `json:"kind"`
	WorkType   string `json:"workType"`
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
	if !ValidAdeWorkType(b.WorkType) || !AdeWorkTypeFitsKind(b.WorkType, b.Kind) {
		return fmt.Errorf("model: ade branch %q: work type %q does not fit kind %q", b.Branch, b.WorkType, b.Kind)
	}
	return nil
}

// AdeNewWork is one row of `ade_new_work` (P129 Part 2 §0.10) — a piece of work with no branch
// yet. The constraint
//
//	CHECK (title <> '' OR jira_key <> '')
//
// is mirrored here so a caller catches the mistake before the DB does.
type AdeNewWork struct {
	ID         string `json:"id"`
	CodeRepoID string `json:"codeRepoId"`
	Title      string `json:"title"`
	WorkType   string `json:"workType"`
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
	if !ValidAdeNewWorkType(w.WorkType) {
		return fmt.Errorf("model: ade new work %q: invalid work type %q", w.ID, w.WorkType)
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

// AdeDependency is one row of `ade_dependencies` (P135 §4.1/§0) — an external wait with no branch,
// no git facts, no plan row and no colour slot. Id "dep:" || uuid, so it never collides with a
// branch name or a "nw:" new-work id.
type AdeDependency struct {
	ID         string  `json:"id"`
	CodeRepoID string  `json:"codeRepoId"`
	Title      string  `json:"title"`
	WaitingOn  string  `json:"waitingOn"`
	ExpectedBy *string `json:"expectedBy,omitempty"`
	CreatedAt  int64   `json:"createdAt"`
	ResolvedAt *int64  `json:"resolvedAt,omitempty"`
}

// Validate asserts the identity/shape fields no SQL constraint covers by itself.
func (d AdeDependency) Validate() error {
	if d.CodeRepoID == "" {
		return fmt.Errorf("model: ade dependency: codeRepoId is required")
	}
	if !strings.HasPrefix(d.ID, "dep:") {
		return fmt.Errorf("model: ade dependency: id %q must have the dep: prefix", d.ID)
	}
	if d.Title == "" {
		return fmt.Errorf("model: ade dependency %q: title is required", d.ID)
	}
	return nil
}

// AdeBlocker is one row of `ade_blockers` — a (dependency, item) link. Item is a branch name or a
// "nw:" new-work id; no FK (two possible target tables), checked in the repo layer instead.
type AdeBlocker struct {
	CodeRepoID string `json:"codeRepoId"`
	Dependency string `json:"dependency"`
	Item       string `json:"item"`
}

// AdeDependencyPatch is UpdateDependency's own patch shape (§4.2) — pointer fields, present only
// when the caller means to change them. ExpectedBy of "" writes NULL (clears the date).
type AdeDependencyPatch struct {
	Title      *string `json:"title,omitempty"`
	WaitingOn  *string `json:"waitingOn,omitempty"`
	ExpectedBy *string `json:"expectedBy,omitempty"`
}
