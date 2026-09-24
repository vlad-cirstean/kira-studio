package bridge

import (
	"context"
	"log/slog"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/config"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/dbmcp"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpauth"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/mcpinstall"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// dbMcpServerName is the one name every Install call registers under — internal/dbmcp's own
// server identity (Implementation.Name, dbmcp/server.go).
const dbMcpServerName = "kira-db"

// dbMcpTokenName is mcpauth.PathNamed's own file-name argument — no repo-id slug (M1 §2.2): one DB
// MCP instance exists per app process per KIRA_HOME, with no second identity to key several apart
// by.
const dbMcpTokenName = "mcp-db"

// McpInstaller is mcpinstall.Installer's own seam, declared where it is consumed — the same
// "declare the interface where it's consumed" precedent GitVsix (gitclients.go) already uses.
type McpInstaller interface {
	Status() mcpinstall.Status
	Install(ctx context.Context, name, url, token string) mcpinstall.Result
}

// DbMcpService is the Database MCP section's whole surface (M1 §6.2): Status, SetEnabled,
// Regenerate, InstallClaudeCode — it owns the embedded *dbmcp.Server's actual lifecycle,
// constructed and started when the setting turns on (or already is, at boot), stopped when it
// turns off or the app quits.
type DbMcpService struct {
	Deps      appcore.Deps
	Installer McpInstaller
	// Approvals is M2's prompt-mode broker — constructed once in main.go and outliving this
	// service's own server start/stop, so the event subscription wired at boot (Events.Attach)
	// stays valid across a restart of the embedded server.
	Approvals *dbmcp.ApprovalBroker

	embedded embeddedService[*dbmcp.Server, DbMcpStatus]
}

// NewDbMcpService wires the embedded lifecycle's own start/stop/status closures once, here, so
// every other method can assume s.embedded is ready — a plain struct literal (main.go's own shape
// before T2-13) would leave them nil.
func NewDbMcpService(deps appcore.Deps, installer McpInstaller, approvals *dbmcp.ApprovalBroker) *DbMcpService {
	s := &DbMcpService{Deps: deps, Installer: installer, Approvals: approvals}
	s.embedded = embeddedService[*dbmcp.Server, DbMcpStatus]{
		startFn: func(mint bool) (*dbmcp.Server, error) {
			home := config.KiraHome()
			// The headersHelper script's own content depends only on the token file's path, never
			// its live value — ensure it once per start (F2), not on every statusFn/Install call.
			if _, err := mcpinstall.EnsureHeaderHelperScript(home, mcpauth.HelperTokenPathNamed(home, dbMcpTokenName)); err != nil {
				return nil, err
			}
			srv, err := dbmcp.New(dbmcp.Config{
				Home:             home,
				Token:            dbMcpTokenProviderFor(home, mint),
				Conns:            s.Deps.Connections,
				Tree:             s.Deps.Tree,
				Query:            s.Deps.Router,
				Approvals:        s.Approvals,
				MaskRules:        s.Deps.MaskRules,
				ExplainThreshold: s.explainThreshold,
				Logger:           slog.Default(),
			})
			if err != nil {
				return nil, err
			}
			go func() {
				if err := srv.Serve(); err != nil {
					slog.Warn("db mcp embedded server", "scope", "dbmcp", "err", err)
				}
			}()
			return srv, nil
		},
		// Approvals stays usable — a later re-enable within the same app run constructs a fresh
		// server against it. AbandonAll runs before Close, not after (finding #17, M6): a run_query
		// handler mid-flight can be parked in ApprovalBroker.Request (M2 §5.3) waiting on a human
		// who will never answer once the server is going away. Close's own closeHTTP calls
		// http.Server.Shutdown, which waits for every in-flight handler to return — closing before
		// abandoning would have that handler, and Shutdown itself, both wait on each other with
		// nothing left to break the deadlock but closeHTTP's own backstop timeout. Abandoning first
		// lets the parked handler return immediately (ApprovalAbandoned), so Shutdown's ordinary
		// graceful drain finds nothing left in flight.
		stopFn: func(srv *dbmcp.Server) {
			s.Approvals.AbandonAll()
			_ = srv.Close()
		},
		statusFn: func(srv *dbmcp.Server) DbMcpStatus {
			inst := s.Installer.Status()
			st := DbMcpStatus{ClaudeAvailable: inst.ClaudePath != "", Probed: inst.Probed}
			if srv == nil {
				return st
			}
			st.Running = true
			// Command is "" whenever no plaintext is currently held (an app restart with the
			// setting already on) — the Database MCP section shows a Regenerate action instead.
			if _, minted := srv.Token(); minted {
				helperPath := mcpinstall.HeaderHelperScriptPath(config.KiraHome())
				st.Command = mcpinstall.Command(dbMcpServerName, srv.URL(), helperPath)
			}
			if exp := srv.TokenExpiry(); !exp.IsZero() {
				st.ExpiresAt = exp.Format(time.RFC3339)
			}
			return st
		},
	}
	return s
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

// Status reads the embedded instance's current state — never starts or stops anything.
func (s *DbMcpService) Status() DbMcpStatus {
	return s.embedded.Status()
}

// dbMcpTokenProviderFor implements dbmcp.TokenProvider's own no-repoID signature with a mint/!mint
// split: mint always mints fresh and persists over any existing file (an explicit enable); !mint
// loads an existing token or mints only if none exists yet, or the existing one has lapsed (the
// app-boot-with-the-leaf-already-true path).
func dbMcpTokenProviderFor(home string, mint bool) dbmcp.TokenProvider {
	return func() (mcpauth.Record, string, bool, error) {
		path := mcpauth.PathNamed(home, dbMcpTokenName)
		helperPath := mcpauth.HelperTokenPathNamed(home, dbMcpTokenName)
		if !mint {
			plain, rec, minted, err := mcpauth.LoadOrMintTTL(path, mcpauth.TTL)
			// A fresh plaintext (minted, or the one-shot zero-ExpiresAt stamp — neither of which
			// LoadOrMintTTL distinguishes in its own return shape) only exists here when minted is
			// true (LoadOrMintTTL's own doc: plain is "" whenever it did not mint). The helper
			// script's own mirror file needs updating only then — a plain load leaves it untouched,
			// already holding the correct current value from the last mint (F2).
			if err == nil && minted {
				if serr := mcpauth.SaveHelperToken(helperPath, plain); serr != nil {
					return rec, plain, minted, serr
				}
			}
			return rec, plain, minted, err
		}
		plain, rec, err := mcpauth.MintTTL(mcpauth.TTL)
		if err != nil {
			return mcpauth.Record{}, "", false, err
		}
		if err := mcpauth.Save(path, rec); err != nil {
			return mcpauth.Record{}, "", false, err
		}
		if err := mcpauth.SaveHelperToken(helperPath, plain); err != nil {
			return mcpauth.Record{}, "", false, err
		}
		return rec, plain, true, nil
	}
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

// startIfEnabled is main.go's own boot-time call: a failure (a bind conflict) is logged, never
// fatal — the app boots regardless.
//
// Unexported, reached only through StartDbMcpIfEnabled below: Wails binds every exported method of
// a registered service, and a wire-callable Start would let a stray call bypass the settings leaf.
func (s *DbMcpService) startIfEnabled() {
	s.embedded.startIfEnabled("dbmcp", func() (bool, error) {
		settings, err := s.Deps.Repos.Settings.GetAll()
		if err != nil {
			return false, err
		}
		return settings.DbMcp.ServerEnabled, nil
	})
}

// stop is main.go's own shutdown call — see startIfEnabled's own note on why this is unexported
// and reached only through StopDbMcp.
func (s *DbMcpService) stop() {
	s.embedded.stop()
}

// StartDbMcpIfEnabled and StopDbMcp are main.go's own boot/shutdown hooks for the embedded
// instance, package-level functions rather than exported methods on DbMcpService — the identical
// reasoning startIfEnabled's own doc comment above documents.
func StartDbMcpIfEnabled(s *DbMcpService) { s.startIfEnabled() }
func StopDbMcp(s *DbMcpService)           { s.stop() }

// DbMcpSetEnabledArgs is SetEnabled's own argument shape.
type DbMcpSetEnabledArgs struct {
	Enabled bool `json:"enabled"`
}

// SetEnabled patches the settings leaf and starts or stops the embedded instance in the same call
// (the toggle bypasses the dialog's draft/Save flow entirely, an instant action). Turning on always
// mints a fresh token, even if a file already exists for a previous enable — a deliberate, explicit
// re-enable is exactly the event token rotation ties regeneration to.
func (s *DbMcpService) SetEnabled(args DbMcpSetEnabledArgs) (DbMcpStatus, error) {
	merged, err := s.Deps.Repos.Settings.Set(model.SettingsPatch{
		DbMcp: &model.DbMcpPatch{ServerEnabled: &args.Enabled},
	})
	if err != nil {
		return DbMcpStatus{}, ipcerr.Internal(err.Error())
	}
	s.Deps.Events.Emit(ChannelSettingsChanged, merged)

	st, err := s.embedded.setRunning(args.Enabled)
	if err != nil {
		slog.Warn("db mcp: start on enable", "scope", "dbmcp", "err", err)
		st.Error = err.Error()
	}
	return st, nil
}

// Regenerate mints a fresh token for the already-running embedded instance without touching the
// setting or its lifecycle (an app restart loaded the existing hash+salt but has no plaintext to
// show). A no-op, returning the current status unchanged, when nothing is running.
func (s *DbMcpService) Regenerate() DbMcpStatus {
	s.embedded.mu.Lock()
	defer s.embedded.mu.Unlock()
	if s.embedded.server == nil {
		return s.embedded.statusLocked()
	}
	path := mcpauth.PathNamed(config.KiraHome(), dbMcpTokenName)
	plain, rec, err := mcpauth.MintTTL(mcpauth.TTL)
	if err != nil {
		slog.Warn("db mcp: regenerate token", "scope", "dbmcp", "err", err)
		return s.embedded.statusLocked()
	}
	if err := mcpauth.Save(path, rec); err != nil {
		slog.Warn("db mcp: persist regenerated token", "scope", "dbmcp", "err", err)
		return s.embedded.statusLocked()
	}
	// The helper script's own live source (F2) — rotation is exactly rewriting this file, no
	// re-registration, so a stale mirror here would defeat the whole point of Regenerate.
	if err := mcpauth.SaveHelperToken(mcpauth.HelperTokenPathNamed(config.KiraHome(), dbMcpTokenName), plain); err != nil {
		slog.Warn("db mcp: persist regenerated helper token", "scope", "dbmcp", "err", err)
		return s.embedded.statusLocked()
	}
	s.embedded.server.SetToken(rec, plain)
	return s.embedded.statusLocked()
}

// DbMcpInstallResult is mcpinstall.Result's wire projection — GitVsixInstallResult's own precedent
// (gitclients.go): a domain package's plain Go struct never crosses the wire directly, only this
// tagged copy of it.
type DbMcpInstallResult struct {
	Outcome string   `json:"outcome"`
	Detail  string   `json:"detail"`
	Probed  []string `json:"probed"`
}

func toWireDbMcpInstallResult(r mcpinstall.Result) DbMcpInstallResult {
	return DbMcpInstallResult{Outcome: r.Outcome, Detail: r.Detail, Probed: r.Probed}
}

// InstallClaudeCode never returns a Go error — mcpinstall.Install's own contract, following
// connections.Service.Reveal/gitvsix.Installer.Install's precedent. A no-op result (outcome
// notFound) when nothing is running: there is nothing to register yet.
func (s *DbMcpService) InstallClaudeCode(ctx context.Context) DbMcpInstallResult {
	s.embedded.mu.Lock()
	defer s.embedded.mu.Unlock()
	if s.embedded.server == nil {
		return DbMcpInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	_, minted := s.embedded.server.Token()
	if !minted {
		return DbMcpInstallResult{Outcome: mcpinstall.OutcomeNotFound}
	}
	helperPath := mcpinstall.HeaderHelperScriptPath(config.KiraHome())
	return toWireDbMcpInstallResult(s.Installer.Install(ctx, dbMcpServerName, s.embedded.server.URL(), helperPath))
}

// dbMcpApprovalPlanIssuesCap bounds DbMcpApprovalPlan.Issues on the wire — the dbmcp package's own
// approvalPlanFrom already caps at this same figure (M3 §6.2), so this is a defense-in-depth
// re-application at the wire boundary. Unlike the statement text below it, eliding some of these
// issues never hides part of the statement itself from the human approving it.
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
		out.Pending = &DbMcpApprovalRequest{
			RequestID: snap.Pending.RequestID, ConnectionID: snap.Pending.ConnectionID,
			ConnectionName: snap.Pending.ConnectionName, Kind: snap.Pending.Kind,
			// Statement carries the full text, uncapped (M7 finding — a byte cap that elided the
			// middle let a hidden clause sit entirely inside the omitted span; the dialog's own
			// `.statement` is a fixed-height scroll container (DbMcpApprovalDialog.vue), so nothing
			// here bounds the DOM by hiding text a human is being asked to approve).
			Class: string(snap.Pending.Class), Statement: snap.Pending.Statement,
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

// ApproveQuery and DenyQuery never return a Go error — a decision is a value (Kira Space's own
// GitClientsService.Approve/Deny set this precedent first) — and return the current snapshot
// rather than an action-result enum, so the clicking window updates immediately instead of
// waiting for its own broadcast to arrive.
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
