package bridge

import (
	"context"
	"log/slog"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/repomap"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// RepoMapInstaller is mcpinstall.Installer's own seam, declared where it is consumed — the same
// "declare the interface where it's consumed" precedent GitVsix (gitclients.go) already uses.
type RepoMapInstaller interface {
	Status() mcpinstall.Status
	Install(ctx context.Context, name, url, token string) mcpinstall.Result
}

// repoMapServerName is the one name every Install call registers under — internal/repomap's own
// server identity (Implementation.Name, server.go).
const repoMapServerName = "kira-repo-map"

// RepoMapService is the Code intelligence tab's whole surface (docs/v1.5/plans/
// C3-mcp-repo-map-server.md §7.4): Status, SetEnabled, Regenerate, InstallClaudeCode. Unlike
// GitClientsService's GitVsix (an install action over a file that already exists on disk), this
// service owns the embedded *repomap.Server's actual lifecycle (§0 D7's correction) — constructed
// and started when the setting turns on (or already is, at boot), stopped when it turns off or the
// app quits.
type RepoMapService struct {
	Deps      appcore.Deps
	Installer RepoMapInstaller

	mu     sync.Mutex
	server *repomap.Server
}

// RepoMapStatus is the wire projection every method below returns.
type RepoMapStatus struct {
	Running         bool     `json:"running"`
	Repo            string   `json:"repo"`
	Command         string   `json:"command"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	Probed          []string `json:"probed"`
	// Error names why Running is false despite the setting being on — no repository resolved at
	// the app's own working directory, or a bind failure (§3.2's own honestly-stated limitation).
	// "" whenever Running is true, or the setting is simply off.
	Error string `json:"error"`
}

func (s *RepoMapService) statusLocked() RepoMapStatus {
	inst := s.Installer.Status()
	st := RepoMapStatus{ClaudeAvailable: inst.ClaudePath != "", Probed: inst.Probed}
	if s.server == nil {
		return st
	}
	st.Running = true
	st.Repo = s.server.Root()
	// Command is "" whenever no plaintext is currently held (an app restart with the setting
	// already on, §0 D8) — the Code intelligence tab shows a Regenerate action instead.
	if plain, minted := s.server.Token(); minted {
		st.Command = mcpinstall.Command(repoMapServerName, s.server.URL(), plain)
	}
	return st
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *RepoMapService) Status() RepoMapStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// tokenProviderFor resolves the embedded instance's own repomap.TokenProvider: mint always mints
// fresh and persists over any existing file (an explicit enable, §0 D8's own "regenerated when the
// toggle turns on"); !mint loads an existing token or mints only if none exists yet (the app-boot-
// with-the-leaf-already-true path, StartIfEnabled below).
func tokenProviderFor(home string, mint bool) repomap.TokenProvider {
	return func(repoID string) (mcpauth.Record, string, bool, error) {
		path := mcpauth.Path(home, mcpauth.Slug(repoID))
		if !mint {
			plain, rec, minted, err := mcpauth.LoadOrMint(path)
			return rec, plain, minted, err
		}
		plain, rec, err := mcpauth.Mint()
		if err != nil {
			return mcpauth.Record{}, "", false, err
		}
		if err := mcpauth.Save(path, rec); err != nil {
			return mcpauth.Record{}, "", false, err
		}
		return rec, plain, true, nil
	}
}

// startLocked constructs and starts a new embedded instance if one is not already running. mu
// must be held by the caller.
func (s *RepoMapService) startLocked(mint bool) error {
	if s.server != nil {
		return nil
	}
	home := config.KiraHome()
	srv, err := repomap.New(context.Background(), repomap.Config{
		Home:   home,
		Token:  tokenProviderFor(home, mint),
		Logger: slog.Default(),
	})
	if err != nil {
		return err
	}
	s.server = srv
	go func() {
		if err := srv.Serve(); err != nil {
			slog.Warn("repo-map embedded server", "scope", "repomap", "err", err)
		}
	}()
	return nil
}

// stopLocked stops and drops the embedded instance, if any. mu must be held by the caller.
func (s *RepoMapService) stopLocked() {
	if s.server == nil {
		return
	}
	_ = s.server.Close()
	s.server = nil
}

// startIfEnabled is main.go's own boot-time call (gitSock.Start()'s own placement and "never
// fatal" posture, §3.2/D7): if the setting is already on from a prior session, start the embedded
// instance now, loading its existing token rather than minting a fresh one (no explicit toggle
// click happened here). A failure (no repository resolved, a bind conflict) is logged, never
// fatal — the app boots regardless, exactly like `git.sock`'s own listener.
//
// Unexported, reached only through StartRepoMapIfEnabled below — not a method Wails' binding
// generator would otherwise expose to the renderer as an IPC call alongside Status/SetEnabled/
// Regenerate/InstallClaudeCode, which are the only methods this service means to cross the wire.
func (s *RepoMapService) startIfEnabled() {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("repo-map: read settings at boot", "scope", "repomap", "err", err)
		return
	}
	if !settings.CodeIntel.McpServerEnabled {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.startLocked(false); err != nil {
		slog.Warn("repo-map: start at boot", "scope", "repomap", "err", err)
	}
}

// stop is main.go's own shutdown call, beside gitSock.Close() — see startIfEnabled's own note on
// why this is unexported and reached only through StopRepoMap.
func (s *RepoMapService) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

// StartRepoMapIfEnabled and StopRepoMap are main.go's own boot/shutdown hooks for the embedded
// instance, package-level functions rather than exported methods on RepoMapService precisely so
// Wails' binding generator (which inspects only the exported methods of a *registered service*
// type) never offers them to the renderer — a wire-callable Stop or a redundant StartIfEnabled
// would let a bug or a stray call bypass the settings leaf entirely (§7.1's own "the toggle is the
// only lifecycle control this phase adds," §9).
func StartRepoMapIfEnabled(s *RepoMapService) { s.startIfEnabled() }
func StopRepoMap(s *RepoMapService)           { s.stop() }

// RepoMapSetEnabledArgs is SetEnabled's own argument shape.
type RepoMapSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the embedded instance in the same call
// (§7.1: the toggle bypasses the dialog's draft/Save flow entirely, an instant action). Turning on
// always mints a fresh token (§0 D8), even if a file already exists for this repository from a
// previous enable — a deliberate, explicit re-enable is exactly the event D8 ties regeneration to.
func (s *RepoMapService) SetEnabled(args RepoMapSetEnabledArgs) (RepoMapStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		CodeIntel: &model.CodeIntelPatch{McpServerEnabled: &args.Enabled},
	})
	if err != nil {
		return RepoMapStatus{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	s.mu.Lock()
	defer s.mu.Unlock()
	if args.Enabled {
		if err := s.startLocked(true); err != nil {
			slog.Warn("repo-map: start on enable", "scope", "repomap", "err", err)
			st := s.statusLocked()
			st.Error = err.Error()
			return st, nil
		}
	} else {
		s.stopLocked()
	}
	return s.statusLocked(), nil
}

// Regenerate mints a fresh token for the already-running embedded instance without touching the
// setting or its lifecycle (§0 D8's restart-recovery path: an app restart loaded the existing
// hash+salt but has no plaintext to show). A no-op, returning the current status unchanged, when
// nothing is running.
func (s *RepoMapService) Regenerate() RepoMapStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return s.statusLocked()
	}
	path := mcpauth.Path(config.KiraHome(), mcpauth.Slug(s.server.RepoID()))
	plain, rec, err := mcpauth.Mint()
	if err != nil {
		slog.Warn("repo-map: regenerate token", "scope", "repomap", "err", err)
		return s.statusLocked()
	}
	if err := mcpauth.Save(path, rec); err != nil {
		slog.Warn("repo-map: persist regenerated token", "scope", "repomap", "err", err)
		return s.statusLocked()
	}
	s.server.SetToken(rec, plain)
	return s.statusLocked()
}

// RepoMapInstallResult is mcpinstall.Result's wire projection — GitVsixInstallResult's own
// precedent (gitclients.go): a domain package's plain Go struct never crosses the wire directly,
// only this tagged copy of it.
type RepoMapInstallResult struct {
	Outcome string   `json:"outcome"`
	Detail  string   `json:"detail"`
	Probed  []string `json:"probed"`
}

func toWireInstallResult(r mcpinstall.Result) RepoMapInstallResult {
	return RepoMapInstallResult{Outcome: r.Outcome, Detail: r.Detail, Probed: r.Probed}
}

// InstallClaudeCode never returns a Go error — mcpinstall.Install's own contract (§7.2), following
// connections.Service.Reveal/gitvsix.Installer.Install's precedent. A no-op result (outcome
// notFound) when nothing is running: there is nothing to register yet.
func (s *RepoMapService) InstallClaudeCode(ctx context.Context) RepoMapInstallResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return RepoMapInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	plain, minted := s.server.Token()
	if !minted {
		return RepoMapInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	return toWireInstallResult(s.Installer.Install(ctx, repoMapServerName, s.server.URL(), plain))
}
