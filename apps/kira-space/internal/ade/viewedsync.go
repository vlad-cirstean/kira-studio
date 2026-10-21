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

// viewedsync.go: one-way app -> git host "viewed" sync of a branch's reviewed files (P150).

// syncPlan is a computed sync plan plus what Apply needs to act on it.
type syncPlan struct {
	wire         adewire.ViewedSyncPlan
	entry        *gitsession.RepoEntry
	changeNodeID string
	changeNumber int
	provider     string
	drop         []string
}

func (b *TaskBoard) syncLock(branchID string) *sync.Mutex {
	b.syncMu.Lock()
	defer b.syncMu.Unlock()
	m, ok := b.syncLocks[branchID]
	if !ok {
		m = &sync.Mutex{}
		b.syncLocks[branchID] = m
	}
	return m
}

// computeSyncPlan resolves the branch's PR and plans against it. Caller holds the branch's syncLock.
func (b *TaskBoard) computeSyncPlan(ctx context.Context, sb model.AdeTaskBranch) (syncPlan, error) {
	out := syncPlan{wire: adewire.ViewedSyncPlan{Files: []adewire.ViewedSyncFile{}}}
	if b.deps.ViewedSync == nil || b.deps.Registry == nil || b.deps.Registry.Review == nil {
		return out, invalid("Viewed sync is not available")
	}
	if sb.Name == "" || sb.ArchivedAt != nil {
		return out, invalid("the branch is not live")
	}
	entry, err := b.openRepo(ctx, sb.CodeRepoID)
	if err != nil {
		return out, err
	}
	out.entry = entry
	res := entry.ResolveBranchChangeRequest(ctx, sb.Name)
	switch res.Kind {
	case "disabled":
		out.wire.Status, out.wire.Message = "disabled", entry.DisabledMessage()
		return out, nil
	case "unavailable":
		out.wire.Status = "unavailable"
		if res.Status != nil {
			out.wire.Status = adewire.ViewedSyncStatus(gitsession.ViewedSyncStatusKind(*res.Status))
			out.wire.Message = res.Status.Reason
		}
		return out, nil
	}
	info, hasHost := entry.HostInfo(ctx)
	if hasHost {
		out.wire.Host = &info
		out.provider = info.ID
	}
	if len(res.ChangeRequests) == 0 {
		out.wire.Status, out.wire.Message = "noPr", fmt.Sprintf("No %s for this branch", info.ChangeRequestNoun)
		return out, nil
	}
	pr := res.ChangeRequests[0]
	out.changeNumber = pr.Number
	out.wire.ChangeRequest = &adewire.ChangeRequest{Number: pr.Number, Title: pr.Title, State: pr.State, URL: pr.URL}
	if pr.State == "merged" || pr.State == "closed" {
		out.wire.Status = "prClosed"
		out.wire.Message = fmt.Sprintf("%s #%d is ", info.ChangeRequestShort, pr.Number) + pr.State
		return out, nil
	}
	branch, base, err := b.reviewSpellings(ctx, entry, sb)
	if err != nil {
		return out, err
	}
	ledger, err := b.deps.ViewedSync.Paths(sb.ID)
	if err != nil {
		return out, err
	}
	synced := map[string]bool{}
	for p, m := range ledger {
		if m.Number == pr.Number && m.Provider == info.ID {
			synced[p] = true
		} else {
			out.drop = append(out.drop, p)
		}
	}
	plan, err := entry.ViewedSyncPlan(ctx, branch, base, pr.Number, synced)
	if err != nil {
		return out, err
	}
	out.wire.Status, out.wire.Message = adewire.ViewedSyncStatus(plan.Status), plan.Message
	out.wire.Account, out.wire.HeadSha, out.wire.LocalTip = plan.Account, plan.HeadSha, plan.LocalTip
	out.changeNodeID = plan.NodeID
	out.drop = append(out.drop, plan.DropSynced...)
	for _, f := range plan.Files {
		out.wire.Files = append(out.wire.Files, adewire.ViewedSyncFile{Path: f.Path, Action: f.Action, Reason: f.Reason})
	}
	return out, nil
}

// dropLedger deletes ledger rows that need no GitHub call.
func (b *TaskBoard) dropLedger(branchID string, paths []string) {
	for _, p := range paths {
		if err := b.deps.ViewedSync.Unmark(branchID, p); err != nil {
			slog.Warn("ade: drop sync ledger row", "scope", "ade", "branch", branchID, "path", p, "err", err)
		}
	}
}

// ViewedSyncPlan reports what a sync would do; it changes nothing on GitHub.
func (b *TaskBoard) ViewedSyncPlan(ctx context.Context, branchID string) (adewire.ViewedSyncPlan, error) {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return adewire.ViewedSyncPlan{}, err
	}
	mu := b.syncLock(branchID)
	mu.Lock()
	defer mu.Unlock()
	plan, err := b.computeSyncPlan(ctx, sb)
	if err != nil {
		return adewire.ViewedSyncPlan{}, err
	}
	if plan.wire.Status == "ok" || plan.wire.Status == "prClosed" {
		b.dropLedger(branchID, plan.drop)
	}
	return plan.wire, nil
}

// ViewedSyncApply recomputes the plan, then marks and unmarks its files on the PR.
func (b *TaskBoard) ViewedSyncApply(ctx context.Context, branchID string) (adewire.ViewedSyncResult, error) {
	sb, err := b.deps.Tasks.GetBranch(branchID)
	if err != nil {
		return adewire.ViewedSyncResult{}, err
	}
	mu := b.syncLock(branchID)
	mu.Lock()
	defer mu.Unlock()
	plan, err := b.computeSyncPlan(ctx, sb)
	if err != nil {
		return adewire.ViewedSyncResult{}, err
	}
	res := adewire.ViewedSyncResult{
		Status: plan.wire.Status, Message: plan.wire.Message,
		Marked: []string{}, Unmarked: []string{}, Failed: []adewire.ViewedSyncFailure{},
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
func (b *TaskBoard) applyViewed(ctx context.Context, branchID string, plan syncPlan, paths []string, viewed bool, res *adewire.ViewedSyncResult) {
	if len(paths) == 0 {
		return
	}
	failed, status := plan.entry.SetChangeFilesViewed(ctx, plan.changeNodeID, paths, viewed)
	now := b.deps.Now().UnixMilli()
	for _, p := range paths {
		if msg, bad := failed[p]; bad {
			res.Failed = append(res.Failed, adewire.ViewedSyncFailure{Path: p, Error: msg})
			continue
		}
		var err error
		if viewed {
			err = b.deps.ViewedSync.Mark(branchID, p, plan.provider, plan.changeNumber, now)
			res.Marked = append(res.Marked, p)
		} else {
			err = b.deps.ViewedSync.Unmark(branchID, p)
			res.Unmarked = append(res.Unmarked, p)
		}
		if err != nil {
			slog.Warn("ade: record sync ledger", "scope", "ade", "branch", branchID, "path", p, "err", err)
		}
	}
	if status.Status != "ok" {
		res.Status, res.Message = adewire.ViewedSyncStatus(status.Status), status.Message
	}
}

// WatchReviews starts the server-side unmark: a review that leaves "full" for a file this app
// marked viewed on GitHub unmarks it there.
func (b *TaskBoard) WatchReviews() {
	if b.deps.Registry == nil || b.deps.Registry.Review == nil || b.deps.ViewedSync == nil {
		return
	}
	b.deps.Registry.Review.SetObserver(b.onReviewChange)
}

func (b *TaskBoard) onReviewChange(c gitreview.ReviewChange) {
	if c.State == "full" || c.State == "comment" || b.ctx.Err() != nil {
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
		paths, err := b.deps.ViewedSync.Paths(sb.ID)
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
	b.syncMu.Lock()
	if b.syncPending[sb.ID] {
		b.syncMu.Unlock()
		return
	}
	b.syncPending[sb.ID] = true
	b.syncMu.Unlock()
	if !b.track() {
		b.syncMu.Lock()
		delete(b.syncPending, sb.ID)
		b.syncMu.Unlock()
		return
	}
	go func() {
		defer b.wg.Done()
		mu := b.syncLock(sb.ID)
		mu.Lock()
		defer mu.Unlock()
		b.syncMu.Lock()
		delete(b.syncPending, sb.ID)
		b.syncMu.Unlock()
		b.runUnmark(sb)
	}()
}

// runUnmark unmarks only the plan's unmark rows; a failed row stays in the ledger for a retry.
func (b *TaskBoard) runUnmark(sb model.AdeTaskBranch) {
	plan, err := b.computeSyncPlan(b.ctx, sb)
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
	res := adewire.ViewedSyncResult{Status: "ok"}
	b.applyViewed(b.ctx, sb.ID, plan, paths, false, &res)
	for _, f := range res.Failed {
		slog.Warn("ade: gh unmark failed", "scope", "ade", "branch", sb.ID, "path", f.Path, "err", f.Error)
	}
	if res.Status != "ok" {
		slog.Warn("ade: gh unmark", "scope", "ade", "branch", sb.ID, "status", res.Status, "msg", res.Message)
	}
}
