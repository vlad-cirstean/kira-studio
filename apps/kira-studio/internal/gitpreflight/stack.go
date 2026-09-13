// G26's own pure model: the nine wire types D17 counts for this phase's contract bump, plus
// ParseStackConfig/BuildStacks/ClassifyRestack — every one of them a pure function over plain data,
// exactly like this package's other classifiers (ClassifyCheckout/ClassifyReset). No spawn, no
// filesystem: gitsession/stack.go is the only place that ever runs a git process for the stack
// feature, and it does so BEFORE calling into this file, never after.
//
// D4's one rule underlies everything here: staleness is `behind > 0` from `rev-list --left-right`
// and NOTHING else — never a stored plan, never merge-base inference on its own (F4/probe P6 shows
// that is provably wrong the moment a parent is amended). BuildStacks/ClassifyRestack both take
// pre-computed behind/ahead counts as input; they never guess at them.
package gitpreflight

import "strings"

// MaxStackedBranches (D3) bounds both the number of `rev-list --left-right` spawns a stack.list
// costs and the number of iterations a cycle walk will ever take — a pre-existing cycle in a
// hand-edited config cannot spin BuildStacks/ClassifyRestack's own cycle detection. A branch beyond
// the cap is still listed (never silently dropped) but with behind/ahead left at zero, since no
// spawn was made for it.
const MaxStackedBranches = 64

// StackBranchState mirrors @kira/git-ipc's own StackBranchState verbatim (D3).
type StackBranchState string

const (
	StackUpToDate      StackBranchState = "upToDate"
	StackNeedsRestack  StackBranchState = "needsRestack"
	StackParentMissing StackBranchState = "parentMissing"
)

// StackBranch mirrors @kira/git-ipc's own StackBranch field for field (D3/D5's encoding rule: an
// absent optional field is omitted, never present-and-null). Track is `porcelain.RefTrack{} |
// "gone" | nil` (F14: reused verbatim from RefRow) — `any` reproduces that three-way union exactly
// as porcelain.RefRow.Track already does, at the same caller-visible-type-switch cost.
type StackBranch struct {
	Name string `json:"name"`
	// Parent is the recorded parent's name — a local branch in this same stack, or the stack's
	// base — EVEN WHEN it does not currently resolve (an orphan's own Parent still names what was
	// recorded, so the client can render "parent 'x' no longer exists").
	Parent string `json:"parent"`
	// Depth is 0 for a branch sitting directly on the stack's base; meaningless (left 0) for an
	// orphan.
	Depth        int     `json:"depth"`
	Tip          string  `json:"tip"`
	ParentTip    *string `json:"parentTip,omitempty"` // nil ⇒ parentMissing
	RecordedBase *string `json:"recordedBase,omitempty"`
	// Behind: commits on the parent this branch does not have — > 0 ⇒ needsRestack (D4). Always 0
	// for an orphan (there is no parent tip to diff against).
	Behind int `json:"behind"`
	// Ahead: this branch's own commits since the merge base with its parent.
	Ahead        int              `json:"ahead"`
	State        StackBranchState `json:"state"`
	CheckedOutIn *string          `json:"checkedOutIn,omitempty"`
	Track        any              `json:"track,omitempty"`
	IsHead       bool             `json:"isHead"`
}

// StackSummary mirrors @kira/git-ipc's own StackSummary field for field.
type StackSummary struct {
	// Base is the branch (or remote-tracking branch) every root in this stack sits on — itself
	// never a member of Branches (D1: a branch with no kirastack config of its own, or a
	// remote-tracking ref, is a base, never a stack member).
	Base string `json:"base"`
	// BaseTip is nil only when Base is a remote-tracking branch that has since been pruned —
	// D3/F14 never spawns a second read to confirm it, the refs snapshot already has it or not.
	BaseTip *string `json:"baseTip,omitempty"`
	// Branches is pre-order, bottom-to-top (D3): a parent always precedes every one of its
	// children, and Depth carries the tree shape without a recursive wire type.
	Branches     []StackBranch `json:"branches"`
	NeedsRestack bool          `json:"needsRestack"`
}

// StackListResult mirrors @kira/git-ipc's own StackListResult field for field.
type StackListResult struct {
	Stacks []StackSummary `json:"stacks"`
	// Orphans: branches whose recorded parent no longer resolves to any ref, or that sit in a
	// cycle — never silently dropped (D3's own doc comment), always surfaced with a remedy. Their
	// own State is always StackParentMissing (a cycle offers no more of a "commit ahead/behind"
	// concept than a dangling parent does), ParentTip is always nil, and Depth is always 0.
	Orphans []StackBranch `json:"orphans"`
}

// RestackBlocker mirrors @kira/git-ipc's own RestackBlocker discriminated union, flattened into one
// struct with omitempty on every kind-specific field — the same convention CheckoutBlocker already
// established in this package.
type RestackBlocker struct {
	Kind         string               `json:"kind"`
	Operation    *InProgressOperation `json:"operation,omitempty"`
	Branch       string               `json:"branch,omitempty"`
	Branches     []string             `json:"branches,omitempty"`
	Parent       string               `json:"parent,omitempty"`
	WorktreePath string               `json:"worktreePath,omitempty"`
	Paths        []string             `json:"paths,omitempty"`
}

// RestackPlanEntry mirrors @kira/git-ipc's own RestackPlanEntry field for field.
type RestackPlanEntry struct {
	Branch     string `json:"branch"`
	Parent     string `json:"parent"`
	Base       string `json:"base"`
	BaseSource string `json:"baseSource"` // "recorded" | "mergeBase"
	Commits    int    `json:"commits"`
	Reason     string `json:"reason"` // "stale" | "ancestorRestacked"
}

// RestackPreflight mirrors @kira/git-ipc's own RestackPreflight field for field (D14).
type RestackPreflight struct {
	Base           string             `json:"base"`
	Plan           []RestackPlanEntry `json:"plan"`
	Blockers       []RestackBlocker   `json:"blockers"`
	Verdict        string             `json:"verdict"` // "clean" | "noop" | "blocked"
	RestoresHead   string             `json:"restoresHead"`
	NeedsForcePush []string           `json:"needsForcePush"`
	Routes         []string           `json:"routes"` // "stashFirst"
}

// StackConfigEntry is one branch's raw, unresolved config row — ParseStackConfig's own output
// shape, before BuildStacks resolves it against live refs. "" means "not set" for either field
// (D2: never absent, always the empty string once a key has ever been written, but ALSO genuinely
// absent for a branch that was never stacked at all — ParseStackConfig does not distinguish the
// two, since D4/D14 only ever ask "is this non-empty", never "was this key ever written").
type StackConfigEntry struct {
	Branch string
	Parent string
	Base   string
}

const stackParentSuffix = ".kirastackparent"
const stackBaseSuffix = ".kirastackbase"

// ParseStackConfig parses D1/probe P3's own `git config --local --null --get-regexp
// '^branch\..*\.kirastack'` output: NUL-terminated records, key and value separated by a NEWLINE —
// byte-identical to the framing gitsession's own parsePullConfig already reads (a different
// package, the same git behaviour). Case-insensitive on the "branch." prefix and the ".kirastack*"
// suffix (probe P1: git lowercases the variable name on write, but this parser trusts nothing about
// case); the branch name's own case is read from the ORIGINAL key, never the lowercased copy, so
// indices stay valid (lower-casing never changes a string's length). Never splits on "." (probe P4:
// a branch named "feat.x" round-trips as branch.feat.x.kirastackparent, matched by stripping the
// known prefix and suffix, not by field-splitting).
func ParseStackConfig(raw []byte) map[string]StackConfigEntry {
	out := map[string]StackConfigEntry{}
	for _, rec := range strings.Split(string(raw), "\x00") {
		if rec == "" {
			continue
		}
		parts := strings.SplitN(rec, "\n", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := parts[0], parts[1]
		lowerKey := strings.ToLower(key)
		if !strings.HasPrefix(lowerKey, "branch.") {
			continue
		}
		rest := key[len("branch."):]
		lowerRest := lowerKey[len("branch."):]

		var branch string
		var isParent, isBase bool
		switch {
		case strings.HasSuffix(lowerRest, stackParentSuffix):
			branch = rest[:len(rest)-len(stackParentSuffix)]
			isParent = true
		case strings.HasSuffix(lowerRest, stackBaseSuffix):
			branch = rest[:len(rest)-len(stackBaseSuffix)]
			isBase = true
		default:
			continue
		}
		if branch == "" {
			continue
		}

		entry := out[branch]
		entry.Branch = branch
		trimmed := strings.TrimSpace(value)
		if isParent {
			entry.Parent = trimmed
		}
		if isBase {
			entry.Base = trimmed
		}
		out[branch] = entry
	}
	return out
}

// resolveState is DetectCycleFrom/resolveStackBase's own shared cycle-walk bookkeeping.
type resolveState int

const (
	resolveUnvisited resolveState = iota
	resolveInProgress
	resolveOK
	resolveBroken
)

type resolvedNode struct {
	state resolveState
	base  string
}

// DetectCycleFrom walks parent pointers up from start (D10's own stackSet cycle check, and this
// file's own orphan/cycle discrimination): returns the ordered list of branch names in the cycle
// (starting at start) the moment a repeat is found, or nil if the walk reaches a resolvable base or
// a dangling parent first. Bounded by MaxStackedBranches iterations (D3's own stated defence: a
// pre-existing cycle in a hand-edited config cannot spin this).
func DetectCycleFrom(config map[string]StackConfigEntry, start string) []string {
	visited := map[string]int{start: 0}
	order := []string{start}
	current := start
	for i := 0; i < MaxStackedBranches; i++ {
		entry, ok := config[current]
		if !ok || entry.Parent == "" {
			return nil // reached an unstacked base — no cycle.
		}
		parent := entry.Parent
		if idx, seen := visited[parent]; seen {
			return order[idx:] // the cycle itself, starting at the repeated node.
		}
		visited[parent] = len(order)
		order = append(order, parent)
		current = parent
	}
	return nil // budget exhausted without a repeat — treated as broken, not a cycle, by the caller.
}

// existsAsRef is the narrow "does this name resolve to some ref at all" predicate BuildStacks needs
// — local branch OR remote-tracking branch (D1: a stack's base may be either).
type existsAsRef func(name string) bool

// resolveStackBase is BuildStacks' own per-branch memoized walk: returns the ultimate resolvable
// base name for branch, or resolveBroken when the chain hits a dangling parent, a cycle, or the
// iteration budget (MaxStackedBranches) first. Memoized so a forest of depth d costs O(n) total,
// not O(n*d).
func resolveStackBase(branch string, config map[string]StackConfigEntry, exists existsAsRef, memo map[string]resolvedNode, budget *int) resolvedNode {
	if n, ok := memo[branch]; ok && n.state != resolveInProgress {
		return n
	}
	memo[branch] = resolvedNode{state: resolveInProgress}

	entry, hasEntry := config[branch]
	parent := ""
	if hasEntry {
		parent = entry.Parent
	}
	if parent == "" {
		n := resolvedNode{state: resolveOK, base: branch}
		memo[branch] = n
		return n
	}

	*budget--
	if *budget < 0 {
		n := resolvedNode{state: resolveBroken}
		memo[branch] = n
		return n
	}

	parentEntry, parentHasEntry := config[parent]
	parentIsStacked := parentHasEntry && parentEntry.Parent != ""
	if !parentIsStacked {
		if !exists(parent) {
			n := resolvedNode{state: resolveBroken}
			memo[branch] = n
			return n
		}
		n := resolvedNode{state: resolveOK, base: parent}
		memo[branch] = n
		return n
	}

	if existing, ok := memo[parent]; ok && existing.state == resolveInProgress {
		n := resolvedNode{state: resolveBroken} // a cycle, detected mid-walk.
		memo[branch] = n
		return n
	}
	resolved := resolveStackBase(parent, config, exists, memo, budget)
	memo[branch] = resolved
	return resolved
}

// StackRefInfo is BuildStacks' own per-local-branch input row — the subset of porcelain.RefRow
// F14 says the stack view needs, plus the base's own tip (looked up the same way for a
// remote-tracking base).
type StackRefInfo struct {
	Tip          string
	CheckedOutIn *string
	Track        any
	IsHead       bool
	HasUpstream  bool
}

// BuildStacksInput is BuildStacks' own parameter object (D3): every value already resolved by the
// caller — gitsession.Stacks() reads the config, the refs snapshot, and spawns exactly one
// `rev-list --left-right` per candidate stacked branch (bounded by MaxStackedBranches) before ever
// calling this pure function.
type BuildStacksInput struct {
	Config map[string]StackConfigEntry
	// LocalRefs: every local branch that currently exists, keyed by short name.
	LocalRefs map[string]StackRefInfo
	// BaseTips: the tip of every name that could be a base — local branches (duplicated from
	// LocalRefs for a uniform lookup) and remote-tracking branches.
	BaseTips map[string]string
	// BehindAhead: behind/ahead counts (D4/porcelain.LeftRightCountArgs), keyed by branch name —
	// present only for branches gitsession actually spawned a count for (the first
	// MaxStackedBranches candidates in sorted order); a branch with no entry here is treated as
	// behind=0/ahead=0 (D3's own truncation clause: never dropped, just uncounted).
	BehindAhead map[string]LeftRightCount
}

// LeftRightCount is porcelain.ParseLeftRightCount's own (left, right) pair, named for this file's
// own domain (behind, ahead) rather than the porcelain package's generic left/right.
type LeftRightCount struct {
	Behind int
	Ahead  int
}

func sortedStrings(s []string) []string {
	out := append([]string(nil), s...)
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j-1] > out[j]; j-- {
			out[j-1], out[j] = out[j], out[j-1]
		}
	}
	return out
}

// BuildStacks is D3's own forest assembly, pure and total: it never drops a branch on the floor
// (a dangling parent or a cycle lands in Orphans, never silently vanishes), it detects cycles
// (DetectCycleFrom) rather than looping forever, and it pre-order-flattens each tree bottom-to-top
// with children visited in sorted-name order (a deterministic rendering — and test — order for what
// SPEC allows to be a genuine fork). Only LOCAL branches with a non-empty recorded parent are ever
// candidates for stack membership (D1); the branch a config entry names as its OWN parent value is
// never itself required to exist in Config (a plain, never-stacked branch or a remote-tracking ref
// has no kirastack keys of its own).
func BuildStacks(in BuildStacksInput) StackListResult {
	memo := map[string]resolvedNode{}
	exists := func(name string) bool {
		if _, ok := in.LocalRefs[name]; ok {
			return true
		}
		_, ok := in.BaseTips[name]
		return ok
	}

	candidateNames := []string{}
	for name := range in.LocalRefs {
		if entry, ok := in.Config[name]; ok && entry.Parent != "" {
			candidateNames = append(candidateNames, name)
		}
	}
	candidateNames = sortedStrings(candidateNames)

	// baseGroups: base name -> the sorted list of branch names whose ultimate resolvable base is
	// exactly that name.
	baseGroups := map[string][]string{}
	orphans := []StackBranch{}

	for _, name := range candidateNames {
		budget := MaxStackedBranches
		resolved := resolveStackBase(name, in.Config, exists, memo, &budget)
		if resolved.state == resolveOK {
			baseGroups[resolved.base] = append(baseGroups[resolved.base], name)
			continue
		}
		// Broken: a dangling parent, a cycle, or a budget exhaustion. Orphaned, never dropped.
		parent := in.Config[name].Parent
		orphans = append(orphans, buildOrphanRow(name, parent, in))
	}

	stacks := make([]StackSummary, 0, len(baseGroups))
	for _, base := range sortedStrings(keysOf(baseGroups)) {
		members := baseGroups[base]
		branches := flattenStack(base, members, in)
		needsRestack := false
		for _, b := range branches {
			if b.State == StackNeedsRestack {
				needsRestack = true
				break
			}
		}
		var baseTip *string
		if tip, ok := in.BaseTips[base]; ok {
			t := tip
			baseTip = &t
		}
		stacks = append(stacks, StackSummary{Base: base, BaseTip: baseTip, Branches: branches, NeedsRestack: needsRestack})
	}

	if orphans == nil {
		orphans = []StackBranch{}
	}
	return StackListResult{Stacks: stacks, Orphans: orphans}
}

func keysOf(m map[string][]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

func buildOrphanRow(name, parent string, in BuildStacksInput) StackBranch {
	tip := ""
	if ref, ok := in.LocalRefs[name]; ok {
		tip = ref.Tip
	}
	row := StackBranch{
		Name: name, Parent: parent, Depth: 0, Tip: tip,
		State: StackParentMissing, Behind: 0, Ahead: 0,
	}
	if ref, ok := in.LocalRefs[name]; ok {
		row.CheckedOutIn = ref.CheckedOutIn
		row.Track = ref.Track
		row.IsHead = ref.IsHead
	}
	if entry, ok := in.Config[name]; ok && entry.Base != "" {
		b := entry.Base
		row.RecordedBase = &b
	}
	return row
}

// flattenStack builds one stack's tree from its member set (all already known to resolve to base)
// and flattens it pre-order, bottom-to-top, children in sorted-name order at each level.
func flattenStack(base string, members []string, in BuildStacksInput) []StackBranch {
	memberSet := map[string]bool{}
	for _, m := range members {
		memberSet[m] = true
	}
	childrenOf := map[string][]string{}
	for _, m := range members {
		parent := in.Config[m].Parent
		childrenOf[parent] = append(childrenOf[parent], m)
	}
	for p := range childrenOf {
		childrenOf[p] = sortedStrings(childrenOf[p])
	}

	out := make([]StackBranch, 0, len(members))
	var visit func(name string, depth int)
	visit = func(name string, depth int) {
		out = append(out, buildStackedRow(name, depth, in))
		for _, child := range childrenOf[name] {
			visit(child, depth+1)
		}
	}
	for _, root := range childrenOf[base] {
		visit(root, 0)
	}
	return out
}

func buildStackedRow(name string, depth int, in BuildStacksInput) StackBranch {
	ref := in.LocalRefs[name]
	entry := in.Config[name]

	var parentTip *string
	if tip, ok := in.BaseTips[entry.Parent]; ok {
		t := tip
		parentTip = &t
	}

	behind, ahead := 0, 0
	if ba, ok := in.BehindAhead[name]; ok {
		behind, ahead = ba.Behind, ba.Ahead
	}
	state := StackUpToDate
	if behind > 0 {
		state = StackNeedsRestack
	}

	var recordedBase *string
	if entry.Base != "" {
		b := entry.Base
		recordedBase = &b
	}

	return StackBranch{
		Name: name, Parent: entry.Parent, Depth: depth, Tip: ref.Tip,
		ParentTip: parentTip, RecordedBase: recordedBase,
		Behind: behind, Ahead: ahead, State: state,
		CheckedOutIn: ref.CheckedOutIn, Track: ref.Track, IsHead: ref.IsHead,
	}
}

// ClassifyRestackInput is ClassifyRestack's own parameter object (D14) — every value already
// resolved by the caller; this function spawns nothing.
type ClassifyRestackInput struct {
	// Target names the branch the user invoked Restack from — used only to select WHICH stack to
	// plan. Scope is always the WHOLE stack the target belongs to, never "from here up" (D14: a
	// branch cannot be stale without its ancestors being at least as stale).
	Target      string
	Stacks      []StackSummary
	Orphans     []StackBranch
	Config      map[string]StackConfigEntry // for the cycle/orphan distinction (DetectCycleFrom)
	InProgress  *InProgressOperation
	CurrentHead HeadRef
	DirtyPaths  []string
	// CheckedOutElsewhere: branch -> the worktree path it is checked out in, for any branch that
	// might land in the plan and is not this session's own current worktree.
	CheckedOutElsewhere map[string]string
	// BranchBases: branch -> the base this restack will actually use for it (D14/F4: recordedBase
	// when it still resolves as a commit, the merge-base fallback otherwise) — resolved by the
	// caller for every branch that could conceivably enter the plan.
	BranchBases map[string]RestackBaseInfo
	// HasUpstream: branch -> whether it has ANY upstream configured (F14/RefRow.Upstream != nil) —
	// feeds NeedsForcePush.
	HasUpstream map[string]bool
}

// HeadRef is CurrentHead's own shape — a branch name, or a detached sha (F5's own "restack always
// moves HEAD, even on a no-op" fact makes restoresHead a preflight-time computation).
type HeadRef struct {
	Branch string // "" when detached
	Sha    string
}

// RestackBaseInfo mirrors one RestackPlanEntry's base/baseSource pair, computed by the caller.
type RestackBaseInfo struct {
	Base   string
	Source string // "recorded" | "mergeBase"
}

func shortSha(sha string) string {
	if len(sha) > 7 {
		return sha[:7]
	}
	return sha
}

func restoresHeadOf(h HeadRef) string {
	if h.Branch != "" {
		return h.Branch
	}
	return shortSha(h.Sha)
}

func findBranchStack(stacks []StackSummary, target string) (StackSummary, StackBranch, bool) {
	for _, s := range stacks {
		for _, b := range s.Branches {
			if b.Name == target {
				return s, b, true
			}
		}
	}
	return StackSummary{}, StackBranch{}, false
}

func findOrphan(orphans []StackBranch, target string) (StackBranch, bool) {
	for _, o := range orphans {
		if o.Name == target {
			return o, true
		}
	}
	return StackBranch{}, false
}

// ClassifyRestack is D14's own restack classifier: six blockers in one fixed order
// (inProgressOperation, notStacked, cycle, parentMissing, checkedOutElsewhere, dirtyWorktree —
// D14's own stated order, "the dialog's own headline" convention ClassifyCheckout already
// established), a plan (D14's own cascade rule: a branch is planned iff it is needsRestack OR any
// ancestor of it in the stack is planned), and restoresHead/needsForcePush/routes.
func ClassifyRestack(in ClassifyRestackInput) RestackPreflight {
	blockers := []RestackBlocker{}
	if in.InProgress != nil {
		blockers = append(blockers, RestackBlocker{Kind: "inProgressOperation", Operation: in.InProgress})
	}

	stack, _, foundInStack := findBranchStack(in.Stacks, in.Target)
	var base string
	plan := []RestackPlanEntry{}

	if !foundInStack {
		if orphan, isOrphan := findOrphan(in.Orphans, in.Target); isOrphan {
			if cyc := DetectCycleFrom(in.Config, in.Target); cyc != nil {
				blockers = append(blockers, RestackBlocker{Kind: "cycle", Branches: cyc})
			} else {
				blockers = append(blockers, RestackBlocker{Kind: "parentMissing", Branch: in.Target, Parent: orphan.Parent})
			}
		} else {
			blockers = append(blockers, RestackBlocker{Kind: "notStacked", Branch: in.Target})
		}
	} else {
		base = stack.Base
		inPlan := map[string]bool{}
		for _, b := range stack.Branches {
			reason := ""
			switch {
			case b.State == StackNeedsRestack:
				inPlan[b.Name] = true
				reason = "stale"
			case inPlan[b.Parent]:
				inPlan[b.Name] = true
				reason = "ancestorRestacked"
			default:
				continue
			}
			baseInfo := in.BranchBases[b.Name]
			plan = append(plan, RestackPlanEntry{
				Branch: b.Name, Parent: b.Parent, Base: baseInfo.Base, BaseSource: baseInfo.Source,
				Commits: b.Ahead, Reason: reason,
			})
		}

		for _, entry := range plan {
			if path, ok := in.CheckedOutElsewhere[entry.Branch]; ok {
				blockers = append(blockers, RestackBlocker{Kind: "checkedOutElsewhere", Branch: entry.Branch, WorktreePath: path})
				break
			}
		}
	}

	routes := []string{}
	if len(in.DirtyPaths) > 0 && len(plan) > 0 {
		blockers = append(blockers, RestackBlocker{Kind: "dirtyWorktree", Paths: in.DirtyPaths})
		routes = append(routes, "stashFirst")
	}

	verdict := "clean"
	switch {
	case len(blockers) > 0:
		verdict = "blocked"
	case len(plan) == 0:
		verdict = "noop"
	}

	needsForcePush := []string{}
	for _, entry := range plan {
		if in.HasUpstream[entry.Branch] {
			needsForcePush = append(needsForcePush, entry.Branch)
		}
	}

	return RestackPreflight{
		Base: base, Plan: plan, Blockers: blockers, Verdict: verdict,
		RestoresHead: restoresHeadOf(in.CurrentHead), NeedsForcePush: needsForcePush, Routes: routes,
	}
}
