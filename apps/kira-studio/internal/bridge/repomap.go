package bridge

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient"
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

// repoMapTokenSlug is the embedded instance's own app-scoped token file slug (P67d §6.3, D2): one
// token now covers every granted repository, so it is no longer keyed by a single repo_id the way
// the headless binary's per-repository files still are (cmd/kira-repo-map, mcpauth.Slug). Distinct
// by construction from any 12-hex slug, so the two file families never collide.
const repoMapTokenSlug = "app"

// RepoMapService is the Code intelligence tab's whole surface (docs/v1.6/plans/
// P67d-repo-map-settings-toggle.md): general enable/disable of one embedded *repomap.Server plus
// per-repository grant/revoke over whichever repositories are imported (code_repos, owned by
// CodeWorkspaceService/P67b's Git module). Unlike GitVsix (an install action over a file that
// already exists on disk), this service owns the embedded server's actual lifecycle — constructed
// and started when the setting turns on (or already is, at boot), stopped when it turns off or the
// app quits; repositories are attached/detached independently of that lifecycle as grants change.
type RepoMapService struct {
	Deps      appcore.Deps
	Installer RepoMapInstaller
	// Discovery/Runner resolve the git executable and run every Attach's own git calls — the same
	// seam CodeWorkspaceService uses (gitrpc's own Deps.Discovery/Deps.Runner precedent).
	Discovery *gitclient.Discovery
	Runner    gitclient.Runner
	// Home overrides KIRA_HOME (a test seam, mirrors CodeWorkspaceService.Home) — empty means
	// config.KiraHome().
	Home string

	mu     sync.Mutex
	server *repomap.Server
	// keys tracks code_repos.id -> the live key currently attached for it, only while server != nil
	// and that repository is attached. Lets a removal (whose row may already be gone by the time
	// the hook runs) or a rename detach/rekey without a storage read.
	keys map[string]string
	// attachErrs tracks code_repos.id -> the last Attach failure for a granted row (git unavailable,
	// a key collision) — cleared on the next successful attach. Distinct from a live instance's own
	// Degraded (a sync failure, surfaced straight from repomap.RepoInfo instead).
	attachErrs map[string]string
}

// RepoMapStatus is the wire projection every method below returns.
type RepoMapStatus struct {
	Running bool `json:"running"`
	// URL is the embedded server's own MCP endpoint (replaces the old single-repository Repo
	// field, P67d §6.1 — nothing renders a single repository's own root any more, since one server
	// now serves however many are granted).
	URL             string   `json:"url"`
	Command         string   `json:"command"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	Probed          []string `json:"probed"`
	// Error is a server-wide failure (a bind failure starting the listener) — "" whenever Running
	// is true, or the setting is simply off. A per-repository failure lives on that repository's
	// own RepoMapRepoStatus.Error instead.
	Error string `json:"error"`
	// Repos is every imported repository (CodeRepos.List's own order), whether or not it is
	// granted and whether or not the server is running — the "Repository access" list's whole data
	// source.
	Repos []RepoMapRepoStatus `json:"repos"`
}

// RepoMapRepoStatus is one imported repository's own MCP access row.
type RepoMapRepoStatus struct {
	ID   string `json:"id"`   // code_repos.id
	Name string `json:"name"` // code_repos.name
	Root string `json:"root"`
	// Key is what an MCP client passes as `repo` — "" until this repository is actually attached
	// (Serving), never a preview of a key that might not end up being used.
	Key     string `json:"key"`
	Enabled bool   `json:"enabled"` // the persisted grant (code_repos.mcp_enabled)
	Serving bool   `json:"serving"` // attached right now
	Ready   bool   `json:"ready"`   // initial sync finished
	Error   string `json:"error"`   // attach or sync failure; "" normally
}

// home resolves this service's own KIRA_HOME override (a test seam), the way
// CodeWorkspaceService.home does.
func (s *RepoMapService) home() string {
	if s.Home != "" {
		return s.Home
	}
	return config.KiraHome()
}

func (s *RepoMapService) statusLocked() RepoMapStatus {
	installStatus := s.Installer.Status()
	st := RepoMapStatus{ClaudeAvailable: installStatus.ClaudePath != "", Probed: installStatus.Probed}

	rows, err := s.Deps.Repos.CodeRepos.List()
	if err != nil {
		slog.Warn("repo-map: list repos for status", "scope", "repomap", "err", err)
		rows = nil
	}

	live := make(map[string]repomap.RepoInfo, len(rows))
	if s.server != nil {
		st.Running = true
		st.URL = s.server.URL()
		// Command is "" whenever no plaintext is currently held (an app restart with the setting
		// already on) — the Code intelligence tab shows a Regenerate action instead.
		if plain, minted := s.server.Token(); minted {
			st.Command = mcpinstall.Command(repoMapServerName, s.server.URL(), plain)
		}
		for _, ri := range s.server.Repos() {
			live[ri.RepoID] = ri
		}
	}

	st.Repos = make([]RepoMapRepoStatus, 0, len(rows))
	for _, r := range rows {
		rs := RepoMapRepoStatus{ID: r.ID, Name: r.Name, Root: r.Root, Enabled: r.McpEnabled}
		if e := s.attachErrs[r.ID]; e != "" {
			rs.Error = e
		}
		if ri, ok := live[r.RepoID]; ok {
			rs.Serving = true
			rs.Key = ri.Key
			rs.Ready = ri.Ready
			if ri.Degraded != "" && rs.Error == "" {
				rs.Error = ri.Degraded
			}
		}
		st.Repos = append(st.Repos, rs)
	}
	return st
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *RepoMapService) Status() RepoMapStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// normalizeRepoKey turns name into a `repo` argument-shaped token (P67d §6.2): lowercase, any run
// of characters outside [a-z0-9._-] collapsed to one '-', leading/trailing '-' trimmed, falling
// back to "repo" when that leaves nothing.
func normalizeRepoKey(name string) string {
	lower := strings.ToLower(name)
	var b strings.Builder
	prevDash := false
	for _, r := range lower {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-':
			b.WriteRune(r)
			prevDash = false
		case !prevDash:
			b.WriteByte('-')
			prevDash = true
		}
	}
	key := strings.Trim(b.String(), "-")
	if key == "" {
		return "repo"
	}
	return key
}

// repoKeys derives every row's own client-facing key from its code_repos.name (normalizeRepoKey),
// deterministic for a given row order: a collision within rows appends -2, -3, … in list order, so
// a key is stable across restarts unless the user renames a repository (the rename hook re-derives
// and Rekeys, syncAttachedKeysLocked below). Every caller must pass the FULL imported-repo list
// (CodeRepos.List's own order), never a filtered subset — a key must depend only on that repo's own
// name and its position in the stable full list, never on which OTHER repos happen to be granted
// right now (1a fix, P68 review: deriving over the granted subset alone meant revoking one repo
// could silently rename another's key the next time some other repo was granted).
func repoKeys(rows []model.CodeRepo) map[string]string {
	counts := make(map[string]int, len(rows))
	keys := make(map[string]string, len(rows))
	for _, r := range rows {
		base := normalizeRepoKey(r.Name)
		n := counts[base]
		counts[base] = n + 1
		key := base
		if n > 0 {
			key = fmt.Sprintf("%s-%d", base, n+1)
		}
		keys[r.ID] = key
	}
	return keys
}

// rowsAndGrantedLocked fetches every imported repository (CodeRepos.List's own order) plus the
// granted subset of it, in one call — every caller that needs the granted set for attach/detach also
// needs the full set to derive stable keys against (repoKeys' own doc comment: a key depends on the
// full imported-repo list's order, never on which other repos happen to be granted).
func (s *RepoMapService) rowsAndGrantedLocked() (rows, granted []model.CodeRepo, err error) {
	rows, err = s.Deps.Repos.CodeRepos.List()
	if err != nil {
		return nil, nil, err
	}
	granted = make([]model.CodeRepo, 0, len(rows))
	for _, r := range rows {
		if r.McpEnabled {
			granted = append(granted, r)
		}
	}
	return rows, granted, nil
}

// syncAttachedKeysLocked recomputes every row's own desired key (repoKeys, over the FULL imported
// list — 1a) and Rekeys any already-attached instance whose live key has drifted from it — a rename,
// or a new grant landing on a name that collides with an already-attached one, can shift another
// row's own dedupe suffix, not just the row that changed.
//
// Repeats the rekey pass until an iteration makes no further progress (P69 review, finding 5a): a
// single pass strands a repository on its stale key when desired keys form a dependency chain (A
// wants the key B currently holds, and B simultaneously wants to move elsewhere) and A is
// processed before B frees it — Rekey's own collision check simply fails for A that round, and
// nothing revisited it before this fix. Each pass is cheap (repomap.Server.Rekey is an in-memory
// map move), so bounding by len(granted) passes is a correctness measure, not a performance one —
// it is exactly enough passes to resolve any acyclic chain of that length; a true cycle (A wants
// B's key, B wants A's) can never resolve through pairwise Rekey alone no matter how many passes
// run, so this converges on everything resolvable and logs whatever is still stuck afterward
// rather than looping forever on a cycle.
func (s *RepoMapService) syncAttachedKeysLocked(rows, granted []model.CodeRepo) {
	desired := repoKeys(rows)
	for pass := 0; pass < len(granted); pass++ {
		progressed := false
		for _, r := range granted {
			want := desired[r.ID]
			have, attached := s.keys[r.ID]
			if !attached || have == want {
				continue
			}
			if err := s.server.Rekey(have, want); err != nil {
				continue // may free up once whatever currently holds `want` moves off it
			}
			s.keys[r.ID] = want
			progressed = true
		}
		if !progressed {
			break
		}
	}
	for _, r := range granted {
		want := desired[r.ID]
		if have, attached := s.keys[r.ID]; attached && have != want {
			slog.Warn("repo-map: rekey did not converge", "scope", "repomap", "repo", r.Name, "have", have, "want", want)
		}
	}
}

// attachGrantedLocked attaches every currently-granted repository that is not already attached
// (repomap.Server.Attach is itself idempotent, so re-running this after a grant or at boot only
// ever adds what's missing). A per-row Attach failure is logged and recorded in that row's own
// attachErrs entry; it never fails the others and never fails the server. mu must be held by the
// caller.
func (s *RepoMapService) attachGrantedLocked(ctx context.Context) {
	if s.server == nil {
		return
	}
	rows, granted, err := s.rowsAndGrantedLocked()
	if err != nil {
		slog.Warn("repo-map: list repos", "scope", "repomap", "err", err)
		return
	}
	if len(granted) == 0 {
		return
	}

	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("repo-map: read settings", "scope", "repomap", "err", err)
		return
	}
	status := s.Discovery.Status(ctx, settings.Git.GitPath)
	if status.Kind != "ok" {
		errText := "git is unavailable: " + status.Kind
		if s.attachErrs == nil {
			s.attachErrs = make(map[string]string)
		}
		for _, r := range granted {
			if _, attached := s.keys[r.ID]; !attached {
				s.attachErrs[r.ID] = errText
			}
		}
		slog.Warn("repo-map: git unavailable, not attaching granted repositories", "scope", "repomap", "kind", status.Kind)
		return
	}

	if s.keys == nil {
		s.keys = make(map[string]string)
	}
	// 1b: rekey every already-attached instance onto its correct desired key FIRST, before
	// attempting any new Attach — otherwise a new repo whose desired key collides with an
	// incumbent's stale one fails to attach (the incumbent hasn't freed it yet) and, since nothing
	// here retries a failed attach, is never attached until the app restarts.
	s.syncAttachedKeysLocked(rows, granted)

	desired := repoKeys(rows)
	for _, r := range granted {
		if _, already := s.keys[r.ID]; already {
			continue
		}
		key := desired[r.ID]
		if _, err := s.server.Attach(repomap.RepoSpec{
			Key: key, RepoID: r.RepoID, Root: r.Root, GitPath: status.Path, Runner: s.Runner,
		}); err != nil {
			slog.Warn("repo-map: attach", "scope", "repomap", "repo", r.Name, "err", err)
			if s.attachErrs == nil {
				s.attachErrs = make(map[string]string)
			}
			s.attachErrs[r.ID] = err.Error()
			continue
		}
		s.keys[r.ID] = key
		delete(s.attachErrs, r.ID)
	}
}

// startLocked constructs and starts a new embedded instance if one is not already running, loading
// (or, on a first-ever enable, minting) this app's own token — P67d §6.3, D2: an explicit enable no
// longer mints unconditionally, since one app-scoped token now covers every granted repository and
// silently invalidating it on every toggle-off-and-on would break a working registration for no
// reason the user asked for. mu must be held by the caller.
func (s *RepoMapService) startLocked() error {
	if s.server != nil {
		return nil
	}
	home := s.home()
	plain, rec, _, err := mcpauth.LoadOrMint(mcpauth.Path(home, repoMapTokenSlug))
	if err != nil {
		return err
	}
	srv, err := repomap.New(repomap.Config{Home: home, Token: rec, TokenPlain: plain, Logger: slog.Default()})
	if err != nil {
		return err
	}
	s.server = srv
	go func() {
		if err := srv.Serve(); err != nil {
			slog.Warn("repo-map embedded server", "scope", "repomap", "err", err)
		}
	}()
	s.attachGrantedLocked(context.Background())
	return nil
}

// stopLocked stops and drops the embedded instance, if any, along with every per-repository
// tracking state it owned. mu must be held by the caller.
func (s *RepoMapService) stopLocked() {
	if s.server == nil {
		return
	}
	_ = s.server.Close()
	s.server = nil
	s.keys = nil
	s.attachErrs = nil
}

// startIfEnabled is main.go's own boot-time call (gitSock.Start()'s own placement and "never
// fatal" posture): if the setting is already on from a prior session, start the embedded instance
// now and attach every currently-granted repository. A failure (a bind conflict, git unavailable)
// is logged, never fatal — the app boots regardless, exactly like `git.sock`'s own listener.
//
// Unexported, reached only through StartRepoMapIfEnabled below — not a method Wails' binding
// generator would otherwise expose to the renderer as an IPC call alongside the methods this
// service means to cross the wire.
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
	if err := s.startLocked(); err != nil {
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

// onRepoRemoved is CodeWorkspaceService.OnRepoRemoved's own hook target (main.go wires it) —
// detaches the removed repository's live instance immediately, by its last-known key (keys, above)
// since the code_repos row is already gone by the time this runs.
func (s *RepoMapService) onRepoRemoved(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.attachErrs, id)
	if s.server == nil {
		return
	}
	if key, ok := s.keys[id]; ok {
		s.server.Detach(key)
		delete(s.keys, id)
	}
}

// onRepoRenamed is CodeWorkspaceService.OnRepoRenamed's own hook target — re-derives every granted
// row's own key against the new name and Rekeys whichever attached instances drifted (possibly more
// than just id's own, per syncAttachedKeysLocked's own doc comment).
func (s *RepoMapService) onRepoRenamed(id, _ string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return
	}
	if _, attached := s.keys[id]; !attached {
		return
	}
	rows, granted, err := s.rowsAndGrantedLocked()
	if err != nil {
		slog.Warn("repo-map: list repos for rename", "scope", "repomap", "err", err)
		return
	}
	s.syncAttachedKeysLocked(rows, granted)
}

// StartRepoMapIfEnabled and StopRepoMap are main.go's own boot/shutdown hooks for the embedded
// instance, package-level functions rather than exported methods on RepoMapService precisely so
// Wails' binding generator (which inspects only the exported methods of a *registered service*
// type) never offers them to the renderer — a wire-callable Stop or a redundant StartIfEnabled
// would let a bug or a stray call bypass the settings leaf entirely. RepoMapNotifyRepoRemoved and
// RepoMapNotifyRepoRenamed are the same shape, for CodeWorkspaceService's own removal/rename hooks
// (main.go).
func StartRepoMapIfEnabled(s *RepoMapService)               { s.startIfEnabled() }
func StopRepoMap(s *RepoMapService)                         { s.stop() }
func RepoMapNotifyRepoRemoved(s *RepoMapService, id string) { s.onRepoRemoved(id) }
func RepoMapNotifyRepoRenamed(s *RepoMapService, id, name string) {
	s.onRepoRenamed(id, name)
}

// RepoMapSetEnabledArgs is SetEnabled's own argument shape.
type RepoMapSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the embedded instance in the same call
// (the toggle bypasses the dialog's draft/Save flow entirely, an instant action). Starting attaches
// every currently-granted repository; nothing is exposed if none are granted yet (P67d §8 item 1).
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
		if err := s.startLocked(); err != nil {
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

// RepoMapSetRepoEnabledArgs is SetRepoEnabled's own argument shape.
type RepoMapSetRepoEnabledArgs struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

// SetRepoEnabled grants or revokes one imported repository's own MCP access (the "Repository
// access" list's own checkbox): persists the grant, then attaches or detaches the live instance if
// the server is currently running — a grant made while the server is off simply persists, and takes
// effect the next time it starts.
func (s *RepoMapService) SetRepoEnabled(args RepoMapSetRepoEnabledArgs) (RepoMapStatus, error) {
	if args.ID == "" {
		return RepoMapStatus{}, ipcerr.BadRequest("id is required")
	}
	if err := s.Deps.Repos.CodeRepos.SetMcpEnabled(args.ID, args.Enabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return RepoMapStatus{}, ipcerr.BadRequest("repository not found")
		}
		return RepoMapStatus{}, ipcerr.Internal(err.Error())
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server != nil {
		if args.Enabled {
			s.attachGrantedLocked(context.Background())
		} else {
			// 1c: cleared unconditionally, not only when a live key exists — a repository that
			// never successfully attached (git was unavailable when it was granted, or 1b's own
			// since-fixed key collision) has no entry in s.keys, so gating this on the s.keys
			// lookup left its attachErrs entry displayed forever, surviving the revoke that was
			// supposed to clear it (statusLocked renders it next to an unchecked checkbox).
			delete(s.attachErrs, args.ID)
			if key, ok := s.keys[args.ID]; ok {
				s.server.Detach(key)
				delete(s.keys, args.ID)
			}
		}
	}
	return s.statusLocked(), nil
}

// Regenerate mints a fresh token for the already-running embedded instance without touching the
// setting, its lifecycle, or any repository's own attachment (P67d §6.3: the app-scoped token
// covers every granted repository, so regeneration is the one explicit, user-initiated way to force
// a fresh one — replacing D8's old "every enable mints fresh" rule). A no-op, returning the current
// status unchanged, when nothing is running.
func (s *RepoMapService) Regenerate() RepoMapStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return s.statusLocked()
	}
	path := mcpauth.Path(s.home(), repoMapTokenSlug)
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

// InstallClaudeCode never returns a Go error — mcpinstall.Install's own contract, following
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
