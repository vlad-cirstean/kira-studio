package ade

import "sort"

// facts.go is P129 Part 2 §4's own pure facts engine: plain functions over plain inputs (no git, no
// DB, no bridge) encoding the six rules the SPEC row and this plan's §0 actually need tested as
// interacting logic (CLAUDE.md's own test bar) — inferParents (§0.5), pairFacts (§0.7), mergedRule
// (§0.8), rebindCandidates (§0.10), colorSlot (§0.13), atRisk (§0.9). Everything else in §4.2
// ("branch facts": ahead/behind, files, commits, dirty, upstream tracking, unpushed) is a straight
// git-backed assembly with no algorithm of its own to isolate — it lives in queue.go, alongside the
// git reads it assembles, not here (§4.5 lists no test for it, only for the six functions below).

// maxColorSlots mirrors storage/repos.maxColorSlots (§0.13) — this package cannot import that leaf
// package's own private constant (nor would it want to: colorSlot is a pure, from-scratch encoding
// of the same rule storage/repos.assignColorSlot applies transactionally over SQL, kept in sync by
// hand since a shared import would need the layering CLAUDE.md forbids, storage/repos -> internal/ade).
const maxColorSlots = 20

// ---------------------------------------------------------------------------------------
// inferParents (§0.5)
// ---------------------------------------------------------------------------------------

// branchNode is inferParents' own per-item input: everything the parent rule needs about one
// queued, non-archived, existing branch, already resolved from git by the caller (queue.go).
type branchNode struct {
	Merged bool
	// ConfigParent is branch.<b>.kirastackparent (gitops.StackParentKey), "" when unset.
	ConfigParent string
	// StartFrom is ade_branches.start_from, "" when unset.
	StartFrom string
	// Ancestors lists the OTHER queued items whose tip is a genuine, strict ancestor of this
	// node's own tip (a tip identical to this node's own is never included here — the caller's own
	// contract, since git counts a commit an ancestor of itself and that is never what rule 2
	// means by "stacked on").
	Ancestors []string
	// MergeBaseEqualsStartFrom is rule 3's own test: StartFrom names another queued item, and that
	// item's CURRENT tip equals git merge-base(this node's tip, that item's tip) — this branch has
	// not diverged from where it started (covers the equal-tip case: freshly branched, zero commits
	// of its own yet, so Ancestors is empty and rule 2 never fires).
	MergeBaseEqualsStartFrom bool
}

// inferParents implements §0.5's own four-rule parent inference plus its cycle guard: a parent
// chain revisiting a branch falls back to main ("") for the branch whose own choice closes the
// cycle. depths gives each queued item's own distance from main (count(mainRef..tip), §4.2's own
// unpushedVsMain — reused, not recomputed) — rule 2's own "deepest ancestor" tie-break input.
// Processes items in sorted key order so a cycle always breaks the same way regardless of Go's
// randomized map iteration.
func inferParents(nodes map[string]branchNode, depths map[string]int) map[string]string {
	items := make([]string, 0, len(nodes))
	for item := range nodes {
		items = append(items, item)
	}
	sort.Strings(items)

	parent := make(map[string]string, len(nodes))
	for _, item := range items {
		parent[item] = inferOneParent(nodes[item], nodes, depths)
	}
	for _, item := range items {
		breakCycleFrom(item, parent)
	}
	return parent
}

// inferOneParent applies §0.5's own rules 1-4, in order, for one node.
func inferOneParent(node branchNode, nodes map[string]branchNode, depths map[string]int) string {
	// Rule 1: config parent naming another queued, non-merged branch.
	if node.ConfigParent != "" {
		if p, ok := nodes[node.ConfigParent]; ok && !p.Merged {
			return node.ConfigParent
		}
	}

	// Rule 2: nearest queued, non-merged strict ancestor — "nearest" = deepest (largest depths
	// value), tie broken by the start_from hint, then lexicographically smallest name.
	best, bestDepth := "", -1
	for _, a := range node.Ancestors {
		p, ok := nodes[a]
		if !ok || p.Merged {
			continue
		}
		d := depths[a]
		switch {
		case d > bestDepth:
			best, bestDepth = a, d
		case d == bestDepth && best != node.StartFrom && (a == node.StartFrom || a < best):
			best = a
		}
	}
	if best != "" {
		return best
	}

	// Rule 3: start_from hint, only when it is itself queued, non-merged, and this branch has not
	// diverged from it yet.
	if node.StartFrom != "" && node.MergeBaseEqualsStartFrom {
		if p, ok := nodes[node.StartFrom]; ok && !p.Merged {
			return node.StartFrom
		}
	}

	// Rule 4: main.
	return ""
}

// breakCycleFrom walks parent's chain starting at item, and if it revisits an already-seen node,
// sets the REVISITING node's own parent to "" (main) — "the branch that closes the cycle" (§0.5).
func breakCycleFrom(item string, parent map[string]string) {
	seen := map[string]bool{item: true}
	cur := item
	for {
		p, ok := parent[cur]
		if !ok || p == "" {
			return
		}
		if seen[p] {
			parent[cur] = ""
			return
		}
		seen[p] = true
		cur = p
	}
}

// ---------------------------------------------------------------------------------------
// pairFacts (§0.7, §4.3)
// ---------------------------------------------------------------------------------------

// pairItem is pairFacts' own per-item input.
type pairItem struct {
	Item, Tip string
	Kind      string // "mine" | "review" | "parked"
	Merged    bool
	// Files is this item's own changed-file set (§4.2's own "files"), keyed by path.
	Files map[string]bool
}

// pair is pairFacts' own output row — AdePair's own domain shape, pre-sort.
type pair struct {
	A, B      string
	Shared    []string
	Conflicts []string
}

// pairFacts computes §0.7's own conflict/share table over items: for each unordered pair with `a`
// mine and `b` mine-or-review, neither parked nor merged, neither an ancestor of the other, and a
// non-empty own-file intersection, it calls mergeTree(tipA, tipB) — ordered so a repeat call with
// the same two tips is a cache hit at the CALLER's own layer (§4.2's tip-keyed LRU; this function
// itself holds no cache, it only ever asks once per passing pair per call). isAncestor(x, y) reports
// whether x or y is a (queued) ancestor of the other, in either order. Output sorted by (a, b).
func pairFacts(items []pairItem, isAncestor func(x, y string) bool, mergeTree func(tipA, tipB string) ([]string, error)) ([]pair, error) {
	var pairs []pair
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			a, b, ok := orderPair(items[i], items[j])
			if !ok {
				continue
			}
			if a.Merged || b.Merged || a.Kind == "parked" || b.Kind == "parked" {
				continue
			}
			if isAncestor(a.Item, b.Item) {
				continue
			}
			shared := sharedFiles(a.Files, b.Files)
			if len(shared) == 0 {
				continue
			}
			conflictedPaths, err := mergeTree(a.Tip, b.Tip)
			if err != nil {
				return nil, err
			}
			pairs = append(pairs, pair{A: a.Item, B: b.Item, Shared: shared, Conflicts: intersectSorted(conflictedPaths, shared)})
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].A != pairs[j].A {
			return pairs[i].A < pairs[j].A
		}
		return pairs[i].B < pairs[j].B
	})
	return pairs, nil
}

// orderPair applies §0.7's own kind filter and ordering: `a` mine x `b` mine-or-review only: a
// mine×review pair always orders `a` mine; a mine×mine pair orders `a`/`b` by name. Any other kind
// combination (review×review, either parked) is not a pair at all.
func orderPair(x, y pairItem) (a, b pairItem, ok bool) {
	switch {
	case x.Kind == "mine" && y.Kind == "mine":
		if x.Item <= y.Item {
			return x, y, true
		}
		return y, x, true
	case x.Kind == "mine" && y.Kind == "review":
		return x, y, true
	case y.Kind == "mine" && x.Kind == "review":
		return y, x, true
	default:
		return pairItem{}, pairItem{}, false
	}
}

func sharedFiles(a, b map[string]bool) []string {
	var out []string
	for f := range a {
		if b[f] {
			out = append(out, f)
		}
	}
	sort.Strings(out)
	return out
}

func intersectSorted(paths, shared []string) []string {
	sharedSet := make(map[string]bool, len(shared))
	for _, s := range shared {
		sharedSet[s] = true
	}
	var out []string
	for _, p := range paths {
		if sharedSet[p] {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out
}

// ---------------------------------------------------------------------------------------
// mergedRule (§0.8)
// ---------------------------------------------------------------------------------------

// mergedRule implements §0.8: merged iff (the tip is reachable from main AND had_commits) or the
// raw PR state is exactly "merged" (covers squash/rebase merges, whose tip never becomes an
// ancestor of main). prState is ResolveBranchPr's own raw State when a PR is known, "" otherwise.
func mergedRule(tipReachableFromMain, hadCommits bool, prState string) bool {
	if tipReachableFromMain && hadCommits {
		return true
	}
	return prState == "merged"
}

// ---------------------------------------------------------------------------------------
// rebindCandidates (§0.10)
// ---------------------------------------------------------------------------------------

// rebindCandidate is rebindCandidates' own per-branch input — one local branch not yet ruled out.
type rebindCandidate struct {
	Name                       string
	CheckedOutInLinkedWorktree bool
	Queued, Archived           bool
	// HasReflog/ReflogCreatedAtUnix are ReflogCreatedAt's own (value, ok) pair — no reflog history
	// (never existed, or reflog disabled) excludes the candidate outright.
	HasReflog           bool
	ReflogCreatedAtUnix int64
}

// rebindDecision is rebindCandidates' own result: Bind is the branch to rebind to ("" = no
// auto-bind); Candidates (only populated when Bind == "" and more than one branch qualifies) is the
// ambiguous set to serve as branchCandidates, sorted by name.
type rebindDecision struct {
	Bind       string
	Candidates []string
}

// rebindCandidates implements §0.10: with branchName set, bind it once it exists among candidates,
// full stop (never falls through to the heuristic below — a typed name that does not exist yet
// stays unbound with no candidates served, since the user already named their own intent). Without
// it, auto-bind only when exactly one candidate is a local branch not queued or archived, checked
// out in a linked worktree, whose reflog creation time is at or after
// firstSessionStartedAtUnix-5s; more than one such candidate: stay unbound and serve every matching
// name. firstSessionStartedAtUnix and each candidate's ReflogCreatedAtUnix are both unix SECONDS —
// the caller (queue.go) converts ade_sessions' own millisecond timestamps before calling.
func rebindCandidates(branchName string, firstSessionStartedAtUnix int64, candidates []rebindCandidate) rebindDecision {
	if branchName != "" {
		for _, c := range candidates {
			if c.Name == branchName {
				return rebindDecision{Bind: branchName}
			}
		}
		return rebindDecision{}
	}

	cutoff := firstSessionStartedAtUnix - 5
	var matches []string
	for _, c := range candidates {
		if c.Queued || c.Archived || !c.CheckedOutInLinkedWorktree || !c.HasReflog {
			continue
		}
		if c.ReflogCreatedAtUnix >= cutoff {
			matches = append(matches, c.Name)
		}
	}
	sort.Strings(matches)
	if len(matches) == 1 {
		return rebindDecision{Bind: matches[0]}
	}
	return rebindDecision{Candidates: matches}
}

// ---------------------------------------------------------------------------------------
// colorSlot (§0.13)
// ---------------------------------------------------------------------------------------

// colorSlot is §0.13's own pure encoding of the slot-assignment rule storage/repos.assignColorSlot
// applies transactionally over SQL (that function's own doc comment explains why the two cannot
// share code: storage/repos is a leaf package internal/ade already depends on, so the reverse
// import direction CLAUDE.md's layering rule requires is unavailable). visible holds every slot
// currently used by a non-archived item in the repo (an archived item's own slot is not "visible",
// §0.13's own "same set as the mockup's visible = in queue, not archived"); usageCount holds each
// slot's own total use count across all history, archived included, for the tie-break once every
// slot 0..19 is visible-used.
func colorSlot(visible map[int]bool, usageCount map[int]int) int {
	for slot := 0; slot < maxColorSlots; slot++ {
		if !visible[slot] {
			return slot
		}
	}
	best, bestCount := 0, -1
	for slot := 0; slot < maxColorSlots; slot++ {
		if bestCount == -1 || usageCount[slot] < bestCount {
			best, bestCount = slot, usageCount[slot]
		}
	}
	return best
}

// ---------------------------------------------------------------------------------------
// atRisk (§0.9)
// ---------------------------------------------------------------------------------------

// atRiskInput is atRisk's own per-item input.
type atRiskInput struct {
	IsNewWork         bool
	Kind              string // "mine" | "review" | "parked" — ignored when IsNewWork
	Merged            bool
	HasLinkedWorktree bool
	// DirtyCount is the linked (or main) worktree's own dirty-path count; meaningless (and unread)
	// when HasLinkedWorktree is false.
	DirtyCount int
	// UnmergedAheadOfMain is count(mainRef..tip); meaningless (and unread) for review or a merged
	// branch.
	UnmergedAheadOfMain int
}

// atRiskResult is atRisk's own output.
type atRiskResult struct {
	Dirty    int
	Unmerged int
}

// atRisk implements §0.9's own deliberate deviation from the design: dirty paths count for ANY
// branch with a linked worktree, review included (removing a dirty worktree discards them
// regardless of whose branch it is) — never for new work, which has no worktree of its own to lose
// anything from. Unmerged commits ahead of main count only for mine/parked, and only while unmerged
// (a merged branch's own history is safe in main already).
func atRisk(in atRiskInput) atRiskResult {
	if in.IsNewWork {
		return atRiskResult{}
	}
	var out atRiskResult
	if in.HasLinkedWorktree {
		out.Dirty = in.DirtyCount
	}
	if (in.Kind == "mine" || in.Kind == "parked") && !in.Merged {
		out.Unmerged = in.UnmergedAheadOfMain
	}
	return out
}
