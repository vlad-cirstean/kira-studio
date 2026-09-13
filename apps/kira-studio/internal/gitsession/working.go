package gitsession

import (
	"context"
	"fmt"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// WorkingDetail is working.detail's own query (P7, item 2): the file list behind the uncommitted-
// changes strip's click-through, composed the same way CommitDetail composes commit.detail's own —
// a status spawn first (statusAndInProgress, already shared with Status/preflight/RunOp), then the
// two working-tree diff spawns concurrently. Unlike CommitDetail, never cached: the working tree
// changes on every save, and entry.go's cache-drop signal (SignalRefsChanged) does not fire on a
// worktree edit, so a cached answer here would be wrong far more often than CommitDetail's
// immutable-sha-keyed cache ever is (the same reasoning Status itself already applies).
func (e *RepoEntry) WorkingDetail(ctx context.Context) ([]porcelain.FileChange, error) {
	statusResult, _, err := e.statusAndInProgress(ctx)
	if err != nil {
		return nil, err
	}

	base := "HEAD"
	if statusResult.Branch.Unborn {
		base = porcelain.EmptyTreeSHA
	}

	var (
		numstat    []porcelain.NumstatEntry
		nameStatus []porcelain.NameStatusEntry
		errs       [2]error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.WorkingNumstatArgs(base))
		if rerr != nil {
			errs[0] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			errs[0] = rerr
			return
		}
		numstat, errs[0] = porcelain.ParseNumstatRecords(recs)
	}()
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, porcelain.WorkingNameStatusArgs(base))
		if rerr != nil {
			errs[1] = rerr
			return
		}
		recs, rerr := allRecords(raw)
		if rerr != nil {
			errs[1] = rerr
			return
		}
		nameStatus, errs[1] = porcelain.ParseNameStatusRecords(recs)
	}()
	wg.Wait()
	for _, spawnErr := range errs {
		if spawnErr != nil {
			return nil, spawnErr
		}
	}

	changes := porcelain.CombineFileChanges(numstat, nameStatus)
	// Untracked files never appear in a plain `git diff` at all (nothing to diff against) — the
	// same gap gitsession/stash.go's own untracked bucket already has an answer for: a bare
	// FileChange, no additions/deletions, mirrored verbatim here rather than inventing a second
	// convention.
	for _, entry := range statusResult.Entries {
		if entry.Kind != "untracked" {
			continue
		}
		if entry.Path == "" {
			return nil, fmt.Errorf("gitsession: WorkingDetail: untracked status entry with empty path")
		}
		changes = append(changes, porcelain.FileChange{Kind: porcelain.FileAdded, Path: entry.Path})
	}
	return changes, nil
}
