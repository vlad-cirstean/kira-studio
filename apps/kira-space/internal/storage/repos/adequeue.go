package repos

import (
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/sqlitex"
)

// ErrQueued/ErrArchived are AddBranch/Rebind/BindNewWork's own sentinel errors (P129 Part 2 §2.2) —
// bridge maps both to E_INVALID. This app has no unarchive (§0.15), so ErrArchived also covers a
// once-archived branch's own id being reused.
var (
	ErrQueued   = errors.New("repos: item is already queued")
	ErrArchived = errors.New("repos: item has already been archived")
	// ErrNotBlockable is SetBlocker's own sentinel (P135 §4.2) — the target item is not a live
	// mine/parked branch or live new work (a review branch, an archived item, or another dependency).
	ErrNotBlockable = errors.New("repos: item cannot be blocked")
	// ErrDependencyGone is UpdateDependency/ResolveDependency/SetBlocker's own sentinel — the
	// dependency id does not exist, or was already resolved.
	ErrDependencyGone = errors.New("repos: dependency not found, or already resolved")
	// ErrEstimateShrink is SetBranchMeta/UpdateNewWork's own sentinel (P135 §6.2) — once an estimate
	// is set, a patch may only grow it (same unit).
	ErrEstimateShrink = errors.New("repos: estimate can only grow once set")
	// ErrWorkTypeBlocked is SetWorkType's own sentinel (P136 §3.3) — a blocked item cannot become
	// review or test (checkBlockable never lets a review item be blocked).
	ErrWorkTypeBlocked = errors.New("repos: unlink its dependencies before marking it review or test")
	// ErrReviewNotesOnly is SetBranchMeta's own sentinel — a review branch only takes notes.
	ErrReviewNotesOnly = errors.New("repos: a review branch only takes notes")
	// ErrWorkTypeInvalid is SetWorkType's own sentinel — new work has no owner to review or test.
	ErrWorkTypeInvalid = errors.New("repos: new work can only be to work or to investigate")
)

// maxColorSlots is §0.13's own slot count (0-19).
const maxColorSlots = 20

const adeBranchColumns = `code_repo_id, branch, kind, work_type, name, draft_title, start_from, jira_key, jira_url, pr_url, est, notes, added_at, had_commits, merged_at, archived_at`
const adeNewWorkColumns = `id, code_repo_id, title, work_type, jira_key, jira_url, start_from, notes, est, branch_name, created_at, archived_at`
const adePlanColumns = `code_repo_id, item, day, position, queued_after`
const adeColorColumns = `code_repo_id, item, slot`
const adeDependencyColumns = `id, code_repo_id, title, waiting_on, expected_by, created_at, resolved_at`
const adeBlockerColumns = `code_repo_id, dependency, item`

// AdeQueueState is Load's own return shape — every row of all six ade_* tables for one repo, read
// in one transaction.
type AdeQueueState struct {
	Branches     []model.AdeBranch
	NewWork      []model.AdeNewWork
	Plan         []model.AdePlanRow
	Colors       []model.AdeColor
	Dependencies []model.AdeDependency
	Blockers     []model.AdeBlocker
}

// AdeQueueRepo reads and writes ade_branches/ade_new_work/ade_plan/ade_colors (P129 Part 2 §2.2) —
// one repo, one concern (the queue): rebind, archive, add-with-color and plan edits each need a
// transaction spanning tables.
type AdeQueueRepo struct {
	DB *sql.DB
}

func scanAdeBranchRow(row rowScanner) (model.AdeBranch, error) {
	var b model.AdeBranch
	var hadCommits int
	var mergedAt, archivedAt sql.NullInt64
	if err := row.Scan(
		&b.CodeRepoID, &b.Branch, &b.Kind, &b.WorkType, &b.Name, &b.DraftTitle, &b.StartFrom, &b.JiraKey,
		&b.JiraURL, &b.PrURL, &b.Est, &b.Notes, &b.AddedAt, &hadCommits, &mergedAt, &archivedAt,
	); err != nil {
		return model.AdeBranch{}, err
	}
	b.HadCommits = hadCommits != 0
	if mergedAt.Valid {
		v := mergedAt.Int64
		b.MergedAt = &v
	}
	if archivedAt.Valid {
		v := archivedAt.Int64
		b.ArchivedAt = &v
	}
	return b, nil
}

func scanAdeNewWorkRow(row rowScanner) (model.AdeNewWork, error) {
	var w model.AdeNewWork
	var archivedAt sql.NullInt64
	if err := row.Scan(
		&w.ID, &w.CodeRepoID, &w.Title, &w.WorkType, &w.JiraKey, &w.JiraURL, &w.StartFrom, &w.Notes, &w.Est,
		&w.BranchName, &w.CreatedAt, &archivedAt,
	); err != nil {
		return model.AdeNewWork{}, err
	}
	if archivedAt.Valid {
		v := archivedAt.Int64
		w.ArchivedAt = &v
	}
	return w, nil
}

func scanAdePlanRow(row rowScanner) (model.AdePlanRow, error) {
	var p model.AdePlanRow
	var day sql.NullString
	if err := row.Scan(&p.CodeRepoID, &p.Item, &day, &p.Position, &p.QueuedAfter); err != nil {
		return model.AdePlanRow{}, err
	}
	if day.Valid {
		v := day.String
		p.Day = &v
	}
	return p, nil
}

func scanAdeColorRow(row rowScanner) (model.AdeColor, error) {
	var c model.AdeColor
	if err := row.Scan(&c.CodeRepoID, &c.Item, &c.Slot); err != nil {
		return model.AdeColor{}, err
	}
	return c, nil
}

func scanAdeDependencyRow(row rowScanner) (model.AdeDependency, error) {
	var d model.AdeDependency
	var expectedBy sql.NullString
	var resolvedAt sql.NullInt64
	if err := row.Scan(&d.ID, &d.CodeRepoID, &d.Title, &d.WaitingOn, &expectedBy, &d.CreatedAt, &resolvedAt); err != nil {
		return model.AdeDependency{}, err
	}
	if expectedBy.Valid {
		v := expectedBy.String
		d.ExpectedBy = &v
	}
	if resolvedAt.Valid {
		v := resolvedAt.Int64
		d.ResolvedAt = &v
	}
	return d, nil
}

func scanAdeBlockerRow(row rowScanner) (model.AdeBlocker, error) {
	var b model.AdeBlocker
	if err := row.Scan(&b.CodeRepoID, &b.Dependency, &b.Item); err != nil {
		return model.AdeBlocker{}, err
	}
	return b, nil
}

// Load reads every row of all four tables for codeRepoID, in one read transaction — Queue.Snapshot's
// own first step.
func (r *AdeQueueRepo) Load(codeRepoID string) (AdeQueueState, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: begin ade queue load: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	branchRows, err := tx.Query(`SELECT `+adeBranchColumns+` FROM ade_branches WHERE code_repo_id = ?`, codeRepoID)
	branches, err := sqlitex.QueryAll(branchRows, err, func(rows *sql.Rows) (model.AdeBranch, bool, error) {
		b, err := scanAdeBranchRow(rows)
		return b, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade branches: %w", err)
	}

	newWorkRows, err := tx.Query(`SELECT `+adeNewWorkColumns+` FROM ade_new_work WHERE code_repo_id = ?`, codeRepoID)
	newWork, err := sqlitex.QueryAll(newWorkRows, err, func(rows *sql.Rows) (model.AdeNewWork, bool, error) {
		w, err := scanAdeNewWorkRow(rows)
		return w, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade new work: %w", err)
	}

	planRows, err := tx.Query(`SELECT `+adePlanColumns+` FROM ade_plan WHERE code_repo_id = ?`, codeRepoID)
	plan, err := sqlitex.QueryAll(planRows, err, func(rows *sql.Rows) (model.AdePlanRow, bool, error) {
		p, err := scanAdePlanRow(rows)
		return p, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade plan: %w", err)
	}

	colorRows, err := tx.Query(`SELECT `+adeColorColumns+` FROM ade_colors WHERE code_repo_id = ?`, codeRepoID)
	colors, err := sqlitex.QueryAll(colorRows, err, func(rows *sql.Rows) (model.AdeColor, bool, error) {
		c, err := scanAdeColorRow(rows)
		return c, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade colors: %w", err)
	}

	depRows, err := tx.Query(`SELECT `+adeDependencyColumns+` FROM ade_dependencies WHERE code_repo_id = ?`, codeRepoID)
	dependencies, err := sqlitex.QueryAll(depRows, err, func(rows *sql.Rows) (model.AdeDependency, bool, error) {
		d, err := scanAdeDependencyRow(rows)
		return d, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade dependencies: %w", err)
	}

	blockerRows, err := tx.Query(`SELECT `+adeBlockerColumns+` FROM ade_blockers WHERE code_repo_id = ?`, codeRepoID)
	blockers, err := sqlitex.QueryAll(blockerRows, err, func(rows *sql.Rows) (model.AdeBlocker, bool, error) {
		b, err := scanAdeBlockerRow(rows)
		return b, true, err
	})
	if err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: load ade blockers: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return AdeQueueState{}, fmt.Errorf("repos: commit ade queue load: %w", err)
	}
	return AdeQueueState{
		Branches: branches, NewWork: newWork, Plan: plan, Colors: colors,
		Dependencies: dependencies, Blockers: blockers,
	}, nil
}

// checkNotQueuedOrArchived refuses AddBranch/Rebind/BindNewWork for a branch id already present in
// ade_branches — ErrQueued when it is a live (non-archived) row, ErrArchived when it was archived
// (this app has no unarchive, §0.15).
func checkNotQueuedOrArchived(tx *sql.Tx, codeRepoID, branch string) error {
	var archivedAt sql.NullInt64
	err := tx.QueryRow(
		`SELECT archived_at FROM ade_branches WHERE code_repo_id = ? AND branch = ?`, codeRepoID, branch,
	).Scan(&archivedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil
	case err != nil:
		return fmt.Errorf("repos: check ade branch %s: %w", branch, err)
	case archivedAt.Valid:
		return ErrArchived
	default:
		return ErrQueued
	}
}

// checkBlockable is SetBlocker's own eligibility check (P135 §4.2): item must be a live
// (non-archived) mine/parked branch, or live new work. A review branch (someone else's, read-only
// here), an archived item, or another dependency all fail.
func checkBlockable(tx *sql.Tx, codeRepoID, item string) error {
	var kind string
	var archivedAt sql.NullInt64
	err := tx.QueryRow(
		`SELECT kind, archived_at FROM ade_branches WHERE code_repo_id = ? AND branch = ?`, codeRepoID, item,
	).Scan(&kind, &archivedAt)
	switch {
	case err == nil:
		if archivedAt.Valid || kind == model.AdeBranchKindReview {
			return ErrNotBlockable
		}
		return nil
	case !errors.Is(err, sql.ErrNoRows):
		return fmt.Errorf("repos: check ade blockable %s: %w", item, err)
	}

	err = tx.QueryRow(
		`SELECT archived_at FROM ade_new_work WHERE code_repo_id = ? AND id = ?`, codeRepoID, item,
	).Scan(&archivedAt)
	switch {
	case err == nil:
		if archivedAt.Valid {
			return ErrNotBlockable
		}
		return nil
	case errors.Is(err, sql.ErrNoRows):
		return ErrNotBlockable
	default:
		return fmt.Errorf("repos: check ade blockable %s: %w", item, err)
	}
}

// checkDependencyLive confirms id names a still-live (unresolved) dependency.
func checkDependencyLive(tx *sql.Tx, codeRepoID, id string) error {
	var resolvedAt sql.NullInt64
	err := tx.QueryRow(
		`SELECT resolved_at FROM ade_dependencies WHERE code_repo_id = ? AND id = ?`, codeRepoID, id,
	).Scan(&resolvedAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return ErrDependencyGone
	case err != nil:
		return fmt.Errorf("repos: check ade dependency %s: %w", id, err)
	case resolvedAt.Valid:
		return ErrDependencyGone
	default:
		return nil
	}
}

// assignColorSlot picks §0.13's own slot for a newly queued item, inside the caller's transaction:
// the first slot 0..19 no non-archived item in this repo currently uses, else the slot used by the
// fewest items overall (archived rows included — a reused slot's own history), ties broken by the
// lowest slot number. A direct SQL-driven duplicate of internal/ade/facts.go's own pure colorSlot,
// not a shared import: storage/repos is a leaf package internal/ade already depends on, so the
// reverse import is unavailable (CLAUDE.md's layering rule) — colorSlot's pure twin is what
// facts_test.go exercises for the algorithm itself.
func assignColorSlot(tx *sql.Tx, codeRepoID string) (int, error) {
	rows, err := tx.Query(`
		SELECT c.slot, b.branch, b.archived_at, w.id, w.archived_at
		FROM ade_colors c
		LEFT JOIN ade_branches b ON b.code_repo_id = c.code_repo_id AND b.branch = c.item
		LEFT JOIN ade_new_work w ON w.code_repo_id = c.code_repo_id AND w.id = c.item
		WHERE c.code_repo_id = ?`, codeRepoID)
	if err != nil {
		return 0, fmt.Errorf("repos: query ade colors: %w", err)
	}
	defer rows.Close()

	usedByVisible := make(map[int]bool)
	countBySlot := make(map[int]int)
	for rows.Next() {
		var slot int
		var branch, newWorkID sql.NullString
		var branchArchived, newWorkArchived sql.NullInt64
		if err := rows.Scan(&slot, &branch, &branchArchived, &newWorkID, &newWorkArchived); err != nil {
			return 0, fmt.Errorf("repos: scan ade color: %w", err)
		}
		if !branch.Valid && !newWorkID.Valid {
			continue // a dangling color row (its own item row is gone) counts toward nothing.
		}
		countBySlot[slot]++
		if !branchArchived.Valid && !newWorkArchived.Valid {
			usedByVisible[slot] = true
		}
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("repos: ade colors rows: %w", err)
	}

	for slot := 0; slot < maxColorSlots; slot++ {
		if !usedByVisible[slot] {
			return slot, nil
		}
	}
	best, bestCount := 0, -1
	for slot := 0; slot < maxColorSlots; slot++ {
		if bestCount == -1 || countBySlot[slot] < bestCount {
			best, bestCount = slot, countBySlot[slot]
		}
	}
	return best, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// AddBranch inserts a new queued branch plus its color assignment in one transaction (§0.13).
// Already queued: ErrQueued. Previously archived: ErrArchived (no unarchive, §0.15).
func (r *AdeQueueRepo) AddBranch(codeRepoID string, b model.AdeBranch) (int, error) {
	if err := b.Validate(); err != nil {
		return 0, fmt.Errorf("repos: %w", err)
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("repos: begin add ade branch: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := checkNotQueuedOrArchived(tx, codeRepoID, b.Branch); err != nil {
		return 0, err
	}
	slot, err := assignColorSlot(tx, codeRepoID)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		`INSERT INTO ade_branches (code_repo_id, branch, kind, work_type, name, draft_title, start_from, jira_key, jira_url, pr_url, est, notes, added_at, had_commits, merged_at, archived_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
		codeRepoID, b.Branch, b.Kind, b.WorkType, b.Name, b.DraftTitle, b.StartFrom, b.JiraKey, b.JiraURL,
		b.PrURL, b.Est, b.Notes, b.AddedAt, boolToInt(b.HadCommits),
	); err != nil {
		return 0, fmt.Errorf("repos: insert ade branch %s: %w", b.Branch, err)
	}
	if _, err := tx.Exec(`INSERT INTO ade_colors (code_repo_id, item, slot) VALUES (?, ?, ?)`, codeRepoID, b.Branch, slot); err != nil {
		return 0, fmt.Errorf("repos: insert ade color %s: %w", b.Branch, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("repos: commit add ade branch %s: %w", b.Branch, err)
	}
	return slot, nil
}

// AddNewWork inserts a new-work row plus its color assignment in one transaction — new-work ids are
// always freshly minted (uuid), so no queued/archived pre-check is needed.
func (r *AdeQueueRepo) AddNewWork(w model.AdeNewWork) (int, error) {
	if err := w.Validate(); err != nil {
		return 0, fmt.Errorf("repos: %w", err)
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return 0, fmt.Errorf("repos: begin add ade new work: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	slot, err := assignColorSlot(tx, w.CodeRepoID)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(
		`INSERT INTO ade_new_work (id, code_repo_id, title, work_type, jira_key, jira_url, start_from, notes, est, branch_name, created_at, archived_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		w.ID, w.CodeRepoID, w.Title, w.WorkType, w.JiraKey, w.JiraURL, w.StartFrom, w.Notes, w.Est, w.BranchName, w.CreatedAt,
	); err != nil {
		return 0, fmt.Errorf("repos: insert ade new work %s: %w", w.ID, err)
	}
	if _, err := tx.Exec(`INSERT INTO ade_colors (code_repo_id, item, slot) VALUES (?, ?, ?)`, w.CodeRepoID, w.ID, slot); err != nil {
		return 0, fmt.Errorf("repos: insert ade color %s: %w", w.ID, err)
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("repos: commit add ade new work %s: %w", w.ID, err)
	}
	return slot, nil
}

// checkEstExtends is UpdateNewWork/SetBranchMeta's own guard (P135 §6.2): once an estimate is set,
// a patch may only grow it, same unit. Unit is fixed — no h/d ratio to reconcile.
func checkEstExtends(old, next string) error {
	if old == "" {
		return nil
	}
	if next == "" || next[len(next)-1] != old[len(old)-1] {
		return ErrEstimateShrink
	}
	o, _ := strconv.ParseFloat(old[:len(old)-1], 64)
	n, _ := strconv.ParseFloat(next[:len(next)-1], 64)
	if n < o {
		return ErrEstimateShrink
	}
	return nil
}

// execEstGuarded runs updateSQL in a transaction after checking checkEstExtends against the row's
// current est (read with selectSQL) — the shared body UpdateNewWork/SetBranchMeta's own Est-patch
// branch each call into.
func execEstGuarded(db *sql.DB, selectSQL string, selectArgs []any, newEst, updateSQL string, updateArgs []any, label string) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin %s: %w", label, err)
	}
	defer tx.Rollback() //nolint:errcheck

	var old string
	if err := tx.QueryRow(selectSQL, selectArgs...).Scan(&old); err != nil {
		return fmt.Errorf("repos: select est for %s: %w", label, err)
	}
	if err := checkEstExtends(old, newEst); err != nil {
		return err
	}
	res, err := tx.Exec(updateSQL, updateArgs...)
	if err != nil {
		return fmt.Errorf("repos: %s: %w", label, err)
	}
	if err := sqlitex.RequireOneRow(res, label); err != nil {
		return err
	}
	return tx.Commit()
}

// UpdateNewWork writes only the leaves the caller actually patched.
func (r *AdeQueueRepo) UpdateNewWork(codeRepoID, id string, patch model.AdeNewWorkPatch) error {
	var sets []string
	var args []any
	if patch.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *patch.Title)
	}
	if patch.JiraKey != nil {
		sets = append(sets, "jira_key = ?")
		args = append(args, *patch.JiraKey)
	}
	if patch.JiraURL != nil {
		sets = append(sets, "jira_url = ?")
		args = append(args, *patch.JiraURL)
	}
	if patch.StartFrom != nil {
		sets = append(sets, "start_from = ?")
		args = append(args, *patch.StartFrom)
	}
	if patch.Notes != nil {
		sets = append(sets, "notes = ?")
		args = append(args, *patch.Notes)
	}
	if patch.Est != nil {
		sets = append(sets, "est = ?")
		args = append(args, *patch.Est)
	}
	if patch.BranchName != nil {
		sets = append(sets, "branch_name = ?")
		args = append(args, *patch.BranchName)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, codeRepoID, id)
	updateSQL := `UPDATE ade_new_work SET ` + strings.Join(sets, ", ") + ` WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL`
	if patch.Est != nil {
		return execEstGuarded(r.DB, `SELECT est FROM ade_new_work WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL`, []any{codeRepoID, id}, *patch.Est,
			updateSQL, args, "ade new work "+id)
	}
	res, err := r.DB.Exec(updateSQL, args...)
	if err != nil {
		return fmt.Errorf("repos: update ade new work %s: %w", id, err)
	}
	return sqlitex.RequireOneRow(res, "ade new work "+id)
}

// SetBranchMeta writes only the leaves the caller actually patched — review's own "keep your own
// notes" rule: a review branch's patch is limited to Notes (ErrReviewNotesOnly).
func (r *AdeQueueRepo) SetBranchMeta(codeRepoID, branch string, patch model.AdeBranchMetaPatch) error {
	if patch.Name != nil || patch.Kind != nil || patch.JiraKey != nil || patch.JiraURL != nil || patch.PrURL != nil || patch.Est != nil {
		var kind string
		err := r.DB.QueryRow(`SELECT kind FROM ade_branches WHERE code_repo_id = ? AND branch = ?`, codeRepoID, branch).Scan(&kind)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("repos: read ade branch kind %s: %w", branch, err)
		}
		if kind == model.AdeBranchKindReview {
			return ErrReviewNotesOnly
		}
	}
	var sets []string
	var args []any
	if patch.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *patch.Name)
	}
	if patch.Kind != nil {
		sets = append(sets, "kind = ?", "work_type = CASE WHEN work_type IN ('review', 'test') THEN 'work' ELSE work_type END")
		args = append(args, *patch.Kind)
	}
	if patch.JiraKey != nil {
		sets = append(sets, "jira_key = ?")
		args = append(args, *patch.JiraKey)
	}
	if patch.JiraURL != nil {
		sets = append(sets, "jira_url = ?")
		args = append(args, *patch.JiraURL)
	}
	if patch.PrURL != nil {
		sets = append(sets, "pr_url = ?")
		args = append(args, *patch.PrURL)
	}
	if patch.Est != nil {
		sets = append(sets, "est = ?")
		args = append(args, *patch.Est)
	}
	if patch.Notes != nil {
		sets = append(sets, "notes = ?")
		args = append(args, *patch.Notes)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, codeRepoID, branch)
	updateSQL := `UPDATE ade_branches SET ` + strings.Join(sets, ", ") + ` WHERE code_repo_id = ? AND branch = ?`
	if patch.Est != nil {
		return execEstGuarded(r.DB, `SELECT est FROM ade_branches WHERE code_repo_id = ? AND branch = ?`,
			[]any{codeRepoID, branch}, *patch.Est, updateSQL, args, "ade branch "+branch)
	}
	res, err := r.DB.Exec(updateSQL, args...)
	if err != nil {
		return fmt.Errorf("repos: set ade branch meta %s: %w", branch, err)
	}
	return sqlitex.RequireOneRow(res, "ade branch "+branch)
}

// SetWorkType sets an item's user-chosen work type and derives its kind (P136 §3.3): review/test
// make a branch kind review, work/investigate make it mine (parked stays parked). New work only
// takes work/investigate. Refuses review/test while the item has blocker links.
func (r *AdeQueueRepo) SetWorkType(codeRepoID, item, workType string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin set ade work type: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if strings.HasPrefix(item, "nw:") {
		if !model.ValidAdeNewWorkType(workType) {
			return ErrWorkTypeInvalid
		}
		res, err := tx.Exec(
			`UPDATE ade_new_work SET work_type = ? WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL`,
			workType, codeRepoID, item,
		)
		if err != nil {
			return fmt.Errorf("repos: set ade new work type %s: %w", item, err)
		}
		if err := sqlitex.RequireOneRow(res, "ade new work "+item); err != nil {
			return err
		}
		return commitSetWorkType(tx, item)
	}

	var oldKind string
	err = tx.QueryRow(
		`SELECT kind FROM ade_branches WHERE code_repo_id = ? AND branch = ? AND archived_at IS NULL`, codeRepoID, item,
	).Scan(&oldKind)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return fmt.Errorf("sqlitex: no ade branch %s", item)
	case err != nil:
		return fmt.Errorf("repos: read ade branch kind %s: %w", item, err)
	}
	kind := model.AdeBranchKindReview
	if workType == model.AdeWorkTypeWork || workType == model.AdeWorkTypeInvestigate {
		kind = model.AdeBranchKindMine
		if oldKind == model.AdeBranchKindParked {
			kind = model.AdeBranchKindParked
		}
	}
	if kind == model.AdeBranchKindReview && oldKind != model.AdeBranchKindReview {
		var one int
		err := tx.QueryRow(`SELECT 1 FROM ade_blockers WHERE code_repo_id = ? AND item = ? LIMIT 1`, codeRepoID, item).Scan(&one)
		switch {
		case err == nil:
			return ErrWorkTypeBlocked
		case !errors.Is(err, sql.ErrNoRows):
			return fmt.Errorf("repos: check ade blockers %s: %w", item, err)
		}
	}
	if _, err := tx.Exec(
		`UPDATE ade_branches SET kind = ?, work_type = ? WHERE code_repo_id = ? AND branch = ?`,
		kind, workType, codeRepoID, item,
	); err != nil {
		return fmt.Errorf("repos: set ade work type %s: %w", item, err)
	}
	return commitSetWorkType(tx, item)
}

func commitSetWorkType(tx *sql.Tx, item string) error {
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit set ade work type %s: %w", item, err)
	}
	return nil
}

// SetPlan upserts each patched item's day and rewrites every item's position 0..n-1 from order —
// Queue's own plan-drag surface (Part 3+).
func (r *AdeQueueRepo) SetPlan(codeRepoID string, days map[string]*string, order []string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin set ade plan: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	for item, day := range days {
		if _, err := tx.Exec(
			`INSERT INTO ade_plan (code_repo_id, item, day, position, queued_after) VALUES (?, ?, ?, 0, '')
			 ON CONFLICT(code_repo_id, item) DO UPDATE SET day = excluded.day`,
			codeRepoID, item, day,
		); err != nil {
			return fmt.Errorf("repos: set ade plan day %s: %w", item, err)
		}
	}
	for i, item := range order {
		if _, err := tx.Exec(
			`INSERT INTO ade_plan (code_repo_id, item, day, position, queued_after) VALUES (?, ?, NULL, ?, '')
			 ON CONFLICT(code_repo_id, item) DO UPDATE SET position = excluded.position`,
			codeRepoID, item, i,
		); err != nil {
			return fmt.Errorf("repos: set ade plan position %s: %w", item, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit set ade plan: %w", err)
	}
	return nil
}

// SetQueuedAfter upserts one item's own queued-after override ("" clears it).
func (r *AdeQueueRepo) SetQueuedAfter(codeRepoID, item, after string) error {
	if _, err := r.DB.Exec(
		`INSERT INTO ade_plan (code_repo_id, item, day, position, queued_after) VALUES (?, ?, NULL, 0, ?)
		 ON CONFLICT(code_repo_id, item) DO UPDATE SET queued_after = excluded.queued_after`,
		codeRepoID, item, after,
	); err != nil {
		return fmt.Errorf("repos: set ade queued after %s: %w", item, err)
	}
	return nil
}

// MarkFacts idempotently flips had_commits 0->1 and sets merged_at once (never overwritten, §0.8's
// "history day") — Queue.Snapshot's own git-fact write-back.
func (r *AdeQueueRepo) MarkFacts(codeRepoID string, hadCommits []string, merged map[string]int64) error {
	if len(hadCommits) == 0 && len(merged) == 0 {
		return nil
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin mark ade facts: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	for _, branch := range hadCommits {
		if _, err := tx.Exec(
			`UPDATE ade_branches SET had_commits = 1 WHERE code_repo_id = ? AND branch = ? AND had_commits = 0`,
			codeRepoID, branch,
		); err != nil {
			return fmt.Errorf("repos: mark ade branch had commits %s: %w", branch, err)
		}
	}
	for branch, at := range merged {
		if _, err := tx.Exec(
			`UPDATE ade_branches SET merged_at = ? WHERE code_repo_id = ? AND branch = ? AND merged_at IS NULL`,
			at, codeRepoID, branch,
		); err != nil {
			return fmt.Errorf("repos: mark ade branch merged %s: %w", branch, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit mark ade facts: %w", err)
	}
	return nil
}

// Archive sets item's own archived_at (on whichever of ade_branches/ade_new_work owns it), deletes
// its ade_plan row, and clears any other item's queued_after pointing at it.
func (r *AdeQueueRepo) Archive(codeRepoID, item string, at int64) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin archive ade item %s: %w", item, err)
	}
	defer tx.Rollback() //nolint:errcheck

	branchRes, err := tx.Exec(
		`UPDATE ade_branches SET archived_at = ? WHERE code_repo_id = ? AND branch = ? AND archived_at IS NULL`,
		at, codeRepoID, item,
	)
	if err != nil {
		return fmt.Errorf("repos: archive ade branch %s: %w", item, err)
	}
	branchN, err := branchRes.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: archive ade branch %s rows affected: %w", item, err)
	}
	if branchN == 0 {
		newWorkRes, err := tx.Exec(
			`UPDATE ade_new_work SET archived_at = ? WHERE code_repo_id = ? AND id = ? AND archived_at IS NULL`,
			at, codeRepoID, item,
		)
		if err != nil {
			return fmt.Errorf("repos: archive ade new work %s: %w", item, err)
		}
		newWorkN, err := newWorkRes.RowsAffected()
		if err != nil {
			return fmt.Errorf("repos: archive ade new work %s rows affected: %w", item, err)
		}
		if newWorkN == 0 {
			return fmt.Errorf("repos: archive ade item %s: not found, or already archived", item)
		}
	}
	if _, err := tx.Exec(`DELETE FROM ade_plan WHERE code_repo_id = ? AND item = ?`, codeRepoID, item); err != nil {
		return fmt.Errorf("repos: archive ade item %s: delete plan row: %w", item, err)
	}
	if _, err := tx.Exec(
		`UPDATE ade_plan SET queued_after = '' WHERE code_repo_id = ? AND queued_after = ?`, codeRepoID, item,
	); err != nil {
		return fmt.Errorf("repos: archive ade item %s: clear queued after: %w", item, err)
	}
	if _, err := tx.Exec(`DELETE FROM ade_blockers WHERE code_repo_id = ? AND item = ?`, codeRepoID, item); err != nil {
		return fmt.Errorf("repos: archive ade item %s: delete blockers: %w", item, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit archive ade item %s: %w", item, err)
	}
	return nil
}

// Rebind is §6.4's own transaction: a new-work row becomes a real ade_branches row once its agent's
// branch exists, carrying its title into draft_title, its links/notes/estimate across, re-keying its
// plan/color/session rows from "nw:<uuid>" to the branch, then deleting the new-work row. Always
// binds as mine, keeping the new work's own work_type: new work is the user's by construction, and
// the tip author at bind time is just whoever last committed to the start point.
// BindNewWork runs this exact same path for an explicit, already-existing branch (§0.10's ambiguous
// case) — checkNotQueuedOrArchived's ErrQueued/ErrArchived cover "must be unqueued" for both.
func (r *AdeQueueRepo) Rebind(codeRepoID, newWorkID, branch string, now int64) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin rebind %s: %w", newWorkID, err)
	}
	defer tx.Rollback() //nolint:errcheck

	w, err := scanAdeNewWorkRow(tx.QueryRow(`SELECT `+adeNewWorkColumns+` FROM ade_new_work WHERE code_repo_id = ? AND id = ?`, codeRepoID, newWorkID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("repos: rebind: new work %s not found", newWorkID)
		}
		return fmt.Errorf("repos: rebind: read new work %s: %w", newWorkID, err)
	}

	if err := checkNotQueuedOrArchived(tx, codeRepoID, branch); err != nil {
		return err
	}

	if _, err := tx.Exec(
		`INSERT INTO ade_branches (code_repo_id, branch, kind, work_type, name, draft_title, start_from, jira_key, jira_url, pr_url, est, notes, added_at, had_commits, merged_at, archived_at)
		 VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, '', ?, ?, ?, 0, NULL, NULL)`,
		codeRepoID, branch, model.AdeBranchKindMine, w.WorkType, w.Title, w.StartFrom, w.JiraKey, w.JiraURL, w.Est, w.Notes, now,
	); err != nil {
		return fmt.Errorf("repos: rebind: insert ade branch %s: %w", branch, err)
	}
	if _, err := tx.Exec(`UPDATE ade_plan SET item = ? WHERE code_repo_id = ? AND item = ?`, branch, codeRepoID, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: rekey ade plan: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_colors SET item = ? WHERE code_repo_id = ? AND item = ?`, branch, codeRepoID, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: rekey ade colors: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_plan SET queued_after = ? WHERE code_repo_id = ? AND queued_after = ?`, branch, codeRepoID, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: rekey queued after: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_sessions SET branch = ?, new_work_id = '' WHERE new_work_id = ?`, branch, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: rekey ade sessions: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_blockers SET item = ? WHERE code_repo_id = ? AND item = ?`, branch, codeRepoID, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: rekey ade blockers: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM ade_new_work WHERE code_repo_id = ? AND id = ?`, codeRepoID, newWorkID); err != nil {
		return fmt.Errorf("repos: rebind: delete new work %s: %w", newWorkID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit rebind %s: %w", newWorkID, err)
	}
	return nil
}

// AddDependency inserts a new dependency row plus its blocker links, in one transaction. Each
// entry of blocks must pass checkBlockable, or the whole call fails.
func (r *AdeQueueRepo) AddDependency(d model.AdeDependency, blocks []string) error {
	if err := d.Validate(); err != nil {
		return fmt.Errorf("repos: %w", err)
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin add ade dependency: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck

	if _, err := tx.Exec(
		`INSERT INTO ade_dependencies (id, code_repo_id, title, waiting_on, expected_by, created_at, resolved_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL)`,
		d.ID, d.CodeRepoID, d.Title, d.WaitingOn, d.ExpectedBy, d.CreatedAt,
	); err != nil {
		return fmt.Errorf("repos: insert ade dependency %s: %w", d.ID, err)
	}
	for _, item := range blocks {
		if err := checkBlockable(tx, d.CodeRepoID, item); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO ade_blockers (code_repo_id, dependency, item) VALUES (?, ?, ?)`,
			d.CodeRepoID, d.ID, item,
		); err != nil {
			return fmt.Errorf("repos: insert ade blocker %s/%s: %w", d.ID, item, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit add ade dependency %s: %w", d.ID, err)
	}
	return nil
}

// UpdateDependency writes only the leaves the caller actually patched, and only onto a still-live
// dependency. ExpectedBy of "" writes NULL (clears the date).
func (r *AdeQueueRepo) UpdateDependency(codeRepoID, id string, patch model.AdeDependencyPatch) error {
	var sets []string
	var args []any
	if patch.Title != nil {
		sets = append(sets, "title = ?")
		args = append(args, *patch.Title)
	}
	if patch.WaitingOn != nil {
		sets = append(sets, "waiting_on = ?")
		args = append(args, *patch.WaitingOn)
	}
	if patch.ExpectedBy != nil {
		if *patch.ExpectedBy == "" {
			sets = append(sets, "expected_by = NULL")
		} else {
			sets = append(sets, "expected_by = ?")
			args = append(args, *patch.ExpectedBy)
		}
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, codeRepoID, id)
	res, err := r.DB.Exec(
		`UPDATE ade_dependencies SET `+strings.Join(sets, ", ")+` WHERE code_repo_id = ? AND id = ? AND resolved_at IS NULL`,
		args...,
	)
	if err != nil {
		return fmt.Errorf("repos: update ade dependency %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: update ade dependency %s rows affected: %w", id, err)
	}
	if n == 0 {
		return ErrDependencyGone
	}
	return nil
}

// ResolveDependency sets resolved_at and deletes the dependency's own blocker links — the
// lifecycle end (§4.2): no confirmation, no "unresolve".
func (r *AdeQueueRepo) ResolveDependency(codeRepoID, id string, now int64) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin resolve ade dependency %s: %w", id, err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := checkDependencyLive(tx, codeRepoID, id); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`UPDATE ade_dependencies SET resolved_at = ? WHERE code_repo_id = ? AND id = ?`, now, codeRepoID, id,
	); err != nil {
		return fmt.Errorf("repos: resolve ade dependency %s: %w", id, err)
	}
	if _, err := tx.Exec(
		`DELETE FROM ade_blockers WHERE code_repo_id = ? AND dependency = ?`, codeRepoID, id,
	); err != nil {
		return fmt.Errorf("repos: resolve ade dependency %s: delete blockers: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit resolve ade dependency %s: %w", id, err)
	}
	return nil
}

// SetBlocker links or unlinks dependency to item. Linking re-checks both that the dependency is
// still live and that item is still blockable; unlinking is unconditional (a link removal never
// fails on eligibility).
func (r *AdeQueueRepo) SetBlocker(codeRepoID, dependency, item string, linked bool) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin set ade blocker %s/%s: %w", dependency, item, err)
	}
	defer tx.Rollback() //nolint:errcheck

	if err := checkDependencyLive(tx, codeRepoID, dependency); err != nil {
		return err
	}
	if linked {
		if err := checkBlockable(tx, codeRepoID, item); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT OR IGNORE INTO ade_blockers (code_repo_id, dependency, item) VALUES (?, ?, ?)`,
			codeRepoID, dependency, item,
		); err != nil {
			return fmt.Errorf("repos: link ade blocker %s/%s: %w", dependency, item, err)
		}
	} else {
		if _, err := tx.Exec(
			`DELETE FROM ade_blockers WHERE code_repo_id = ? AND dependency = ? AND item = ?`,
			codeRepoID, dependency, item,
		); err != nil {
			return fmt.Errorf("repos: unlink ade blocker %s/%s: %w", dependency, item, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit set ade blocker %s/%s: %w", dependency, item, err)
	}
	return nil
}
