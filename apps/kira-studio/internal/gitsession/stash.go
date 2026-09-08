package gitsession

import (
	"context"
	"errors"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// ErrStashNotFound is stash.show/preflight.stashPop/preflight.stashBranch's own answer for a sha
// that no longer names any entry in the stash list — a caller mistake (the webview only ever passes
// a sha it read out of a previous stash.list result) or a genuine race (the stack changed between
// list and this call). gitrpc maps this to E_BAD_REQUEST, same as every other "the caller's own
// data is now stale" case this phase's neighbours already use (mapDetailError, detail.go).
var ErrStashNotFound = errors.New("gitsession: no stash entry matches this sha")

// distinctBaseShas collects every distinct StashEntry.BaseSha, preserving first-seen order — the
// small set StashBaseSubjectArgs' own batch spawn resolves in one call.
func distinctBaseShas(entries []porcelain.StashEntry) []string {
	seen := make(map[string]bool, len(entries))
	var out []string
	for _, e := range entries {
		if !seen[e.BaseSha] {
			seen[e.BaseSha] = true
			out = append(out, e.BaseSha)
		}
	}
	return out
}

// StashList is stash.list's own query (D3, probe 12): one spawn (StashListArgs) plus one small
// batch spawn resolving every distinct baseSha's own subject (model/stash.ts's own doc comment —
// %gs cannot name a PARENT commit's subject). Deliberately uncached: every mutating stash op and
// every stash preflight re-reads this immediately before acting, as its own sha-verification race
// guard (the contract's own "the service verifies... immediately before writing" convention) — a
// stale cached value here would be actively wrong, not merely imprecise.
func (e *RepoEntry) StashList(ctx context.Context) ([]porcelain.StashEntry, error) {
	listRaw, err := e.runOne(ctx, porcelain.StashListArgs())
	if err != nil {
		return nil, err
	}
	provisional, err := porcelain.ParseStashList(listRaw, nil)
	if err != nil {
		return nil, err
	}

	subjects := map[string]string{}
	if baseShas := distinctBaseShas(provisional); len(baseShas) > 0 {
		subjRaw, err := e.runOne(ctx, porcelain.StashBaseSubjectArgs(baseShas))
		if err != nil {
			return nil, err
		}
		subjects, err = porcelain.ParseStashBaseSubjects(subjRaw)
		if err != nil {
			return nil, err
		}
	}

	entries, err := porcelain.ParseStashList(listRaw, subjects)
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []porcelain.StashEntry{}
	}
	return entries, nil
}

// resolveStashEntry re-reads stash.list and returns the entry matching sha — the fresh read every
// stash.show/preflight.stashPop/preflight.stashBranch call starts from (contract.ts's own
// "verifies... immediately before writing" convention applies equally to a preflight read: a stack
// reshuffle between an earlier stash.list and this call is exactly the race that convention exists
// to catch).
func (e *RepoEntry) resolveStashEntry(ctx context.Context, sha string) (porcelain.StashEntry, error) {
	entries, err := e.StashList(ctx)
	if err != nil {
		return porcelain.StashEntry{}, err
	}
	for _, entry := range entries {
		if entry.Sha == sha {
			return entry, nil
		}
	}
	return porcelain.StashEntry{}, ErrStashNotFound
}

// StashShowResult is stash.show's own wire result — structurally matches contract.ts's
// `{sha, changes: FileChange[]}` exactly.
type StashShowResult struct {
	SHA     string                 `json:"sha"`
	Changes []porcelain.FileChange `json:"changes"`
}

// StashShow is stash.show's own query (D3, F9): the same NumstatArgs/NameStatusArgs pair
// commit.detail already uses, from the stash's own base to the stash commit itself, plus — when the
// stash has an untracked half — an ls-tree over the untracked helper commit's own tree, each path
// folded in as FileAdded (untracked content by definition has no "before").
func (e *RepoEntry) StashShow(ctx context.Context, sha string) (StashShowResult, error) {
	entry, err := e.resolveStashEntry(ctx, sha)
	if err != nil {
		return StashShowResult{}, err
	}

	numstatArgs, nameStatusArgs := porcelain.StashShowArgs(entry.BaseSha, entry.Sha)

	var numstat []porcelain.NumstatEntry
	var nameStatus []porcelain.NameStatusEntry
	var untrackedPaths []string
	var errs [3]error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		raw, rerr := e.runOne(ctx, numstatArgs)
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
		raw, rerr := e.runOne(ctx, nameStatusArgs)
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
	if entry.UntrackedSha != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			raw, rerr := e.runOne(ctx, porcelain.StashUntrackedLsTreeArgs(*entry.UntrackedSha))
			if rerr != nil {
				errs[2] = rerr
				return
			}
			recs, rerr := allRecords(raw)
			if rerr != nil {
				errs[2] = rerr
				return
			}
			untrackedPaths = make([]string, len(recs))
			for i, r := range recs {
				untrackedPaths[i] = string(r)
			}
		}()
	}
	wg.Wait()
	for _, spawnErr := range errs {
		if spawnErr != nil {
			return StashShowResult{}, spawnErr
		}
	}

	changes := porcelain.CombineFileChanges(numstat, nameStatus)
	for _, p := range untrackedPaths {
		changes = append(changes, porcelain.FileChange{Kind: porcelain.FileAdded, Path: p})
	}
	if changes == nil {
		changes = []porcelain.FileChange{}
	}
	return StashShowResult{SHA: sha, Changes: changes}, nil
}
