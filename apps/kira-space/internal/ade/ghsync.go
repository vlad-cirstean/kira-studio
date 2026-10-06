package ade

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitreview"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
)

// ghsync.go: one-way app -> GitHub "viewed" sync of a branch's reviewed files (P150).

// ghPlan is a computed sync plan plus what Apply needs to act on it.
type ghPlan struct {
	wire     adewire.GhSyncPlan
	entry    *gitsession.RepoEntry
	prNodeID string
	prNumber int
	synced   map[string]int
	drop     []string
}

func (b *TaskBoard) ghLock(branchID string) *sync.Mutex {
	b.ghMu.Lock()
	defer b.ghMu.Unlock()
	m, ok := b.ghLocks[branchID]
	if !ok {
		m = &sync.Mutex{}
		b.ghLocks[branchID] = m
	}
	return m
}

// computeGhPlan resolves the branch's PR and plans against it. Caller holds the branch's ghLock.
func (b *TaskBoard) computeGhPlan(ctx context.Context, sb model.AdeTaskBranch) (ghPlan, error) {
	out := ghPlan{wire: adewire.GhSyncPlan{Files: []adewire.GhSyncFile{}}}
	if b.deps.GhSynced == nil || b.deps.Registry == nil || b.deps.Registry.Review == nil {
		return out, invalid("GitHub sync is not available")
	}
	if sb.Name == "" || sb.ArchivedAt != nil {
		return out, invalid("the branch is not live")
	}
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return out, err
	}
	out.entry = entry
	res := entry.ResolveBranchPr(ctx, sb.Name)
	switch res.Kind {
	case "disabled":
		out.wire.Status, out.wire.Message = "disabled", "GitHub is turned off for this repo"
		return out, nil
	case "unavailable":
		out.wire.Status = "unavailable"
		if res.Gh != nil {
			out.wire.Status = adewire.GhSyncStatus(gitsession.GhStatusKind(*res.Gh))
			out.wire.Message = res.Gh.Reason
		}
		return out, nil
	}
	if len(res.PRs) == 0 {
		out.wire.Status, out.wire.Message = "noPr", "No pull request for this branch"
		return out, nil
	}
	pr := res.PRs[0]
	out.prNumber = pr.Number
	out.wire.Pr = &adewire.PR{Number: pr.Number, Title: pr.Title, State: pr.State, URL: pr.URL}
	if pr.State == "merged" || pr.State == "closed" {
		out.wire.Status = "prClosed"
		out.wire.Message = fmt.Sprintf("PR #%d is ", pr.Number) + pr.State
		return out, nil
	}
	branch, base, err := b.reviewSpellings(ctx, entry, sb)
	if err != nil {
		return out, err
	}
	ledger, err := b.deps.GhSynced.Paths(sb.ID)
	if err != nil {
		return out, err
	}
	out.synced = map[string]int{}
	synced := map[string]bool{}
	for p, n := range ledger {
		if n == pr.Number {
			out.synced[p] = n
			synced[p] = true
		} else {
			out.drop = append(out.drop, p)
		}
	}
	plan, err := entry.GhSyncPlan(ctx, branch, base, pr.Number, synced)
	if err != nil {
		return out, err
	}
	out.wire.Status, out.wire.Message = adewire.GhSyncStatus(plan.Status), plan.Message
	out.wire.Account, out.wire.HeadSha, out.wire.LocalTip = plan.Account, plan.HeadSha, plan.LocalTip
	out.prNodeID = plan.PrNodeID
	out.drop = append(out.drop, plan.DropSynced...)
	for _, f := range plan.Files {
		out.wire.Files = append(out.wire.Files, adewire.GhSyncFile{Path: f.Path, Action: f.Action, Reason: f.Reason})
	}
	return out, nil
}

// dropLedger deletes ledger rows that need no GitHub call.
func (b *TaskBoard) dropLedger(branchID string, paths []string) {
	for _, p := range paths {
		if err := b.deps.GhSynced.Unmark(branchID, p); err != nil {
			slog.Warn("ade: drop sync ledger row", "scope", "ade", "branch", branchID, "path", p, "err", err)
		}
	}
}

// GitHubSyncPlan reports what a sync would do; it changes nothing on GitHub.
func (b *TaskBoard) GitHubSyncPlan(ctx context.Context, branchID string) (adewire.GhSyncPlan, error) {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return adewire.GhSyncPlan{}, err
	}
	mu := b.ghLock(branchID)
	mu.Lock()
	defer mu.Unlock()
	plan, err := b.computeGhPlan(ctx, sb)
	if err != nil {
		return adewire.GhSyncPlan{}, err
	}
	if plan.wire.Status == "ok" || plan.wire.Status == "prClosed" {
		b.dropLedger(branchID, plan.drop)
	}
	return plan.wire, nil
}

// GitHubSyncApply recomputes the plan, then marks and unmarks its files on the PR.
func (b *TaskBoard) GitHubSyncApply(ctx context.Context, branchID string) (adewire.GhSyncResult, error) {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return adewire.GhSyncResult{}, err
	}
	mu := b.ghLock(branchID)
	mu.Lock()
	defer mu.Unlock()
	plan, err := b.computeGhPlan(ctx, sb)
	if err != nil {
		return adewire.GhSyncResult{}, err
	}
	res := adewire.GhSyncResult{
		Status: plan.wire.Status, Message: plan.wire.Message,
		Marked: []string{}, Unmarked: []string{}, Failed: []adewire.GhSyncFailure{},
	}
	if plan.wire.Status != "ok" {
		return res, nil
	}
	b.dropLedger(branchID, plan.drop)
	var toMark, toUnmark []string
	for _, f := range plan.wire.Files {
		switch f.Action {
		case "mark":
			toMark = append(toMark, f.Path)
		case "unmark":
			toUnmark = append(toUnmark, f.Path)
		}
	}
	b.applyViewed(ctx, sb.ID, plan, toMark, true, &res)
	if res.Status == "ok" {
		b.applyViewed(ctx, sb.ID, plan, toUnmark, false, &res)
	}
	return res, nil
}

// applyViewed sends one direction and records the ledger per success. A whole-call failure sets
// res.Status.
func (b *TaskBoard) applyViewed(ctx context.Context, branchID string, plan ghPlan, paths []string, viewed bool, res *adewire.GhSyncResult) {
	if len(paths) == 0 {
		return
	}
	failed, status := plan.entry.SetPrFilesViewed(ctx, plan.prNodeID, paths, viewed)
	now := b.deps.Now().UnixMilli()
	for _, p := range paths {
		if msg, bad := failed[p]; bad {
			res.Failed = append(res.Failed, adewire.GhSyncFailure{Path: p, Error: msg})
			continue
		}
		var err error
		if viewed {
			err = b.deps.GhSynced.Mark(branchID, p, plan.prNumber, now)
			res.Marked = append(res.Marked, p)
		} else {
			err = b.deps.GhSynced.Unmark(branchID, p)
			res.Unmarked = append(res.Unmarked, p)
		}
		if err != nil {
			slog.Warn("ade: record sync ledger", "scope", "ade", "branch", branchID, "path", p, "err", err)
		}
	}
	if status.Status != "ok" {
		res.Status, res.Message = adewire.GhSyncStatus(status.Status), status.Message
	}
}

// WatchReviews starts the server-side unmark: a review that leaves "full" for a file this app
// marked viewed on GitHub unmarks it there.
func (b *TaskBoard) WatchReviews() {
	if b.deps.Registry == nil || b.deps.Registry.Review == nil || b.deps.GhSynced == nil {
		return
	}
	b.deps.Registry.Review.SetObserver(b.onReviewChange)
}

func (b *TaskBoard) onReviewChange(c gitreview.ReviewChange) {
	if c.State == "full" || b.ctx.Err() != nil {
		return
	}
	b.mu.Lock()
	codeRepoID := b.byGitRepoID[c.RepoID]
	b.mu.Unlock()
	if codeRepoID == "" {
		return
	}
	live, err := b.deps.Tasks.BranchesLive()
	if err != nil {
		slog.Warn("ade: gh unmark: list branches", "scope", "ade", "err", err)
		return
	}
	for _, sb := range live {
		if sb.CodeRepoID != codeRepoID || sb.Name == "" || !(c.Branch == sb.Name || strings.HasSuffix(c.Branch, "/"+sb.Name)) {
			continue
		}
		paths, err := b.deps.GhSynced.Paths(sb.ID)
		if err != nil {
			slog.Warn("ade: gh unmark: ledger", "scope", "ade", "branch", sb.ID, "err", err)
			continue
		}
		if _, ok := paths[c.Path]; ok {
			b.queueUnmark(sb)
		}
	}
}

// queueUnmark coalesces: one pending worker per branch.
func (b *TaskBoard) queueUnmark(sb model.AdeTaskBranch) {
	b.ghMu.Lock()
	if b.ghPending[sb.ID] {
		b.ghMu.Unlock()
		return
	}
	b.ghPending[sb.ID] = true
	b.ghMu.Unlock()
	if !b.track() {
		b.ghMu.Lock()
		delete(b.ghPending, sb.ID)
		b.ghMu.Unlock()
		return
	}
	go func() {
		defer b.wg.Done()
		mu := b.ghLock(sb.ID)
		mu.Lock()
		defer mu.Unlock()
		b.ghMu.Lock()
		delete(b.ghPending, sb.ID)
		b.ghMu.Unlock()
		b.runUnmark(sb)
	}()
}

// runUnmark unmarks only the plan's unmark rows; a failed row stays in the ledger for a retry.
func (b *TaskBoard) runUnmark(sb model.AdeTaskBranch) {
	plan, err := b.computeGhPlan(b.ctx, sb)
	if err != nil || plan.wire.Status != "ok" {
		if err != nil {
			slog.Warn("ade: gh unmark: plan", "scope", "ade", "branch", sb.ID, "err", err)
		}
		return
	}
	b.dropLedger(sb.ID, plan.drop)
	var paths []string
	for _, f := range plan.wire.Files {
		if f.Action == "unmark" {
			paths = append(paths, f.Path)
		}
	}
	res := adewire.GhSyncResult{Status: "ok"}
	b.applyViewed(b.ctx, sb.ID, plan, paths, false, &res)
	for _, f := range res.Failed {
		slog.Warn("ade: gh unmark failed", "scope", "ade", "branch", sb.ID, "path", f.Path, "err", f.Error)
	}
	if res.Status != "ok" {
		slog.Warn("ade: gh unmark", "scope", "ade", "branch", sb.ID, "status", res.Status, "msg", res.Message)
	}
}
