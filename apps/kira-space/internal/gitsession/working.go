package gitsession

import (
	"context"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
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
		// F18 cross-chunk fix (Part 14, flagged for Part 16's own reviewer): the empty-tree hash
		// is only a fixed constant WITHIN one hash algorithm (SHA-1 vs. SHA-256 have different
		// values) — derived here from this repository's own object format, via a real spawn,
		// rather than a hardcoded SHA-1-width literal that silently broke this in a SHA-256 repo.
		hashRaw, herr := e.runOne(ctx, porcelain.EmptyTreeHashArgs())
		if herr != nil {
			return nil, herr
		}
		base = porcelain.ParseEmptyTreeHash(hashRaw)
	}

	numstat, nameStatus, err := e.fileChanges(ctx, porcelain.WorkingNumstatArgs(base), porcelain.WorkingNameStatusArgs(base))
	if err != nil {
		return nil, err
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
