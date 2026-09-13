package gitsession

import (
	"context"
	"path/filepath"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// RefsResult mirrors @kira/git-ipc's own refs.list result shape.
type RefsResult struct {
	Branches       []porcelain.RefRow  `json:"branches"`
	RemoteBranches []porcelain.RefRow  `json:"remoteBranches"`
	Tags           []porcelain.RefRow  `json:"tags"`
	Head           gitclient.HeadState `json:"head"`
}

// Refs is refs.list's own query (D10): cache-reading, dropped on refsChanged before the fan-out
// (entry.go's note). One value, not an LRU — a repository has one ref list.
func (e *RepoEntry) Refs(ctx context.Context) (RefsResult, error) {
	if cached, ok := e.refs.get(); ok {
		return cached, nil
	}
	result, err := e.refsSnapshot(ctx)
	if err != nil {
		return RefsResult{}, err
	}
	e.refs.set(result)
	return result, nil
}

// refsSnapshot is refs.list's ALWAYS-FRESH twin (D10/F16): both HeadsRefsArgs and TagRefsArgs,
// split by kind, %(worktreepath)-subtracted, and never read from the cache — pre-flight and the
// write executor's own checkout arm call this directly, never Refs, because a decision that
// precedes a write must see git's own current state, not a value that predates a `git fetch
// --prune` (or worse, resolve a target that no longer exists at all).
func (e *RepoEntry) refsSnapshot(ctx context.Context) (RefsResult, error) {
	headsRaw, err := e.runOne(ctx, porcelain.HeadsRefsArgs())
	if err != nil {
		return RefsResult{}, err
	}
	headsRows, err := porcelain.ParseRefRows(headsRaw, false)
	if err != nil {
		return RefsResult{}, err
	}

	tagsRaw, err := e.runOne(ctx, porcelain.TagRefsArgs())
	if err != nil {
		return RefsResult{}, err
	}
	tags, err := porcelain.ParseRefRows(tagsRaw, true)
	if err != nil {
		return RefsResult{}, err
	}

	branches := []porcelain.RefRow{}
	remoteBranches := []porcelain.RefRow{}
	var headBranch *porcelain.RefRow
	for i := range headsRows {
		r := headsRows[i]
		switch r.Kind {
		case "branch":
			branches = append(branches, r)
			if r.IsHead {
				hb := r
				headBranch = &hb
			}
		case "remoteBranch":
			remoteBranches = append(remoteBranches, r)
		}
	}
	if tags == nil {
		tags = []porcelain.RefRow{}
	}

	branches = subtractOwnWorktree(branches, e.Summary.Root)
	remoteBranches = subtractOwnWorktree(remoteBranches, e.Summary.Root)

	// %(HEAD) is authoritative for the overwhelmingly common case (on a branch) and free — no
	// third spawn. A detached or unborn HEAD is invisible to for-each-ref entirely, so those fall
	// back to Head(ctx), which re-resolves through ResolveHead only if a ref change since marked
	// it stale (D16) — stronger than upstream's own unconditional cache trust.
	var head gitclient.HeadState
	if headBranch != nil {
		head = gitclient.HeadState{Kind: "branch", Name: headBranch.ShortName}
		e.setHead(head)
	} else {
		head, err = e.Head(ctx)
		if err != nil {
			return RefsResult{}, err
		}
	}

	return RefsResult{Branches: branches, RemoteBranches: remoteBranches, Tags: tags, Head: head}, nil
}

// subtractOwnWorktree turns %(worktreepath) — populated for the branch checked out in ANY
// worktree, including this session's own (probe P2) — into "checked out ELSEWHERE": equal to our
// own root (both filepath.Clean'd, so a trailing separator can never produce a false positive) ⇒
// omitted; anything else ⇒ kept.
func subtractOwnWorktree(rows []porcelain.RefRow, ownRoot string) []porcelain.RefRow {
	root := filepath.Clean(ownRoot)
	out := make([]porcelain.RefRow, len(rows))
	for i, r := range rows {
		if r.CheckedOutIn != nil && filepath.Clean(*r.CheckedOutIn) == root {
			r.CheckedOutIn = nil
		}
		out[i] = r
	}
	return out
}

// resolvedCheckoutTarget is resolveCheckoutTarget's own output — the {kind, name} shape
// gitpreflight.ClassifyCheckout expects, plus the checkedOutIn it needs to build the fifth
// blocker.
type resolvedCheckoutTarget struct {
	Kind         string
	Name         string
	CheckedOutIn *string
}

// resolveCheckoutTarget resolves the wire's bare target string against a FRESH ref snapshot
// (never the cache, F16) into resolvedCheckoutTarget — branches checked before tags before remote
// branches, so a local branch always wins a same-named ambiguity. Anything matching none of the
// three is a raw sha, passed through verbatim: ClassifyCheckout's "sha" kind always detaches, and
// git itself refuses a target resolving to nothing when the argv actually runs.
func resolveCheckoutTarget(snapshot RefsResult, target string) resolvedCheckoutTarget {
	for _, r := range snapshot.Branches {
		if r.ShortName == target {
			return resolvedCheckoutTarget{Kind: "branch", Name: r.ShortName, CheckedOutIn: r.CheckedOutIn}
		}
	}
	for _, r := range snapshot.Tags {
		if r.ShortName == target {
			return resolvedCheckoutTarget{Kind: "tag", Name: r.ShortName}
		}
	}
	for _, r := range snapshot.RemoteBranches {
		if r.ShortName == target {
			return resolvedCheckoutTarget{Kind: "remoteBranch", Name: r.ShortName}
		}
	}
	return resolvedCheckoutTarget{Kind: "sha", Name: target}
}

// localNameForRemoteBranch: "origin/topic" -> "topic" — the executor's own choice of the actual
// branch name switchCreateTrackingArgs will create (F10's "origin/topic -> topic" heuristic,
// duplicated from gitpreflight's own stripRemotePrefix rather than imported: that one is a pure
// label concern, this one picks the argv's real branch name).
func localNameForRemoteBranch(remoteBranchName string) string {
	if i := strings.IndexByte(remoteBranchName, '/'); i >= 0 {
		return remoteBranchName[i+1:]
	}
	return remoteBranchName
}
