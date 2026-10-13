package bridge

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
	"github.com/kirathecat/kira-studio/internal/memory/memcheck"
)

// ChannelMemoryChanged fires after any write to memory.db, this process's or the MCP subprocess's.
const ChannelMemoryChanged = "kira:memory:changed"

// ChannelMemorySemantic fires when semantic-search status or indexing progress changes. The payload
// is empty; the UI refetches SemanticStatus.
const ChannelMemorySemantic = "kira:memory:semantic"

// ChannelMemoryImport fires when a bulk-import job or file changes state or makes progress. The
// payload is empty; the UI refetches the job list and the open job.
const ChannelMemoryImport = "kira:memory:import"

// memoryServerName is the name the kira-memory stdio server registers under in Claude Code.
const memoryServerName = "kira-memory"

const (
	memoryWatchInterval = 500 * time.Millisecond
	emitGap             = 250 * time.Millisecond
	memoryUIListLimit   = 100
)

// MemoryMcpInstaller is mcpinstall.Installer's seam as MemoryService consumes it.
type MemoryMcpInstaller interface {
	Status() mcpinstall.Status
	InstallStdio(ctx context.Context, name, command string, args []string) mcpinstall.Result
}

// MemoryService is the Memory module's bridge over the shared memory.Service. memory.db opens on
// first use; a watcher then turns the MCP subprocess's commits into ChannelMemoryChanged.
type MemoryService struct {
	events    appcore.Emitter
	installer MemoryMcpInstaller
	prompts   llmprompts.Source

	mu        sync.Mutex
	svc       *memory.Service
	store     *memory.Store
	embedder  *embed.Client
	spec      embed.Spec
	stopWatch context.CancelFunc

	// installing serialises model downloads; progress is read by SemanticStatus.
	installing sync.Mutex
	dlMu       sync.Mutex
	dlActive   bool
	dlDone     int64
	dlTotal    int64

	// Bursts (a backfill batch, an import progress tick) coalesce to one event per emitGap.
	semanticEvents *coalescer
	importEvents   *coalescer
	engine         *importer.Engine
}

// NewMemoryService wires the module; spec is the embedding model it installs and runs.
func NewMemoryService(events appcore.Emitter, installer MemoryMcpInstaller, prompts llmprompts.Source, spec embed.Spec) *MemoryService {
	s := &MemoryService{events: events, installer: installer, prompts: prompts, spec: spec}
	s.semanticEvents = newCoalescer(emitGap, func() { events.Emit(ChannelMemorySemantic, struct{}{}) })
	s.importEvents = newCoalescer(emitGap, func() { events.Emit(ChannelMemoryImport, struct{}{}) })
	return s
}

func (s *MemoryService) service() *memory.Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.svc != nil {
		return s.svc
	}
	s.store = memory.OpenDefault()
	s.embedder = embed.NewClient(embed.ClientOptions{Spec: s.spec, Home: memory.Home(), OnState: s.emitSemantic})
	s.svc = memory.NewService(s.store, memory.NewCLIRunner(), memory.ServiceOptions{
		Embedder: s.embedder, OnChange: s.emitChanged, OnSemantic: s.emitSemantic, Prompts: s.prompts,
	})
	ctx, cancel := context.WithCancel(context.Background())
	s.stopWatch = cancel
	go s.watch(ctx, s.store)
	s.svc.StartBackfill()
	return s.svc
}

func (s *MemoryService) emitSemantic() { s.semanticEvents.Trigger() }

func (s *MemoryService) emitImport() { s.importEvents.Trigger() }

// importer returns the bulk-import engine, opening it (and memory.db) on first use.
func (s *MemoryService) importer() (*importer.Engine, error) {
	s.service()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.engine != nil {
		return s.engine, nil
	}
	if s.store == nil {
		return nil, errors.New("memory service closed")
	}
	exe, err := memoryExecutable()
	if err != nil {
		return nil, err
	}
	s.engine, err = importer.Open(s.store, importer.Options{
		Launcher:  importer.SpawnLauncher{Executable: exe, LogPath: importer.DefaultLogPath(s.store)},
		Available: memory.NewCLIRunner().Available,
		OnChange:  s.emitImport,
	})
	return s.engine, err
}

func (s *MemoryService) emitChanged() { s.events.Emit(ChannelMemoryChanged, struct{}{}) }

// watch reacts when another process commits (the MCP server, the import runner): PRAGMA data_version
// moves only for foreign writes. Every foreign commit refreshes import progress; memory lists
// refetch only when facts changed (the store revision moved).
func (s *MemoryService) watch(ctx context.Context, store *memory.Store) {
	last, err := store.DataVersion(ctx)
	if err != nil {
		return
	}
	rev, _ := store.Revision(ctx)
	t := time.NewTicker(memoryWatchInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			v, err := store.DataVersion(ctx)
			if err != nil {
				continue
			}
			if v == last {
				continue
			}
			last = v
			s.emitImport()
			if r, err := store.Revision(ctx); err == nil && r != rev {
				rev = r
				s.emitChanged()
			}
		}
	}
}

// CloseMemory stops the watcher and closes memory.db. A package-level function, not a method:
// Wails binds every exported method of a registered service.
func CloseMemory(s *MemoryService) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopWatch != nil {
		s.stopWatch()
	}
	if s.engine != nil {
		_ = s.engine.Close()
	}
	if s.svc != nil {
		s.svc.Close()
	}
	if s.store != nil {
		_ = s.store.Close()
	}
	s.svc, s.store, s.embedder, s.stopWatch, s.engine = nil, nil, nil, nil, nil
}

func memoryErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, memory.ErrInvalid), errors.Is(err, memory.ErrClaudeNotFound), errors.Is(err, memory.ErrClaudeAuth),
		errors.Is(err, memory.ErrClaudeBudget), errors.Is(err, memory.ErrClaudeTimeout), errors.Is(err, memory.ErrClaudeOutput),
		errors.Is(err, memory.ErrClaudeOutdated), errors.Is(err, memory.ErrClaudeRateLimited), errors.Is(err, memory.ErrClaudeUsageLimit):
		return ipcerr.BadRequest(err.Error())
	case errors.Is(err, embed.ErrChecksum):
		return ipcerr.BadRequest(err.Error())
	case errors.Is(err, memory.ErrNotFound), errors.Is(err, importer.ErrNotFound):
		return ipcerr.NotFound(err.Error())
	}
	return ipcerr.Internal(err.Error())
}

// MemorySearchArgs is Search's argument shape.
type MemorySearchArgs struct {
	Query          string   `json:"query"`
	IncludeHistory bool     `json:"includeHistory"`
	Scopes         []string `json:"scopes"`
	Origins        []string `json:"origins"`
	// Project is the key whose facts rank first; empty boosts none.
	Project string `json:"project"`
}

// MemoryIDArgs names one memory by any version's id.
type MemoryIDArgs struct {
	ID string `json:"id"`
}

// MemoryStoreItem is one fact the UI stores; origin is fixed server-side to user.
type MemoryStoreItem struct {
	Fact   string `json:"fact"`
	Reason string `json:"reason"`
}

// MemoryStoreArgs is Store's argument shape. Origin and source are fixed server-side: the UI
// always speaks as the user. Scope and Project apply to every item; Project is for scope project.
type MemoryStoreArgs struct {
	Items          []MemoryStoreItem      `json:"items"`
	Clarifications []memory.Clarification `json:"clarifications"`
	Scope          string                 `json:"scope"`
	Project        string                 `json:"project"`
}

// MemoryContextArgs names one fact and caps the facts per group; Limit 0 means the default.
type MemoryContextArgs struct {
	ID    string `json:"id"`
	Limit int    `json:"limit"`
}

// Search is the module's recall-first search; an empty query lists recent memories.
func (s *MemoryService) Search(ctx context.Context, args MemorySearchArgs) ([]memory.Memory, error) {
	svc := s.service()
	if _, ok := memory.BuildMatch(args.Query); !ok {
		ms, err := svc.Recent(ctx, memoryUIListLimit)
		return ms, memoryErr(err)
	}
	ms, err := svc.Search(ctx, memory.SearchArgs{Query: args.Query, IncludeHistory: args.IncludeHistory, Limit: memory.MaxSearchLimit,
		Scopes: args.Scopes, Origins: args.Origins, Project: args.Project})
	return ms, memoryErr(err)
}

// Recent lists the newest current memories.
func (s *MemoryService) Recent(ctx context.Context) ([]memory.Memory, error) {
	ms, err := s.service().Recent(ctx, memoryUIListLimit)
	return ms, memoryErr(err)
}

// History returns every version of one memory with its events.
func (s *MemoryService) History(ctx context.Context, args MemoryIDArgs) (memory.History, error) {
	h, err := s.service().History(ctx, args.ID)
	return h, memoryErr(err)
}

// Store runs the gate-reconcile-commit pipeline as the user.
func (s *MemoryService) Store(ctx context.Context, args MemoryStoreArgs) (memory.StoreResult, error) {
	items := make([]memory.Item, len(args.Items))
	for i, it := range args.Items {
		items[i] = memory.Item{Fact: it.Fact, Reason: it.Reason, Origin: memory.OriginUser, Scope: args.Scope, Project: args.Project}
	}
	res, err := s.service().Store(ctx, memory.StoreRequest{Items: items, Clarifications: args.Clarifications, Source: memory.SourceUI})
	return res, memoryErr(err)
}

// Context returns a fact with the other facts stored in its groups.
func (s *MemoryService) Context(ctx context.Context, args MemoryContextArgs) (memory.Context, error) {
	c, err := s.service().Context(ctx, args.ID, args.Limit)
	return c, memoryErr(err)
}

// Projects lists the project keys of current facts, for the Add dialog's suggestions.
func (s *MemoryService) Projects(ctx context.Context) ([]string, error) {
	ps, err := s.service().Projects(ctx)
	return ps, memoryErr(err)
}

// SemanticStatus reports semantic search: the service's state, overlaid with download progress
// (bytes in Done and Total) while a model install runs.
func (s *MemoryService) SemanticStatus(ctx context.Context) (memory.SemanticStatus, error) {
	st, err := s.service().SemanticStatus(ctx)
	if err != nil {
		return memory.SemanticStatus{}, memoryErr(err)
	}
	s.dlMu.Lock()
	defer s.dlMu.Unlock()
	if s.dlActive {
		st.State, st.Message, st.Done, st.Total = memory.SemanticDownloading, "", s.dlDone, s.dlTotal
	}
	return st, nil
}

func (s *MemoryService) setDownload(active bool, done, total int64) {
	s.dlMu.Lock()
	s.dlActive, s.dlDone, s.dlTotal = active, done, total
	s.dlMu.Unlock()
	s.emitSemantic()
}

// InstallSemanticModel downloads the embedding model into the shared memory home, then starts
// indexing existing memories. One download at a time; cancelling the call aborts it.
func (s *MemoryService) InstallSemanticModel(ctx context.Context) error {
	s.service()
	if !s.installing.TryLock() {
		return ipcerr.T(ipcerr.CodeConflict, "backend.space.memory.alreadyDownloading.body", nil)
	}
	defer s.installing.Unlock()
	s.mu.Lock()
	client, svc := s.embedder, s.svc
	s.mu.Unlock()
	if client == nil || svc == nil {
		return ipcerr.T(ipcerr.CodeUnavailable, "backend.space.memory.serviceClosed.body", nil)
	}

	s.setDownload(true, 0, s.spec.TotalSize())
	err := embed.Install(ctx, client.Dir(), s.spec, func(done, total int64) {
		s.dlMu.Lock()
		s.dlDone, s.dlTotal = done, total
		s.dlMu.Unlock()
		s.emitSemantic()
	})
	s.setDownload(false, 0, 0)
	if err != nil {
		return memoryErr(err)
	}
	client.Reset()
	svc.StartBackfill()
	return nil
}

// RetrySemantic clears a recorded embedding failure and its spawn backoff, then retries indexing.
func (s *MemoryService) RetrySemantic() {
	s.service()
	s.mu.Lock()
	client, svc := s.embedder, s.svc
	s.mu.Unlock()
	if client == nil || svc == nil {
		return
	}
	client.Reset()
	svc.StartBackfill()
	s.emitSemantic()
}

// MemoryMcpStatus is the Connect dialog's pre-click read.
type MemoryMcpStatus struct {
	Command         string   `json:"command"`
	Executable      string   `json:"executable"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	Probed          []string `json:"probed"`
}

// MemoryCommentCheck is what Settings > Memory shows to install the kira-memory commit check in
// another repository.
type MemoryCommentCheck struct {
	Executable     string `json:"executable"`
	InstallCommand string `json:"installCommand"`
	HookLine       string `json:"hookLine"`
}

// MemoryInstallResult is mcpinstall's outcome vocabulary on the wire.
type MemoryInstallResult struct {
	Outcome string   `json:"outcome"`
	Detail  string   `json:"detail"`
	Probed  []string `json:"probed"`
}

// memoryExecutable is the running binary, symlinks resolved, so the registration survives a
// launcher alias.
func memoryExecutable() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		return resolved, nil
	}
	return exe, nil
}

// McpStatus reports the registration command for this binary and whether `claude` is installed.
func (s *MemoryService) McpStatus() MemoryMcpStatus {
	inst := s.installer.Status()
	st := MemoryMcpStatus{ClaudeAvailable: inst.ClaudePath != "", Probed: inst.Probed}
	if exe, err := memoryExecutable(); err == nil {
		st.Executable = exe
		st.Command = mcpinstall.StdioCommand(memoryServerName, exe, []string{"memory-mcp"})
	}
	return st
}

// CommentCheck returns the commands that install the memory-check pre-commit hook for this binary.
func (s *MemoryService) CommentCheck() MemoryCommentCheck {
	exe, err := memoryExecutable()
	if err != nil {
		return MemoryCommentCheck{}
	}
	return MemoryCommentCheck{Executable: exe, InstallCommand: memcheck.InstallCommand(exe), HookLine: memcheck.HookLine(exe)}
}

// InstallClaudeCode registers the kira-memory stdio server with Claude Code. It never returns a
// Go error: every outcome is a value the dialog renders.
func (s *MemoryService) InstallClaudeCode(ctx context.Context) MemoryInstallResult {
	exe, err := memoryExecutable()
	if err != nil {
		return MemoryInstallResult{Outcome: mcpinstall.OutcomeInstallFailed, Detail: err.Error(), Probed: []string{}}
	}
	r := s.installer.InstallStdio(ctx, memoryServerName, exe, []string{"memory-mcp"})
	if r.Probed == nil {
		r.Probed = []string{}
	}
	return MemoryInstallResult{Outcome: r.Outcome, Detail: r.Detail, Probed: r.Probed}
}
