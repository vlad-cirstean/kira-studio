package bridge

import (
	"context"
	"log/slog"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeworkspace"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// CodeWorkspaceService is C5 §3.3's whole bound surface, extended by C6 §7 with the index
// lifecycle and navigation: repo import/rename/remove, the two read primitives (ListFiles,
// ReadFile), and now OpenWorkspace/CloseWorkspace/ReadDiff/Definitions. §11's read-only guarantee
// is unchanged — no method in this file writes into a repository's working tree, and every git
// invocation below goes through internal/codeworkspace, which builds every Spec with
// ReadOnly: true.
type CodeWorkspaceService struct {
	Deps appcore.Deps
	// Discovery/Runner mirror gitrpc's own seam (Deps.Discovery/Deps.Runner) rather than reusing
	// GitRegistry — this workspace needs one read-only runner and the resolved git.path, never the
	// refcounted RepoEntry lifecycle gitsession.Registry owns.
	Discovery *gitclient.Discovery
	Runner    gitclient.Runner
	// Registry is internal/codeworkspace's own per-repo session registry (§2/§12), now extended
	// (C6) with each session's own Index/Graph/Watcher/catfile.Session.
	Registry *codeworkspace.Registry
	// IndexStore is the shared codeindex.Store every session's Index/Graph opens against — one per
	// process (C6 §3.1), constructed in main.go and closed by Shutdown.
	IndexStore *codeindex.Store
	// Home overrides KIRA_HOME for the sync lock (C6 §3.3) — empty means config.KiraHome(); a test
	// seam, mirroring repomap.Config.Home.
	Home string
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
// ListFiles/ReadFile/ReadDiff/Definitions call — re-resolved on every request (Registry.Open now
// reuses a live session when nothing that matters changed, §2/C6 §3.2) rather than trusting a
// cached session this method never re-checked against a stale git.path. IndexRepoID is filled from
// the repo row's own RepoID on every call — cheap, and correct even for a session Open reused
// rather than rebuilt.
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
	sess := s.Registry.Open(repo.ID, repo.Root, s.Runner, status.Path)
	sess.IndexRepoID = repo.RepoID
	return sess, repo, nil
}

// home resolves this service's own KIRA_HOME override (a test seam) the way repomap.Config.Home
// does.
func (s *CodeWorkspaceService) home() string {
	if s.Home != "" {
		return s.Home
	}
	return config.KiraHome()
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

// OpenWorkspace starts args.ID's own index/graph/watcher (C6 §3.3) — the warm-up path called from
// openRepoWorkspace right after the tree/graph shell is ensured. Returns as soon as the background
// sync goroutine is started; the initial sync of a large repository takes far longer than an IPC
// call may.
func (s *CodeWorkspaceService) OpenWorkspace(ctx context.Context, args CodeWorkspaceIDArgs) error {
	if args.ID == "" {
		return ipcerr.BadRequest("id is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return err
	}
	sess.EnsureIndex(s.IndexStore, s.home(), slog.Default())
	return nil
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

// CodeWorkspaceDefinitionArgs is Definitions's own args — line/column are Monaco's own 1-based
// line and 1-based UTF-16 column.
type CodeWorkspaceDefinitionArgs struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
}

// Definitions answers go-to-definition/hover for args.Path at (args.Line, args.Column) (C6 §6).
// It ensures the session's own index has been started (§3.3: "Definitions itself" is one of the
// two EnsureIndex callers, so a navigation request that somehow arrives before OpenWorkspace ever
// did is still correct) — EnsureIndex itself is idempotent and returns immediately either way.
func (s *CodeWorkspaceService) Definitions(ctx context.Context, args CodeWorkspaceDefinitionArgs) (codeworkspace.NavResult, error) {
	if args.ID == "" {
		return codeworkspace.NavResult{}, ipcerr.BadRequest("id is required")
	}
	if args.Path == "" {
		return codeworkspace.NavResult{}, ipcerr.BadRequest("path is required")
	}
	sess, _, err := s.session(ctx, args.ID)
	if err != nil {
		return codeworkspace.NavResult{}, err
	}
	sess.EnsureIndex(s.IndexStore, s.home(), slog.Default())
	result, err := codeworkspace.Definitions(ctx, sess, s.IndexStore, args.Path, args.Line, args.Column)
	if err != nil {
		return codeworkspace.NavResult{}, ipcerr.Internal(err.Error())
	}
	return result, nil
}

// Shutdown stops every open session and closes the shared index store — process teardown
// (main.go's own teardown, beside repositories.Close()). Not a bound method: called directly from
// main.go, the same way bridge.StopRepoMap(repoMapSvc) is.
func (s *CodeWorkspaceService) Shutdown() {
	s.Registry.CloseAll()
	if s.IndexStore != nil {
		_ = s.IndexStore.Close()
	}
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
// longer than an IPC call may (OpenWorkspace's own posture). StartSearch does NOT call
// EnsureIndex: text search is independent of C2's graph, and searching a repository must not start
// parsing one.
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
		if err != nil {
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
