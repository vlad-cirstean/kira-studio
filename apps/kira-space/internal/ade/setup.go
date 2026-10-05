package ade

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitprepare"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// setup.go creates the worktrees a run needs and runs each repo's prepare script in a new one. The
// gate (setupReady) keeps a branch's runs waiting until the script finished (SPEC2 section 6.1).

const maxBranchSlug = 40

// slug lowercases s to [a-z0-9-], collapsed, trimmed and cut to maxBranchSlug.
func slug(s string) string {
	var sb strings.Builder
	dash := true
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			sb.WriteRune(r)
			dash = false
		} else if !dash {
			sb.WriteByte('-')
			dash = true
		}
	}
	out := strings.Trim(sb.String(), "-")
	if len(out) > maxBranchSlug {
		out = strings.Trim(out[:maxBranchSlug], "-")
	}
	if out == "" {
		return "task"
	}
	return out
}

// safeSegment makes a repo name safe as one path segment.
func safeSegment(s string) string {
	s = strings.NewReplacer("/", "-", "\\", "-", "\x00", "").Replace(s)
	if s == "" || s == "." || s == ".." {
		return "repo"
	}
	return s
}

// taskTitle mirrors labels.ts taskTitle: title, else Jira key, else first branch name, else a default.
func taskTitle(t model.AdeTask, branches []model.AdeTaskBranch) string {
	switch {
	case t.Title != "":
		return t.Title
	case t.JiraKey != "":
		return t.JiraKey
	}
	for _, br := range branches {
		if br.Name != "" {
			return br.Name
		}
	}
	return "New task"
}

func lastSegment(branch string) string {
	if i := strings.LastIndexByte(branch, '/'); i >= 0 && i < len(branch)-1 {
		return branch[i+1:]
	}
	return branch
}

// freePath returns <home>/wt/<repo>/<branch last segment>, with -2, -3... if the path exists.
func (b *TaskBoard) freePath(repoName, branch string) string {
	base := filepath.Join(b.deps.HomeDir, "wt", safeSegment(repoName), safeSegment(lastSegment(branch)))
	path := base
	for n := 2; ; n++ {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			return path
		}
		path = fmt.Sprintf("%s-%d", base, n)
	}
}

func localBranch(inv []porcelain.InventoryRef, short string) (porcelain.InventoryRef, bool) {
	for _, r := range inv {
		if r.Remote == "" && r.Short == short {
			return r, true
		}
	}
	return porcelain.InventoryRef{}, false
}

func branchExists(inv []porcelain.InventoryRef, short string) bool {
	for _, r := range inv {
		if r.Short == short {
			return true
		}
	}
	return false
}

// worktreeResult is ensureWorktree's outcome: Fresh is true when this call created the worktree.
type worktreeResult struct {
	Path  string
	Name  string
	Fresh bool
}

// ensureWorktree makes the branch's worktree exist (R14): a branch checked out anywhere, the repo
// root included, runs there as is; a created branch without one gets an existingBranch worktree; a
// not-created branch gets its name, then a newBranch worktree from its base. wanted is the caller's
// name for a not-created branch ("" = derived from the task title).
func (b *TaskBoard) ensureWorktree(ctx context.Context, title string, rec model.CodeRepo, sb model.AdeTaskBranch, wanted string) (worktreeResult, error) {
	if err := b.checkNotArchiving(sb.TaskID); err != nil {
		return worktreeResult{}, err
	}
	mu := b.repoMutex(sb.CodeRepoID)
	mu.Lock()
	defer mu.Unlock()
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return worktreeResult{}, err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return worktreeResult{}, err
	}
	if sb.Name != "" {
		if row, ok := localBranch(inv, sb.Name); ok && row.WorktreePath != "" {
			return worktreeResult{Path: row.WorktreePath, Name: sb.Name}, nil
		}
		path := b.freePath(rec.Name, sb.Name)
		if err := b.addWorktree(ctx, entry, gitsession.OpRequest{Kind: "worktreeAdd", Mode: "existingBranch", Path: path, Branch: sb.Name}); err != nil {
			return worktreeResult{}, err
		}
		return worktreeResult{Path: path, Name: sb.Name, Fresh: true}, nil
	}

	name, err := b.claimBranchName(sb, title, wanted, inv)
	if err != nil {
		return worktreeResult{}, err
	}
	path := b.freePath(rec.Name, name)
	req := gitsession.OpRequest{Kind: "worktreeAdd", Mode: "newBranch", Path: path, Branch: name, StartPoint: b.startPoint(ctx, entry, sb, inv)}
	if err := b.addWorktree(ctx, entry, req); err != nil {
		if rerr := b.deps.Tasks.SetBranchName(sb.ID, ""); rerr != nil {
			slog.Warn("ade: release branch name", "scope", "ade", "branch", sb.ID, "err", rerr)
		}
		return worktreeResult{}, err
	}
	return worktreeResult{Path: path, Name: name, Fresh: true}, nil
}

// claimBranchName stores the branch's name before git runs, so the board shows it. An explicit name
// that already exists is refused; a derived one gets -2, -3... until free.
func (b *TaskBoard) claimBranchName(sb model.AdeTaskBranch, title, wanted string, inv []porcelain.InventoryRef) (string, error) {
	if wanted != "" {
		if branchExists(inv, wanted) {
			return "", invalid("branch %s already exists", wanted)
		}
		if err := b.deps.Tasks.SetBranchName(sb.ID, wanted); err != nil {
			return "", branchNameErr(err, wanted)
		}
		return wanted, nil
	}
	base := "feat/" + slug(title)
	for n := 1; ; n++ {
		name := base
		if n > 1 {
			name = fmt.Sprintf("%s-%d", base, n)
		}
		if branchExists(inv, name) {
			continue
		}
		err := b.deps.Tasks.SetBranchName(sb.ID, name)
		if err == nil {
			return name, nil
		}
		if !errors.Is(err, repos.ErrBranchNameTaken) {
			return "", err
		}
	}
}

func branchNameErr(err error, name string) error {
	if errors.Is(err, repos.ErrBranchNameTaken) {
		return invalid("branch %s is already on a task", name)
	}
	return err
}

// startPoint is the ref a new branch starts from: the stored base, else the repo's main. A local
// branch wins over its remote-tracking twin.
func (b *TaskBoard) startPoint(ctx context.Context, entry *gitsession.RepoEntry, sb model.AdeTaskBranch, inv []porcelain.InventoryRef) string {
	remote, _ := entry.DefaultRemote(ctx)
	short := sb.Base
	var full string
	if short == "" {
		ref, _, ok, err := entry.MainRef(ctx)
		if err != nil || !ok {
			return ""
		}
		short, _ = mainDisplay(ref)
		full = ref
	}
	if row, ok := resolveQueuedRef(inv, short, remote); ok {
		return row.Ref
	}
	if full != "" {
		return full
	}
	return short
}

func (b *TaskBoard) addWorktree(ctx context.Context, entry *gitsession.RepoEntry, req gitsession.OpRequest) error {
	res, err := entry.RunOp(ctx, b.conn.ID, boardConnLabel, req)
	if err != nil {
		return err
	}
	if !res.OK {
		msg := "git refused"
		if res.Error != nil {
			msg = res.Error.Message
		}
		return invalid("worktree for %s: %s", req.Branch, msg)
	}
	return nil
}

// worktreeOf is the path where the branch is checked out, "" when nowhere.
func (b *TaskBoard) worktreeOf(ctx context.Context, sb model.AdeTaskBranch) (string, error) {
	if sb.Name == "" {
		return "", nil
	}
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return "", err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return "", err
	}
	if row, ok := localBranch(inv, sb.Name); ok {
		return row.WorktreePath, nil
	}
	return "", nil
}

// setupReady is the gate: the branch's setup row is ready, or it has none and its worktree exists.
func (b *TaskBoard) setupReady(sb model.AdeTaskBranch, worktree string, setups map[string]model.AdeWorktreeSetup) bool {
	if s, ok := setups[sb.ID]; ok {
		return s.State == model.AdeSetupReady
	}
	return worktree != ""
}

// startSetup records the setup and, when the repo has a prepare script, runs it in the background.
// onReady is called (off the caller's goroutine) after a successful script; a repo without one is
// ready at once and onReady is not called.
func (b *TaskBoard) startSetup(rec model.CodeRepo, sb model.AdeTaskBranch, name, path string, onReady func(branchID string)) error {
	if err := b.checkNotArchiving(sb.TaskID); err != nil {
		return err
	}
	settings, err := b.deps.GitRepoSettings(rec.RepoID)
	if err != nil {
		return err
	}
	if err := b.deps.Logs.Reset(repos.AdeLogSetup, sb.ID, sb.TaskID); err != nil {
		return err
	}
	now := b.deps.Now().UnixMilli()
	sink := b.newLogSink(repos.AdeLogSetup, sb.ID, sb.TaskID)
	if settings.WorktreePrepareScript == "" {
		zero := 0
		sink.add(logEvent, "no prepare script configured")
		sink.flush()
		defer b.notifyBoard()
		return b.deps.Tasks.UpsertSetup(model.AdeWorktreeSetup{BranchID: sb.ID, State: model.AdeSetupReady, StartedAt: now, FinishedAt: &now, ExitCode: &zero})
	}
	sctx, endSetup, ok := b.claimSetup(sb.ID)
	if !ok {
		return invalid("a setup is already running for this branch")
	}
	if err := b.deps.Tasks.UpsertSetup(model.AdeWorktreeSetup{BranchID: sb.ID, State: model.AdeSetupRunning, StartedAt: now}); err != nil {
		endSetup()
		return err
	}
	b.notifyBoard()
	timeout, timeoutText := gitsession.ParsePrepareTimeout(settings.WorktreePrepareTimeout)
	b.wg.Add(1)
	go func() {
		defer b.wg.Done()
		defer endSetup()
		b.runSetup(sctx, rec, sb, name, path, settings.WorktreePrepareScript, timeout, timeoutText, sink, now, onReady)
	}()
	return nil
}

// claimSetup registers the branch's running prepare script; ok is false when one already runs.
func (b *TaskBoard) claimSetup(branchID string) (context.Context, func(), bool) {
	b.runMu.Lock()
	_, busy := b.setupLive[branchID]
	b.runMu.Unlock()
	if busy {
		return nil, nil, false
	}
	ctx, end := b.beginLive(b.setupLive, branchID)
	return ctx, end, true
}

func (b *TaskBoard) runSetup(ctx context.Context, rec model.CodeRepo, sb model.AdeTaskBranch, name, path, script string, timeout time.Duration, timeoutText string, sink *logSink, startedAt int64, onReady func(string)) {
	commonDir := rec.Root
	if entry, err := b.openRepo(ctx, sb.CodeRepoID); err == nil {
		commonDir = entry.Summary.CommonDir
	}
	shell, login := gitprepare.ResolveShell(os.Getenv, gitprepare.IsExecutableFile)
	res, err := b.scriptRunner().Run(ctx, gitprepare.Spec{
		Shell: shell, LoginShell: login, Script: script, Dir: path, Timeout: timeout,
		Env: gitprepare.BuildEnv(os.Environ(), gitprepare.Vars{WorktreePath: path, WorktreeBranch: name, RepoRoot: rec.Root, RepoCommonDir: commonDir}),
		OnBatch: func(lines []gitprepare.Line) {
			for _, l := range lines {
				sink.add(l.Stream, l.Text)
			}
		},
	})
	state, exit := model.AdeSetupReady, res.ExitCode
	switch {
	case res.Cancelled && err == nil && b.ctx.Err() != nil:
		sink.flush()
		return // app quit: the row stays running (R18)
	case res.Cancelled && err == nil:
		state = model.AdeSetupFailed
		sink.add(logEvent, "cancelled: "+context.Cause(ctx).Error())
	case err != nil:
		state = model.AdeSetupFailed
		sink.add(logEvent, "could not start: "+err.Error())
	case res.TimedOut:
		state = model.AdeSetupFailed
		sink.add(logEvent, "timed out after "+timeoutText)
	case res.ExitCode != 0:
		state = model.AdeSetupFailed
		sink.add(logEvent, fmt.Sprintf("exited with status %d", res.ExitCode))
	}
	sink.flush()
	finished := b.deps.Now().UnixMilli()
	row := model.AdeWorktreeSetup{BranchID: sb.ID, State: state, StartedAt: startedAt, FinishedAt: &finished, ExitCode: &exit}
	if err := b.deps.Tasks.UpsertSetup(row); err != nil {
		slog.Warn("ade: record setup", "scope", "ade", "branch", sb.ID, "err", err)
		return
	}
	if state == model.AdeSetupFailed {
		b.setPendingNote(sb.ID, noteSetupFailed)
	}
	b.notifyBoard()
	if state == model.AdeSetupReady && onReady != nil {
		onReady(sb.ID)
	}
}
