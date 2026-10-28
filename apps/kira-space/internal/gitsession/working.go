package gitsession

import (
	"context"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
)

// WorkingDetail is working.detail's own query: the file list behind the uncommitted-
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
		// The empty-tree hash is only a fixed constant WITHIN one hash algorithm (SHA-1 vs.
		// SHA-256 have different values) — derived here from this repository's own object format,
		// via a real spawn, rather than a hardcoded SHA-1-width literal that silently broke this
		// in a SHA-256 repo.
		hashRaw, herr := e.runOne(ctx, porcelain.EmptyTreeHashArgs())
		if herr != nil {
			return nil, herr
		}
		base = porcelain.ParseEmptyTreeHash(hashRaw)
	}

	changes, err := e.fileChanges(ctx, porcelain.WorkingNameStatusArgs(base))
	if err != nil {
		return nil, err
	}

	return appendUntracked(changes, statusResult.Entries)
}

// WorktreeChanges is WorkingDetail for a linked worktree at dir: staged, unstaged and untracked
// changes against that worktree's own HEAD, which it also returns (the left side of a diff). A
// detached or unborn HEAD diffs against the empty tree and returns "".
func (e *RepoEntry) WorktreeChanges(ctx context.Context, dir string) (head string, changes []porcelain.FileChange, err error) {
	_, head, err = e.WorktreeHead(ctx, dir)
	if err != nil {
		return "", nil, err
	}
	base := head
	if base == "" {
		hashRaw, herr := e.runOne(ctx, porcelain.EmptyTreeHashArgs())
		if herr != nil {
			return "", nil, herr
		}
		base = porcelain.ParseEmptyTreeHash(hashRaw)
	}
	raw, err := e.runOneInDir(ctx, dir, porcelain.WorkingNameStatusArgs(base))
	if err != nil {
		return "", nil, err
	}
	recs, err := allRecords(raw)
	if err != nil {
		return "", nil, err
	}
	changes, err = porcelain.ParseNameStatusRecords(recs)
	if err != nil {
		return "", nil, err
	}
	entries, err := e.WorktreeStatus(ctx, dir)
	if err != nil {
		return "", nil, err
	}
	changes, err = appendUntracked(changes, entries)
	return head, changes, err
}

// appendUntracked adds a bare FileChange per untracked status entry: a plain `git diff` never
// lists them (nothing to diff against). Same convention as gitsession/stash.go's untracked bucket.
func appendUntracked(changes []porcelain.FileChange, entries []porcelain.StatusEntry) ([]porcelain.FileChange, error) {
	for _, entry := range entries {
		if entry.Kind != "untracked" {
			continue
		}
		if entry.Path == "" {
			return nil, fmt.Errorf("gitsession: untracked status entry with empty path")
		}
		changes = append(changes, porcelain.FileChange{Kind: porcelain.FileAdded, Path: entry.Path})
	}
	return nonNil(changes), nil
}
