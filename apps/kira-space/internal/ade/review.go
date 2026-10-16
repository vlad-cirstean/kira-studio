package ade

import (
	"context"
	"log/slog"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// review.go: review windows (P150). One ephemeral window per task branch reviews only that branch.

// ReviewWindowOpen is OpenReviewWindow's outcome: Existing means the window already was open and
// the caller only focuses it; otherwise the caller opens a native window with this record.
type ReviewWindowOpen struct {
	Key      string
	Title    string
	Order    int
	Existing bool
}

// refSpelling is how git names the row: the short name for a local branch, <remote>/<short> else.
func refSpelling(row porcelain.InventoryRef) string {
	if row.Remote == "" {
		return row.Short
	}
	return row.Remote + "/" + row.Short
}

// reviewSpellings resolves the branch and its base to ref spellings usable by review.* requests.
func (b *TaskBoard) reviewSpellings(ctx context.Context, entry *gitsession.RepoEntry, sb model.AdeTaskBranch) (branch, base string, err error) {
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return "", "", err
	}
	remote, _ := entry.DefaultRemote(ctx)
	row, ok := resolveQueuedRef(inv, sb.Name, remote)
	if !ok {
		return "", "", invalid("branch %s not found in its repo", sb.Name)
	}
	branch = refSpelling(row)
	sc, err := b.baseCtxFor(ctx, entry, sb.CodeRepoID)
	if err != nil {
		return "", "", err
	}
	br := sc.resolveBase(sb)
	switch {
	case br.ok:
		return branch, br.ref, nil
	case br.reason == baseMissing:
		return branch, cmpNonEmpty(sb.Base, br.name), nil
	case br.reason == baseParentDraft:
		return "", "", invalid("the base of %s is not created yet", sb.Name)
	}
	return "", "", invalid("the repo has no main branch to review against")
}

func (b *TaskBoard) reviewTarget(ctx context.Context, tc *taskCtx, sb model.AdeTaskBranch) (adewire.ReviewWindowTarget, error) {
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return adewire.ReviewWindowTarget{}, err
	}
	branch, base, err := b.reviewSpellings(ctx, entry, sb)
	if err != nil {
		return adewire.ReviewWindowTarget{}, err
	}
	worktree, err := b.worktreeOf(ctx, sb)
	if err != nil {
		return adewire.ReviewWindowTarget{}, err
	}
	return adewire.ReviewWindowTarget{
		TaskID: tc.task.ID, BranchID: sb.ID, CodeRepoID: sb.CodeRepoID, GitRepoID: entry.Summary.RepoID,
		Branch: branch, Base: base, Worktree: worktree,
	}, nil
}

// OpenReviewWindow records the review window of a created branch and pins its review session.
func (b *TaskBoard) OpenReviewWindow(ctx context.Context, branchID string) (ReviewWindowOpen, error) {
	if b.deps.ReviewWindows == nil || b.deps.Windows == nil || b.deps.Registry == nil || b.deps.Registry.Review == nil {
		return ReviewWindowOpen{}, invalid("review windows are not available")
	}
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return ReviewWindowOpen{}, err
	}
	mu := b.taskMu(sb.TaskID)
	mu.Lock()
	defer mu.Unlock()
	tc, err := b.loadTaskCtx(sb.TaskID)
	if err != nil {
		return ReviewWindowOpen{}, err
	}
	if sb.ArchivedAt != nil {
		return ReviewWindowOpen{}, invalid("the branch is archived")
	}
	if sb.Kind != model.AdeBranchKindMine && sb.Kind != model.AdeBranchKindReview {
		return ReviewWindowOpen{}, invalid("only a mine or review branch can be reviewed")
	}
	if sb.Name == "" {
		return ReviewWindowOpen{}, invalid("the branch of %s is not created yet", b.repoNick(tc, sb))
	}
	if existing, err := b.deps.ReviewWindows.ByBranch(sb.ID); err != nil {
		return ReviewWindowOpen{}, err
	} else if existing != nil {
		return ReviewWindowOpen{Key: existing.WindowKey, Existing: true}, nil
	}
	tgt, err := b.reviewTarget(ctx, tc, sb)
	if err != nil {
		return ReviewWindowOpen{}, err
	}
	if err := b.deps.Registry.Review.SetPinned(ctx, tgt.GitRepoID, tgt.Branch, true); err != nil {
		return ReviewWindowOpen{}, err
	}
	records, err := b.deps.Windows.List()
	if err != nil {
		return ReviewWindowOpen{}, err
	}
	order := 0
	for _, r := range records {
		if r.Order >= order {
			order = r.Order + 1
		}
	}
	key := b.newID()
	if err := b.deps.Windows.Create(model.WindowRecord{Key: key, Order: order}); err != nil {
		return ReviewWindowOpen{}, err
	}
	row := repos.AdeReviewWindow{WindowKey: key, TaskID: sb.TaskID, BranchID: sb.ID, CreatedAt: b.deps.Now().UnixMilli()}
	if err := b.deps.ReviewWindows.Insert(row); err != nil {
		if derr := b.deps.Windows.Delete(key); derr != nil {
			slog.Warn("ade: drop orphan review window row", "scope", "ade", "key", key, "err", derr)
		}
		return ReviewWindowOpen{}, err
	}
	title := "Review · " + b.repoNick(tc, sb) + " · " + sb.Name
	return ReviewWindowOpen{Key: key, Title: title, Order: order}, nil
}

// ReviewWindowTarget returns what a review window reviews, nil when key is not a review window or
// its branch is gone.
func (b *TaskBoard) ReviewWindowTarget(ctx context.Context, key string) (*adewire.ReviewWindowTarget, error) {
	if b.deps.ReviewWindows == nil {
		return nil, nil
	}
	row, err := b.deps.ReviewWindows.ByKey(key)
	if err != nil || row == nil {
		return nil, err
	}
	sb, err := b.deps.Tasks.GetBranch(row.BranchID)
	if err != nil {
		return nil, err
	}
	tc, err := b.loadTaskCtx(row.TaskID)
	if err != nil {
		return nil, err
	}
	if sb.Name == "" || sb.ArchivedAt != nil {
		return nil, nil
	}
	tgt, err := b.reviewTarget(ctx, tc, sb)
	if err != nil {
		return nil, err
	}
	return &tgt, nil
}

// teardownReview unpins and purges the task's review sessions, closes its review windows and drops
// its GitHub sync ledger (Archive; no GitHub call).
func (b *TaskBoard) teardownReview(ctx context.Context, tc *taskCtx) {
	if b.deps.Registry != nil && b.deps.Registry.Review != nil {
		for _, sb := range tc.branches {
			if sb.Name == "" {
				continue
			}
			entry, err := b.openRepo(ctx, sb.CodeRepoID)
			if err != nil {
				slog.Warn("ade: review teardown: open repo", "scope", "ade", "branch", sb.ID, "err", err)
				continue
			}
			branch, _, err := b.reviewSpellings(ctx, entry, sb)
			if err != nil {
				branch = sb.Name
			}
			id := entry.Summary.RepoID
			if err := b.deps.Registry.Review.SetPinned(ctx, id, branch, false); err != nil {
				slog.Warn("ade: review teardown: unpin", "scope", "ade", "branch", sb.ID, "err", err)
				continue
			}
			if err := b.deps.Registry.Review.Purge(ctx, id, branch); err != nil {
				slog.Warn("ade: review teardown: purge", "scope", "ade", "branch", sb.ID, "err", err)
			}
		}
	}
	if b.deps.ReviewWindows != nil {
		if b.deps.CloseReviewWindows != nil {
			b.deps.CloseReviewWindows(tc.task.ID)
		}
		if err := b.deps.ReviewWindows.DeleteByTask(tc.task.ID); err != nil {
			slog.Warn("ade: review teardown: windows", "scope", "ade", "task", tc.task.ID, "err", err)
		}
	}
	if b.deps.GhSynced == nil {
		return
	}
	if err := b.deps.GhSynced.DeleteByTask(tc.task.ID); err != nil {
		slog.Warn("ade: review teardown: sync ledger", "scope", "ade", "task", tc.task.ID, "err", err)
	}
}
