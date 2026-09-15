package bridge

import (
	"context"
	"log/slog"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/dbmcp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// dbMcpServerName is the one name every Install call registers under — internal/dbmcp's own
// server identity (Implementation.Name, dbmcp/server.go).
const dbMcpServerName = "kira-db"

// dbMcpTokenName is mcpauth.PathNamed's own file-name argument — no repo-id slug (M1 §2.2): one DB
// MCP instance exists per app process per KIRA_HOME, with no second identity to key several apart
// by, unlike the repo-map server.
const dbMcpTokenName = "mcp-db"

// DbMcpService is the Database MCP section's whole surface (M1 §6.2): Status, SetEnabled,
// Regenerate, InstallClaudeCode. Copies RepoMapService's own shape exactly (§3.3) — it owns the
// embedded *dbmcp.Server's actual lifecycle, constructed and started when the setting turns on (or
// already is, at boot), stopped when it turns off or the app quits. Installer reuses
// RepoMapInstaller as-is (declared in repomap.go) rather than a second, identical interface.
type DbMcpService struct {
	Deps      appcore.Deps
	Installer RepoMapInstaller
	// Approvals is M2's prompt-mode broker — constructed once in main.go and outliving this
	// service's own server start/stop, so the event subscription wired at boot (Events.Attach)
	// stays valid across a restart of the embedded server.
	Approvals *dbmcp.ApprovalBroker

	mu     sync.Mutex
	server *dbmcp.Server
}

// DbMcpStatus is the wire projection every method below returns.
type DbMcpStatus struct {
	Running         bool     `json:"running"`
	Command         string   `json:"command"`
	ClaudeAvailable bool     `json:"claudeAvailable"`
	Probed          []string `json:"probed"`
	// ExpiresAt is the current token's own expiry, RFC 3339, "" when nothing is running or the
	// record has not yet been stamped.
	ExpiresAt string `json:"expiresAt"`
	// Error names why Running is false despite the setting being on — a bind failure. "" whenever
	// Running is true, or the setting is simply off.
	Error string `json:"error"`
}

func (s *DbMcpService) statusLocked() DbMcpStatus {
	inst := s.Installer.Status()
	st := DbMcpStatus{ClaudeAvailable: inst.ClaudePath != "", Probed: inst.Probed}
	if s.server == nil {
		return st
	}
	st.Running = true
	// Command is "" whenever no plaintext is currently held (an app restart with the setting
	// already on) — the Database MCP section shows a Regenerate action instead.
	if plain, minted := s.server.Token(); minted {
		st.Command = mcpinstall.Command(dbMcpServerName, s.server.URL(), plain)
	}
	if exp := s.server.TokenExpiry(); !exp.IsZero() {
		st.ExpiresAt = exp.Format(time.RFC3339)
	}
	return st
}

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *DbMcpService) Status() DbMcpStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statusLocked()
}

// dbMcpTokenProviderFor mirrors tokenProviderFor's own mint/!mint split (repomap.go), applied to
// dbmcp.TokenProvider's own no-repoID signature: mint always mints fresh and persists over any
// existing file (an explicit enable); !mint loads an existing token or mints only if none exists
// yet, or the existing one has lapsed (the app-boot-with-the-leaf-already-true path).
func dbMcpTokenProviderFor(home string, mint bool) dbmcp.TokenProvider {
	return func() (mcpauth.Record, string, bool, error) {
		path := mcpauth.PathNamed(home, dbMcpTokenName)
		if !mint {
			plain, rec, minted, err := mcpauth.LoadOrMintTTL(path, mcpauth.TTL)
			return rec, plain, minted, err
		}
		plain, rec, err := mcpauth.MintTTL(mcpauth.TTL)
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
func (s *DbMcpService) startLocked(mint bool) error {
	if s.server != nil {
		return nil
	}
	home := config.KiraHome()
	srv, err := dbmcp.New(dbmcp.Config{
		Home:             home,
		Token:            dbMcpTokenProviderFor(home, mint),
		Conns:            s.Deps.Connections,
		Tree:             s.Deps.Tree,
		Query:            s.Deps.Router,
		Approvals:        s.Approvals,
		ExplainThreshold: s.explainThreshold,
		Logger:           slog.Default(),
	})
	if err != nil {
		return err
	}
	s.server = srv
	go func() {
		if err := srv.Serve(); err != nil {
			slog.Warn("db mcp embedded server", "scope", "dbmcp", "err", err)
		}
	}()
	return nil
}

// explainThreshold is dbmcp.Config.ExplainThreshold's real backend: settingsState.advanced.
// expensiveQueryRows's own Go leaf, read fresh on every call — never cached, since a stale
// threshold would silently mis-flag every query after the user changes it (M3 §3.3). A settings
// read failure must not break a query; it falls back to the documented default and logs once.
func (s *DbMcpService) explainThreshold() int {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("db mcp: read expensive-query threshold, using default", "scope", "dbmcp", "err", err)
		return model.DefaultSettings().Advanced.ExpensiveQueryRows
	}
	return settings.Advanced.ExpensiveQueryRows
}

// stopLocked stops and drops the embedded instance, if any. mu must be held by the caller.
func (s *DbMcpService) stopLocked() {
	if s.server == nil {
		return
	}
	_ = s.server.Close()
	s.server = nil
	// M2 §5.3: nothing left blocked on a broker nobody will answer again. The broker itself stays
	// usable — a later re-enable within the same app run constructs a fresh server against it.
	s.Approvals.AbandonAll()
}

// startIfEnabled is main.go's own boot-time call, mirroring StartRepoMapIfEnabled's own posture
// exactly: a failure (a bind conflict) is logged, never fatal — the app boots regardless.
//
// Unexported, reached only through StartDbMcpIfEnabled below — repomap.go's own startIfEnabled
// doc comment explains why (Wails binds every exported method of a registered service, and a
// wire-callable Start would let a stray call bypass the settings leaf).
func (s *DbMcpService) startIfEnabled() {
	settings, err := s.Deps.Repos.Settings.GetAll()
	if err != nil {
		slog.Warn("db mcp: read settings at boot", "scope", "dbmcp", "err", err)
		return
	}
	if !settings.DbMcp.ServerEnabled {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.startLocked(false); err != nil {
		slog.Warn("db mcp: start at boot", "scope", "dbmcp", "err", err)
	}
}

// stop is main.go's own shutdown call, beside bridge.StopRepoMap — see startIfEnabled's own note
// on why this is unexported and reached only through StopDbMcp.
func (s *DbMcpService) stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopLocked()
}

// StartDbMcpIfEnabled and StopDbMcp are main.go's own boot/shutdown hooks for the embedded
// instance, package-level functions rather than exported methods on DbMcpService — the identical
// reasoning StartRepoMapIfEnabled/StopRepoMap already document.
func StartDbMcpIfEnabled(s *DbMcpService) { s.startIfEnabled() }
func StopDbMcp(s *DbMcpService)           { s.stop() }

// DbMcpSetEnabledArgs is SetEnabled's own argument shape.
type DbMcpSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the embedded instance in the same call
// (the toggle bypasses the dialog's draft/Save flow entirely, an instant action, mirroring
// RepoMapService.SetEnabled). Turning on always mints a fresh token, even if a file already exists
// for a previous enable — a deliberate, explicit re-enable is exactly the event token rotation
// ties regeneration to.
func (s *DbMcpService) SetEnabled(args DbMcpSetEnabledArgs) (DbMcpStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		DbMcp: &model.DbMcpPatch{ServerEnabled: &args.Enabled},
	})
	if err != nil {
		return DbMcpStatus{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	s.mu.Lock()
	defer s.mu.Unlock()
	if args.Enabled {
		if err := s.startLocked(true); err != nil {
			slog.Warn("db mcp: start on enable", "scope", "dbmcp", "err", err)
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
// setting or its lifecycle (an app restart loaded the existing hash+salt but has no plaintext to
// show). A no-op, returning the current status unchanged, when nothing is running.
func (s *DbMcpService) Regenerate() DbMcpStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return s.statusLocked()
	}
	path := mcpauth.PathNamed(config.KiraHome(), dbMcpTokenName)
	plain, rec, err := mcpauth.MintTTL(mcpauth.TTL)
	if err != nil {
		slog.Warn("db mcp: regenerate token", "scope", "dbmcp", "err", err)
		return s.statusLocked()
	}
	if err := mcpauth.Save(path, rec); err != nil {
		slog.Warn("db mcp: persist regenerated token", "scope", "dbmcp", "err", err)
		return s.statusLocked()
	}
	s.server.SetToken(rec, plain)
	return s.statusLocked()
}

// DbMcpInstallResult is mcpinstall.Result's wire projection — RepoMapInstallResult's own
// precedent.
type DbMcpInstallResult struct {
	Outcome string   `json:"outcome"`
	Detail  string   `json:"detail"`
	Probed  []string `json:"probed"`
}

func toWireDbMcpInstallResult(r mcpinstall.Result) DbMcpInstallResult {
	return DbMcpInstallResult{Outcome: r.Outcome, Detail: r.Detail, Probed: r.Probed}
}

// InstallClaudeCode never returns a Go error — mcpinstall.Install's own contract, following
// RepoMapService.InstallClaudeCode's precedent. A no-op result (outcome notFound) when nothing is
// running: there is nothing to register yet.
func (s *DbMcpService) InstallClaudeCode(ctx context.Context) DbMcpInstallResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server == nil {
		return DbMcpInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	plain, minted := s.server.Token()
	if !minted {
		return DbMcpInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	return toWireDbMcpInstallResult(s.Installer.Install(ctx, dbMcpServerName, s.server.URL(), plain))
}

// dbMcpApprovalStatementCap bounds DbMcpApprovalRequest.Statement on the wire — a generated
// statement can be large, and the approval dialog renders it; Truncated says whether it was cut.
const dbMcpApprovalStatementCap = 4000

// capApprovalStatement cuts s at a rune boundary so a multi-byte character straddling the cap
// never produces invalid UTF-8 on the wire.
func capApprovalStatement(s string) (text string, truncated bool) {
	if len(s) <= dbMcpApprovalStatementCap {
		return s, false
	}
	cut := dbMcpApprovalStatementCap
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut], true
}

// dbMcpApprovalPlanIssuesCap bounds DbMcpApprovalPlan.Issues on the wire — the dbmcp package's own
// approvalPlanFrom already caps at this same figure (M3 §6.2), so this is a defense-in-depth
// re-application at the wire boundary, the same posture capApprovalStatement already takes for
// the statement text.
const dbMcpApprovalPlanIssuesCap = 10

// DbMcpApprovalPlanIssue is dbmcp.ApprovalPlanIssue's wire projection.
type DbMcpApprovalPlanIssue struct {
	Severity string `json:"severity"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

// DbMcpApprovalPlan is dbmcp.ApprovalPlan's wire projection — M3's own plan evidence the approval
// dialog renders, present only on a request that carries one.
type DbMcpApprovalPlan struct {
	EstimatedRowsRead *float64                 `json:"estimatedRowsRead"`
	ThresholdRows     int                      `json:"thresholdRows"`
	OverThreshold     bool                     `json:"overThreshold"`
	Issues            []DbMcpApprovalPlanIssue `json:"issues"`
	IssuesOmitted     int                      `json:"issuesOmitted"`
}

func toWireApprovalPlan(p *dbmcp.ApprovalPlan) *DbMcpApprovalPlan {
	if p == nil {
		return nil
	}
	issues := p.Issues
	omitted := p.IssuesOmitted
	if len(issues) > dbMcpApprovalPlanIssuesCap {
		omitted += len(issues) - dbMcpApprovalPlanIssuesCap
		issues = issues[:dbMcpApprovalPlanIssuesCap]
	}
	wireIssues := make([]DbMcpApprovalPlanIssue, len(issues))
	for i, iss := range issues {
		wireIssues[i] = DbMcpApprovalPlanIssue{Severity: iss.Severity, Code: iss.Code, Message: iss.Message}
	}
	return &DbMcpApprovalPlan{
		EstimatedRowsRead: p.EstimatedRowsRead, ThresholdRows: p.ThresholdRows,
		OverThreshold: p.OverThreshold, Issues: wireIssues, IssuesOmitted: omitted,
	}
}

// DbMcpApprovalRequest is dbmcp.ApprovalRequest's wire projection — an absolute deadline (epoch
// ms) instead of a time.Time, GitPairingRequest's own precedent.
type DbMcpApprovalRequest struct {
	RequestID      string `json:"requestId"`
	ConnectionID   string `json:"connectionId"`
	ConnectionName string `json:"connectionName"`
	Kind           string `json:"kind"`
	Class          string `json:"class"`
	Statement      string `json:"statement"`
	Truncated      bool   `json:"truncated"`
	ExpiresAtMs    int64  `json:"expiresAtMs"`
	// Reason is M3's own "permission" | "heavy" — every M2-era request is "permission" (M3 §6.2).
	Reason string             `json:"reason"`
	Plan   *DbMcpApprovalPlan `json:"plan"`
}

// DbMcpApprovalSnapshot is dbmcp.ApprovalSnapshot's wire projection.
type DbMcpApprovalSnapshot struct {
	Pending *DbMcpApprovalRequest `json:"pending"`
	Queued  int                   `json:"queued"`
}

func toWireApprovalSnapshot(snap dbmcp.ApprovalSnapshot) DbMcpApprovalSnapshot {
	out := DbMcpApprovalSnapshot{Queued: snap.Queued}
	if snap.Pending != nil {
		statement, truncated := capApprovalStatement(snap.Pending.Statement)
		out.Pending = &DbMcpApprovalRequest{
			RequestID: snap.Pending.RequestID, ConnectionID: snap.Pending.ConnectionID,
			ConnectionName: snap.Pending.ConnectionName, Kind: snap.Pending.Kind,
			Class: string(snap.Pending.Class), Statement: statement, Truncated: truncated,
			ExpiresAtMs: snap.Pending.ExpiresAt.UnixMilli(),
			Reason:      string(snap.Pending.Reason),
			Plan:        toWireApprovalPlan(snap.Pending.Plan),
		}
	}
	return out
}

// PendingApprovals is the snapshot a newly opened window fetches on mount — state/gitClients.ts's
// own boot-time hydration, applied to the approval queue.
func (s *DbMcpService) PendingApprovals() DbMcpApprovalSnapshot {
	return toWireApprovalSnapshot(s.Approvals.Pending())
}

// DbMcpApprovalArgs is shared by ApproveQuery/DenyQuery — nothing but the request id.
type DbMcpApprovalArgs struct {
	RequestID string `json:"requestId"`
}

// ApproveQuery and DenyQuery never return a Go error — a decision is a value (GitClientsService's
// own precedent) — and return the current snapshot rather than an action-result enum, so the
// clicking window updates immediately instead of waiting for its own broadcast to arrive.
func (s *DbMcpService) ApproveQuery(args DbMcpApprovalArgs) (DbMcpApprovalSnapshot, error) {
	if args.RequestID == "" {
		return DbMcpApprovalSnapshot{}, ipcerr.BadRequest("requestId is required")
	}
	s.Approvals.Approve(args.RequestID)
	return toWireApprovalSnapshot(s.Approvals.Pending()), nil
}

func (s *DbMcpService) DenyQuery(args DbMcpApprovalArgs) (DbMcpApprovalSnapshot, error) {
	if args.RequestID == "" {
		return DbMcpApprovalSnapshot{}, ipcerr.BadRequest("requestId is required")
	}
	s.Approvals.Deny(args.RequestID)
	return toWireApprovalSnapshot(s.Approvals.Pending()), nil
}
