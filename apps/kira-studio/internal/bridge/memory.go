package bridge

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/internal/memory"
)

// ChannelMemoryChanged fires after any write to memory.db, this process's or the MCP subprocess's.
const ChannelMemoryChanged = "kira:memory:changed"

// memoryServerName is the name the kira-memory stdio server registers under in Claude Code.
const memoryServerName = "kira-memory"

const (
	memoryWatchInterval = 2 * time.Second
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

	mu        sync.Mutex
	svc       *memory.Service
	store     *memory.Store
	stopWatch context.CancelFunc
}

func NewMemoryService(events appcore.Emitter, installer MemoryMcpInstaller) *MemoryService {
	return &MemoryService{events: events, installer: installer}
}

func (s *MemoryService) service() *memory.Service {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.svc != nil {
		return s.svc
	}
	s.store = memory.OpenDefault()
	s.svc = memory.NewService(s.store, memory.NewCLIRunner(), s.emitChanged)
	ctx, cancel := context.WithCancel(context.Background())
	s.stopWatch = cancel
	go s.watch(ctx, s.store)
	return s.svc
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
	if s.store != nil {
		_ = s.store.Close()
	}
	s.svc, s.store, s.stopWatch = nil, nil, nil
}

func memoryErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, memory.ErrInvalid), errors.Is(err, memory.ErrClaudeNotFound), errors.Is(err, memory.ErrClaudeAuth),
		errors.Is(err, memory.ErrClaudeBudget), errors.Is(err, memory.ErrClaudeTimeout), errors.Is(err, memory.ErrClaudeOutput),
		errors.Is(err, memory.ErrClaudeOutdated):
		return ipcerr.BadRequest(err.Error())
	case errors.Is(err, memory.ErrNotFound):
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

// MemoryMcpStatus is the Connect dialog's pre-click read.
type MemoryMcpStatus struct {
	Command         string   `json:"command"`
	Executable      string   `json:"executable"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	Probed          []string `json:"probed"`
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
