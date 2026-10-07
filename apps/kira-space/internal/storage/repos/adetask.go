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

// Sentinels AdeTaskRepo/AdeBacklogRepo return; bridge maps them to E_INVALID/E_NOT_FOUND.
var (
	ErrTaskNotFound  = errors.New("repos: task not found")
	ErrBranchOnTask  = errors.New("repos: branch is already on a task")
	ErrRepoOnTask    = errors.New("repos: task already has a branch in that repo")
	ErrReviewKind    = errors.New("repos: a task only moves between task and parked, and a review task keeps its kind")
	ErrBranchMissing = errors.New("repos: branch not found")
	ErrBacklogGone   = errors.New("repos: backlog item not found")
	ErrRunNotFound   = errors.New("repos: run not found")
	// ErrBranchNameTaken marks a created-branch name already used by a live branch of the repo.
	ErrBranchNameTaken = errors.New("repos: a live branch in that repo already has that name")
	// ErrEstimateShrink: once an estimate is set, a patch may only grow it (same unit).
	ErrEstimateShrink = errors.New("repos: estimate can only grow once set")
)

// maxColorSlots is the task colour slot count (0-19).
const maxColorSlots = 20

// MaxEstHours and MaxEstDays bound an estimate: a longer one makes the Plan span thousands of days.
const (
	MaxEstHours = 480
	MaxEstDays  = 60
)

// EstOverCap reports an estimate above the bound.
func EstOverCap(est string) bool {
	if est == "" {
		return false
	}
	n, err := strconv.ParseFloat(est[:len(est)-1], 64)
	if err != nil {
		return false
	}
	if est[len(est)-1] == 'h' {
		return n > MaxEstHours
	}
	return n > MaxEstDays
}

// checkEstExtends guards an estimate patch: once set, it may only grow, same unit (h or d). An
// estimate stored above the cap may be replaced by any valid one, so a typo is recoverable.
func checkEstExtends(old, next string) error {
	if old == "" || EstOverCap(old) {
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

const adeTaskColumns = `id, kind, title, owner, jira_key, jira_url, github_url, workflow_id, stage_id, current_stage_json, workflow_json, workflow_hash, est, notes, color, created_at, archived_at`
const adeTaskBranchColumns = `id, task_id, code_repo_id, name, kind, base, queued_after, position, had_commits, added_at, merged_at, archived_at, origin`
const adeRunColumns = `id, task_id, stage_id, step_id, branch_id, attempt, state, loops, note, summary, session_id, exit_code, started_at, finished_at, launch_note, launch_resume_id, launch_prompt, launch_extra`

// AdeTaskRepo reads and writes the v2 task store: tasks, branches, plan, runs, worktree setup and
// last-valid workflows.
type AdeTaskRepo struct {
	DB *sql.DB
}

func nullInt64Ptr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func nullIntPtr(n sql.NullInt64) *int {
	if !n.Valid {
		return nil
	}
	v := int(n.Int64)
	return &v
}

func scanAdeTask(row rowScanner) (model.AdeTask, error) {
	var t model.AdeTask
	var stage, workflow sql.NullString
	var archived sql.NullInt64
	if err := row.Scan(&t.ID, &t.Kind, &t.Title, &t.Owner, &t.JiraKey, &t.JiraURL, &t.GithubURL, &t.WorkflowID,
		&t.StageID, &stage, &workflow, &t.WorkflowHash, &t.Est, &t.Notes, &t.Color, &t.CreatedAt, &archived); err != nil {
		return model.AdeTask{}, err
	}
	t.CurrentStageJSON = stage.String
	t.WorkflowJSON = workflow.String
	t.ArchivedAt = nullInt64Ptr(archived)
	return t, nil
}

func scanAdeTaskBranch(row rowScanner) (model.AdeTaskBranch, error) {
	var b model.AdeTaskBranch
	var had int
	var merged, archived sql.NullInt64
	if err := row.Scan(&b.ID, &b.TaskID, &b.CodeRepoID, &b.Name, &b.Kind, &b.Base, &b.QueuedAfter, &b.Position,
		&had, &b.AddedAt, &merged, &archived, &b.Origin); err != nil {
		return model.AdeTaskBranch{}, err
	}
	b.HadCommits = had != 0
	b.MergedAt = nullInt64Ptr(merged)
	b.ArchivedAt = nullInt64Ptr(archived)
	return b, nil
}

func (r *AdeTaskRepo) queryTasks(query string, args ...any) ([]model.AdeTask, error) {
	rows, err := r.DB.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade tasks: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeTask, 0)
	for rows.Next() {
		t, err := scanAdeTask(rows)
		if err != nil {
			return nil, fmt.Errorf("repos: scan ade task: %w", err)
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade tasks rows: %w", err)
	}
	return out, nil
}

// ListLive returns non-archived tasks in plan order (a task with no plan row sorts last).
func (r *AdeTaskRepo) ListLive() ([]model.AdeTask, error) {
	return r.queryTasks(`SELECT t.id, t.kind, t.title, t.owner, t.jira_key, t.jira_url, t.github_url, t.workflow_id,
		t.stage_id, t.current_stage_json, t.workflow_json, t.workflow_hash, t.est, t.notes, t.color, t.created_at, t.archived_at
		FROM ade_tasks t LEFT JOIN ade_task_plan p ON p.task_id = t.id
		WHERE t.archived_at IS NULL ORDER BY p.position IS NULL, p.position, t.created_at, t.id`)
}

// ListArchived returns archived tasks, newest archive first.
func (r *AdeTaskRepo) ListArchived() ([]model.AdeTask, error) {
	return r.queryTasks(`SELECT ` + adeTaskColumns + ` FROM ade_tasks WHERE archived_at IS NOT NULL ORDER BY archived_at DESC, id`)
}

// GetTask returns one task, live or archived; ErrTaskNotFound if absent.
func (r *AdeTaskRepo) GetTask(id string) (model.AdeTask, error) {
	t, err := scanAdeTask(r.DB.QueryRow(`SELECT `+adeTaskColumns+` FROM ade_tasks WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeTask{}, ErrTaskNotFound
	}
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: get ade task %s: %w", id, err)
	}
	return t, nil
}

// insertTask writes the task, its branches and a plan row at the end (Later), in tx. It assigns
// the task's color: the first slot no live task uses, else the least-used slot overall.
func insertTask(tx *sql.Tx, t model.AdeTask, branches []model.AdeTaskBranch) (model.AdeTask, error) {
	if err := t.Validate(); err != nil {
		return model.AdeTask{}, err
	}
	rows, err := tx.Query(`SELECT color, archived_at IS NULL FROM ade_tasks`)
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: query ade task colors: %w", err)
	}
	visible := make(map[int]bool)
	count := make(map[int]int)
	for rows.Next() {
		var slot int
		var live bool
		if err := rows.Scan(&slot, &live); err != nil {
			rows.Close()
			return model.AdeTask{}, fmt.Errorf("repos: scan ade task color: %w", err)
		}
		count[slot]++
		if live {
			visible[slot] = true
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return model.AdeTask{}, fmt.Errorf("repos: ade task colors rows: %w", err)
	}
	rows.Close()
	t.Color = pickColorSlot(visible, count)

	var stage any
	if t.CurrentStageJSON != "" {
		stage = t.CurrentStageJSON
	}
	if _, err := tx.Exec(`INSERT INTO ade_tasks (id, kind, title, owner, jira_key, jira_url, github_url, workflow_id, stage_id, current_stage_json, est, notes, color, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
		t.ID, t.Kind, t.Title, t.Owner, t.JiraKey, t.JiraURL, t.GithubURL, t.WorkflowID, t.StageID, stage, t.Est,
		t.Notes, t.Color, t.CreatedAt); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: insert ade task %s: %w", t.ID, err)
	}
	for _, b := range branches {
		if err := insertTaskBranch(tx, b); err != nil {
			return model.AdeTask{}, err
		}
	}
	if _, err := tx.Exec(`INSERT INTO ade_task_plan (task_id, day, position)
		SELECT ?, NULL, COALESCE(MAX(position) + 1, 0) FROM ade_task_plan`, t.ID); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: insert ade task plan %s: %w", t.ID, err)
	}
	return t, nil
}

func pickColorSlot(visible map[int]bool, count map[int]int) int {
	for slot := 0; slot < maxColorSlots; slot++ {
		if !visible[slot] {
			return slot
		}
	}
	best, bestCount := 0, -1
	for slot := 0; slot < maxColorSlots; slot++ {
		if bestCount == -1 || count[slot] < bestCount {
			best, bestCount = slot, count[slot]
		}
	}
	return best
}

func insertTaskBranch(tx *sql.Tx, b model.AdeTaskBranch) error {
	if err := b.Validate(); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO ade_task_branches (`+adeTaskBranchColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
		b.ID, b.TaskID, b.CodeRepoID, b.Name, b.Kind, b.Base, b.QueuedAfter, b.Position, boolInt(b.HadCommits), b.AddedAt, b.Origin); err != nil {
		if isUniqueViolation(err) {
			return ErrBranchOnTask
		}
		return fmt.Errorf("repos: insert ade task branch %s: %w", b.ID, err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// CreateTask inserts a task, its branches and a Later plan row at the end in one transaction and
// returns the stored task (color assigned).
func (r *AdeTaskRepo) CreateTask(t model.AdeTask, branches []model.AdeTaskBranch) (model.AdeTask, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: begin create ade task: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	out, err := insertTask(tx, t, branches)
	if err != nil {
		return model.AdeTask{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: commit create ade task: %w", err)
	}
	return out, nil
}

// UpdateTask writes the patched leaves. Est may only grow; kind moves only between task and parked,
// and a review task refuses any kind change.
func (r *AdeTaskRepo) UpdateTask(id string, p model.AdeTaskPatch) (model.AdeTask, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: begin update ade task: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	cur, err := scanAdeTask(tx.QueryRow(`SELECT `+adeTaskColumns+` FROM ade_tasks WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeTask{}, ErrTaskNotFound
	}
	if err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: select ade task %s: %w", id, err)
	}
	prevKind := cur.Kind
	if p.Est != nil {
		if err := checkEstExtends(cur.Est, *p.Est); err != nil {
			return model.AdeTask{}, err
		}
		cur.Est = *p.Est
	}
	if p.Kind != nil && *p.Kind != cur.Kind {
		if cur.Kind == model.AdeTaskKindReview || (*p.Kind != model.AdeTaskKindTask && *p.Kind != model.AdeTaskKindParked) {
			return model.AdeTask{}, ErrReviewKind
		}
		cur.Kind = *p.Kind
	}
	if p.Title != nil {
		cur.Title = *p.Title
	}
	if p.JiraKey != nil {
		cur.JiraKey = *p.JiraKey
	}
	if p.JiraURL != nil {
		cur.JiraURL = *p.JiraURL
	}
	if p.GithubURL != nil {
		cur.GithubURL = *p.GithubURL
	}
	if p.Notes != nil {
		cur.Notes = *p.Notes
	}
	if p.Color != nil {
		if *p.Color < 0 || *p.Color >= maxColorSlots {
			return model.AdeTask{}, fmt.Errorf("repos: color %d out of range", *p.Color)
		}
		cur.Color = *p.Color
	}
	if p.Kind != nil && *p.Kind != prevKind {
		from, to := model.AdeBranchKindMine, model.AdeBranchKindParked
		if *p.Kind == model.AdeTaskKindTask {
			from, to = to, from
		}
		if _, err := tx.Exec(`UPDATE ade_task_branches SET kind = ? WHERE task_id = ? AND kind = ?`, to, id, from); err != nil {
			return model.AdeTask{}, fmt.Errorf("repos: move ade task branches to %s: %w", to, err)
		}
	}
	if _, err := tx.Exec(`UPDATE ade_tasks SET kind = ?, title = ?, jira_key = ?, jira_url = ?, github_url = ?, est = ?, notes = ?, color = ? WHERE id = ?`,
		cur.Kind, cur.Title, cur.JiraKey, cur.JiraURL, cur.GithubURL, cur.Est, cur.Notes, cur.Color, id); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: update ade task %s: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return model.AdeTask{}, fmt.Errorf("repos: commit update ade task %s: %w", id, err)
	}
	return cur, nil
}

// AddBranch appends b to its task after the last branch. A task holds at most one live branch per
// repo (ErrRepoOnTask); a created branch name is unique among live branches of the repo
// (ErrBranchOnTask). b.Position is overwritten.
func (r *AdeTaskRepo) AddBranch(b model.AdeTaskBranch) (model.AdeTaskBranch, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: begin add ade task branch: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM ade_tasks WHERE id = ? AND archived_at IS NULL`, b.TaskID).Scan(&exists); err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: check ade task %s: %w", b.TaskID, err)
	}
	if exists == 0 {
		return model.AdeTaskBranch{}, ErrTaskNotFound
	}
	var same int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM ade_task_branches WHERE task_id = ? AND code_repo_id = ? AND archived_at IS NULL`,
		b.TaskID, b.CodeRepoID).Scan(&same); err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: check ade task repo: %w", err)
	}
	if same > 0 {
		return model.AdeTaskBranch{}, ErrRepoOnTask
	}
	if err := tx.QueryRow(`SELECT COALESCE(MAX(position) + 1, 0) FROM ade_task_branches WHERE task_id = ?`, b.TaskID).Scan(&b.Position); err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: next ade branch position: %w", err)
	}
	if err := insertTaskBranch(tx, b); err != nil {
		return model.AdeTaskBranch{}, err
	}
	if err := tx.Commit(); err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: commit add ade task branch: %w", err)
	}
	return b, nil
}

func (r *AdeTaskRepo) queryBranches(where string) ([]model.AdeTaskBranch, error) {
	rows, err := r.DB.Query(`SELECT b.id, b.task_id, b.code_repo_id, b.name, b.kind, b.base, b.queued_after, b.position,
		b.had_commits, b.added_at, b.merged_at, b.archived_at, b.origin
		FROM ade_task_branches b JOIN ade_tasks t ON t.id = b.task_id WHERE ` + where + ` ORDER BY b.task_id, b.position, b.id`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade task branches: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeTaskBranch, 0)
	for rows.Next() {
		b, err := scanAdeTaskBranch(rows)
		if err != nil {
			return nil, fmt.Errorf("repos: scan ade task branch: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade task branches rows: %w", err)
	}
	return out, nil
}

// BranchesLive returns the non-archived branches of live tasks.
func (r *AdeTaskRepo) BranchesLive() ([]model.AdeTaskBranch, error) {
	return r.queryBranches(`t.archived_at IS NULL AND b.archived_at IS NULL`)
}

// BranchesArchived returns the branches of archived tasks (history).
func (r *AdeTaskRepo) BranchesArchived() ([]model.AdeTaskBranch, error) {
	return r.queryBranches(`t.archived_at IS NOT NULL`)
}

// GetBranch returns one branch by id; ErrBranchMissing if absent.
func (r *AdeTaskRepo) GetBranch(id string) (model.AdeTaskBranch, error) {
	b, err := scanAdeTaskBranch(r.DB.QueryRow(`SELECT `+adeTaskBranchColumns+` FROM ade_task_branches WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeTaskBranch{}, ErrBranchMissing
	}
	if err != nil {
		return model.AdeTaskBranch{}, fmt.Errorf("repos: get ade task branch %s: %w", id, err)
	}
	return b, nil
}

// PlanRows returns every plan row in position order.
func (r *AdeTaskRepo) PlanRows() ([]model.AdeTaskPlanRow, error) {
	rows, err := r.DB.Query(`SELECT task_id, day, position FROM ade_task_plan ORDER BY position, task_id`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade task plan: %w", err)
	}
	defer rows.Close()
	out := make([]model.AdeTaskPlanRow, 0)
	for rows.Next() {
		var p model.AdeTaskPlanRow
		var day sql.NullString
		if err := rows.Scan(&p.TaskID, &day, &p.Position); err != nil {
			return nil, fmt.Errorf("repos: scan ade task plan: %w", err)
		}
		if day.Valid {
			v := day.String
			p.Day = &v
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade task plan rows: %w", err)
	}
	return out, nil
}

// SetPlan rewrites plan positions densely in order (plan rows not in order keep their relative
// position after it) and sets the day of each key in days (nil = Later).
func (r *AdeTaskRepo) SetPlan(order []string, days map[string]*string) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin set ade task plan: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	rows, err := tx.Query(`SELECT task_id FROM ade_task_plan ORDER BY position, task_id`)
	if err != nil {
		return fmt.Errorf("repos: query ade task plan: %w", err)
	}
	inOrder := make(map[string]bool, len(order))
	for _, id := range order {
		inOrder[id] = true
	}
	final := append(make([]string, 0, len(order)), order...)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("repos: scan ade task plan: %w", err)
		}
		if !inOrder[id] {
			final = append(final, id)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return fmt.Errorf("repos: ade task plan rows: %w", err)
	}
	rows.Close()
	for i, id := range final {
		res, err := tx.Exec(`UPDATE ade_task_plan SET position = ? WHERE task_id = ?`, i, id)
		if err != nil {
			return fmt.Errorf("repos: set ade task plan position %s: %w", id, err)
		}
		if err := sqlitex.RequireOneRow(res, "ade task plan row "+id); err != nil {
			return err
		}
	}
	for id, day := range days {
		res, err := tx.Exec(`UPDATE ade_task_plan SET day = ? WHERE task_id = ?`, day, id)
		if err != nil {
			return fmt.Errorf("repos: set ade task plan day %s: %w", id, err)
		}
		if err := sqlitex.RequireOneRow(res, "ade task plan row "+id); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit set ade task plan: %w", err)
	}
	return nil
}

// SetQueuedAfter sets one branch's queued-after branch id ("" clears it).
func (r *AdeTaskRepo) SetQueuedAfter(branchID, after string) error {
	res, err := r.DB.Exec(`UPDATE ade_task_branches SET queued_after = ? WHERE id = ?`, after, branchID)
	if err != nil {
		return fmt.Errorf("repos: set ade queued after %s: %w", branchID, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: set ade queued after %s: %w", branchID, err)
	}
	if n == 0 {
		return ErrBranchMissing
	}
	return nil
}

// MarkBranchFacts idempotently sets had_commits and sets merged_at once (never overwritten).
func (r *AdeTaskRepo) MarkBranchFacts(hadCommits []string, merged map[string]int64) error {
	if len(hadCommits) == 0 && len(merged) == 0 {
		return nil
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin mark ade branch facts: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	for _, id := range hadCommits {
		if _, err := tx.Exec(`UPDATE ade_task_branches SET had_commits = 1 WHERE id = ? AND had_commits = 0`, id); err != nil {
			return fmt.Errorf("repos: mark ade branch had commits %s: %w", id, err)
		}
	}
	for id, at := range merged {
		if _, err := tx.Exec(`UPDATE ade_task_branches SET merged_at = ? WHERE id = ? AND merged_at IS NULL`, at, id); err != nil {
			return fmt.Errorf("repos: mark ade branch merged %s: %w", id, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit mark ade branch facts: %w", err)
	}
	return nil
}

// RunsByLiveTask returns the runs of live (unarchived) tasks grouped by task id, oldest first.
func (r *AdeTaskRepo) RunsByLiveTask() (map[string][]model.AdeRun, error) {
	return r.queryRunsByTask(` WHERE task_id IN (SELECT id FROM ade_tasks WHERE archived_at IS NULL)`)
}

// RunsOfTask returns one task's runs, oldest first.
func (r *AdeTaskRepo) RunsOfTask(taskID string) ([]model.AdeRun, error) {
	by, err := r.queryRunsByTask(` WHERE task_id = ?`, taskID)
	return by[taskID], err
}

func (r *AdeTaskRepo) queryRunsByTask(where string, args ...any) (map[string][]model.AdeRun, error) {
	rows, err := r.DB.Query(`SELECT `+adeRunColumns+` FROM ade_runs`+where+` ORDER BY COALESCE(started_at, 0), id`, args...)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade runs: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]model.AdeRun)
	for rows.Next() {
		run, err := scanAdeRun(rows)
		if err != nil {
			return nil, fmt.Errorf("repos: scan ade run: %w", err)
		}
		out[run.TaskID] = append(out[run.TaskID], run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade runs rows: %w", err)
	}
	return out, nil
}

// SetupByBranch returns every worktree-setup row keyed by branch id.
func (r *AdeTaskRepo) SetupByBranch() (map[string]model.AdeWorktreeSetup, error) {
	rows, err := r.DB.Query(`SELECT branch_id, state, started_at, finished_at, exit_code FROM ade_worktree_setup`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade worktree setup: %w", err)
	}
	defer rows.Close()
	out := make(map[string]model.AdeWorktreeSetup)
	for rows.Next() {
		var s model.AdeWorktreeSetup
		var finished, exit sql.NullInt64
		if err := rows.Scan(&s.BranchID, &s.State, &s.StartedAt, &finished, &exit); err != nil {
			return nil, fmt.Errorf("repos: scan ade worktree setup: %w", err)
		}
		s.FinishedAt, s.ExitCode = nullInt64Ptr(finished), nullIntPtr(exit)
		out[s.BranchID] = s
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade worktree setup rows: %w", err)
	}
	return out, nil
}

// LastValid returns the last valid workflow JSON recorded per file name.
func (r *AdeTaskRepo) LastValid() (map[string]string, error) {
	rows, err := r.DB.Query(`SELECT file_name, workflow_json FROM ade_workflow_last_valid`)
	if err != nil {
		return nil, fmt.Errorf("repos: query ade workflow last valid: %w", err)
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var file, js string
		if err := rows.Scan(&file, &js); err != nil {
			return nil, fmt.Errorf("repos: scan ade workflow last valid: %w", err)
		}
		out[file] = js
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("repos: ade workflow last valid rows: %w", err)
	}
	return out, nil
}

// RecordLastValid upserts the last valid workflow JSON for a file.
func (r *AdeTaskRepo) RecordLastValid(file, workflowJSON string, now int64) error {
	if _, err := r.DB.Exec(`INSERT INTO ade_workflow_last_valid (file_name, workflow_json, recorded_at) VALUES (?, ?, ?)
		ON CONFLICT(file_name) DO UPDATE SET workflow_json = excluded.workflow_json, recorded_at = excluded.recorded_at`,
		file, workflowJSON, now); err != nil {
		return fmt.Errorf("repos: record ade workflow last valid %s: %w", file, err)
	}
	return nil
}

// SetBranchName records the created branch name; ErrBranchNameTaken when a live branch of the repo
// already holds it, ErrBranchMissing when the branch is gone.
func (r *AdeTaskRepo) SetBranchName(id, name string) error {
	res, err := r.DB.Exec(`UPDATE ade_task_branches SET name = ? WHERE id = ?`, name, id)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrBranchNameTaken
		}
		return fmt.Errorf("repos: set ade branch name %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: set ade branch name %s: %w", id, err)
	}
	if n == 0 {
		return ErrBranchMissing
	}
	return nil
}

// SetBranchOrigin marks who made the branch row ("" user, "agent").
func (r *AdeTaskRepo) SetBranchOrigin(id, origin string) error {
	res, err := r.DB.Exec(`UPDATE ade_task_branches SET origin = ? WHERE id = ?`, origin, id)
	if err != nil {
		return fmt.Errorf("repos: set ade branch origin %s: %w", id, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("repos: set ade branch origin %s: %w", id, err)
	}
	if n == 0 {
		return ErrBranchMissing
	}
	return nil
}

// SetStage moves the task to a stage and stores its snapshot ("" JSON stores NULL).
func (r *AdeTaskRepo) SetStage(taskID, stageID, stageJSON string) error {
	var stage any
	if stageJSON != "" {
		stage = stageJSON
	}
	res, err := r.DB.Exec(`UPDATE ade_tasks SET stage_id = ?, current_stage_json = ? WHERE id = ?`, stageID, stage, taskID)
	if err != nil {
		return fmt.Errorf("repos: set ade task stage %s: %w", taskID, err)
	}
	return sqlitex.RequireOneRow(res, "ade task "+taskID)
}

// ResetWorkflow switches the task's workflow and restarts it: the task's runs and run logs are
// deleted and the stage is set in one transaction ("" stageJSON stores NULL).
func (r *AdeTaskRepo) ResetWorkflow(taskID, workflowID, stageID, stageJSON string) error {
	var stage any
	if stageJSON != "" {
		stage = stageJSON
	}
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin reset ade task workflow %s: %w", taskID, err)
	}
	defer tx.Rollback() //nolint:errcheck
	const runIDs = `SELECT id FROM ade_runs WHERE task_id = ?`
	if _, err := tx.Exec(`DELETE FROM ade_log_chunks WHERE kind = 'run' AND id IN (`+runIDs+`)`, taskID); err != nil {
		return fmt.Errorf("repos: delete ade run log chunks %s: %w", taskID, err)
	}
	if _, err := tx.Exec(`DELETE FROM ade_logs WHERE kind = 'run' AND id IN (`+runIDs+`)`, taskID); err != nil {
		return fmt.Errorf("repos: delete ade run logs %s: %w", taskID, err)
	}
	if _, err := tx.Exec(`DELETE FROM ade_runs WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("repos: delete ade runs %s: %w", taskID, err)
	}
	res, err := tx.Exec(`UPDATE ade_tasks SET workflow_id = ?, stage_id = ?, current_stage_json = ?, workflow_json = NULL, workflow_hash = '' WHERE id = ?`,
		workflowID, stageID, stage, taskID)
	if err != nil {
		return fmt.Errorf("repos: reset ade task workflow %s: %w", taskID, err)
	}
	if err := sqlitex.RequireOneRow(res, "ade task "+taskID); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit reset ade task workflow %s: %w", taskID, err)
	}
	return nil
}

// HasRunning reports whether any run of the task is running.
func (r *AdeTaskRepo) HasRunning(taskID string) (bool, error) {
	var n int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM ade_runs WHERE task_id = ? AND state = ?`, taskID, model.AdeRunRunning).Scan(&n); err != nil {
		return false, fmt.Errorf("repos: count running ade runs %s: %w", taskID, err)
	}
	return n > 0, nil
}

// SetWorkflowSnapshot stores the whole workflow a task began with. A task that already has one keeps
// it: the first snapshot wins.
func (r *AdeTaskRepo) SetWorkflowSnapshot(taskID, workflowJSON, hash string) error {
	if _, err := r.DB.Exec(`UPDATE ade_tasks SET workflow_json = ?, workflow_hash = ? WHERE id = ? AND workflow_json IS NULL`,
		workflowJSON, hash, taskID); err != nil {
		return fmt.Errorf("repos: set ade task workflow snapshot %s: %w", taskID, err)
	}
	return nil
}

// SetSnapshot rewrites only the stage snapshot, keeping the stage id.
func (r *AdeTaskRepo) SetSnapshot(taskID, stageJSON string) error {
	res, err := r.DB.Exec(`UPDATE ade_tasks SET current_stage_json = ? WHERE id = ?`, stageJSON, taskID)
	if err != nil {
		return fmt.Errorf("repos: set ade task snapshot %s: %w", taskID, err)
	}
	return sqlitex.RequireOneRow(res, "ade task "+taskID)
}

func scanAdeRun(row rowScanner) (model.AdeRun, error) {
	var run model.AdeRun
	var exit, started, finished sql.NullInt64
	if err := row.Scan(&run.ID, &run.TaskID, &run.StageID, &run.StepID, &run.BranchID, &run.Attempt, &run.State,
		&run.Loops, &run.Note, &run.Summary, &run.SessionID, &exit, &started, &finished,
		&run.Launch.Note, &run.Launch.ResumeID, &run.Launch.Prompt, &run.Launch.Extra); err != nil {
		return model.AdeRun{}, err
	}
	run.ExitCode = nullIntPtr(exit)
	run.StartedAt, run.FinishedAt = nullInt64Ptr(started), nullInt64Ptr(finished)
	return run, nil
}

// InsertRun writes a new run attempt.
func (r *AdeTaskRepo) InsertRun(run model.AdeRun) error {
	if run.ID == "" || run.TaskID == "" || run.Attempt < 1 {
		return fmt.Errorf("repos: insert ade run: id, taskId and attempt >= 1 are required")
	}
	if _, err := r.DB.Exec(`INSERT INTO ade_runs (`+adeRunColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID, run.TaskID, run.StageID, run.StepID, run.BranchID, run.Attempt, run.State,
		run.Loops, run.Note, run.Summary, run.SessionID, run.ExitCode, run.StartedAt, run.FinishedAt,
		run.Launch.Note, run.Launch.ResumeID, run.Launch.Prompt, run.Launch.Extra); err != nil {
		return fmt.Errorf("repos: insert ade run %s: %w", run.ID, err)
	}
	return nil
}

// UpdateRun applies the non-nil leaves of p and returns the stored run.
func (r *AdeTaskRepo) UpdateRun(id string, p model.AdeRunPatch) (model.AdeRun, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return model.AdeRun{}, fmt.Errorf("repos: begin update ade run: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	cur, err := scanAdeRun(tx.QueryRow(`SELECT `+adeRunColumns+` FROM ade_runs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeRun{}, ErrRunNotFound
	}
	if err != nil {
		return model.AdeRun{}, fmt.Errorf("repos: select ade run %s: %w", id, err)
	}
	if p.State != nil {
		cur.State = *p.State
	}
	if p.Note != nil {
		cur.Note = *p.Note
	}
	if p.Summary != nil {
		cur.Summary = *p.Summary
	}
	if p.SessionID != nil {
		cur.SessionID = *p.SessionID
	}
	if p.ExitCode != nil {
		cur.ExitCode = p.ExitCode
	}
	if p.StartedAt != nil {
		cur.StartedAt = p.StartedAt
	}
	if p.FinishedAt != nil {
		cur.FinishedAt = p.FinishedAt
	}
	if p.Launch != nil {
		cur.Launch = *p.Launch
	}
	if _, err := tx.Exec(`UPDATE ade_runs SET state = ?, note = ?, summary = ?, session_id = ?,
		exit_code = ?, started_at = ?, finished_at = ?, launch_note = ?, launch_resume_id = ?, launch_prompt = ?,
		launch_extra = ? WHERE id = ?`,
		cur.State, cur.Note, cur.Summary, cur.SessionID, cur.ExitCode, cur.StartedAt,
		cur.FinishedAt, cur.Launch.Note, cur.Launch.ResumeID, cur.Launch.Prompt, cur.Launch.Extra, id); err != nil {
		return model.AdeRun{}, fmt.Errorf("repos: update ade run %s: %w", id, err)
	}
	if err := tx.Commit(); err != nil {
		return model.AdeRun{}, fmt.Errorf("repos: commit update ade run %s: %w", id, err)
	}
	return cur, nil
}

// GetRun returns one run; ErrRunNotFound if absent.
func (r *AdeTaskRepo) GetRun(id string) (model.AdeRun, error) {
	run, err := scanAdeRun(r.DB.QueryRow(`SELECT `+adeRunColumns+` FROM ade_runs WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.AdeRun{}, ErrRunNotFound
	}
	if err != nil {
		return model.AdeRun{}, fmt.Errorf("repos: get ade run %s: %w", id, err)
	}
	return run, nil
}

// LatestRuns returns the latest attempt of every (stage, step, branch) of one task.
func (r *AdeTaskRepo) LatestRuns(taskID string) ([]model.AdeRun, error) {
	rows, err := r.DB.Query(`SELECT `+adeRunColumns+` FROM ade_runs a WHERE task_id = ? AND attempt = (
		SELECT MAX(attempt) FROM ade_runs b WHERE b.task_id = a.task_id AND b.stage_id = a.stage_id
		AND b.step_id = a.step_id AND b.branch_id = a.branch_id) ORDER BY COALESCE(started_at, 0), id`, taskID)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeRun, bool, error) {
		run, err := scanAdeRun(rows)
		return run, true, err
	})
}

// UpsertSetup writes a branch's worktree-setup row.
func (r *AdeTaskRepo) UpsertSetup(s model.AdeWorktreeSetup) error {
	if _, err := r.DB.Exec(`INSERT INTO ade_worktree_setup (branch_id, state, started_at, finished_at, exit_code)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT(branch_id) DO UPDATE SET state = excluded.state,
		started_at = excluded.started_at, finished_at = excluded.finished_at, exit_code = excluded.exit_code`,
		s.BranchID, s.State, s.StartedAt, s.FinishedAt, s.ExitCode); err != nil {
		return fmt.Errorf("repos: upsert ade worktree setup %s: %w", s.BranchID, err)
	}
	return nil
}

// GetSetup returns a branch's setup row; (nil, nil) when it has none.
func (r *AdeTaskRepo) GetSetup(branchID string) (*model.AdeWorktreeSetup, error) {
	var s model.AdeWorktreeSetup
	var finished, exit sql.NullInt64
	err := r.DB.QueryRow(`SELECT branch_id, state, started_at, finished_at, exit_code FROM ade_worktree_setup WHERE branch_id = ?`,
		branchID).Scan(&s.BranchID, &s.State, &s.StartedAt, &finished, &exit)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("repos: get ade worktree setup %s: %w", branchID, err)
	}
	s.FinishedAt, s.ExitCode = nullInt64Ptr(finished), nullIntPtr(exit)
	return &s, nil
}

// SetPendingNote rewrites the note of a branch's pending runs and returns them.
func (r *AdeTaskRepo) SetPendingNote(branchID, note string) ([]model.AdeRun, error) {
	if _, err := r.DB.Exec(`UPDATE ade_runs SET note = ? WHERE branch_id = ? AND state = ?`, note, branchID, model.AdeRunPending); err != nil {
		return nil, fmt.Errorf("repos: set pending ade run note %s: %w", branchID, err)
	}
	rows, err := r.DB.Query(`SELECT `+adeRunColumns+` FROM ade_runs WHERE branch_id = ? AND state = ? ORDER BY id`, branchID, model.AdeRunPending)
	return sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeRun, bool, error) {
		run, err := scanAdeRun(rows)
		return run, true, err
	})
}

// RecoverRunning turns every running run stuck with note and returns them (boot recovery).
func (r *AdeTaskRepo) RecoverRunning(now int64, note string) ([]model.AdeRun, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, fmt.Errorf("repos: begin recover ade runs: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	rows, err := tx.Query(`SELECT ` + adeRunColumns + ` FROM ade_runs WHERE state = 'running' ORDER BY id`)
	runs, err := sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeRun, bool, error) {
		run, err := scanAdeRun(rows)
		return run, true, err
	})
	if err != nil {
		return nil, fmt.Errorf("repos: select running ade runs: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_runs SET state = ?, note = ?, finished_at = ? WHERE state = 'running'`,
		model.AdeRunStuck, note, now); err != nil {
		return nil, fmt.Errorf("repos: recover ade runs: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("repos: commit recover ade runs: %w", err)
	}
	for i := range runs {
		runs[i].State, runs[i].Note, runs[i].FinishedAt = model.AdeRunStuck, note, &now
	}
	return runs, nil
}

// FailRunningSetups marks every running worktree setup failed and returns their branch and task ids
// (boot recovery).
func (r *AdeTaskRepo) FailRunningSetups(now int64) ([]model.AdeTaskBranch, error) {
	tx, err := r.DB.Begin()
	if err != nil {
		return nil, fmt.Errorf("repos: begin recover ade setups: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck
	rows, err := tx.Query(`SELECT b.id, b.task_id FROM ade_worktree_setup s JOIN ade_task_branches b ON b.id = s.branch_id
		WHERE s.state = 'running' ORDER BY b.id`)
	out, err := sqlitex.QueryAll(rows, err, func(rows *sql.Rows) (model.AdeTaskBranch, bool, error) {
		var b model.AdeTaskBranch
		err := rows.Scan(&b.ID, &b.TaskID)
		return b, true, err
	})
	if err != nil {
		return nil, fmt.Errorf("repos: select running ade setups: %w", err)
	}
	if _, err := tx.Exec(`UPDATE ade_worktree_setup SET state = ?, finished_at = ? WHERE state = 'running'`,
		model.AdeSetupFailed, now); err != nil {
		return nil, fmt.Errorf("repos: recover ade setups: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("repos: commit recover ade setups: %w", err)
	}
	return out, nil
}

// CountRuns counts a step's runs on one branch in the given state, across attempts.
func (r *AdeTaskRepo) CountRuns(taskID, stageID, stepID, branchID, state string) (int, error) {
	var n int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM ade_runs WHERE task_id = ? AND stage_id = ? AND step_id = ? AND branch_id = ? AND state = ?`,
		taskID, stageID, stepID, branchID, state).Scan(&n); err != nil {
		return 0, fmt.Errorf("repos: count ade runs %s: %w", taskID, err)
	}
	return n, nil
}

// HasRunningOn reports whether a run on the branch is running.
func (r *AdeTaskRepo) HasRunningOn(branchID string) (bool, error) {
	var n int
	if err := r.DB.QueryRow(`SELECT COUNT(*) FROM ade_runs WHERE branch_id = ? AND state = ?`, branchID, model.AdeRunRunning).Scan(&n); err != nil {
		return false, fmt.Errorf("repos: count running ade runs on %s: %w", branchID, err)
	}
	return n > 0, nil
}

// ArchiveTask archives the task and its branches and drops its plan row in one transaction.
func (r *AdeTaskRepo) ArchiveTask(taskID string, now int64) error {
	tx, err := r.DB.Begin()
	if err != nil {
		return fmt.Errorf("repos: begin archive ade task %s: %w", taskID, err)
	}
	defer tx.Rollback() //nolint:errcheck
	res, err := tx.Exec(`UPDATE ade_tasks SET archived_at = ? WHERE id = ? AND archived_at IS NULL`, now, taskID)
	if err != nil {
		return fmt.Errorf("repos: archive ade task %s: %w", taskID, err)
	}
	if err := sqlitex.RequireOneRow(res, "ade task "+taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE ade_task_branches SET archived_at = ? WHERE task_id = ? AND archived_at IS NULL`, now, taskID); err != nil {
		return fmt.Errorf("repos: archive ade task branches %s: %w", taskID, err)
	}
	if _, err := tx.Exec(`DELETE FROM ade_task_plan WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("repos: drop ade task plan row %s: %w", taskID, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("repos: commit archive ade task %s: %w", taskID, err)
	}
	return nil
}
