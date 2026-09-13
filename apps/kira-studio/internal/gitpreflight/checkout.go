package gitpreflight

import "strings"

// CheckoutTarget mirrors @kira/git-ipc's own CheckoutPreflight.target.
type CheckoutTarget struct {
	Kind string `json:"kind"` // RefKind ("branch"|"remoteBranch"|"tag") | "sha"
	Name string `json:"name"`
}

// CreatesTracking mirrors @kira/git-ipc's own CheckoutPreflight.createsTracking.
type CreatesTracking struct {
	Branch   string `json:"branch"`
	Upstream string `json:"upstream"`
}

// CheckoutBlocker mirrors @kira/git-ipc's own CheckoutBlocker discriminated union, flattened into
// one struct with omitempty on every kind-specific field (gitsock/handshake.go's own "one struct,
// a kind discriminant" convention) — Paths for blockedByTracked/blockedByUntracked, Operation for
// inProgressOperation, Branch/WorktreePath for worktreeConflict.
type CheckoutBlocker struct {
	Kind         string               `json:"kind"`
	Paths        []string             `json:"paths,omitempty"`
	Operation    *InProgressOperation `json:"operation,omitempty"`
	Branch       string               `json:"branch,omitempty"`
	WorktreePath string               `json:"worktreePath,omitempty"`
}

// CheckoutPreflight mirrors @kira/git-ipc's own CheckoutPreflight field for field.
type CheckoutPreflight struct {
	Target          CheckoutTarget    `json:"target"`
	Detaches        bool              `json:"detaches"`
	CreatesTracking *CreatesTracking  `json:"createsTracking,omitempty"`
	Carried         []string          `json:"carried"`
	Blockers        []CheckoutBlocker `json:"blockers"`
	Verdict         string            `json:"verdict"` // "clean" | "cleanCarry" | "blocked"
	// Routes: "discard" | "stashAndCarry" | "autoStash" | "detachHere" (G28 D2 adds the latter
	// two). The classifier's own verdict semantics do NOT change when either is present — verdict
	// stays "blocked", because that is what git itself would do; whether the app routes around the
	// refusal is policy, and policy lives client-side (D16), not in this pure function.
	Routes []string `json:"routes"`
}

// ClassifyCheckoutInput is ClassifyCheckout's own input — a direct port of preflight/checkout.ts's
// parameter object.
type ClassifyCheckoutInput struct {
	Target CheckoutTarget
	// Mode is the wire request's own explicit choice ("switch"|"detach") — "detach" is what turns
	// an otherwise-trackable remote branch into a plain detached checkout with no tracking branch
	// created. Not derivable from Target.Kind alone: a remoteBranch target can go either way.
	Mode  string
	Dirty []DirtyPath
	// Rewritten is T: the paths the checkout would rewrite (`git diff --name-only -z HEAD
	// <target>`).
	Rewritten []string
	// TargetTreePaths is reserved for a future caller with a real target-tree path set (G12's
	// stash-pop, never read by this function's own body): for a plain checkout every path in T is,
	// by construction, one the target tree either changes or adds, so "in T" and "in the target
	// tree" coincide already (D12).
	TargetTreePaths map[string]bool
	InProgress      *InProgressOperation
	// CheckedOutIn: set when the target ref is checked out in a linked worktree that is NOT this
	// session's own — the absolute path of that worktree (D12/probe P2).
	CheckedOutIn *string
	// StashAvailable: false through G5-G16 (D12) — G17 D8's preflightCheckout passes true
	// unconditionally, which alone is what turns the "stashAndCarry" route on.
	StashAvailable bool
}

// ClassifyCheckout is §7.5's checkout classifier — a SET INTERSECTION, not a merge simulation
// (docs/plans/P6.md's "The hard parts": a byte-identical local edit is still refused by git, which
// rules out a content-aware predictor as wrong, not merely unnecessary work). Ported verbatim from
// preflight/checkout.ts, including the exact blocker order (inProgressOperation, worktreeConflict,
// blockedByUntracked, blockedByTracked — the dialog renders the first as its headline, D12).
func ClassifyCheckout(in ClassifyCheckoutInput) CheckoutPreflight {
	rewrittenSet := make(map[string]bool, len(in.Rewritten))
	for _, p := range in.Rewritten {
		rewrittenSet[p] = true
	}

	trackedBlocked := []string{}
	untrackedBlocked := []string{}
	carried := []string{}
	for _, d := range in.Dirty {
		if rewrittenSet[d.Path] {
			if d.Tracked {
				trackedBlocked = append(trackedBlocked, d.Path)
			} else {
				untrackedBlocked = append(untrackedBlocked, d.Path)
			}
			continue
		}
		carried = append(carried, d.Path)
	}

	blockers := []CheckoutBlocker{}
	if in.InProgress != nil {
		blockers = append(blockers, CheckoutBlocker{Kind: "inProgressOperation", Operation: in.InProgress})
	}
	if in.CheckedOutIn != nil {
		blockers = append(blockers, CheckoutBlocker{Kind: "worktreeConflict", Branch: in.Target.Name, WorktreePath: *in.CheckedOutIn})
	}
	if len(untrackedBlocked) > 0 {
		blockers = append(blockers, CheckoutBlocker{Kind: "blockedByUntracked", Paths: untrackedBlocked})
	}
	if len(trackedBlocked) > 0 {
		blockers = append(blockers, CheckoutBlocker{Kind: "blockedByTracked", Paths: trackedBlocked})
	}

	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case len(carried) > 0:
		verdict = "cleanCarry"
	}

	// Discard cannot clear an untracked block (probe P9) — if one is present, no route helps,
	// regardless of whether a tracked block is present alongside it.
	routes := []string{}
	if len(trackedBlocked) > 0 && len(untrackedBlocked) == 0 {
		routes = append(routes, "discard")
		if in.StashAvailable {
			routes = append(routes, "stashAndCarry")
		}
	}
	// G28 D2: autoStash is the ONLY route that clears an untracked block too (F5/probe P15: `stash
	// push -u` is the one argv proven to clear both blocker classes in one write) — so, unlike
	// "discard"/"stashAndCarry" above, it is offered whenever EITHER dirty blocker is present, not
	// only the tracked-only case. Withheld when an operation is already in progress (F15/probe P17:
	// `stash push` mid-conflict fails with empty stderr, which the host-side gate in prepareCheckout
	// refuses before ever building this argv — the route itself must not be offered for a state
	// where taking it would only produce an unclassifiable failure).
	if in.StashAvailable && in.InProgress == nil && (len(trackedBlocked) > 0 || len(untrackedBlocked) > 0) {
		routes = append(routes, "autoStash")
	}
	// G28 D6: offered whenever the worktree-conflict blocker is present, for a switch to a
	// branch/remote-branch target — a tag or raw-sha target already detaches on its own (Detaches
	// below), and an explicit detach-mode request is already the thing this route would do, so
	// offering it there would be a route to an outcome the caller already asked for. Probe P14:
	// `git switch --detach <branch>` succeeds where a plain switch fails with exit 128 against a
	// branch checked out in another worktree. Deliberately independent of trackedBlocked/
	// untrackedBlocked (plan §3.8's own "worktree conflict + dirty -> BOTH routes" case): a target
	// can be simultaneously checked out elsewhere AND have a dirty tree that would be overwritten,
	// and the two routes compose client-side (D16) into one re-issued request carrying both
	// mode:'detach' and autoStash:true — this classifier only needs to report that each is
	// individually available, not resolve their interaction.
	if in.CheckedOutIn != nil && in.InProgress == nil && in.Mode == "switch" &&
		(in.Target.Kind == "branch" || in.Target.Kind == "remoteBranch") {
		routes = append(routes, "detachHere")
	}

	// A tag or a raw sha always detaches regardless of the requested mode (git itself refuses a
	// plain switch to either); a branch or remote-branch target detaches only when the caller
	// explicitly asked for "detach" mode. Tracking-branch creation is the DWIM-avoidance path for a
	// DEFAULT checkout of a bare remote ref — an explicit detach skips landing on a branch at all,
	// so no tracking branch is created even for a remoteBranch target.
	detaches := in.Mode == "detach" || in.Target.Kind == "tag" || in.Target.Kind == "sha"
	var creates *CreatesTracking
	if in.Mode == "switch" && in.Target.Kind == "remoteBranch" {
		creates = &CreatesTracking{Branch: stripRemotePrefix(in.Target.Name), Upstream: in.Target.Name}
	}

	return CheckoutPreflight{
		Target: in.Target, Detaches: detaches, CreatesTracking: creates,
		Carried: carried, Blockers: blockers, Verdict: verdict, Routes: routes,
	}
}

// stripRemotePrefix: "origin/topic" -> "topic". A heuristic (a remote name with a slash in it
// defeats it) — good enough because the label always states which branch it will create rather
// than acting on the guess silently (§11.2's sibling judgment call, upstream's own).
func stripRemotePrefix(remoteBranchName string) string {
	if i := strings.IndexByte(remoteBranchName, '/'); i >= 0 {
		return remoteBranchName[i+1:]
	}
	return remoteBranchName
}
