package bridge

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/config"
	"github.com/kirathecat/kira-studio/internal/claudecfg"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

// ChannelMemoryChanged fires after any write to memory.db, this process's or the MCP subprocess's.
const ChannelMemoryChanged = "kira:memory:changed"

// ChannelMemorySemantic fires when semantic-search status or indexing progress changes. The payload
// is empty; the UI refetches SemanticStatus.
const ChannelMemorySemantic = "kira:memory:semantic"

// ChannelMemoryImport fires when a bulk-import job or file changes state or makes progress. The
// payload is empty; the UI refetches the job list and the open job.
const ChannelMemoryImport = "kira:memory:import"

const (
	memoryWatchInterval = 2 * time.Second
	emitGap             = 250 * time.Millisecond
	memoryUIListLimit   = 100
)

// MemoryMcpInstaller is mcpinstall.Installer's seam as MemoryService consumes it.
type MemoryMcpInstaller interface {
	Status() mcpinstall.Status
	Remove(ctx context.Context, name string) mcpinstall.Result
}

// MemoryService is the Memory module's bridge over the shared memory.Service. memory.db opens on
// first use; a watcher then turns the MCP subprocess's commits into ChannelMemoryChanged.
type MemoryService struct {
	events    appcore.Emitter
	installer MemoryMcpInstaller

	mu        sync.Mutex
	svc       *memory.Service
	store     *memory.Store
	embedder  *embed.Client
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

func NewMemoryService(events appcore.Emitter, installer MemoryMcpInstaller) *MemoryService {
	s := &MemoryService{events: events, installer: installer}
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
	s.embedder = embed.NewClient(embed.ClientOptions{Spec: embed.Default, Home: memory.Home(), OnState: s.emitSemantic})
	s.svc = memory.NewService(s.store, memory.NewCLIRunner(), memory.ServiceOptions{
		Embedder: s.embedder, OnChange: s.emitChanged, OnSemantic: s.emitSemantic,
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
		Agent:    importer.ClaudeAgent{Runner: memory.NewCLIRunner(), Executable: exe, Home: memory.Home()},
		OnChange: s.emitImport,
	})
	return s.engine, err
}

func (s *MemoryService) emitChanged() { s.events.Emit(ChannelMemoryChanged, struct{}{}) }

// watch emits when another process commits: PRAGMA data_version moves only for foreign writes.
func (s *MemoryService) watch(ctx context.Context, store *memory.Store) {
	last, err := store.DataVersion(ctx)
	if err != nil {
		return
	}
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
			if v != last {
				last = v
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
	Query          string `json:"query"`
	IncludeHistory bool   `json:"includeHistory"`
}

// MemoryIDArgs names one memory by any version's id.
type MemoryIDArgs struct {
	ID string `json:"id"`
}

// MemoryStoreArgs is Store's argument shape. Author and source are fixed server-side: the UI
// always speaks as the user.
type MemoryStoreArgs struct {
	Items          []memory.Item          `json:"items"`
	Clarifications []memory.Clarification `json:"clarifications"`
}

// Search is the module's recall-first search; an empty query lists recent memories.
func (s *MemoryService) Search(ctx context.Context, args MemorySearchArgs) ([]memory.Memory, error) {
	svc := s.service()
	if _, ok := memory.BuildMatch(args.Query); !ok {
		ms, err := svc.Recent(ctx, memoryUIListLimit)
		return ms, memoryErr(err)
	}
	ms, err := svc.Search(ctx, memory.SearchArgs{Query: args.Query, IncludeHistory: args.IncludeHistory, Limit: memoryUIListLimit})
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
	res, err := s.service().Store(ctx, memory.StoreRequest{
		Items: args.Items, Clarifications: args.Clarifications, Author: memory.AuthorUser, Source: memory.SourceUI,
	})
	return res, memoryErr(err)
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
		return ipcerr.BadRequest("already downloading")
	}
	defer s.installing.Unlock()
	s.mu.Lock()
	client, svc := s.embedder, s.svc
	s.mu.Unlock()
	if client == nil || svc == nil {
		return ipcerr.Internal("memory service closed")
	}

	s.setDownload(true, 0, embed.Default.TotalSize())
	err := embed.Install(ctx, client.Dir(), embed.Default, func(done, total int64) {
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

// MemoryMcpStatus is the Claude Code status line: the binary Kira Space's own sessions launch as
// the memory server, and whether the claude CLI was found.
type MemoryMcpStatus struct {
	Executable      string   `json:"executable"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	ClaudePath      string   `json:"claudePath"`
	Probed          []string `json:"probed"`
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

// McpStatus reports the memory server binary and whether `claude` is installed.
func (s *MemoryService) McpStatus() MemoryMcpStatus {
	inst := s.installer.Status()
	st := MemoryMcpStatus{ClaudeAvailable: inst.ClaudePath != "", ClaudePath: inst.ClaudePath, Probed: inst.Probed}
	if st.Probed == nil {
		st.Probed = []string{}
	}
	if exe, err := memoryExecutable(); err == nil {
		st.Executable = exe
	}
	return st
}

// ClaudeLegacyEntry is one Kira-written registration found in the user's Claude Code config.
type ClaudeLegacyEntry struct {
	Name    string `json:"name"`
	Summary string `json:"summary"`
}

// ClaudeLegacyStatus lists registrations earlier Kira versions made in File.
type ClaudeLegacyStatus struct {
	File    string              `json:"file"`
	Entries []ClaudeLegacyEntry `json:"entries"`
}

// ClaudeLegacyCleanup is RemoveClaudeLegacy's outcome.
type ClaudeLegacyCleanup struct {
	Outcome    string   `json:"outcome"`
	Removed    []string `json:"removed"`
	Remaining  []string `json:"remaining"`
	BackupPath string   `json:"backupPath"`
	Detail     string   `json:"detail"`
	Commands   []string `json:"commands"`
}

func claudeConfigFile() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return claudecfg.ConfigPath(os.Getenv, home)
}

// ClaudeLegacy reads the user's Claude Code config for entries earlier versions registered. Read
// only; a missing or unreadable file lists nothing.
func (s *MemoryService) ClaudeLegacy() ClaudeLegacyStatus {
	st := ClaudeLegacyStatus{File: claudeConfigFile(), Entries: []ClaudeLegacyEntry{}}
	found, err := claudecfg.DetectLegacy(st.File)
	if err != nil {
		slog.Warn("memory: read claude config", "scope", "memory", "err", err)
		return st
	}
	for _, e := range found.Entries {
		st.Entries = append(st.Entries, ClaudeLegacyEntry{Name: e.Name, Summary: e.Summary})
	}
	return st
}

// RemoveClaudeLegacy removes every Kira-written entry ClaudeLegacy lists, after backing the file up
// under Kira Space's home. It runs only when the user confirms; nothing calls it on its own.
func (s *MemoryService) RemoveClaudeLegacy(ctx context.Context) ClaudeLegacyCleanup {
	r := claudecfg.CleanupLegacy(ctx, s.installer, claudeConfigFile(), filepath.Join(config.KiraSpaceHome(), "claude-config-backups"),
		[]string{claudecfg.NameMemory, claudecfg.NameDB, claudecfg.NameRepoMap})
	return ClaudeLegacyCleanup{
		Outcome: r.Outcome, Removed: r.Removed, Remaining: r.Remaining,
		BackupPath: r.BackupPath, Detail: r.Detail, Commands: r.Commands,
	}
}
