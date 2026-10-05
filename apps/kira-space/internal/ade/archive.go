package ade

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// archive.go archives a whole task (SPEC2 section 10, R18): its live work stops, its worktrees go
// and the task moves to history. The caller shows ArchiveRisk first; ArchiveTask is the confirmed
// delete, uncommitted changes included.

// linkedBranch is a task branch with a linked worktree (not the repo root).
type linkedBranch struct {
	sb    model.AdeTaskBranch
	path  string
	entry *gitsession.RepoEntry
}

// linkedBranches lists the task's created branches that own a linked worktree.
func (b *TaskBoard) linkedBranches(ctx context.Context, tc *taskCtx) ([]linkedBranch, error) {
	var out []linkedBranch
	for _, sb := range tc.branches {
		if sb.Name == "" {
			continue
		}
		path, err := b.worktreeOf(ctx, sb)
		if err != nil {
			return nil, err
		}
		if path == "" {
			continue
		}
		entry, err := b.openRepo(ctx, sb.CodeRepoID)
		if err != nil {
			return nil, err
		}
		if filepath.Clean(path) == filepath.Clean(entry.Summary.Root) {
			continue
		}
		out = append(out, linkedBranch{sb: sb, path: path, entry: entry})
	}
	return out, nil
}

// ArchiveRisk reports what archiving the task would discard.
func (b *TaskBoard) ArchiveRisk(ctx context.Context, taskID string) (adewire.ArchiveRisk, error) {
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return adewire.ArchiveRisk{}, err
	}
	linked, err := b.linkedBranches(ctx, tc)
	if err != nil {
		return adewire.ArchiveRisk{}, err
	}
	out := adewire.ArchiveRisk{TaskID: taskID, Branches: []adewire.BranchRisk{}}
	for _, lb := range linked {
		risk, err := b.branchRisk(ctx, lb)
		if err != nil {
			return adewire.ArchiveRisk{}, err
		}
		out.Branches = append(out.Branches, risk)
	}
	return out, nil
}

func (b *TaskBoard) branchRisk(ctx context.Context, lb linkedBranch) (adewire.BranchRisk, error) {
	status, err := lb.entry.WorktreeStatus(ctx, lb.path)
	if err != nil {
		return adewire.BranchRisk{}, err
	}
	dirty := toDirtyEntries(status)
	unmerged := 0
	if lb.sb.MergedAt == nil {
		if unmerged, err = b.aheadOfMain(ctx, lb); err != nil {
			return adewire.BranchRisk{}, err
		}
	}
	res := atRisk(atRiskInput{
		Kind: lb.sb.Kind, Merged: lb.sb.MergedAt != nil, HasLinkedWorktree: true,
		DirtyCount: len(dirty), UnmergedAheadOfMain: unmerged,
	})
	pf, err := lb.entry.WorktreeRemovePreflight(ctx, lb.path)
	if err != nil {
		return adewire.BranchRisk{}, err
	}
	risk := adewire.BranchRisk{BranchID: lb.sb.ID, Worktree: lb.path, Dirty: []adewire.DirtyEntry{}, Unmerged: res.Unmerged}
	for _, d := range dirty {
		risk.Dirty = append(risk.Dirty, adewire.DirtyEntry{Code: d.Code, Path: d.Path})
	}
	if pf.Verdict == "blocked" && len(pf.Blockers) > 0 {
		risk.Blocked = pf.Blockers[0].Kind
	}
	return risk, nil
}

// aheadOfMain counts the branch's commits not on the repo's main.
func (b *TaskBoard) aheadOfMain(ctx context.Context, lb linkedBranch) (int, error) {
	_, mainTip, hasMain, err := lb.entry.MainRef(ctx)
	if err != nil || !hasMain {
		return 0, err
	}
	inv, err := lb.entry.BranchInventory(ctx)
	if err != nil {
		return 0, err
	}
	remote, _ := lb.entry.DefaultRemote(ctx)
	row, ok := resolveQueuedRef(inv, lb.sb.Name, remote)
	if !ok {
		return 0, nil
	}
	ahead, _, err := lb.entry.AheadBehind(ctx, row.Tip, mainTip)
	return ahead, err
}

// ArchiveTask stops the task's runs, setups and terminals, removes its worktrees and archives it.
func (b *TaskBoard) ArchiveTask(ctx context.Context, taskID string) error {
	tc, err := b.loadTaskCtx(taskID)
	if err != nil {
		return err
	}
	linked, err := b.linkedBranches(ctx, tc)
	if err != nil {
		return err
	}
	var blocked []string
	for _, lb := range linked {
		risk, err := b.branchRisk(ctx, lb)
		if err != nil {
			return err
		}
		if risk.Blocked != "" {
			blocked = append(blocked, fmt.Sprintf("%s (%s)", lb.sb.Name, risk.Blocked))
		}
	}
	if len(blocked) > 0 {
		return invalid("cannot archive: worktree of %s cannot be removed", strings.Join(blocked, ", "))
	}

	if err := b.stopTaskWork(tc); err != nil {
		return err
	}

	mu := b.taskMu(taskID)
	mu.Lock()
	defer mu.Unlock()
	if err := b.closeTaskTerminals(taskID); err != nil {
		return err
	}
	b.teardownReview(ctx, tc)
	for _, lb := range linked {
		if err := b.removeWorktree(ctx, lb); err != nil {
			return err
		}
	}
	if err := b.deps.Tasks.ArchiveTask(taskID, b.deps.Now().UnixMilli()); err != nil {
		return err
	}
	b.notifyBoard()
	b.notifySessions()
	return nil
}

// stopTaskWork cancels the task's running processes and prepare scripts and waits for them to end.
func (b *TaskBoard) stopTaskWork(tc *taskCtx) error {
	runs, err := b.deps.Tasks.RunsOfTask(tc.task.ID)
	if err != nil {
		return err
	}
	var waits []<-chan struct{}
	for _, r := range runs {
		if r.State == model.AdeRunRunning {
			if done := b.cancelLive(b.live, r.ID, errArchived); done != nil {
				waits = append(waits, done)
			}
		}
	}
	for _, sb := range tc.branches {
		if done := b.cancelLive(b.setupLive, sb.ID, errArchived); done != nil {
			waits = append(waits, done)
		}
	}
	for _, done := range waits {
		if err := b.awaitEnd(done); err != nil {
			return err
		}
	}
	return nil
}

func (b *TaskBoard) closeTaskTerminals(taskID string) error {
	rows, err := b.deps.Sessions.ListTask()
	if err != nil {
		return err
	}
	for _, s := range rows {
		if s.TaskID != taskID || s.Mode != model.AdeSessionModeTUI || s.State != model.AdeSessionStateRunning || s.TerminalID == "" {
			continue
		}
		if b.deps.CloseTerminal == nil {
			continue
		}
		if err := b.deps.CloseTerminal(s.TerminalID); err != nil {
			slog.Warn("ade: close task terminal", "scope", "ade", "task", taskID, "terminal", s.TerminalID, "err", err)
		}
	}
	return nil
}

// removeWorktree removes a linked worktree, discarding uncommitted changes (the archive was confirmed).
func (b *TaskBoard) removeWorktree(ctx context.Context, lb linkedBranch) error {
	mu := b.repoMutex(lb.sb.CodeRepoID)
	mu.Lock()
	defer mu.Unlock()
	pf, err := lb.entry.WorktreeRemovePreflight(ctx, lb.path)
	if err != nil {
		return err
	}
	req := gitsession.OpRequest{Kind: "worktreeRemove", Path: lb.path}
	if pf.Verdict == "dirty" {
		token := filepath.Base(lb.path)
		req.ConfirmToken = &token
	}
	res, err := lb.entry.RunOp(ctx, b.conn.ID, boardConnLabel, req)
	if err != nil {
		return err
	}
	if !res.OK {
		msg := "worktree remove failed"
		if res.Error != nil {
			msg = res.Error.Message
		}
		return invalid("archive %s: %s", lb.sb.Name, msg)
	}
	return nil
}
