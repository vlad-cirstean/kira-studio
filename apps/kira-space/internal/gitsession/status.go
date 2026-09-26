package gitsession

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpreflight"
)

// headStateFromStatusBranch calls gitpreflight's own HeadStateFromBranch (H8, P115 Part 2) — status
// --branch's header already carries HEAD's identity for free, so statusAndInProgress can refresh
// the entry's live head without a third rev-parse/symbolic-ref spawn. Converted at this package's
// own boundary, per gitpreflight.HeadState's own doc comment.
func headStateFromStatusBranch(b porcelain.StatusBranchInfo) gitclient.HeadState {
	return gitclient.HeadState(gitpreflight.HeadStateFromBranch(b))
}

// statusAndInProgress is §7.11's join point (D16): the one place ParseStatus,
// gitops.ReadInProgressStateFiles and gitpreflight.ClassifyInProgress meet, so status.get, both
// pre-flights and RunOp's read-back all pay exactly one status spawn and can never disagree about
// what "in progress" means. Refreshes the entry's live head as a side effect, unconditionally —
// every caller here already has a fresh StatusResult in hand, so this is the one place the head
// can be kept honest for free.
func (e *RepoEntry) statusAndInProgress(ctx context.Context) (porcelain.StatusResult, *gitpreflight.InProgressOperation, error) {
	var statusResult porcelain.StatusResult
	var stateFiles gitpreflight.InProgressStateFiles
	var statusErr error

	// F10 (P108 Part 16 review): captured before the spawns below — see Refs' own identical guard
	// and cacheGeneration's own doc comment. setHead below is skipped, not just this method's own
	// cache, since a stale head is exactly the same "serve pre-change data after the change already
	// invalidated it" hazard.
	gen := e.cacheGeneration()

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		recs, err := e.runRecords(ctx, porcelain.StatusArgs())
		if err != nil {
			statusErr = err
			return
		}
		statusResult, statusErr = porcelain.ParseStatus(recs)
	}()
	go func() {
		defer wg.Done()
		// A plain filesystem read, not a git spawn — no read-pool slot needed, and no serialization
		// concern against a concurrent Write.
		stateFiles = gitops.ReadInProgressStateFiles(e.Summary.GitDir)
	}()
	wg.Wait()
	if statusErr != nil {
		return porcelain.StatusResult{}, nil, statusErr
	}

	inProgress := gitpreflight.ClassifyInProgress(stateFiles, gitpreflight.UnmergedPaths(statusResult))
	if e.cacheGeneration() == gen {
		e.setHead(headStateFromStatusBranch(statusResult.Branch))
	}
	return statusResult, inProgress, nil
}

// Status is status.get's own query — the wire-shaped, display-capped summary (D11). The verdict
// pre-flight needs is always computed over the FULL, uncapped set: preflight.go's own callers read
// gitpreflight.DirtyPaths directly off statusAndInProgress's raw StatusResult, never off this
// method's own capped list.
func (e *RepoEntry) Status(ctx context.Context) (gitpreflight.StatusSummary, error) {
	statusResult, inProgress, err := e.statusAndInProgress(ctx)
	if err != nil {
		return gitpreflight.StatusSummary{}, err
	}
	summary := gitpreflight.SummarizeStatus(statusResult, inProgress)
	if len(summary.DirtyPaths) > gitpreflight.DirtyPathsDisplayCap {
		summary.DirtyPaths = summary.DirtyPaths[:gitpreflight.DirtyPathsDisplayCap]
		summary.DirtyTruncated = true
	}
	return summary, nil
}
