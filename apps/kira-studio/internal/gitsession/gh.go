package gitsession

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ghclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitops"
)

// G24 D6's three per-repo TTLs, and D6's own LRU bound for the per-commit cache — shas are
// unbounded, unlike branches, so only this one needs an eviction policy at all.
const (
	ghSnapshotTTL    = 5 * time.Minute
	ghBranchTTL      = 5 * time.Minute
	ghCommitTTL      = 10 * time.Minute
	ghCommitCacheCap = 512
)

// ghBreakerFallback is D7's own "parsed reset, else now + 15 min" — this package always takes the
// fallback: D4's exact `gh api` argv never requests response headers (`--include`), so there is no
// X-RateLimit-Reset value to parse in the first place. Documented here as the one place that
// departs from D7's literal "parsed reset" wording (a locally-reasonable call the plan itself did
// not resolve — see this phase's own commit message for the full rationale).
const ghBreakerFallback = 15 * time.Minute

// PrLookupResult is commit.resolvePr/branch.resolvePr's own shared shape (D14) — gitrpc's wire
// PrLookupResult is a direct, structural projection of this.
type PrLookupResult struct {
	Kind string // "ok" | "disabled" | "unavailable"
	PRs  []ghclient.PR
	Gh   *ghclient.Status
}

func disabledResult() PrLookupResult { return PrLookupResult{Kind: "disabled"} }

func unavailableResult(status ghclient.Status) PrLookupResult {
	s := status
	return PrLookupResult{Kind: "unavailable", Gh: &s}
}

func okResult(prs []ghclient.PR) PrLookupResult {
	if prs == nil {
		prs = []ghclient.PR{}
	}
	return PrLookupResult{Kind: "ok", PRs: prs}
}

type ghCommitEntry struct {
	prs      []ghclient.PR
	cachedAt time.Time
}

type ghBranchEntry struct {
	pr       *ghclient.PR
	cachedAt time.Time
}

// ghState is one RepoEntry's whole G24 slot (D6): the repo-wide open-PR snapshot, the per-branch
// cache, the per-commit LRU, this entry's own GitHub-remote detection (D15), and the rate-limit
// breaker (D7). One instance per RepoEntry, never shared across repositories.
type ghState struct {
	mu sync.Mutex

	// remoteChecked/repo/isGitHub cache D15's own one-git-spawn "is this a GitHub repository"
	// detection for this entry's life — dropped on refsChanged (a remote could have been
	// added/changed/removed).
	remoteChecked bool
	repo          ghclient.Repo
	isGitHub      bool

	snapshot      []ghclient.PR
	snapshotAt    time.Time
	snapshotValid bool

	branch map[string]ghBranchEntry

	commit    map[string]ghCommitEntry
	commitLRU []string // oldest first; ghCommitCacheCap-bounded.

	// blockedUntil/blockedStatus is D7's own breaker — set only by a rate-limited forbidden,
	// deliberately NOT cleared by drop() (refsChanged does not clear it, D7).
	blockedUntil  time.Time
	blockedStatus ghclient.Status

	// lastEagerPurgeAt gates eagerPurgeAllowed below (G30 round-1 performance review, finding #2)
	// — deliberately NOT cleared by drop(): the whole point is to survive the very refsChanged
	// that triggers the next eager pass, not reset alongside it.
	lastEagerPurgeAt time.Time
}

func newGhState() *ghState {
	return &ghState{branch: make(map[string]ghBranchEntry), commit: make(map[string]ghCommitEntry)}
}

// drop is the refsChanged handler's own call (D6/D15): the snapshot, per-branch cache, per-commit
// cache and the GitHub-remote detection are all dropped — the breaker is not (D7).
func (s *ghState) drop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.remoteChecked = false
	s.snapshotValid = false
	s.snapshot = nil
	s.branch = make(map[string]ghBranchEntry)
	s.commit = make(map[string]ghCommitEntry)
	s.commitLRU = nil
}

func (s *ghState) armBreaker(status ghclient.Status) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blockedUntil = time.Now().Add(ghBreakerFallback)
	s.blockedStatus = status
}

// breakerStatus returns the cached forbidden Status and true while the breaker is armed — every
// call inside that window is served from here with NO spawn (D7).
func (s *ghState) breakerStatus() (ghclient.Status, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.blockedUntil.IsZero() || time.Now().After(s.blockedUntil) {
		return ghclient.Status{}, false
	}
	return s.blockedStatus, true
}

// eagerPurgeMinGap bounds how often eagerResolveClosedBranches may actually do its own work,
// independent of maxEagerPurgeBranches' own per-pass branch cap (G30 round-1 performance review,
// finding #2). note()'s own refsChanged handler calls drop() immediately before scheduling this
// pass, on EVERY refsChanged — an interactive rebase's dozen-plus signals, or a `git fetch
// --prune`'s own single burst, used to re-trigger a fresh bulk gh fetch on every single one, with
// no throttle anywhere in this path. Mirrors graphView.ts's own AUTO_REFRESH_MIN_GAP_MS — the
// client's own auto-refresh already learned this exact lesson for the same reason.
const eagerPurgeMinGap = 1 * time.Second

// eagerPurgeAllowed reports whether enough time has passed since the last eager pass that actually
// ran, and — if so — atomically claims this call as the one that runs, so two goroutines racing
// this check (two refsChanged signals close enough together that both reach here before either
// finishes) can never both proceed.
func (s *ghState) eagerPurgeAllowed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.lastEagerPurgeAt.IsZero() && time.Since(s.lastEagerPurgeAt) < eagerPurgeMinGap {
		return false
	}
	s.lastEagerPurgeAt = time.Now()
	return true
}

func (s *ghState) commitCacheGet(sha string) ([]ghclient.PR, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.commit[sha]
	if !ok || time.Since(entry.cachedAt) >= ghCommitTTL {
		return nil, false
	}
	return entry.prs, true
}

func (s *ghState) commitCachePut(sha string, prs []ghclient.PR) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.commit[sha]; !exists {
		s.commitLRU = append(s.commitLRU, sha)
		for len(s.commitLRU) > ghCommitCacheCap {
			oldest := s.commitLRU[0]
			s.commitLRU = s.commitLRU[1:]
			delete(s.commit, oldest)
		}
	}
	s.commit[sha] = ghCommitEntry{prs: prs, cachedAt: time.Now()}
}

func (s *ghState) branchCacheGet(branch string) (*ghclient.PR, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.branch[branch]
	if !ok || time.Since(entry.cachedAt) >= ghBranchTTL {
		return nil, false
	}
	return entry.pr, true
}

func (s *ghState) branchCachePut(branch string, pr *ghclient.PR) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.branch[branch] = ghBranchEntry{pr: pr, cachedAt: time.Now()}
}

func (s *ghState) snapshotGet() ([]ghclient.PR, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.snapshotValid || time.Since(s.snapshotAt) >= ghSnapshotTTL {
		return nil, false
	}
	return s.snapshot, true
}

func (s *ghState) snapshotPut(prs []ghclient.PR) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshot = prs
	s.snapshotAt = time.Now()
	s.snapshotValid = true
}

// isGitHubHost is D15's own test: the literal "github.com", or a host the Client's own Discovery
// has ever probed successfully (a GHES install).
func isGitHubHost(host string, ghHosts []string) bool {
	if host == "github.com" {
		return true
	}
	for _, h := range ghHosts {
		if strings.EqualFold(h, host) {
			return true
		}
	}
	return false
}

// githubRepo resolves and caches (for this entry's life, dropped on refsChanged) whether this
// repository has a GitHub-shaped "origin" remote at all (D15) — the ONE git spawn this whole
// feature ever needs (`git remote get-url origin`), so a non-GitHub remote costs exactly zero gh
// probes (§0.4's own ground rule).
func (e *RepoEntry) githubRepo(ctx context.Context) (ghclient.Repo, bool) {
	e.gh.mu.Lock()
	if e.gh.remoteChecked {
		repo, ok := e.gh.repo, e.gh.isGitHub
		e.gh.mu.Unlock()
		return repo, ok
	}
	e.gh.mu.Unlock()

	res, err := e.runAllowingExit(ctx, gitops.RemoteGetURLArgs("origin"), 0, 128)
	var repo ghclient.Repo
	var ok bool
	if err == nil && res.ExitCode == 0 {
		url := strings.TrimSpace(string(res.Stdout))
		if parsed, parsedOK := ghclient.ParseRemote(url); parsedOK {
			hosts := e.ghClient.Hosts(ctx)
			if isGitHubHost(parsed.Host, hosts) {
				repo, ok = parsed, true
			}
		}
	}

	e.gh.mu.Lock()
	e.gh.remoteChecked = true
	e.gh.repo = repo
	e.gh.isGitHub = ok
	e.gh.mu.Unlock()
	return repo, ok
}

// githubEnabled reads kiraVersion.github.enabled off this entry's own repo settings (D16) — plain
// field read, no caching of its own (RepoSettings() is already cheap, and a live toggle must take
// effect on the very next resolve, not after some TTL).
func (e *RepoEntry) githubEnabled() bool {
	return e.RepoSettings().GithubEnabled
}

// ensureSnapshot is D6's own repo-wide open-PR snapshot, fetched lazily on first need and cached
// for ghSnapshotTTL — the one bulk read this feature makes, serving the graph indicator's own
// pre-seed, the branch-picker badges and search's synchronous PR-record match all at once (D6/F16).
// Never called at repo open (D13).
func (e *RepoEntry) ensureSnapshot(ctx context.Context) ([]ghclient.PR, ghclient.Status) {
	if prs, ok := e.gh.snapshotGet(); ok {
		return prs, ghclient.Status{Kind: ghclient.KindOK}
	}
	if status, armed := e.gh.breakerStatus(); armed {
		return nil, status
	}
	if !e.githubEnabled() {
		return nil, ghclient.Status{Kind: "disabled"}
	}
	repo, ok := e.githubRepo(ctx)
	if !ok {
		return nil, ghclient.Status{Kind: "disabled"}
	}
	prs, status := e.ghClient.OpenPulls(ctx, repo)
	if !status.OK() {
		if isRateLimitedStatus(status) {
			e.gh.armBreaker(status)
		}
		return nil, status
	}
	e.gh.snapshotPut(prs)
	return prs, status
}

// isRateLimitedStatus mirrors ghclient's own private isRateLimited — reimplemented here (a
// substring check on Status.Reason) since ghclient does not export it and this package must not
// reach into ghclient's own internals to get it.
func isRateLimitedStatus(s ghclient.Status) bool {
	return s.Kind == ghclient.KindForbidden && strings.Contains(strings.ToLower(s.Reason), "rate limit")
}

// ResolveCommitPr is commit.resolvePr's own orchestration (D9 step 3): github.enabled off or no
// GitHub remote -> {kind:'disabled'}; a cached commit record -> served with no spawn; the breaker
// armed -> the cached forbidden Status with no spawn; otherwise Client.PullsForCommit, cached on a
// successful answer. Never returns a Go error (D1's own "Client never returns an error" carried
// through this whole call chain) — every outcome is a PrLookupResult the RPC layer answers with
// directly, so a GitHub hiccup never blocks or fails the request (§0.4's ground rule).
func (e *RepoEntry) ResolveCommitPr(ctx context.Context, sha string) PrLookupResult {
	if !e.githubEnabled() {
		return disabledResult()
	}
	repo, ok := e.githubRepo(ctx)
	if !ok {
		return disabledResult()
	}
	if prs, hit := e.gh.commitCacheGet(sha); hit {
		return okResult(prs)
	}
	if status, armed := e.gh.breakerStatus(); armed {
		return unavailableResult(status)
	}

	prs, status := e.ghClient.PullsForCommit(ctx, repo, sha)
	if !status.OK() {
		if isRateLimitedStatus(status) {
			e.gh.armBreaker(status)
		}
		return unavailableResult(status)
	}
	e.gh.commitCachePut(sha, prs)
	return okResult(prs)
}

// ResolveBranchPr is branch.resolvePr's own orchestration (D8): a snapshot hit on head.ref ==
// branch answers with no call at all; a miss falls through to the per-branch `state=all` query —
// the only call that can report a PR that has since closed. A resolved closed/merged PR triggers
// G11's own exported Purge seam (D20) — this reuses that seam, it never reimplements purging logic
// or adds a second delete path (F6/plan's own explicit prohibition). A purge failure is logged and
// never turned into an RPC error.
func (e *RepoEntry) ResolveBranchPr(ctx context.Context, branch string) PrLookupResult {
	if !e.githubEnabled() {
		return disabledResult()
	}
	repo, ok := e.githubRepo(ctx)
	if !ok {
		return disabledResult()
	}

	// G30 round-1 performance review, finding #1: this used to read the snapshot cache with
	// snapshotGet alone, which never POPULATES it — ensureSnapshot is the one thing that does,
	// and had zero callers anywhere in the tree. So on any cold cache (repo open, or every
	// ghSnapshotTTL expiry) every branch's first resolve fell straight through to its own
	// per-branch `gh api` spawn, and the client's own "warm every branch at once" fan-out
	// (pr.ts's ensureSnapshot, called from BranchPicker.vue/search/stack) turned that into one
	// process + one GitHub REST call PER BRANCH, all concurrent, for a repo that may have hundreds.
	// Calling ensureSnapshot here means the first resolve after a cold cache pays ONE bulk
	// OpenPulls call and warms the snapshot for every other branch that has an open PR; only a
	// genuinely non-GitHub-shaped miss (a since-closed PR, or the breaker/a fetch failure) still
	// falls through to the per-branch query below, exactly as before.
	if snapshot, status := e.ensureSnapshot(ctx); status.OK() {
		for _, pr := range snapshot {
			if pr.HeadRef == branch {
				e.maybePurgeClosed(ctx, branch, &pr)
				return okResult([]ghclient.PR{pr})
			}
		}
		// No OPEN PR for this branch in the snapshot — not yet authoritative for "no PR at all"
		// (the snapshot is open-PRs-only), so this still falls through to the per-branch
		// state=all query below, the one call that can report a PR that has since closed.
	}

	if cached, hit := e.gh.branchCacheGet(branch); hit {
		if cached == nil {
			return okResult(nil)
		}
		return okResult([]ghclient.PR{*cached})
	}
	if status, armed := e.gh.breakerStatus(); armed {
		return unavailableResult(status)
	}

	prs, status := e.ghClient.PullsForBranch(ctx, repo, branch)
	if !status.OK() {
		if isRateLimitedStatus(status) {
			e.gh.armBreaker(status)
		}
		return unavailableResult(status)
	}

	var latest *ghclient.PR
	if len(prs) > 0 {
		p := prs[0]
		latest = &p
	}
	e.gh.branchCachePut(branch, latest)
	e.maybePurgeClosed(ctx, branch, latest)
	if latest == nil {
		return okResult(nil)
	}
	return okResult([]ghclient.PR{*latest})
}

// maxEagerPurgeBranches bounds D8's own eager post-fetch re-resolve pass, triggered by refsChanged
// and nothing else (never a timer, §0.4's own ground rule) — a repository with many stale review
// sessions never turns one refsChanged signal into an unbounded burst of gh calls.
const maxEagerPurgeBranches = 8

// eagerResolveClosedBranches is D8's own eager purge, run in its own goroutine by note()'s own
// refsChanged handler, AFTER the cache drop: skipped outright when github.enabled is off, there is
// no GitHub remote, or the breaker is already armed — resolves at most maxEagerPurgeBranches
// branches that actually have a stored review session (gitreview.Store.Branches, a read, never a
// second lifecycle — F6), reusing the snapshot exactly like ResolveBranchPr does, and purges each
// one whose resolved state is closed/merged through the SAME maybePurgeClosed this file's own
// user-initiated path already uses. Never returns anything and never logs beyond what
// maybePurgeClosed itself already logs on a purge failure — this is a background best-effort pass,
// not a request with a caller waiting on it.
func (e *RepoEntry) eagerResolveClosedBranches() {
	if !e.gh.eagerPurgeAllowed() {
		return
	}
	if !e.githubEnabled() {
		return
	}
	if _, armed := e.gh.breakerStatus(); armed {
		return
	}
	ctx := context.Background()
	if _, ok := e.githubRepo(ctx); !ok {
		return
	}
	branches, err := e.review.Branches(ctx, e.Summary.RepoID)
	if err != nil {
		slog.Warn("ghclient: list review branches for eager re-resolve", "repo", e.Summary.RepoID, "err", err)
		return
	}
	if len(branches) > maxEagerPurgeBranches {
		branches = branches[:maxEagerPurgeBranches]
	}
	for _, branch := range branches {
		e.ResolveBranchPr(ctx, branch)
	}
}

// maybePurgeClosed is D8's own eager-purge call site, shared by both ResolveBranchPr's snapshot-hit
// and full-query paths: a resolved PR whose state is "closed" or "merged" purges that branch's
// review session via G11's own (*gitreview.Store).Purge — nothing else. A purge failure is a
// warning, never an RPC error (D8's own doc comment in reaper.go, restated here at the one call
// site this phase adds).
func (e *RepoEntry) maybePurgeClosed(ctx context.Context, branch string, pr *ghclient.PR) {
	if pr == nil || (pr.State != "closed" && pr.State != "merged") {
		return
	}
	if err := e.review.Purge(ctx, e.Summary.RepoID, branch); err != nil {
		slog.Warn("ghclient: purge review session", "repo", e.Summary.RepoID, "branch", branch, "err", err)
	}
}
