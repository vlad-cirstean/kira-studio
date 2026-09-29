package ade

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	lru "github.com/hashicorp/golang-lru/v2"
	"golang.org/x/sync/errgroup"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitaskpass"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient/porcelain"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitsession"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
)

// queue.go is P129 Part 2 §5.1's own queue service: the git-facts pipeline (§4) and persistence
// (§2) orchestrated behind one long-lived Conn, bound to `AdeService.Queue` in Part 2's own commit
// 6. `internal/ade` never imports `bridge` (Space's layering_test.go) — bridge/ade.go converts
// every type below to its own wire projection.

// adeConnID/adeConnLabel identify ade's own gitsession.Conn (§0.3) — one shared connection this
// whole service holds repositories open on, distinct from the git module's per-window Conns.
const (
	adeConnID    = gitsession.ConnID("ade")
	adeConnLabel = "Kira Space ade"
)

// adeRepoChangedDebounce is §5.1's own "Signal" rule: a held repo's own repo.changed is coalesced
// per repo before OnRepoChanged fires — a fetch or a background ref move commonly touches several
// refs in a burst.
const adeRepoChangedDebounce = 250 * time.Millisecond

// branchFactsCacheCap/mergeTreeCacheCap are §4.2's own "512 entries per repo" cache bound, applied
// to two separate per-repo LRUs (ahead/behind/files/commits keyed by (tip(parent), tip(branch));
// merge-tree conflicts keyed by the ordered pair of tips pairFacts already calls its callback with)
// rather than one cache discriminated by a third "kind" field — tips are immutable object ids, so
// neither needs an invalidation rule beyond eviction.
const (
	branchFactsCacheCap = 512
	mergeTreeCacheCap   = 512
)

// SessionRef is QueueDeps.Sessions' own per-session shape — a purpose-built projection of
// model.AdeSession (Part 1's own Tracker.List) rather than that type reused directly: it decouples
// this file's own rebind/archive logic from ade_sessions' exact column set, the same reasoning
// gitsession/queuefacts.go's wrappers already follow for git reads. main.go wires QueueDeps.Sessions
// as a closure filtering Tracker.List() by CodeRepoID and mapping each row to this shape.
type SessionRef struct {
	ID, Branch, NewWorkID, State, TerminalID string
	StartedAt                                int64 // unix ms, ade_sessions' own unit (Part 1 §4.7).
}

// QueueDeps is NewQueue's own construction seam (§5.1). OnSessionsChanged and AutofetchMinutes are
// two small, disclosed additions beyond the plan's own listed struct: §6.4 requires an
// AdeSessionsChanged signal after a rebind moves session rows, and §5.2's AdeRepoSnapshot.
// AutofetchMinutes must echo the global git.fetchAutoIntervalMinutes leaf — neither has a seam in
// the plan's literal QueueDeps list, and this package has no other way to reach either fact.
type QueueDeps struct {
	Store             *repos.AdeQueueRepo
	Sessions          func(codeRepoID string) []SessionRef
	CodeRepo          func(id string) (root string, ok bool)
	Registry          *gitsession.Registry
	GitPath           func() string
	Askpass           *gitaskpass.Broker
	CloseTerminal     func(id string) error
	OnRepoChanged     func(codeRepoID string)
	OnCredential      func(payload any)
	OnSessionsChanged func()
	AutofetchMinutes  func() int
	Now               func() time.Time
}

// --- domain result shapes (bridge/ade.go's own AdeRepoSnapshot etc. are the wire projection) -----

type Main struct{ Name, Ref, Tip string }

type FileDelta struct {
	Path           string
	Added, Deleted *int
	Binary         bool
}

type Commit struct{ Sha, Message string }

type DirtyEntry struct{ Code, Path string }

type Jira struct{ Key, URL string }

// BranchFact is one queued branch's own assembled facts (§4.2) — Exists false means the branch
// resolved to neither a local nor a remote-tracking ref (§0.14): every git-derived field below
// stays zero-valued and only the stored meta (Kind/Name/.../AddedAt) is real.
type BranchFact struct {
	ID, Branch, Kind, Name, DraftTitle, StartFrom string
	Exists                                        bool
	Ref, Tip                                      string
	Owner, AuthorEmail                            string
	IsMine                                        bool
	LastCommitAt                                  int64
	Base                                          string // parent item id, "" = main
	Ahead, Behind                                 int
	Merged                                        bool
	MergedAt                                      *int64
	Worktree                                      string
	Files                                         []FileDelta
	Commits                                       []Commit
	CommitCount                                   int
	Dirty                                         []DirtyEntry
	Upstream                                      string
	UpstreamAhead, UpstreamBehind                 int
	Jira                                          Jira
	PrURL, Est, Notes                             string
	AddedAt                                       int64
}

type NewWorkFact struct {
	ID, Title, StartFrom, BranchName, Est, Notes string
	Jira                                         Jira
	CreatedAt                                    int64
	BranchCandidates                             []string
}

type PairFact struct {
	A, B      string
	Shared    []string
	Conflicts []string
}

// DependencyFact is one live external dependency's own assembled facts (P135 §4.3) — no git field
// of any kind: a dependency never has a branch, so it carries no ahead/behind, no merge state, no
// PR/CI state.
type DependencyFact struct {
	ID, Title, WaitingOn string
	ExpectedBy           *string
	CreatedAt            int64
	Blocks               []string
}

type HistoryItem struct {
	Item, Kind, Title, Branch string
	MergedAt                  *int64
	ArchivedAt                int64
}

type PlanFact struct {
	Day         map[string]*string
	Order       []string
	QueuedAfter map[string]string
	Unpushed    map[string]bool
}

type RepoSnapshot struct {
	CodeRepoID, GitRepoID string
	Main                  *Main
	// Remote is the repo's own default remote (§0.5 of the P129 Part 4 plan, DefaultRemote's own
	// "origin if present, else the sole remote, else \"\"") — the renderer's own dialog templates
	// read it for `git fetch <remote>` rather than a hardcoded "origin".
	Remote           string
	Branches         []BranchFact
	NewWork          []NewWorkFact
	Plan             PlanFact
	Colors           map[string]int
	Pairs            []PairFact
	History          []HistoryItem
	Dependencies     []DependencyFact
	LastFetchAt      *int64
	AutofetchMinutes int
	WorktreeBasePath string
}

type PrFact struct {
	Number     int
	Title, URL string
	State      string
}

type RepoPrs struct {
	Kind     string // "ok" | "disabled" | "unavailable"
	Branches map[string]*PrFact
	// WebURL is the repo's own web root (P129 Part 6 §0.8), "" when there is no GitHub remote or
	// GitHub is disabled — the Branch link renders unlinked in that case.
	WebURL string
}

type CandidateBranch struct {
	Name, Author string
	LastCommitAt int64
	RemoteOnly   bool
	// Mine mirrors AddBranch's own resolveKind rule (§0.2/3 of the P129 Part 5 plan), so the
	// Existing-branch picker's "you" label never disagrees with the kind AddBranch would assign.
	Mine bool
}

type RefreshResult struct {
	RefsChanged int
	NewlyMerged []string
	Error       *gitsession.RemoteOpError
}

type ForcePushResult struct {
	Branch string
	OK     bool
	Error  *gitsession.RemoteOpError
}

type ArchiveRisk struct {
	Dirty    []DirtyEntry
	Unmerged int
	Worktree string
	Blocked  string // "" = not blocked; else the blocking reason (gitpreflight's own blocker kind)
}

// --- per-repo caches (§4.2) -------------------------------------------------------------------

type branchFactsKey struct{ TipParent, TipBranch string }

type branchFactsValue struct {
	Ahead, Behind int
	Files         []porcelain.FileChange
	Commits       []porcelain.RangeCommit
}

type mergeTreeKey struct{ TipA, TipB string }

type repoCaches struct {
	branch    *lru.Cache[branchFactsKey, branchFactsValue]
	mergeTree *lru.Cache[mergeTreeKey, []string]
}

func newRepoCaches() *repoCaches {
	b, _ := lru.New[branchFactsKey, branchFactsValue](branchFactsCacheCap)
	m, _ := lru.New[mergeTreeKey, []string](mergeTreeCacheCap)
	return &repoCaches{branch: b, mergeTree: m}
}

// --- Queue -----------------------------------------------------------------------------------

// Queue is P129 Part 2's own service: one shared gitsession.Conn holding every repo this app's
// queue board has touched, a per-repo mutex serializing writes/rebind/Refresh/ForcePush/Archive
// against that repo (pure reads run under the entry's own pool, unguarded here), and a per-repo
// facts cache.
type Queue struct {
	deps QueueDeps
	conn *gitsession.Conn

	mu          sync.Mutex
	repoMus     map[string]*sync.Mutex
	byGitRepoID map[string]string // gitclient RepoID -> codeRepoID, populated on open
	caches      map[string]*repoCaches
	debounce    map[string]*time.Timer
}

func NewQueue(deps QueueDeps) *Queue {
	q := &Queue{
		deps:        deps,
		repoMus:     map[string]*sync.Mutex{},
		byGitRepoID: map[string]string{},
		caches:      map[string]*repoCaches{},
		debounce:    map[string]*time.Timer{},
	}
	q.conn = gitsession.NewConn(adeConnID, "ade", adeConnLabel, q.handleEmit)
	return q
}

// handleEmit is ade's own Conn.emit (§0.3/§6.5): "repo.changed" debounces into OnRepoChanged (the
// gitclient RepoID it carries is mapped back to the code_repos.id that opened it);
// "credential.request" passes straight through to OnCredential — nothing here answers it, Part 3's
// renderer does, through AdeService.ProvideCredential.
func (q *Queue) handleEmit(method string, payload any) {
	switch method {
	case "repo.changed":
		ev, ok := payload.(gitsession.Event)
		if !ok {
			return
		}
		q.mu.Lock()
		codeRepoID, ok := q.byGitRepoID[ev.RepoID]
		q.mu.Unlock()
		if !ok {
			return
		}
		q.scheduleRepoChanged(codeRepoID)
	case "credential.request":
		if q.deps.OnCredential != nil {
			q.deps.OnCredential(payload)
		}
	}
}

func (q *Queue) scheduleRepoChanged(codeRepoID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if t, ok := q.debounce[codeRepoID]; ok {
		t.Stop()
	}
	q.debounce[codeRepoID] = time.AfterFunc(adeRepoChangedDebounce, func() {
		if q.deps.OnRepoChanged != nil {
			q.deps.OnRepoChanged(codeRepoID)
		}
	})
}

// notifyChanged is every write's own immediate signal (§5.1: "every write also calls
// OnRepoChanged (no debounce)") — distinct from scheduleRepoChanged, which only debounces a
// held repo's own background repo.changed events.
func (q *Queue) notifyChanged(codeRepoID string) {
	if q.deps.OnRepoChanged != nil {
		q.deps.OnRepoChanged(codeRepoID)
	}
}

func (q *Queue) repoMutex(codeRepoID string) *sync.Mutex {
	q.mu.Lock()
	defer q.mu.Unlock()
	m, ok := q.repoMus[codeRepoID]
	if !ok {
		m = &sync.Mutex{}
		q.repoMus[codeRepoID] = m
	}
	return m
}

func (q *Queue) cachesFor(codeRepoID string) *repoCaches {
	q.mu.Lock()
	defer q.mu.Unlock()
	c, ok := q.caches[codeRepoID]
	if !ok {
		c = newRepoCaches()
		q.caches[codeRepoID] = c
	}
	return c
}

// openRepo is every method's own first step: resolve codeRepoID to its root through CodeRepo, open
// it on ade's own Conn (first use arms the held-until-Close/repo-gone lifetime §5.1 describes), and
// record the gitclient RepoID -> codeRepoID mapping handleEmit needs.
func (q *Queue) openRepo(ctx context.Context, codeRepoID string) (*gitsession.RepoEntry, error) {
	root, ok := q.deps.CodeRepo(codeRepoID)
	if !ok {
		return nil, fmt.Errorf("ade: queue: code repo %s not found", codeRepoID)
	}
	summary, err := q.conn.Open(ctx, q.deps.Registry, q.deps.GitPath(), root)
	if err != nil {
		return nil, err
	}
	q.mu.Lock()
	q.byGitRepoID[summary.RepoID] = codeRepoID
	q.mu.Unlock()
	entry, ok := q.conn.Entry(summary.RepoID)
	if !ok {
		return nil, fmt.Errorf("ade: queue: repo entry missing for %s after open", codeRepoID)
	}
	return entry, nil
}

// resolveQueuedRef is §0.14's own identity rule: refs/heads/<b> when present, else
// refs/remotes/<defaultRemote>/<b> (review branches are often remote-only).
func resolveQueuedRef(inventory []porcelain.InventoryRef, short, defaultRemote string) (porcelain.InventoryRef, bool) {
	for _, r := range inventory {
		if r.Remote == "" && r.Short == short {
			return r, true
		}
	}
	if defaultRemote != "" {
		for _, r := range inventory {
			if r.Remote == defaultRemote && r.Short == short {
				return r, true
			}
		}
	}
	return porcelain.InventoryRef{}, false
}

func dirtyCode(e porcelain.StatusEntry) (string, bool) {
	if e.Kind == "ignored" {
		return "", false
	}
	if e.Kind == "untracked" {
		return "??", true
	}
	if e.Staged == 'D' || e.Unstaged == 'D' {
		return "D", true
	}
	return "M", true
}

func toDirtyEntries(entries []porcelain.StatusEntry) []DirtyEntry {
	out := make([]DirtyEntry, 0, len(entries))
	for _, e := range entries {
		if code, ok := dirtyCode(e); ok {
			out = append(out, DirtyEntry{Code: code, Path: e.Path})
		}
	}
	return out
}

func toFileDeltas(changes []porcelain.FileChange) []FileDelta {
	out := make([]FileDelta, len(changes))
	for i, c := range changes {
		out[i] = FileDelta{Path: c.Path, Added: c.Additions, Deleted: c.Deletions, Binary: c.IsBinary}
	}
	return out
}

func toCommits(commits []porcelain.RangeCommit) []Commit {
	out := make([]Commit, len(commits))
	for i, c := range commits {
		out[i] = Commit{Sha: c.Sha, Message: c.Subject}
	}
	return out
}

func resolveKind(row porcelain.InventoryRef, userEmail, override string) string {
	if override != "" {
		return override
	}
	if userEmail != "" && strings.EqualFold(row.AuthorEmail, userEmail) {
		return model.AdeBranchKindMine
	}
	return model.AdeBranchKindReview
}

// --- Snapshot (§5.1) --------------------------------------------------------------------------

func (q *Queue) Snapshot(ctx context.Context, codeRepoID string) (RepoSnapshot, error) {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()
	return q.snapshotLocked(ctx, codeRepoID)
}

// resolvedRef is snapshotLocked's own per-item ref resolution result (§0.14).
type resolvedRef struct {
	row   porcelain.InventoryRef
	found bool
}

// snapshotContext bundles snapshotLocked's own git-derived read-only inputs — split out so the
// per-branch fact computation (computeOneBranchFact) and the parent-inference setup
// (buildParentGraph) each take one argument instead of a dozen, and so snapshotLocked's own
// cognitive complexity stays readable (§9's own gocognit/gocyclo budget).
type snapshotContext struct {
	entry      *gitsession.RepoEntry
	inventory  []porcelain.InventoryRef
	refByItem  map[string]resolvedRef
	userEmail  string
	remote     string
	mainTip    string
	hasMain    bool
	depths     map[string]int
	tips       map[string]string
	parentOf   map[string]string
	ancestryOf map[string][]string
	caches     *repoCaches
	nowMs      int64
}

func (q *Queue) snapshotLocked(ctx context.Context, codeRepoID string) (RepoSnapshot, error) {
	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return RepoSnapshot{}, err
	}

	state, err := q.deps.Store.Load(codeRepoID)
	if err != nil {
		return RepoSnapshot{}, err
	}
	rebound, branchCandidates, err := q.reconcileNewWork(ctx, entry, codeRepoID, &state)
	if err != nil {
		return RepoSnapshot{}, err
	}
	if rebound {
		state, err = q.deps.Store.Load(codeRepoID)
		if err != nil {
			return RepoSnapshot{}, err
		}
	}

	inventory, err := entry.BranchInventory(ctx)
	if err != nil {
		return RepoSnapshot{}, err
	}
	mainRefName, mainTip, hasMain, err := entry.MainRef(ctx)
	if err != nil {
		return RepoSnapshot{}, err
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return RepoSnapshot{}, err
	}
	remote, _ := entry.DefaultRemote(ctx)

	activeBranches, archivedBranches := splitArchived(state.Branches)
	sort.Slice(activeBranches, func(i, j int) bool { return activeBranches[i].Branch < activeBranches[j].Branch })

	refByItem := make(map[string]resolvedRef, len(activeBranches))
	for _, b := range activeBranches {
		row, found := resolveQueuedRef(inventory, b.Branch, remote)
		refByItem[b.Branch] = resolvedRef{row: row, found: found}
	}

	depths, tips, refs, existing, err := q.computeDepthsAndTips(ctx, entry, activeBranches, refByItem, hasMain, mainTip)
	if err != nil {
		return RepoSnapshot{}, err
	}
	ancestryOf, err := q.computeAncestry(ctx, entry, existing, tips, refs)
	if err != nil {
		return RepoSnapshot{}, err
	}
	stackParents, err := entry.StackParents(ctx)
	if err != nil {
		return RepoSnapshot{}, err
	}
	parentOf := buildParentGraph(activeBranches, existing, stackParents, tips, ancestryOf, depths)

	sc := &snapshotContext{
		entry: entry, inventory: inventory, refByItem: refByItem, userEmail: userEmail, remote: remote,
		mainTip: mainTip, hasMain: hasMain, depths: depths, tips: tips, parentOf: parentOf,
		ancestryOf: ancestryOf, caches: q.cachesFor(codeRepoID), nowMs: q.deps.Now().UnixMilli(),
	}
	branchFacts, pairItems, newHadCommits, newlyMerged, err := q.computeBranchFacts(ctx, sc, activeBranches)
	if err != nil {
		return RepoSnapshot{}, err
	}
	if len(newHadCommits) > 0 || len(newlyMerged) > 0 {
		if err := q.deps.Store.MarkFacts(codeRepoID, newHadCommits, newlyMerged); err != nil {
			return RepoSnapshot{}, err
		}
	}
	pairFactsOut, err := q.computePairFacts(ctx, sc, pairItems)
	if err != nil {
		return RepoSnapshot{}, err
	}

	var lastFetchAt *int64
	if info, err := os.Stat(filepath.Join(entry.Summary.CommonDir, "FETCH_HEAD")); err == nil {
		v := info.ModTime().UnixMilli()
		lastFetchAt = &v
	}
	autofetch := 0
	if q.deps.AutofetchMinutes != nil {
		autofetch = q.deps.AutofetchMinutes()
	}
	var mainFact *Main
	if hasMain {
		name, ref := mainDisplay(mainRefName)
		mainFact = &Main{Name: name, Ref: ref, Tip: mainTip}
	}

	return RepoSnapshot{
		CodeRepoID: codeRepoID, GitRepoID: entry.Summary.RepoID,
		Main: mainFact, Remote: remote, Branches: branchFacts,
		NewWork:          buildNewWorkFacts(state.NewWork, branchCandidates),
		Plan:             buildPlanFact(state.Plan, branchFacts),
		Colors:           buildColors(state.Colors),
		Pairs:            pairFactsOut,
		History:          buildHistory(archivedBranches, state.NewWork, state.Dependencies),
		Dependencies:     buildDependencyFacts(state),
		LastFetchAt:      lastFetchAt,
		AutofetchMinutes: autofetch,
		WorktreeBasePath: entry.RepoSettings().WorktreeBasePath,
	}, nil
}

// mainDisplay is P129 Part 4 §0.5's own short-form split of MainRef's full refname:
// `refs/heads/X` -> name X, ref X (a local-only main); `refs/remotes/<r>/X` -> name X, ref
// `<r>/X` (a remote-tracking main, the common case) — `countRefsChanged` keeps keying on the full
// refname unchanged, only this display pair is shortened. A refname this doesn't recognize (never
// produced by MainRef today) passes through unchanged in both fields, rather than panicking.
func mainDisplay(full string) (name, ref string) {
	if rest, ok := strings.CutPrefix(full, "refs/heads/"); ok {
		return rest, rest
	}
	if rest, ok := strings.CutPrefix(full, "refs/remotes/"); ok {
		if i := strings.IndexByte(rest, '/'); i > 0 {
			return rest[i+1:], rest
		}
	}
	return full, full
}

func splitArchived(branches []model.AdeBranch) (active, archived []model.AdeBranch) {
	active = make([]model.AdeBranch, 0, len(branches))
	archived = make([]model.AdeBranch, 0)
	for _, b := range branches {
		if b.ArchivedAt == nil {
			active = append(active, b)
		} else {
			archived = append(archived, b)
		}
	}
	return active, archived
}

// computeDepthsAndTips is §4.2's own unpushedVsMain (depths[item] = count(mainRef..tip)) plus the
// tip/ref lookup tables every later step (ancestry, parent inference, per-branch facts) shares.
func (q *Queue) computeDepthsAndTips(ctx context.Context, entry *gitsession.RepoEntry, activeBranches []model.AdeBranch, refByItem map[string]resolvedRef, hasMain bool, mainTip string) (depths map[string]int, tips, refs map[string]string, existing []string, err error) {
	depths = make(map[string]int)
	tips = make(map[string]string)
	refs = make(map[string]string)
	for _, b := range activeBranches {
		r := refByItem[b.Branch]
		if !r.found {
			continue
		}
		existing = append(existing, b.Branch)
		tips[b.Branch] = r.row.Tip
		refs[b.Branch] = r.row.Ref
		if hasMain {
			ahead, _, err := entry.AheadBehind(ctx, r.row.Tip, mainTip)
			if err != nil {
				return nil, nil, nil, nil, err
			}
			depths[b.Branch] = ahead
		}
	}
	return depths, tips, refs, existing, nil
}

// computeAncestry is §0.5's own Ancestors input: for each existing item, which OTHER existing
// items are strict (non-equal-tip) ancestors of it — also pairFacts' own isAncestor callback data.
func (q *Queue) computeAncestry(ctx context.Context, entry *gitsession.RepoEntry, existing []string, tips, refs map[string]string) (map[string][]string, error) {
	ancestryOf := make(map[string][]string, len(existing))
	refToItem := make(map[string]string, len(existing))
	for _, item := range existing {
		refToItem[refs[item]] = item
	}
	for _, item := range existing {
		var among []string
		for _, other := range existing {
			if other != item {
				among = append(among, refs[other])
			}
		}
		if len(among) == 0 {
			continue
		}
		merged, err := entry.Ancestors(ctx, tips[item], among)
		if err != nil {
			return nil, err
		}
		for _, refname := range merged {
			other := refToItem[refname]
			if tips[other] == tips[item] {
				continue // equal tip: never a strict ancestor (branchNode.Ancestors' own contract).
			}
			ancestryOf[item] = append(ancestryOf[item], other)
		}
	}
	return ancestryOf, nil
}

// buildParentGraph assembles inferParents' own per-item input (branchNode) and runs it — pure,
// once every git-derived fact (tips, ancestry, stack config) is already in hand.
func buildParentGraph(activeBranches []model.AdeBranch, existing []string, stackParents, tips map[string]string, ancestryOf map[string][]string, depths map[string]int) map[string]string {
	byBranch := make(map[string]model.AdeBranch, len(activeBranches))
	for _, b := range activeBranches {
		byBranch[b.Branch] = b
	}
	nodes := make(map[string]branchNode, len(existing))
	for _, item := range existing {
		b := byBranch[item]
		startFrom := b.StartFrom
		nodes[item] = branchNode{
			Merged:                   b.MergedAt != nil,
			ConfigParent:             stackParents[item],
			StartFrom:                startFrom,
			Ancestors:                ancestryOf[item],
			MergeBaseEqualsStartFrom: startFrom != "" && tips[startFrom] != "" && tips[startFrom] == tips[item],
		}
	}
	return inferParents(nodes, depths)
}

// computeBranchFacts fans out computeOneBranchFact over every active branch (errgroup, limit 4 —
// §4.2's own fan-out cap), collecting the had-commits/merged write-back sets computeOneBranchFact
// reports rather than writing them itself.
func (q *Queue) computeBranchFacts(ctx context.Context, sc *snapshotContext, activeBranches []model.AdeBranch) ([]BranchFact, []pairItem, []string, map[string]int64, error) {
	branchFacts := make([]BranchFact, len(activeBranches))
	pairItems := make([]pairItem, 0, len(activeBranches))
	var newHadCommits []string
	newlyMerged := map[string]int64{}

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(4)
	var mu sync.Mutex
	for i, b := range activeBranches {
		g.Go(func() error {
			fact, pi, hadCommitsNew, mergedNew, err := q.computeOneBranchFact(gctx, sc, b)
			if err != nil {
				return err
			}
			mu.Lock()
			defer mu.Unlock()
			branchFacts[i] = fact
			if pi != nil {
				pairItems = append(pairItems, *pi)
			}
			if hadCommitsNew {
				newHadCommits = append(newHadCommits, b.Branch)
			}
			if mergedNew {
				newlyMerged[b.Branch] = sc.nowMs
			}
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, nil, nil, nil, err
	}
	return branchFacts, pairItems, newHadCommits, newlyMerged, nil
}

// computeOneBranchFact is one active branch's own §4.2 assembly: existence, ownership, stack
// base/ahead/behind/files/commits (LRU-cached on (parentTip, tip)), dirty status, had-commits
// latch and the merged rule (§0.8). Returns the pairItem to feed pairFacts (nil when this branch
// is parked, archived-facts-only, or does not exist) and the two write-back flags snapshotLocked's
// own caller batches into one MarkFacts call.
func (q *Queue) computeOneBranchFact(ctx context.Context, sc *snapshotContext, b model.AdeBranch) (fact BranchFact, pi *pairItem, hadCommitsNew, mergedNew bool, err error) {
	r := sc.refByItem[b.Branch]
	fact = BranchFact{
		ID: b.Branch, Branch: b.Branch, Kind: b.Kind, Name: b.Name, DraftTitle: b.DraftTitle,
		StartFrom: b.StartFrom, Jira: Jira{Key: b.JiraKey, URL: b.JiraURL},
		PrURL: b.PrURL, Est: b.Est, Notes: b.Notes, AddedAt: b.AddedAt, MergedAt: b.MergedAt,
	}
	if !r.found {
		return fact, nil, false, false, nil
	}
	fact.Exists = true
	fact.Ref, fact.Tip = r.row.Ref, r.row.Tip
	fact.Owner, fact.AuthorEmail = r.row.AuthorName, r.row.AuthorEmail
	fact.IsMine = sc.userEmail != "" && strings.EqualFold(r.row.AuthorEmail, sc.userEmail)
	fact.LastCommitAt = r.row.CommitterUnix
	fact.Worktree = r.row.WorktreePath
	fact.Upstream = r.row.Upstream
	fact.UpstreamAhead, fact.UpstreamBehind = r.row.UpstreamAhead, r.row.UpstreamBehind

	if r.row.Upstream == "" && sc.remote != "" {
		if remoteRow, found := findRemoteRow(sc.inventory, sc.remote, b.Branch); found {
			ahead, behind, err := sc.entry.AheadBehind(ctx, r.row.Tip, remoteRow.Tip)
			if err != nil {
				return BranchFact{}, nil, false, false, err
			}
			fact.Upstream = remoteRow.Ref
			fact.UpstreamAhead, fact.UpstreamBehind = ahead, behind
		}
	}

	parentItem := sc.parentOf[b.Branch]
	parentTip := sc.mainTip
	if parentItem != "" {
		parentTip = sc.tips[parentItem]
		fact.Base = parentItem
	}
	if parentItem == "" && !sc.hasMain {
		// noMain (§0.6): meta only, no ahead/behind/files/commits to compute against nothing.
		return fact, nil, false, false, nil
	}

	rangeFacts, err := q.rangeFactsFor(ctx, sc, parentTip, r.row.Tip)
	if err != nil {
		return BranchFact{}, nil, false, false, err
	}
	fact.Ahead, fact.Behind = rangeFacts.Ahead, rangeFacts.Behind
	fact.Files = toFileDeltas(rangeFacts.Files)
	fact.Commits = toCommits(rangeFacts.Commits)
	fact.CommitCount = sc.depths[b.Branch]

	if fact.Worktree != "" {
		statusEntries, err := sc.entry.WorktreeStatus(ctx, fact.Worktree)
		if err != nil {
			return BranchFact{}, nil, false, false, err
		}
		fact.Dirty = toDirtyEntries(statusEntries)
	}

	hadCommits := b.HadCommits || sc.depths[b.Branch] > 0
	hadCommitsNew = hadCommits && !b.HadCommits

	tipReachableFromMain := false
	if sc.hasMain {
		reached, err := sc.entry.Ancestors(ctx, sc.mainTip, []string{fact.Ref})
		if err != nil {
			return BranchFact{}, nil, false, false, err
		}
		tipReachableFromMain = len(reached) > 0
	}
	fact.Merged = mergedRule(tipReachableFromMain, hadCommits, "")
	if fact.Merged && b.MergedAt == nil {
		mergedNew = true
		nowMs := sc.nowMs
		fact.MergedAt = &nowMs
	}

	if fact.Kind == model.AdeBranchKindMine || fact.Kind == model.AdeBranchKindReview {
		pi = &pairItem{Item: b.Branch, Tip: fact.Tip, Kind: fact.Kind, Merged: fact.Merged, Files: filesSet(rangeFacts.Files)}
	}
	return fact, pi, hadCommitsNew, mergedNew, nil
}

func findRemoteRow(inventory []porcelain.InventoryRef, remote, short string) (porcelain.InventoryRef, bool) {
	for _, rr := range inventory {
		if rr.Remote == remote && rr.Short == short {
			return rr, true
		}
	}
	return porcelain.InventoryRef{}, false
}

// rangeFactsFor is the (parentTip, tip)-keyed LRU cache (§4.2's own 512-entry bound) around
// ahead/behind/files/commits — the one git-cost-bearing step computeOneBranchFact repeats often
// enough (every Snapshot, every branch) to be worth caching on immutable object ids.
func (q *Queue) rangeFactsFor(ctx context.Context, sc *snapshotContext, parentTip, tip string) (branchFactsValue, error) {
	key := branchFactsKey{TipParent: parentTip, TipBranch: tip}
	if v, ok := sc.caches.branch.Get(key); ok {
		return v, nil
	}
	ahead, behind, err := sc.entry.AheadBehind(ctx, tip, parentTip)
	if err != nil {
		return branchFactsValue{}, err
	}
	files, err := sc.entry.RangeChanges(ctx, parentTip, tip)
	if err != nil {
		return branchFactsValue{}, err
	}
	commits, err := sc.entry.RangeCommits(ctx, parentTip, tip, 50)
	if err != nil {
		return branchFactsValue{}, err
	}
	v := branchFactsValue{Ahead: ahead, Behind: behind, Files: files, Commits: commits}
	sc.caches.branch.Add(key, v)
	return v, nil
}

// computePairFacts wraps pairFacts (§0.7) with its own isAncestor/mergeTree callbacks — the
// mergeTree side is the (tipA, tipB)-keyed LRU cache (§4.2), so a repeat pair whose tips are
// unchanged since the last Snapshot/Refresh never re-spawns merge-tree.
func (q *Queue) computePairFacts(ctx context.Context, sc *snapshotContext, pairItems []pairItem) ([]PairFact, error) {
	isAncestorFn := func(x, y string) bool {
		for _, a := range sc.ancestryOf[y] {
			if a == x {
				return true
			}
		}
		for _, a := range sc.ancestryOf[x] {
			if a == y {
				return true
			}
		}
		return false
	}
	mergeTreeFn := func(tipA, tipB string) ([]string, error) {
		key := mergeTreeKey{TipA: tipA, TipB: tipB}
		if v, ok := sc.caches.mergeTree.Get(key); ok {
			return v, nil
		}
		pred, err := sc.entry.MergeTreeConflicts(ctx, tipA, tipB)
		if err != nil {
			return nil, err
		}
		paths := pred.Paths
		if paths == nil {
			paths = []string{}
		}
		sc.caches.mergeTree.Add(key, paths)
		return paths, nil
	}
	pairs, err := pairFacts(pairItems, isAncestorFn, mergeTreeFn)
	if err != nil {
		return nil, err
	}
	out := make([]PairFact, len(pairs))
	for i, p := range pairs {
		out[i] = PairFact{A: p.A, B: p.B, Shared: p.Shared, Conflicts: p.Conflicts}
	}
	return out, nil
}

func buildNewWorkFacts(newWork []model.AdeNewWork, branchCandidates map[string][]string) []NewWorkFact {
	out := make([]NewWorkFact, 0, len(newWork))
	for _, w := range newWork {
		if w.ArchivedAt != nil {
			continue
		}
		out = append(out, NewWorkFact{
			ID: w.ID, Title: w.Title, StartFrom: w.StartFrom, BranchName: w.BranchName,
			Est: w.Est, Notes: w.Notes, Jira: Jira{Key: w.JiraKey, URL: w.JiraURL}, CreatedAt: w.CreatedAt,
			BranchCandidates: branchCandidates[w.ID],
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// buildHistory is every archived branch/new-work/resolved-dependency row, meta only,
// newest-archived (or newest-resolved) first.
func buildHistory(archivedBranches []model.AdeBranch, newWork []model.AdeNewWork, dependencies []model.AdeDependency) []HistoryItem {
	var history []HistoryItem
	for _, b := range archivedBranches {
		title := b.Name
		if title == "" {
			title = b.DraftTitle
		}
		if title == "" {
			title = b.Branch
		}
		history = append(history, HistoryItem{Item: b.Branch, Kind: b.Kind, Title: title, Branch: b.Branch, MergedAt: b.MergedAt, ArchivedAt: *b.ArchivedAt})
	}
	for _, w := range newWork {
		if w.ArchivedAt == nil {
			continue
		}
		history = append(history, HistoryItem{Item: w.ID, Kind: "newWork", Title: w.Title, ArchivedAt: *w.ArchivedAt})
	}
	for _, d := range dependencies {
		if d.ResolvedAt == nil {
			continue
		}
		history = append(history, HistoryItem{Item: d.ID, Kind: "dependency", Title: d.Title, ArchivedAt: *d.ResolvedAt})
	}
	sort.Slice(history, func(i, j int) bool { return history[i].ArchivedAt > history[j].ArchivedAt })
	return history
}

// buildDependencyFacts is live (unresolved) dependencies only, sorted by creation, each with its
// own Blocks list sorted for stable output (P135 §4.3) — never passed to facts.go, so it carries
// no git field of any kind.
func buildDependencyFacts(state repos.AdeQueueState) []DependencyFact {
	blocksByDep := make(map[string][]string)
	for _, bl := range state.Blockers {
		blocksByDep[bl.Dependency] = append(blocksByDep[bl.Dependency], bl.Item)
	}
	out := make([]DependencyFact, 0, len(state.Dependencies))
	for _, d := range state.Dependencies {
		if d.ResolvedAt != nil {
			continue
		}
		blocks := blocksByDep[d.ID]
		sort.Strings(blocks)
		out = append(out, DependencyFact{
			ID: d.ID, Title: d.Title, WaitingOn: d.WaitingOn, ExpectedBy: d.ExpectedBy,
			CreatedAt: d.CreatedAt, Blocks: blocks,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

func buildColors(rows []model.AdeColor) map[string]int {
	colors := make(map[string]int, len(rows))
	for _, c := range rows {
		colors[c.Item] = c.Slot
	}
	return colors
}

func buildPlanFact(rows []model.AdePlanRow, branchFacts []BranchFact) PlanFact {
	dayMap := make(map[string]*string, len(rows))
	queuedAfter := make(map[string]string)
	positioned := append([]model.AdePlanRow(nil), rows...)
	sort.Slice(positioned, func(i, j int) bool { return positioned[i].Position < positioned[j].Position })
	order := make([]string, 0, len(positioned))
	for _, p := range positioned {
		dayMap[p.Item] = p.Day
		order = append(order, p.Item)
		if p.QueuedAfter != "" {
			queuedAfter[p.Item] = p.QueuedAfter
		}
	}
	unpushed := make(map[string]bool)
	for _, f := range branchFacts {
		if f.Upstream != "" && f.UpstreamAhead > 0 && f.UpstreamBehind > 0 {
			unpushed[f.ID] = true
		}
	}
	return PlanFact{Day: dayMap, Order: order, QueuedAfter: queuedAfter, Unpushed: unpushed}
}

func filesSet(changes []porcelain.FileChange) map[string]bool {
	out := make(map[string]bool, len(changes))
	for _, c := range changes {
		out[c.Path] = true
	}
	return out
}

// reconcileNewWork is §0.10's own rebind check, run at the top of every Snapshot (§5.1 step 3):
// a typed branch_name binds once that branch exists (never falls through to the heuristic below,
// §0.10 rule 1); otherwise auto-binds only when exactly one local branch, not queued or archived,
// checked out in a linked worktree, has a reflog creation time at or after the new-work's own first
// session start minus 5s — more than one such candidate stays unbound and is served back on the
// NewWork row as BranchCandidates (this function's own second return, applied by the caller onto
// NewWorkFact regardless of whether this call itself rebound anything else).
func (q *Queue) reconcileNewWork(ctx context.Context, entry *gitsession.RepoEntry, codeRepoID string, state *repos.AdeQueueState) (bool, map[string][]string, error) {
	var activeNewWork []model.AdeNewWork
	for _, w := range state.NewWork {
		if w.ArchivedAt == nil {
			activeNewWork = append(activeNewWork, w)
		}
	}
	if len(activeNewWork) == 0 {
		return false, nil, nil
	}

	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return false, nil, err
	}
	branchState := make(map[string]model.AdeBranch, len(state.Branches))
	for _, b := range state.Branches {
		branchState[b.Branch] = b
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return false, nil, err
	}

	rebound := false
	branchCandidates := map[string][]string{}
	for _, w := range activeNewWork {
		if w.BranchName != "" {
			bound, err := q.reconcileTypedNewWork(ctx, entry, codeRepoID, w, inv, branchState, userEmail)
			if err != nil {
				return false, nil, err
			}
			rebound = rebound || bound
			continue
		}
		bound, candidates, err := q.reconcileHeuristicNewWork(ctx, entry, codeRepoID, w, inv, branchState, userEmail)
		if err != nil {
			return false, nil, err
		}
		if bound {
			rebound = true
		} else if len(candidates) > 0 {
			branchCandidates[w.ID] = candidates
		}
	}
	return rebound, branchCandidates, nil
}

// reconcileTypedNewWork is §0.10 rule 1: a typed branch_name binds once that branch exists in the
// inventory and is not already queued or archived — never falls through to the heuristic below.
func (q *Queue) reconcileTypedNewWork(ctx context.Context, entry *gitsession.RepoEntry, codeRepoID string, w model.AdeNewWork, inv []porcelain.InventoryRef, branchState map[string]model.AdeBranch, userEmail string) (bool, error) {
	row, found := resolveQueuedRef(inv, w.BranchName, "")
	if !found {
		return false, nil
	}
	if _, exists := branchState[w.BranchName]; exists {
		return false, nil // already queued or archived — a typed name never displaces it.
	}
	if err := q.bindNewWorkLocked(ctx, entry, codeRepoID, w.ID, w.BranchName, row, userEmail); err != nil {
		return false, err
	}
	return true, nil
}

// reconcileHeuristicNewWork is §0.10's own auto-bind path: a session already exists for w, and
// exactly one local branch, not queued or archived, checked out in a linked worktree, has a reflog
// creation time at or after that session's own first start minus 5s. More than one match: stays
// unbound, every matching name returned as the ambiguous candidate set.
func (q *Queue) reconcileHeuristicNewWork(ctx context.Context, entry *gitsession.RepoEntry, codeRepoID string, w model.AdeNewWork, inv []porcelain.InventoryRef, branchState map[string]model.AdeBranch, userEmail string) (bool, []string, error) {
	firstStartedMs, hasSession := firstSessionStart(q.deps.Sessions(codeRepoID), w.ID)
	if !hasSession {
		return false, nil, nil
	}

	mainRoot := entry.Summary.Root
	var candidates []rebindCandidate
	for _, r := range inv {
		if r.Remote != "" {
			continue
		}
		if r.WorktreePath == "" || filepath.Clean(r.WorktreePath) == filepath.Clean(mainRoot) {
			continue
		}
		b, isBranchRow := branchState[r.Short]
		reflogAt, hasReflog, err := entry.ReflogCreatedAt(ctx, r.Short)
		if err != nil {
			return false, nil, err
		}
		candidates = append(candidates, rebindCandidate{
			Name: r.Short, CheckedOutInLinkedWorktree: true,
			Queued: isBranchRow && b.ArchivedAt == nil, Archived: isBranchRow && b.ArchivedAt != nil,
			HasReflog: hasReflog, ReflogCreatedAtUnix: reflogAt,
		})
	}

	decision := rebindCandidates("", firstStartedMs/1000, candidates)
	if decision.Bind == "" {
		return false, decision.Candidates, nil
	}
	row, found := resolveQueuedRef(inv, decision.Bind, "")
	if !found {
		return false, nil, nil
	}
	if err := q.bindNewWorkLocked(ctx, entry, codeRepoID, w.ID, decision.Bind, row, userEmail); err != nil {
		return false, nil, err
	}
	return true, nil, nil
}

func firstSessionStart(sessions []SessionRef, newWorkID string) (firstStartedMs int64, ok bool) {
	for _, s := range sessions {
		if s.NewWorkID != newWorkID {
			continue
		}
		if !ok || s.StartedAt < firstStartedMs {
			firstStartedMs = s.StartedAt
		}
		ok = true
	}
	return firstStartedMs, ok
}

func (q *Queue) bindNewWorkLocked(ctx context.Context, entry *gitsession.RepoEntry, codeRepoID, newWorkID, branch string, row porcelain.InventoryRef, userEmail string) error {
	kind := resolveKind(row, userEmail, "")
	now := q.deps.Now().UnixMilli()
	if err := q.deps.Store.Rebind(codeRepoID, newWorkID, branch, kind, now); err != nil {
		return err
	}
	if q.deps.OnSessionsChanged != nil {
		q.deps.OnSessionsChanged()
	}
	return nil
}

// --- Prs (§0.12) -------------------------------------------------------------------------------

func (q *Queue) Prs(ctx context.Context, codeRepoID string) (RepoPrs, error) {
	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return RepoPrs{}, err
	}
	state, err := q.deps.Store.Load(codeRepoID)
	if err != nil {
		return RepoPrs{}, err
	}

	webURL, _ := entry.RepoWebURL(ctx)

	var branches []string
	for _, b := range state.Branches {
		if b.ArchivedAt == nil {
			branches = append(branches, b.Branch)
		}
	}
	if len(branches) == 0 {
		return RepoPrs{Kind: "ok", Branches: map[string]*PrFact{}, WebURL: webURL}, nil
	}

	out := make(map[string]*PrFact)
	var mu sync.Mutex
	kind := ""
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for _, branch := range branches {
		g.Go(func() error {
			res := entry.ResolveBranchPr(gctx, branch)
			mu.Lock()
			defer mu.Unlock()
			if kind == "" || kind == "ok" {
				kind = res.Kind
			}
			if res.Kind == "ok" && len(res.PRs) > 0 {
				pr := res.PRs[0]
				out[branch] = &PrFact{Number: pr.Number, Title: pr.Title, URL: pr.URL, State: pr.State}
			}
			return nil
		})
	}
	_ = g.Wait() // ResolveBranchPr never errors — it reports disabled/unavailable instead.
	if kind == "" {
		kind = "ok"
	}
	return RepoPrs{Kind: kind, Branches: out, WebURL: webURL}, nil
}

// --- Candidates (§5.3) -------------------------------------------------------------------------

func (q *Queue) Candidates(ctx context.Context, codeRepoID string) ([]CandidateBranch, error) {
	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return nil, err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return nil, err
	}
	state, err := q.deps.Store.Load(codeRepoID)
	if err != nil {
		return nil, err
	}
	known := make(map[string]bool, len(state.Branches))
	for _, b := range state.Branches {
		known[b.Branch] = true
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var out []CandidateBranch
	for _, r := range inv {
		if r.Remote != "" || known[r.Short] || seen[r.Short] {
			continue
		}
		seen[r.Short] = true
		mine := resolveKind(r, userEmail, "") == model.AdeBranchKindMine
		out = append(out, CandidateBranch{Name: r.Short, Author: r.AuthorName, LastCommitAt: r.CommitterUnix, Mine: mine})
	}
	for _, r := range inv {
		if r.Remote == "" || known[r.Short] || seen[r.Short] {
			continue
		}
		seen[r.Short] = true
		mine := resolveKind(r, userEmail, "") == model.AdeBranchKindMine
		out = append(out, CandidateBranch{Name: r.Short, Author: r.AuthorName, LastCommitAt: r.CommitterUnix, RemoteOnly: true, Mine: mine})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastCommitAt > out[j].LastCommitAt })
	return out, nil
}

// --- Writes (§5.1/§5.3) ------------------------------------------------------------------------

func (q *Queue) AddBranch(ctx context.Context, codeRepoID, branch, kindOverride string) (string, error) {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return "", err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return "", err
	}
	remote, _ := entry.DefaultRemote(ctx)
	row, found := resolveQueuedRef(inv, branch, remote)
	if !found {
		return "", fmt.Errorf("ade: queue: branch %q not found", branch)
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return "", err
	}
	kind := resolveKind(row, userEmail, kindOverride)
	b := model.AdeBranch{
		CodeRepoID: codeRepoID, Branch: branch, Kind: kind, WorkType: model.DefaultAdeWorkType(kind),
		AddedAt: q.deps.Now().UnixMilli(),
	}
	if _, err := q.deps.Store.AddBranch(codeRepoID, b); err != nil {
		return "", err
	}
	q.notifyChanged(codeRepoID)
	return branch, nil
}

// NewWorkInput is AddNewWork's own argument bundle (§5.3).
type NewWorkInput struct {
	Title, JiraKey, JiraURL, StartFrom, Notes, Est string
}

func (q *Queue) AddNewWork(codeRepoID string, in NewWorkInput) (string, error) {
	startFrom := in.StartFrom
	if startFrom == "" {
		startFrom = "main"
	}
	id := "nw:" + uuid.NewString()
	w := model.AdeNewWork{
		ID: id, CodeRepoID: codeRepoID, Title: in.Title, WorkType: model.AdeWorkTypeWork,
		JiraKey: in.JiraKey, JiraURL: in.JiraURL, StartFrom: startFrom, Notes: in.Notes, Est: in.Est, CreatedAt: q.deps.Now().UnixMilli(),
	}
	if _, err := q.deps.Store.AddNewWork(w); err != nil {
		return "", err
	}
	q.notifyChanged(codeRepoID)
	return id, nil
}

func (q *Queue) UpdateNewWork(codeRepoID, id string, patch model.AdeNewWorkPatch) error {
	if err := q.deps.Store.UpdateNewWork(id, patch); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

func (q *Queue) SetBranchMeta(codeRepoID, branch string, patch model.AdeBranchMetaPatch) error {
	if err := q.deps.Store.SetBranchMeta(codeRepoID, branch, patch); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

func (q *Queue) SetPlan(codeRepoID string, days map[string]*string, order []string) error {
	if err := q.deps.Store.SetPlan(codeRepoID, days, order); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

func (q *Queue) SetQueuedAfter(codeRepoID, item, after string) error {
	if err := q.deps.Store.SetQueuedAfter(codeRepoID, item, after); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

// DependencyInput is AddDependency's own argument bundle (P135 §4.3).
type DependencyInput struct {
	Title, WaitingOn, ExpectedBy string
	Blocks                       []string
}

// AddDependency mints a fresh "dep:" id and stores it plus its blocker links — no openRepo, no
// gitsession, no worktree: a dependency has no git identity of any kind.
func (q *Queue) AddDependency(codeRepoID string, in DependencyInput) (string, error) {
	id := "dep:" + uuid.NewString()
	var expectedBy *string
	if in.ExpectedBy != "" {
		expectedBy = &in.ExpectedBy
	}
	d := model.AdeDependency{
		ID: id, CodeRepoID: codeRepoID, Title: in.Title, WaitingOn: in.WaitingOn,
		ExpectedBy: expectedBy, CreatedAt: q.deps.Now().UnixMilli(),
	}
	if err := q.deps.Store.AddDependency(d, in.Blocks); err != nil {
		return "", err
	}
	q.notifyChanged(codeRepoID)
	return id, nil
}

func (q *Queue) UpdateDependency(codeRepoID, id string, patch model.AdeDependencyPatch) error {
	if err := q.deps.Store.UpdateDependency(codeRepoID, id, patch); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

func (q *Queue) ResolveDependency(codeRepoID, id string) error {
	if err := q.deps.Store.ResolveDependency(codeRepoID, id, q.deps.Now().UnixMilli()); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

func (q *Queue) SetBlocker(codeRepoID, dependency, item string, linked bool) error {
	if err := q.deps.Store.SetBlocker(codeRepoID, dependency, item, linked); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

// BindNewWork is §0.10's own explicit path (the ambiguous-candidates case's own resolution) —
// branch must already exist and be unqueued; Store.Rebind's own checkNotQueuedOrArchived enforces
// the latter.
func (q *Queue) BindNewWork(ctx context.Context, codeRepoID, newWorkID, branch string) error {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return err
	}
	inv, err := entry.BranchInventory(ctx)
	if err != nil {
		return err
	}
	remote, _ := entry.DefaultRemote(ctx)
	row, found := resolveQueuedRef(inv, branch, remote)
	if !found {
		return fmt.Errorf("ade: queue: branch %q not found", branch)
	}
	userEmail, err := entry.ConfigValue(ctx, "user.email")
	if err != nil {
		return err
	}
	return q.bindNewWorkLocked(ctx, entry, codeRepoID, newWorkID, branch, row, userEmail)
}

// --- Refresh (§6.1) ----------------------------------------------------------------------------

// Refresh is §6.1's own five-step sequence. Step 4 ("recompute snapshot") is deliberately a real
// call to snapshotLocked (not a hand-rolled duplicate of its ancestor-reachability merge check):
// Refresh already holds codeRepoID's own repoMutex, snapshotLocked expects exactly that, and it is
// the one place mergedRule's tipReachableFromMain-based detection (§0.8's first branch) and its own
// MarkFacts write already live — the PR-state branch of §0.8 is the only merge signal Refresh must
// contribute itself (step 5).
func (q *Queue) Refresh(ctx context.Context, codeRepoID string) (RefreshResult, error) {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return RefreshResult{}, err
	}
	remote, hasRemote := entry.DefaultRemote(ctx)
	if !hasRemote {
		return RefreshResult{Error: &gitsession.RemoteOpError{Kind: "NoRemote", Message: "this repository has no remote configured"}}, nil
	}

	before, err := entry.BranchInventory(ctx)
	if err != nil {
		return RefreshResult{}, err
	}
	beforeTips := make(map[string]string, len(before))
	for _, r := range before {
		beforeTips[r.Ref] = r.Tip
	}
	stateBefore, err := q.deps.Store.Load(codeRepoID)
	if err != nil {
		return RefreshResult{}, err
	}
	mergedBefore := make(map[string]bool, len(stateBefore.Branches))
	for _, b := range stateBefore.Branches {
		mergedBefore[b.Branch] = b.MergedAt != nil
	}

	res, err := entry.RunRemote(ctx, q.conn, gitsession.RemoteOpParams{Kind: "fetch", Remote: remote, Prune: true}, gitsession.RemoteDeps{Askpass: q.deps.Askpass})
	if err != nil {
		return RefreshResult{}, err
	}
	if !res.OK {
		return RefreshResult{Error: res.Error}, nil
	}

	snap, err := q.snapshotLocked(ctx, codeRepoID)
	if err != nil {
		return RefreshResult{}, err
	}
	newlyMergedSet, mineNotMerged := splitRefreshedBranches(snap.Branches, mergedBefore)

	mergedNow := q.checkPrMerges(ctx, entry, mineNotMerged)
	if len(mergedNow) > 0 {
		if err := q.deps.Store.MarkFacts(codeRepoID, nil, mergedNow); err != nil {
			return RefreshResult{}, err
		}
		for branch := range mergedNow {
			newlyMergedSet[branch] = true
		}
	}
	newlyMerged := make([]string, 0, len(newlyMergedSet))
	for branch := range newlyMergedSet {
		newlyMerged = append(newlyMerged, branch)
	}
	sort.Strings(newlyMerged)

	refsChanged, err := q.countRefsChanged(ctx, entry, stateBefore.Branches, beforeTips, remote)
	if err != nil {
		return RefreshResult{}, err
	}

	q.notifyChanged(codeRepoID)
	return RefreshResult{RefsChanged: refsChanged, NewlyMerged: newlyMerged}, nil
}

// splitRefreshedBranches is step 4/5's own split over the just-recomputed snapshot: which existing
// branches newly crossed into merged (ancestor-reachability, §0.8's first branch) since
// mergedBefore was captured, and which mine branches are still unmerged and so need step 5's own
// PR-state check.
func splitRefreshedBranches(branches []BranchFact, mergedBefore map[string]bool) (newlyMerged map[string]bool, mineNotMerged []BranchFact) {
	newlyMerged = map[string]bool{}
	for _, bf := range branches {
		if !bf.Exists {
			continue
		}
		if bf.MergedAt != nil && !mergedBefore[bf.ID] {
			newlyMerged[bf.ID] = true
		}
		if bf.Kind == model.AdeBranchKindMine && bf.MergedAt == nil {
			mineNotMerged = append(mineNotMerged, bf)
		}
	}
	return newlyMerged, mineNotMerged
}

// checkPrMerges is §6.1 step 5: ResolveBranchPr for every still-unmerged mine branch (errgroup,
// limit 4), covering squash/rebase merges whose tip never becomes an ancestor of main (§0.8's
// second branch).
func (q *Queue) checkPrMerges(ctx context.Context, entry *gitsession.RepoEntry, mineNotMerged []BranchFact) map[string]int64 {
	mergedNow := map[string]int64{}
	if len(mineNotMerged) == 0 {
		return mergedNow
	}
	nowMs := q.deps.Now().UnixMilli()
	var mu sync.Mutex
	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(4)
	for _, bf := range mineNotMerged {
		g.Go(func() error {
			result := entry.ResolveBranchPr(gctx, bf.Branch)
			if result.Kind == "ok" && len(result.PRs) > 0 && result.PRs[0].State == "merged" {
				mu.Lock()
				mergedNow[bf.Branch] = nowMs
				mu.Unlock()
			}
			return nil
		})
	}
	_ = g.Wait() // ResolveBranchPr never errors — it reports disabled/unavailable instead.
	return mergedNow
}

// countRefsChanged is step 4's own refsChanged count: every non-archived queued branch plus main
// whose resolved tip moved between the pre- and post-fetch inventory.
func (q *Queue) countRefsChanged(ctx context.Context, entry *gitsession.RepoEntry, branchesBefore []model.AdeBranch, beforeTips map[string]string, remote string) (int, error) {
	after, err := entry.BranchInventory(ctx)
	if err != nil {
		return 0, err
	}
	afterTips := make(map[string]string, len(after))
	for _, r := range after {
		afterTips[r.Ref] = r.Tip
	}
	mainRefName, _, hasMain, err := entry.MainRef(ctx)
	if err != nil {
		return 0, err
	}
	refsChanged := 0
	for _, b := range branchesBefore {
		if b.ArchivedAt != nil {
			continue
		}
		if row, found := resolveQueuedRef(after, b.Branch, remote); found {
			if beforeTips[row.Ref] != afterTips[row.Ref] {
				refsChanged++
			}
		}
	}
	if hasMain && beforeTips[mainRefName] != afterTips[mainRefName] {
		refsChanged++
	}
	return refsChanged, nil
}

// --- ForcePush (§6.2) --------------------------------------------------------------------------

func (q *Queue) forcePushRemote(ctx context.Context, entry *gitsession.RepoEntry, branch string) string {
	if inv, err := entry.BranchInventory(ctx); err == nil {
		for _, r := range inv {
			if r.Remote == "" && r.Short == branch && r.Upstream != "" {
				rest := strings.TrimPrefix(r.Upstream, "refs/remotes/")
				if i := strings.IndexByte(rest, '/'); i > 0 {
					return rest[:i]
				}
			}
		}
	}
	remote, _ := entry.DefaultRemote(ctx)
	return remote
}

func (q *Queue) ForcePush(ctx context.Context, codeRepoID string, branches, confirmProtected []string) ([]ForcePushResult, error) {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return nil, err
	}
	confirmSet := make(map[string]bool, len(confirmProtected))
	for _, b := range confirmProtected {
		confirmSet[b] = true
	}

	out := make([]ForcePushResult, 0, len(branches))
	for _, branch := range branches {
		remote := q.forcePushRemote(ctx, entry, branch)
		pf, err := entry.PushPreflight(ctx, remote, branch)
		if err != nil {
			out = append(out, ForcePushResult{Branch: branch, Error: &gitsession.RemoteOpError{Kind: "Unknown", Message: err.Error()}})
			continue
		}
		confirmToken := ""
		if confirmSet[branch] {
			confirmToken = branch
		}
		res, err := entry.RunRemote(ctx, q.conn, gitsession.RemoteOpParams{
			Kind: "forcePush", Remote: remote, Branch: branch,
			ExpectedRemoteTip: pf.RemoteTip, ConfirmToken: confirmToken,
		}, gitsession.RemoteDeps{Askpass: q.deps.Askpass})
		if err != nil {
			out = append(out, ForcePushResult{Branch: branch, Error: &gitsession.RemoteOpError{Kind: "Unknown", Message: err.Error()}})
			continue
		}
		out = append(out, ForcePushResult{Branch: branch, OK: res.OK, Error: res.Error})
	}
	q.notifyChanged(codeRepoID)
	return out, nil
}

// --- Archive / ArchiveRisk (§0.9/§6.3) ------------------------------------------------------

// itemLookup resolves item to (isBranch, isNewWork, branchRow, worktreePath) — shared by Archive
// and ArchiveRisk.
func (q *Queue) itemLookup(ctx context.Context, entry *gitsession.RepoEntry, codeRepoID, item string) (isNewWork bool, branch model.AdeBranch, worktreePath string, found bool, err error) {
	state, err := q.deps.Store.Load(codeRepoID)
	if err != nil {
		return false, model.AdeBranch{}, "", false, err
	}
	for _, w := range state.NewWork {
		if w.ID == item && w.ArchivedAt == nil {
			return true, model.AdeBranch{}, "", true, nil
		}
	}
	for _, b := range state.Branches {
		if b.Branch == item && b.ArchivedAt == nil {
			inv, ierr := entry.BranchInventory(ctx)
			if ierr != nil {
				return false, model.AdeBranch{}, "", false, ierr
			}
			remote, _ := entry.DefaultRemote(ctx)
			if row, ok := resolveQueuedRef(inv, item, remote); ok {
				worktreePath = row.WorktreePath
			}
			return false, b, worktreePath, true, nil
		}
	}
	return false, model.AdeBranch{}, "", false, nil
}

func (q *Queue) ArchiveRisk(ctx context.Context, codeRepoID, item string) (ArchiveRisk, error) {
	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return ArchiveRisk{}, err
	}
	isNewWork, branch, worktreePath, found, err := q.itemLookup(ctx, entry, codeRepoID, item)
	if err != nil {
		return ArchiveRisk{}, err
	}
	if !found {
		return ArchiveRisk{}, fmt.Errorf("ade: queue: item %q not found", item)
	}
	if isNewWork {
		return ArchiveRisk{}, nil // new work has no worktree, nothing at risk (§0.9).
	}

	hasLinkedWorktree := worktreePath != "" && filepath.Clean(worktreePath) != filepath.Clean(entry.Summary.Root)

	var unmerged int
	if branch.MergedAt == nil {
		if _, mainTip, hasMain, err := entry.MainRef(ctx); err == nil && hasMain {
			inv, ierr := entry.BranchInventory(ctx)
			if ierr != nil {
				return ArchiveRisk{}, ierr
			}
			remote, _ := entry.DefaultRemote(ctx)
			if row, ok := resolveQueuedRef(inv, item, remote); ok {
				ahead, _, err := entry.AheadBehind(ctx, row.Tip, mainTip)
				if err != nil {
					return ArchiveRisk{}, err
				}
				unmerged = ahead
			}
		}
	}
	result := atRisk(atRiskInput{
		Kind: branch.Kind, Merged: branch.MergedAt != nil,
		HasLinkedWorktree: hasLinkedWorktree, UnmergedAheadOfMain: unmerged,
	})

	var dirty []DirtyEntry
	blocked := ""
	if hasLinkedWorktree {
		statusEntries, err := entry.WorktreeStatus(ctx, worktreePath)
		if err != nil {
			return ArchiveRisk{}, err
		}
		dirty = toDirtyEntries(statusEntries)
		result.Dirty = len(dirty)
		pf, err := entry.WorktreeRemovePreflight(ctx, worktreePath)
		if err != nil {
			return ArchiveRisk{}, err
		}
		if pf.Verdict == "blocked" && len(pf.Blockers) > 0 {
			blocked = pf.Blockers[0].Kind
		}
	}

	return ArchiveRisk{Dirty: dirty, Unmerged: result.Unmerged, Worktree: worktreePath, Blocked: blocked}, nil
}

func (q *Queue) Archive(ctx context.Context, codeRepoID, item string, discard bool) error {
	mu := q.repoMutex(codeRepoID)
	mu.Lock()
	defer mu.Unlock()

	entry, err := q.openRepo(ctx, codeRepoID)
	if err != nil {
		return err
	}
	isNewWork, _, worktreePath, found, err := q.itemLookup(ctx, entry, codeRepoID, item)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("ade: queue: item %q not found or already archived", item)
	}

	hasLinkedWorktree := worktreePath != "" && filepath.Clean(worktreePath) != filepath.Clean(entry.Summary.Root)
	if !isNewWork && hasLinkedWorktree {
		if err := q.checkWorktreeRemovable(ctx, entry, item, worktreePath, discard); err != nil {
			return err
		}
	}

	if err := q.stopRunningSessions(codeRepoID, item, isNewWork); err != nil {
		return err
	}

	if !isNewWork && hasLinkedWorktree {
		if err := q.removeLinkedWorktree(ctx, entry, item, worktreePath, discard); err != nil {
			return err
		}
	}

	now := q.deps.Now().UnixMilli()
	if err := q.deps.Store.Archive(codeRepoID, item, now); err != nil {
		return err
	}
	q.notifyChanged(codeRepoID)
	return nil
}

// checkWorktreeRemovable runs WorktreeRemovePreflight for Archive's own linked-worktree path,
// rejecting a blocked removal outright and a dirty one unless the caller asked to discard.
func (q *Queue) checkWorktreeRemovable(ctx context.Context, entry *gitsession.RepoEntry, item, worktreePath string, discard bool) error {
	pf, err := entry.WorktreeRemovePreflight(ctx, worktreePath)
	if err != nil {
		return err
	}
	if pf.Verdict == "blocked" {
		reason := "this worktree cannot be removed"
		if len(pf.Blockers) > 0 {
			reason = pf.Blockers[0].Kind
		}
		return fmt.Errorf("ade: queue: archive %s: blocked: %s", item, reason)
	}
	if pf.Verdict == "dirty" && !discard {
		return fmt.Errorf("ade: queue: archive %s: worktree has uncommitted changes", item)
	}
	return nil
}

// stopRunningSessions closes the terminal of every running session Archive's own item owns, so
// nothing keeps the worktree busy once it's removed.
func (q *Queue) stopRunningSessions(codeRepoID, item string, isNewWork bool) error {
	for _, s := range q.deps.Sessions(codeRepoID) {
		matches := (isNewWork && s.NewWorkID == item) || (!isNewWork && s.Branch == item)
		if matches && s.State == model.AdeSessionStateRunning && s.TerminalID != "" {
			if err := q.deps.CloseTerminal(s.TerminalID); err != nil {
				return err
			}
		}
	}
	return nil
}

// removeLinkedWorktree runs the worktreeRemove op, passing a confirm token (the worktree's base
// name) only when the caller asked to discard its uncommitted changes.
func (q *Queue) removeLinkedWorktree(ctx context.Context, entry *gitsession.RepoEntry, item, worktreePath string, discard bool) error {
	var confirmToken *string
	if discard {
		base := filepath.Base(worktreePath)
		confirmToken = &base
	}
	res, err := entry.RunOp(ctx, adeConnID, adeConnLabel, gitsession.OpRequest{
		Kind: "worktreeRemove", Path: worktreePath, ConfirmToken: confirmToken,
	})
	if err != nil {
		return err
	}
	if !res.OK {
		msg := "worktree remove failed"
		if res.Error != nil {
			msg = res.Error.Message
		}
		return fmt.Errorf("ade: queue: archive %s: %s", item, msg)
	}
	return nil
}

// --- Credentials (§6.5) ------------------------------------------------------------------------

func (q *Queue) ProvideCredential(requestID string, secret *string) bool {
	return q.conn.ProvideCredential(requestID, secret)
}

// Close releases ade's own Conn — every repo it holds open, and stops any pending debounce timer.
func (q *Queue) Close() {
	q.mu.Lock()
	for _, t := range q.debounce {
		t.Stop()
	}
	q.debounce = map[string]*time.Timer{}
	q.mu.Unlock()
	q.conn.Close()
}
