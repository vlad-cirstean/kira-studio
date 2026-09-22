package bridge

import (
	"context"
	"errors"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitclient"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/model"
	"golang.org/x/sync/errgroup"
)

// CodeWorkspaceService is C5 §3.3's whole bound surface: repo import/rename/remove, the two read
// primitives (ListFiles, ReadFile), and OpenWorkspace/CloseWorkspace/ReadDiff. §11's read-only
// guarantee is unchanged — no method in this file writes into a repository's working tree, and
// every git invocation below goes through internal/codeworkspace, which builds every Spec with
// ReadOnly: true.
type CodeWorkspaceService struct {
	Deps appcore.Deps
	// Discovery/Runner mirror gitrpc's own seam (Deps.Discovery/Deps.Runner) rather than reusing
	// GitRegistry — this workspace needs one read-only runner and the resolved git.path, never the
	// refcounted RepoEntry lifecycle gitsession.Registry owns.
	Discovery *gitclient.Discovery
	Runner    gitclient.Runner
	// Registry is internal/codeworkspace's own per-repo session registry (§2/§12).
	Registry *codeworkspace.Registry
}

type CodeWorkspaceIDArgs struct {
	ID string `json:"id"`
}

type CodeWorkspaceImportArgs struct {
	Path string `json:"path"`
}

type CodeWorkspaceRenameArgs struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type CodeWorkspaceReadFileArgs struct {
	ID   string `json:"id"`
	Path string `json:"path"`
}

// gitPathSetting reads the current git.path setting fresh — the same "never cached, read on every
// call" discipline gitrpc's own gitPathFrom helper follows (a stale value here is a correctness
// bug, not a performance one).
func (s *CodeWorkspaceService) gitPathSetting() string {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		return ""
	}
	return settings.Git.GitPath
}

// session resolves id's own code_repos row into an internal/codeworkspace.Session, ready for a
// ListFiles/ReadFile/ReadDiff call — re-resolved on every request (Registry.Open now reuses a live
// session when nothing that matters changed, §2/C6 §3.2) rather than trusting a cached session this
// method never re-checked against a stale git.path.
func (s *CodeWorkspaceService) session(ctx context.Context, id string) (*codeworkspace.Session, *model.CodeRepo, error) {
	repo, err := s.Deps.Repos.CodeRepos.Get(id)
	if err != nil {
		return nil, nil, ipcerr.Internal(err.Error())
	}
	if repo == nil {
		return nil, nil, ipcerr.New("E_NOT_FOUND", "codeworkspace: repository not found")
	}
	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return nil, nil, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}
	return s.Registry.Open(repo.ID, repo.Root, s.Runner, status.Path), repo, nil
}

// ListRepos returns every imported repository, sort_order then name (CodeReposRepo.List's own
// order — the panel's own list, oldest-imported-first until a user reorders it, matching
// ConnectionsRepo's own convention).
func (s *CodeWorkspaceService) ListRepos() ([]model.CodeRepo, error) {
	repos, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	return repos, nil
}

// CodeRepoHeadsArgs optionally scopes RepoHeads to specific rows — an empty/omitted IDs answers
// every imported repository. repo/state/repoHeads.ts's refsChanged trigger (P83 plan §12.3) passes
// one id here to refresh a single repository's entry, the same batched call with a filtered arg.
type CodeRepoHeadsArgs struct {
	IDs []string `json:"ids,omitempty"`
}

// CodeRepoHead is one repository row's checked-out branch, or the reason it has none. Head is nil
// for a bare repository (no HEAD to show) or a row RepoHeads could not read — Error names why.
type CodeRepoHead struct {
	ID    string               `json:"id"`
	Head  *gitclient.HeadState `json:"head"`
	Error string               `json:"error,omitempty"`
}

// repoHeadsConcurrency mirrors gitclient's own maxConcurrentReads (repo.go:37) — the same
// per-repository read-pool ceiling, applied here across repositories instead of within one.
const repoHeadsConcurrency = 4

// RepoHeads answers every imported repository's checked-out branch in one batched call (P83 plan
// §12.2) — GitPanel.vue's own repo-row label, one round trip regardless of row count rather than
// one bound call per row. Reuses gitclient.ResolveHead (repo.go:251) unchanged; no new git-side
// code. A row whose repository can no longer be read (removed from disk, permission denied)
// resolves to {Head: nil, Error: …} rather than failing the whole call.
func (s *CodeWorkspaceService) RepoHeads(ctx context.Context, args CodeRepoHeadsArgs) ([]CodeRepoHead, error) {
	repos, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}
	if len(args.IDs) > 0 {
		want := make(map[string]bool, len(args.IDs))
		for _, id := range args.IDs {
			want[id] = true
		}
		filtered := repos[:0]
		for _, r := range repos {
			if want[r.ID] {
				filtered = append(filtered, r)
			}
		}
		repos = filtered
	}

	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return nil, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}

	results := make([]CodeRepoHead, len(repos))
	var g errgroup.Group
	g.SetLimit(repoHeadsConcurrency)
	for i, repo := range repos {
		results[i] = CodeRepoHead{ID: repo.ID}
		if repo.Root == "" {
			continue // a bare repository (§12.2) has no worktree, so no HEAD to show
		}
		g.Go(func() error {
			head, err := gitclient.ResolveHead(ctx, s.Runner, status.Path, repo.Root)
			if err != nil {
				results[i].Error = err.Error()
				return nil
			}
			results[i].Head = &head
			return nil
		})
	}
	g.Wait()
	return results, nil
}

// CodeRepoWorktreeLink is one repository row's place in the panel's own list: ParentID names the
// row it nests under (P84 plan §3's anchor), empty when it is a top-level repository. Error names
// why a row could not be read — a row whose worktree is gone from disk keeps ParentID empty and
// stays top-level, the safe default.
type CodeRepoWorktreeLink struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId"`
	Error    string `json:"error,omitempty"`
}

// RepoWorktreeLinks groups every imported repository by its `--git-common-dir` and answers each
// row's anchor (P84 plan §3/§4.2) — GitPanel.vue's dedup filter: a row with a non-empty ParentID
// never renders at the top level, only nested under its anchor's twisty. No args: both callers
// (the panel's onMounted and its records watcher) refresh the whole list, the same shape ListRepos
// already uses.
func (s *CodeWorkspaceService) RepoWorktreeLinks(ctx context.Context) ([]CodeRepoWorktreeLink, error) {
	repos, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return nil, ipcerr.Internal(err.Error())
	}

	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return nil, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}

	// CodeRepos.List() orders by (sort_order, name), which is not the total order §3's rule-2
	// tiebreak needs (two rows can share both). Sort explicitly by (SortOrder, CreatedAt, ID) so
	// anchor selection is deterministic regardless of the storage layer's own order (P84 plan §16
	// OQ-3).
	sort.Slice(repos, func(i, j int) bool {
		if repos[i].SortOrder != repos[j].SortOrder {
			return repos[i].SortOrder < repos[j].SortOrder
		}
		if repos[i].CreatedAt != repos[j].CreatedAt {
			return repos[i].CreatedAt < repos[j].CreatedAt
		}
		return repos[i].ID < repos[j].ID
	})

	type identity struct {
		gitDir    string
		commonDir string
		err       string
	}
	identities := make([]identity, len(repos))
	var g errgroup.Group
	g.SetLimit(repoHeadsConcurrency)
	for i, repo := range repos {
		if repo.Root == "" {
			continue // a bare repository (RepoHeads' own guard, :180) has no worktree; belt-and-braces
		}
		g.Go(func() error {
			gitDir, commonDir, err := gitclient.WorktreeIdentity(ctx, s.Runner, status.Path, repo.Root)
			if err != nil {
				identities[i].err = err.Error()
				return nil
			}
			identities[i].gitDir = gitDir
			identities[i].commonDir = commonDir
			return nil
		})
	}
	g.Wait()

	results := make([]CodeRepoWorktreeLink, len(repos))
	for i, repo := range repos {
		results[i] = CodeRepoWorktreeLink{ID: repo.ID, Error: identities[i].err}
	}

	// Group by commonDir, skipping errored or bare (commonDir == "") rows, then pick each group's
	// anchor per §3: the row that is not a linked worktree if the group has one (there is at most
	// one, since only a main worktree's gitDir equals its own commonDir), otherwise the smallest
	// (sortOrder, createdAt, id) — which repos' own sort above already put first in each group.
	groups := make(map[string][]int)
	for i, id := range identities {
		if id.err != "" || id.commonDir == "" {
			continue
		}
		groups[id.commonDir] = append(groups[id.commonDir], i)
	}
	for _, idxs := range groups {
		anchor := idxs[0]
		for _, i := range idxs {
			if identities[i].gitDir == identities[i].commonDir {
				anchor = i
				break
			}
		}
		for _, i := range idxs {
			if i != anchor {
				results[i].ParentID = repos[anchor].ID
			}
		}
	}

	return results, nil
}

// ImportRepo identifies path via gitclient.Identify and stores it as a code_repos row — a plain
// E_INVALID for a bare repository (no worktree to browse) or a path that isn't a git repository at
// all, per §3.3's own contract; a friendlier E_ALREADY_IMPORTED than the UNIQUE index's own
// constraint-violation text when repo_id is already stored.
func (s *CodeWorkspaceService) ImportRepo(ctx context.Context, args CodeWorkspaceImportArgs) (model.CodeRepo, error) {
	if args.Path == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("path is required")
	}
	status := s.Discovery.Status(ctx, s.gitPathSetting())
	if status.Kind != "ok" {
		return model.CodeRepo{}, ipcerr.New("E_GIT_UNAVAILABLE", "codeworkspace: git is unavailable: "+status.Kind)
	}
	summary, err := gitclient.Identify(ctx, s.Runner, status.Path, args.Path)
	if err != nil {
		return model.CodeRepo{}, ipcerr.New("E_INVALID", "not a git repository: "+err.Error())
	}
	if summary.IsBare {
		return model.CodeRepo{}, ipcerr.New("E_INVALID", "a bare repository has no worktree to browse")
	}

	existing, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	for _, r := range existing {
		if r.RepoID == summary.RepoID {
			return model.CodeRepo{}, ipcerr.New("E_ALREADY_IMPORTED", r.Name+" is already imported")
		}
	}

	rec := model.CodeRepo{
		ID:        uuid.NewString(),
		Name:      filepath.Base(summary.Root),
		Root:      summary.Root,
		RepoID:    summary.RepoID,
		CreatedAt: model.NowISO(),
	}
	created, err := s.Deps.Repos.CodeRepos.Create(rec)
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	return created, nil
}

func (s *CodeWorkspaceService) RenameRepo(args CodeWorkspaceRenameArgs) (model.CodeRepo, error) {
	if args.ID == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("id is required")
	}
	if args.Name == "" {
		return model.CodeRepo{}, ipcerr.BadRequest("name is required")
	}
	rec, err := s.Deps.Repos.CodeRepos.Rename(args.ID, args.Name)
	if err != nil {
		return model.CodeRepo{}, ipcerr.Internal(err.Error())
	}
	return rec, nil
}

// RemoveRepo drops the row, its tab rows (CodeReposRepo.Remove's own transaction, §3.1) and stops
// any session (§3.3) — the renderer closes the workspace's own switcher entry and open tabs on the
// TS side; this is the storage/session half.
func (s *CodeWorkspaceService) RemoveRepo(args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.CodeRepos.Remove(args.ID); err != nil {
		return ipcerr.Internal(err.Error())
	}
	s.Registry.Close(args.ID)
	return nil
}

func (s *CodeWorkspaceService) ListFiles(ctx context.Context, args CodeWorkspaceIDArgs) (codeworkspace.FileListing, error) {
	if args.ID == "" {
		return codeworkspace.FileListing{}, ipcerr.BadRequest("id is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.FileListing{}, err
	}
	listing, err := codeworkspace.ListFiles(ctx, sess)
	if err != nil {
		return codeworkspace.FileListing{}, ipcerr.Internal(err.Error())
	}
	return listing, nil
}

// ReadFile validates args.Path against the session's own root (§11) before ever touching disk —
// every path crossing this boundary is checked for ".." traversal and symlink escape via
// filepath.EvalSymlinks, since a repository can contain a symlink pointing anywhere on the
// machine.
func (s *CodeWorkspaceService) ReadFile(ctx context.Context, args CodeWorkspaceReadFileArgs) (codeworkspace.FileContent, error) {
	if args.ID == "" {
		return codeworkspace.FileContent{}, ipcerr.BadRequest("id is required")
	}
	if args.Path == "" {
		return codeworkspace.FileContent{}, ipcerr.BadRequest("path is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.FileContent{}, err
	}
	absPath, err := codeworkspace.ValidateRelPath(sess.Root, args.Path)
	if err != nil {
		return codeworkspace.FileContent{}, ipcerr.New("E_INVALID", err.Error())
	}
	content, err := codeworkspace.ReadFile(absPath, args.Path)
	if err != nil {
		return codeworkspace.FileContent{}, ipcerr.Internal(err.Error())
	}
	return content, nil
}

// OpenWorkspace opens args.ID's own session (§2/§12) — the registry entry CloseWorkspace pairs
// with.
func (s *CodeWorkspaceService) OpenWorkspace(ctx context.Context, args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	_, _, err := s.session(ctx, args.ID)
	return err
}

// CloseWorkspace stops args.ID's own session (index, watcher, catfile) — called from
// closeRepoWorkspace when the user leaves the workspace, distinct from RemoveRepo (which also
// drops the repository's own storage row).
func (s *CodeWorkspaceService) CloseWorkspace(args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	s.Registry.Close(args.ID)
	return nil
}

// ReadDiff reads args.Path's own HEAD-vs-worktree content (C6 §5) — read-only, like ReadFile: the
// HEAD side never touches the working tree at all, and the worktree side goes through the same
// ReadFile classification every other read does.
func (s *CodeWorkspaceService) ReadDiff(ctx context.Context, args CodeWorkspaceReadFileArgs) (codeworkspace.DiffContent, error) {
	if args.ID == "" {
		return codeworkspace.DiffContent{}, ipcerr.BadRequest("id is required")
	}
	if args.Path == "" {
		return codeworkspace.DiffContent{}, ipcerr.BadRequest("path is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.DiffContent{}, err
	}
	content, err := codeworkspace.ReadDiff(ctx, sess, args.Path)
	if err != nil {
		return codeworkspace.DiffContent{}, ipcerr.Internal(err.Error())
	}
	return content, nil
}

// Shutdown stops every open session — process teardown (main.go's own teardown, beside
// repositories.Close()). Not a bound method: called directly from main.go.
func (s *CodeWorkspaceService) Shutdown() {
	s.Registry.CloseAll()
}

// ---- C7 D7: the coalescing search-results push channel ----

const (
	searchCoalesceInterval   = 60 * time.Millisecond
	searchCoalesceMaxMatches = 256
)

// CodeSearchEventErr mirrors GrpcCallEventErr's own shape — a structured code/message pair, the
// same convention every other terminal-event error in this package uses.
type CodeSearchEventErr struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// CodeSearchEvent is ChannelCodeSearch's own payload (packages/shared/domain/repo.ts's
// codeSearchEventSchema, field for field) — one coalesced batch of a repository-wide search's
// file groups. seq is the index of the first file group in this batch (D11: the renderer merges
// by path, not by seq, but the field stays for the same future-reviewer-detects-a-gap reason
// GrpcCallEvent's own seq exists); stats/error are set only on the terminal event.
type CodeSearchEvent struct {
	SearchID string                      `json:"searchId"`
	Seq      int                         `json:"seq"`
	Files    []codeworkspace.FileMatches `json:"files"`
	Done     bool                        `json:"done"`
	Stats    *codeworkspace.SearchStats  `json:"stats,omitempty"`
	Error    *CodeSearchEventErr         `json:"error,omitempty"`
}

// searchCoalescer is grpcCoalescer's own rules (D8's shape, restated here per D7 rather than
// generifying grpcCoalescer — that would rewrite a shipped, -race-tested path for one new caller's
// benefit, and the two payloads share no field), with one difference: it flushes on an accumulated
// *match* count across possibly many file groups, not a message count, since one file group can
// itself carry up to MaxMatchesPerFile matches.
type searchCoalescer struct {
	emit      appcore.Emitter
	windowKey string
	searchID  string

	mu             sync.Mutex
	pending        []codeworkspace.FileMatches
	pendingMatches int
	nextSeq        int
	timer          *time.Timer
	done           bool
}

func newSearchCoalescer(emit appcore.Emitter, windowKey, searchID string) *searchCoalescer {
	return &searchCoalescer{emit: emit, windowKey: windowKey, searchID: searchID}
}

// push is codeworkspace.Search's own onFile callback — documented there as "may be called
// concurrently from different worker goroutines," which is exactly what this mutex covers.
func (c *searchCoalescer) push(fm codeworkspace.FileMatches) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.pending = append(c.pending, fm)
	c.pendingMatches += len(fm.Matches)
	if c.pendingMatches >= searchCoalesceMaxMatches {
		c.flushLocked(false, nil, nil)
		return
	}
	if c.timer == nil {
		c.timer = time.AfterFunc(searchCoalesceInterval, c.onTimer)
	}
}

func (c *searchCoalescer) onTimer() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done || len(c.pending) == 0 {
		return
	}
	c.flushLocked(false, nil, nil)
}

// finish is the terminal flush — always sent, even with nothing pending, so the panel's own
// "Searching…" state can never strand (D7).
func (c *searchCoalescer) finish(stats *codeworkspace.SearchStats, errInfo *CodeSearchEventErr) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.done {
		return
	}
	c.flushLocked(true, stats, errInfo)
	c.done = true
}

func (c *searchCoalescer) flushLocked(done bool, stats *codeworkspace.SearchStats, errInfo *CodeSearchEventErr) {
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	seq := c.nextSeq
	files := c.pending
	if files == nil {
		files = []codeworkspace.FileMatches{}
	}
	c.pending = nil
	c.pendingMatches = 0
	c.nextSeq += len(files)
	c.emit.EmitTo(c.windowKey, ChannelCodeSearch, CodeSearchEvent{
		SearchID: c.searchID, Seq: seq, Files: files, Done: done, Stats: stats, Error: errInfo,
	})
}

// CodeWorkspaceSearchArgs is StartSearch's own args — windowKey addresses the coalesced push
// channel at the one window that asked (EmitTo, D7), exactly like GrpcCallArgs.WindowKey.
type CodeWorkspaceSearchArgs struct {
	ID            string `json:"id"`
	WindowKey     string `json:"windowKey"`
	Query         string `json:"query"`
	Regex         bool   `json:"regex"`
	CaseSensitive bool   `json:"caseSensitive"`
	WholeWord     bool   `json:"wholeWord"`
}

type CodeWorkspaceSearchHandle struct {
	SearchID string `json:"searchId"`
}

// StartSearch validates args, compiles the pattern before returning (codeworkspace.ValidatePattern
// — a bad regex is E_INVALID on this call, never a stream error the panel has to render twice),
// mints a search id, and starts one goroutine running codeworkspace.Search followed by the
// coalescer's terminal flush. It returns the handle immediately — a full-worktree scan takes far
// longer than an IPC call may (OpenWorkspace's own posture).
func (s *CodeWorkspaceService) StartSearch(ctx context.Context, args CodeWorkspaceSearchArgs) (CodeWorkspaceSearchHandle, error) {
	if args.ID == "" {
		return CodeWorkspaceSearchHandle{}, ipcerr.BadRequest("id is required")
	}
	if args.WindowKey == "" {
		return CodeWorkspaceSearchHandle{}, ipcerr.BadRequest("windowKey is required")
	}
	if args.Query == "" {
		return CodeWorkspaceSearchHandle{}, ipcerr.BadRequest("query is required")
	}
	req := codeworkspace.SearchRequest{
		Query:         args.Query,
		Regex:         args.Regex,
		CaseSensitive: args.CaseSensitive,
		WholeWord:     args.WholeWord,
	}
	if err := codeworkspace.ValidatePattern(req); err != nil {
		return CodeWorkspaceSearchHandle{}, ipcerr.New("E_INVALID", err.Error())
	}

	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return CodeWorkspaceSearchHandle{}, err
	}

	searchID := uuid.NewString()
	coalescer := newSearchCoalescer(s.Deps.Events, args.WindowKey, searchID)
	// sess.BeginSearch(), not ctx: this bound call returns long before a full-worktree scan
	// finishes, so the search must outlive it — CancelSearch/Session.Close are the only two ways
	// this context ever ends (D8).
	searchCtx := sess.BeginSearch()

	go func() {
		stats, err := codeworkspace.Search(searchCtx, sess, req, coalescer.push)
		// C14-7: CancelSearch (the panel's own Stop button) cancels searchCtx, which
		// codeworkspace.Search surfaces as ctx.Err() == context.Canceled -- a clean, user-requested
		// stop, not a failure. Rendering it as an E_INTERNAL error banner hid the partial-results
		// summary line and made stopping a search look like it had failed. Session.Close ends
		// searchCtx the same way (StartSearch's own doc comment), and gets the identical clean
		// treatment here for the same reason: nothing is left to show it to by then anyway.
		if err != nil && !errors.Is(err, context.Canceled) {
			coalescer.finish(&stats, &CodeSearchEventErr{Code: "E_INTERNAL", Message: err.Error()})
			return
		}
		coalescer.finish(&stats, nil)
	}()

	return CodeWorkspaceSearchHandle{SearchID: searchID}, nil
}

// CancelSearch stops args.ID's own in-flight search (D8: the workspace's one search, never a
// specific search id — the renderer always means "stop what this panel is running"). Uses
// Registry.Peek rather than s.session(): a search can only be running for a workspace that
// already opened a session (StartSearch itself resolved one), so this must not create a fresh one
// the way Open's normal fallback would, and stopping a search must not depend on git being
// reachable right now the way every read path's own availability check does.
func (s *CodeWorkspaceService) CancelSearch(args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	if sess := s.Registry.Peek(args.ID); sess != nil {
		sess.CancelSearch()
	}
	return nil
}
