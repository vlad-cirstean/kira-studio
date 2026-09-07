package gitsession

import (
	"context"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpreflight"
)

// headStateFromStatusBranch mirrors gitpreflight's own (unexported) headStateFromBranch — status
// --branch's header already carries HEAD's identity for free, so statusAndInProgress can refresh
// the entry's live head without a third rev-parse/symbolic-ref spawn.
func headStateFromStatusBranch(b porcelain.StatusBranchInfo) gitclient.HeadState {
	if b.Detached {
		return gitclient.HeadState{Kind: "detached", SHA: b.OID}
	}
	if b.Unborn {
		return gitclient.HeadState{Kind: "unborn", Name: b.HeadName}
	}
	return gitclient.HeadState{Kind: "branch", Name: b.HeadName}
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

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		raw, err := e.runOne(ctx, porcelain.StatusArgs())
		if err != nil {
			statusErr = err
			return
		}
		recs, err := allRecords(raw)
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
	e.setHead(headStateFromStatusBranch(statusResult.Branch))
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
