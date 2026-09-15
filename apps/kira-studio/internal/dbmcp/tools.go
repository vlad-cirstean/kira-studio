package dbmcp

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/queryplan"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- list_connections (§4.1) ---

type listConnectionsArgs struct{}

// listConnections returns every connection with mcp_enabled true — deny by default (§6.1): a
// connection the user has not exposed is absent entirely, not listed-and-denied, since its
// existence is not the AI client's business.
//
// M7 finding #8: deliberately not gated on read mode the way listChildren/describeTable/
// describeSchema now are. This tool's whole job is enumerating exposed connections *and their own
// configured permissions* (the Permissions field below) so a caller can see, up front, that a
// connection denies read/write/DDL before trying any of them — gating it on read mode would hide
// exactly the information it exists to surface, for a connection that denies reads but still
// allows writes or DDL.
func (s *Server) listConnections(_ context.Context, _ *mcp.CallToolRequest, _ listConnectionsArgs) (*mcp.CallToolResult, any, error) {
	conns, err := s.cfg.Conns.List()
	if err != nil {
		return nil, nil, err
	}
	out := make([]connectionView, 0, len(conns))
	for _, c := range conns {
		if !c.McpEnabled {
			continue
		}
		state := s.cfg.Conns.StateOf(c.ID)
		view := connectionView{
			ID: c.ID, Name: c.Name, Kind: c.Kind, ReadOnly: c.ReadOnly, Status: state.Status,
			Description: c.McpDescription,
			Permissions: connectionPermissions{Read: c.McpReadMode, Write: c.McpWriteMode, DDL: c.McpDdlMode},
		}
		if state.ServerVersion != nil {
			view.ServerVersion = state.ServerVersion
		}
		if caps, ok := capsOf(state); ok {
			view.Capabilities = &connectionCapabilities{Query: caps.SQL, Describe: caps.Describe, SchemaColumns: caps.SchemaColumns}
		}
		// §4.5: cheap — one repo read per list_connections call, a human-frequency operation. A
		// read failure degrades to "no masked columns reported" rather than failing the whole
		// listing; the render path's own refusal (§4.4) is the real safety backstop regardless.
		if rules, err := s.cfg.MaskRules.List(c.ID); err == nil {
			view.MaskedColumns = maskedColumnsFor(rules)
		}
		out = append(out, view)
	}
	return jsonResult(out)
}

// --- list_children (§4.2) — replacing the fixed-name list_databases/list_schemas SPEC first named:
// the adapter layer's metadata primitive is one lazy level (Adapter.Children), and the levels
// differ per kind (§1.5), so one tool that returns the node's own `kind` is strictly more
// information than a pair of fixed names could carry. ---

type listChildrenArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path of the container to list, exactly as a previous list_children returned it. Omit for the connection's top level."`
	Refresh      bool   `json:"refresh,omitempty" jsonschema:"Bypass the cached listing and re-read from the server. Default false."`
}

func (s *Server) listChildren(_ context.Context, _ *mcp.CallToolRequest, args listChildrenArgs) (*mcp.CallToolResult, any, error) {
	summary, err := s.resolveEnabled(args.ConnectionID)
	if err != nil {
		return errResult(err.Error())
	}
	// M7 finding #8: a schema-browsing tool, gated at read-mode's own minimum bar — deny refuses,
	// same as every other read here. Not extended to prompt's own approval dialog: unlike run_query/
	// explain_query, this never runs caller-supplied SQL against the connection, so there is no
	// statement to show the human in an approval request.
	if m := modesOf(summary); m.read == "deny" {
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny read statements; change them in the connection's MCP tab", summary.Name))
	}
	result, err := s.cfg.Tree.Children(args.ConnectionID, args.Path, args.Refresh)
	if err != nil {
		return toolError(err)
	}
	return jsonResult(result.Nodes)
}

// --- describe_table (§4.3) ---

type describeTableArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	Path         string `json:"path" jsonschema:"Encoded path of the table, view or collection, from list_children."`
	Refresh      bool   `json:"refresh,omitempty" jsonschema:"Bypass the cached listing and re-read from the server. Default false."`
}

// describeTable is gated on Caps().Describe only in the sense that an adapter which cannot serve
// it already answers E_UNSUPPORTED in its own words (kafka/s3/sqs/redis) — surfaced verbatim by
// toolError rather than an invented message here (§4.3).
func (s *Server) describeTable(_ context.Context, _ *mcp.CallToolRequest, args describeTableArgs) (*mcp.CallToolResult, any, error) {
	summary, err := s.resolveEnabled(args.ConnectionID)
	if err != nil {
		return errResult(err.Error())
	}
	// M7 finding #8: same read-mode-deny gate as listChildren — see its own comment for why prompt
	// stops short of an approval dialog here.
	if m := modesOf(summary); m.read == "deny" {
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny read statements; change them in the connection's MCP tab", summary.Name))
	}
	result, err := s.cfg.Tree.Describe(args.ConnectionID, args.Path, args.Refresh, nil)
	if err != nil {
		return toolError(err)
	}
	return jsonResult(result.Meta)
}

// --- describe_schema (§4.4) ---

type describeSchemaArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	Path         string `json:"path" jsonschema:"Encoded path of a database or schema, from list_children."`
	Refresh      bool   `json:"refresh,omitempty" jsonschema:"Bypass the cached listing and re-read from the server. Default false."`
}

func (s *Server) describeSchema(_ context.Context, _ *mcp.CallToolRequest, args describeSchemaArgs) (*mcp.CallToolResult, any, error) {
	summary, err := s.resolveEnabled(args.ConnectionID)
	if err != nil {
		return errResult(err.Error())
	}
	// M7 finding #8: same read-mode-deny gate as listChildren — see its own comment for why prompt
	// stops short of an approval dialog here.
	if m := modesOf(summary); m.read == "deny" {
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny read statements; change them in the connection's MCP tab", summary.Name))
	}
	result, err := s.cfg.Tree.SchemaColumns(args.ConnectionID, args.Path, args.Refresh)
	if err != nil {
		return toolError(err)
	}
	return jsonResult(result.Relations)
}

// --- run_query (§4.5) ---

const (
	runQueryDefaultMaxRows = 200
	runQueryMaxMaxRows     = 2000
)

type runQueryArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	SQL          string `json:"sql" jsonschema:"One statement to run. Not a script — send one statement per call."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path selecting the database to run against, from list_children. Required for engines with more than one database; ignored by engines with one."`
	MaxRows      int    `json:"maxRows,omitempty" jsonschema:"Rows to return, 1-2000. Default 200. The query still runs in full; this caps what is returned."`
}

// runQuery builds an adapterhost.ExecuteRequestWire and calls Query.Execute — literally the method
// case "data:execute" calls for the console (§4.5), so throttling, op-logging, cancellation, panic
// recovery and each adapter's own read-only wrap all apply with nothing re-implemented. Connects on
// demand (§6.3): exposing a connection to MCP is the human's own explicit consent, and Connect is
// the same deduplicated path the UI uses, so the connection visibly comes up in the app rather than
// opening invisibly.
//
// M3 §5.2's gate order — a deliberate reorder from M2's own predicted seam, for two reasons: a
// statement the permission gate will deny must buy no EXPLAIN work, and one call must raise at
// most one approval prompt. resolve (unchanged) → refuse before connecting if every mode denies
// (unchanged) → clamp maxRows (unchanged) → connect (unchanged) → classify (unchanged) → verdict,
// with deny refusing here, before any EXPLAIN (reordered) → forced EXPLAIN when McpAutoExplain is
// on (new — a nil plan or any error degrades to "no plan", never blocks) → heavy check (new,
// §6.1: overThreshold only) → at most one approval, for verdict=="prompt" or heavy (extended) →
// execute (unchanged) → render, now carrying a plan summary when one exists (extended).
func (s *Server) runQuery(ctx context.Context, _ *mcp.CallToolRequest, args runQueryArgs) (*mcp.CallToolResult, any, error) {
	summary, err := s.resolveEnabled(args.ConnectionID)
	if err != nil {
		return errResult(err.Error())
	}

	m := modesOf(summary)
	if m.read == "deny" && m.write == "deny" && m.ddl == "deny" {
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny every statement class; change them in the connection's MCP tab", summary.Name))
	}

	maxRows := args.MaxRows
	if maxRows <= 0 {
		maxRows = runQueryDefaultMaxRows
	}
	if maxRows > runQueryMaxMaxRows {
		maxRows = runQueryMaxMaxRows
	}

	state, err := s.connectForQuery(args.ConnectionID)
	if err != nil {
		return toolError(err)
	}
	if state.Status != "connected" {
		return errResult(connectStateError(state))
	}

	// A classifier error degrades to ClassUnknown rather than failing the call — never a way to
	// bypass the gate, and never a way to break a connection either.
	class, err := s.cfg.Query.ClassifyStatement(ctx, args.ConnectionID, args.SQL)
	if err != nil {
		s.log.Warn("dbmcp: run_query: classification failed, treating as unknown", "connectionId", args.ConnectionID, "error", err)
		class = adapters.ClassUnknown
	}

	verdict := verdictFor(m, class)
	switch verdict {
	case "allow", "prompt":
		// continue below — a statement the gate will deny must buy no EXPLAIN work (§5.2), so deny
		// is refused before auto-force-explain ever runs.
	case "deny":
		return errResult(fmt.Sprintf("this connection's MCP permissions deny %s statements; change them in the connection's MCP tab", class))
	default:
		// An unrecognised mode word cannot reach here — repos/connections.go's scan coerces any
		// unreadable mode to "deny" before this method is ever called.
		return errResult(fmt.Sprintf("this connection's MCP permissions are misconfigured for %s statements; change them in the connection's MCP tab", class))
	}

	// Auto-force-explain (§5.2 step 7): a plan-only EXPLAIN, never ANALYZE, run before the human
	// is asked about the query when verdict is "prompt" — the minimum information needed to tell
	// them what they are approving. Any failure degrades to "no plan" (D19 rule 6's own posture);
	// a run_query call must not start failing because a plan could not be parsed.
	var plan *queryplan.Plan
	if summary.McpAutoExplain {
		p, planErr := s.planFor(ctx, summary, args.SQL, args.Path)
		if planErr != nil {
			s.log.Warn("dbmcp: run_query: auto-force-explain failed, running without a plan", "connectionId", args.ConnectionID, "error", planErr)
		} else {
			plan = p
		}
	}

	// §6.1: heavy is overThreshold only, never "any warn issue" — SQLite reports no row estimate
	// at all, so borrowing the console's isFlaggedPlan rule would raise a modal on nearly every
	// SQLite query.
	heavy := plan != nil && plan.OverThreshold

	// At most one approval prompt per call (§5.2/§6.2): when both a permission-prompt and a heavy
	// plan apply, one request carries Reason: ApprovalReasonPermission (the stricter reason — the
	// user said "ask me about every write") with the plan evidence riding along.
	if verdict == "prompt" || heavy {
		reason := ApprovalReasonHeavy
		if verdict == "prompt" {
			reason = ApprovalReasonPermission
		}
		outcome := s.cfg.Approvals.Request(ctx, ApprovalRequest{
			ConnectionID: args.ConnectionID, ConnectionName: summary.Name, Kind: summary.Kind,
			Class: class, Statement: args.SQL, Reason: reason,
			Plan: approvalPlanFrom(plan, s.cfg.ExplainThreshold()),
		})
		switch outcome {
		case ApprovalApproved:
			// M7 finding: summary/m/verdict above were resolved before this (up to 2-minute) wait.
			// If the user reacted to the prompt by revoking the connection's MCP exposure or
			// tightening this class's mode to deny, an Approve landing after that must not run the
			// statement under permissions that no longer hold — re-resolve both, the same posture
			// MaskSetFor below already takes for mask rules post-approval.
			resummary, err := s.resolveEnabled(args.ConnectionID)
			if err != nil {
				return errResult(err.Error())
			}
			if v := verdictFor(modesOf(resummary), class); v == "deny" {
				return errResult(fmt.Sprintf("this connection's MCP permissions now deny %s statements; change them in the connection's MCP tab", class))
			}
			summary = resummary
		case ApprovalDenied:
			return errResult(fmt.Sprintf("query against %q was denied by the user", summary.Name))
		case ApprovalTimedOut:
			return errResult(fmt.Sprintf("query against %q got no answer within 2 minutes", summary.Name))
		case ApprovalAbandoned:
			return errResult(fmt.Sprintf("the database MCP server stopped before the query against %q was answered", summary.Name))
		default:
			return errResult(fmt.Sprintf("query against %q was not approved", summary.Name))
		}
	}

	// M5 §4.3: resolved before Execute, so a key-store failure fails the call before the query runs,
	// not after — wasted adapter work on a call that cannot be rendered anyway.
	set, err := s.cfg.MaskRules.MaskSetFor(args.ConnectionID)
	if err != nil {
		return nil, nil, err
	}
	var mk *maskset
	if !set.Empty() {
		mk = &set
	}

	resp, err := s.cfg.Query.Execute(ctx, adapterhost.ExecuteRequestWire{
		OpID:         uuid.NewString(),
		ConnectionID: args.ConnectionID,
		Path:         args.Path,
		Statements:   []string{args.SQL},
	})
	if err != nil {
		// Finding #4, M6: a Postgres/MySQL driver error routinely embeds the offending value (a
		// failed type-cast error names the literal it couldn't parse) — on a connection with
		// active mask rules, the adapter's raw message could leak a real, unmasked value one row
		// at a time (SELECT email::int FROM customers LIMIT 1 OFFSET n). Scoped to masked
		// connections only; an unmasked connection keeps full error detail for debuggability.
		if mk != nil {
			return maskedToolError(err)
		}
		return toolError(err)
	}
	if len(resp.Pages) == 0 {
		return jsonResult(map[string]any{"kind": "empty", "rowCount": 0, "returned": 0})
	}
	rendered, err := renderPage(resp.Pages[0], maxRows, summaryOf(plan, s.cfg.ExplainThreshold()), mk, args.SQL)
	if err != nil {
		// §4.4/§5.3: a document/stream page under active masking rules is caller-correctable
		// (narrow the query, or remove the rules) — surfaced as an IsError result, not a raw Go
		// error. Anything else here is a genuine internal render fault.
		var refused *maskingRefusedError
		if errors.As(err, &refused) {
			return errResult(refused.Error())
		}
		return nil, nil, err
	}
	// Finding #12, M6: a `;`-separated args.SQL can make the adapter execute more than one
	// statement, each with its own page — surface that rather than silently rendering only
	// resp.Pages[0] with no sign anything else ran.
	var result any = rendered
	if len(resp.Pages) > 1 {
		result = withAdditionalStatementResultsNote(rendered, len(resp.Pages)-1)
	}
	return jsonResult(result)
}

// --- explain_query (§4) ---

type explainQueryArgs struct {
	ConnectionID string `json:"connectionId" jsonschema:"Connection id from list_connections."`
	SQL          string `json:"sql" jsonschema:"One SELECT or WITH statement to plan. It is not executed — EXPLAIN is always issued without ANALYZE."`
	Path         string `json:"path,omitempty" jsonschema:"Encoded path selecting the database to plan against, from list_children. Required for engines with more than one database; ignored by engines with one."`
	IncludeRaw   bool   `json:"includeRaw,omitempty" jsonschema:"Also return the server's own raw EXPLAIN text. Default false — it can be tens of kilobytes, and the parsed plan above is the point."`
}

// explainQueryResult embeds queryplan.Plan so its own fields inline directly into the result
// object — the same shape planModel.ts's QueryPlan is, plus ThresholdRows (§4.2): an MCP client
// cannot otherwise interpret OverThreshold, since the threshold itself lives in this app's own
// settings, never sent to the client any other way.
type explainQueryResult struct {
	queryplan.Plan
	ThresholdRows int `json:"thresholdRows"`
}

// explainQuery plans one SELECT/WITH statement without running it (§4.3's own gate order):
// resolve → kind support → explainability → read-mode deny (before connecting) → connect →
// classify-assert every composed statement as a read (§8.3) → verdict on the read mode (prompt
// raises M2's approval, carrying the composed statement) → execute → parse → project, dropping Raw
// unless IncludeRaw.
func (s *Server) explainQuery(ctx context.Context, _ *mcp.CallToolRequest, args explainQueryArgs) (*mcp.CallToolResult, any, error) {
	summary, err := s.resolveEnabled(args.ConnectionID)
	if err != nil {
		return errResult(err.Error())
	}

	// §7: unsupported kinds are refused before connecting — nothing this call can do will succeed.
	if !queryplan.Supported(summary.Kind) {
		return errResult(fmt.Sprintf("connection %q (%s) has no EXPLAIN this app can parse", summary.Name, summary.Kind))
	}
	// §8.1: explain_query accepts only what queryplan.Explainable accepts — a DELETE/UPDATE never
	// gets its own EXPLAIN path (ClickHouse's EXPLAIN can execute its target on some forms).
	if !queryplan.Explainable(args.SQL) {
		return errResult("explain_query only accepts a SELECT or WITH statement")
	}

	m := modesOf(summary)
	if m.read == "deny" {
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny read statements; change them in the connection's MCP tab", summary.Name))
	}

	state, err := s.connectForQuery(args.ConnectionID)
	if err != nil {
		return toolError(err)
	}
	if state.Status != "connected" {
		return errResult(connectStateError(state))
	}

	statements := queryplan.StatementsFor(summary.Kind, args.SQL)
	// §8.2/§8.3: the composed EXPLAIN is gated as a read through M2's existing classifier, not a
	// new permission vocabulary — a non-read verdict here is an internal refusal, this app's own
	// composer producing something it does not trust, never something the caller did wrong.
	if err := s.assertComposedStatementsAreReads(ctx, args.ConnectionID, statements); err != nil {
		return nil, nil, err
	}

	switch verdict := verdictFor(m, adapters.ClassRead); verdict {
	case "allow":
		// fall through to Execute below.
	case "prompt":
		outcome := s.cfg.Approvals.Request(ctx, ApprovalRequest{
			ConnectionID: args.ConnectionID, ConnectionName: summary.Name, Kind: summary.Kind,
			Class: adapters.ClassRead, Statement: strings.Join(statements, "\n"),
			Reason: ApprovalReasonPermission,
		})
		switch outcome {
		case ApprovalApproved:
			// fall through to Execute below.
		case ApprovalDenied:
			return errResult(fmt.Sprintf("query against %q was denied by the user", summary.Name))
		case ApprovalTimedOut:
			return errResult(fmt.Sprintf("query against %q got no answer within 2 minutes", summary.Name))
		case ApprovalAbandoned:
			return errResult(fmt.Sprintf("the database MCP server stopped before the query against %q was answered", summary.Name))
		default:
			return errResult(fmt.Sprintf("query against %q was not approved", summary.Name))
		}
	case "deny":
		// Already handled above (m.read == "deny", before connecting) — unreachable in practice,
		// kept so a future change to verdictFor cannot silently skip the read-mode gate here.
		return errResult(fmt.Sprintf("connection %q's MCP permissions deny read statements; change them in the connection's MCP tab", summary.Name))
	default:
		return errResult("this connection's MCP permissions are misconfigured for read statements; change them in the connection's MCP tab")
	}

	// Finding #4, M6: same masked-error scoping as run_query — a composed EXPLAIN still plans
	// against the connection's real data, so keep the adapter's driver error value-free here too
	// when this connection has active mask rules.
	set, err := s.cfg.MaskRules.MaskSetFor(args.ConnectionID)
	if err != nil {
		return nil, nil, err
	}
	var mk *maskset
	if !set.Empty() {
		mk = &set
	}

	resp, err := s.cfg.Query.Execute(ctx, adapterhost.ExecuteRequestWire{
		OpID:         uuid.NewString(),
		ConnectionID: args.ConnectionID,
		Path:         args.Path,
		Statements:   statements,
	})
	if err != nil {
		if mk != nil {
			return maskedToolError(err)
		}
		return toolError(err)
	}

	threshold := s.cfg.ExplainThreshold()
	plan, err := queryplan.FromPages(summary.Kind, resp.Pages, threshold)
	if err != nil {
		if errors.Is(err, queryplan.ErrTruncated) {
			return errResult("the query plan was too large to parse — try a narrower statement")
		}
		return errResult(fmt.Sprintf("could not parse the EXPLAIN result: %s", err.Error()))
	}
	if !args.IncludeRaw {
		plan.Raw = ""
	}
	return jsonResult(explainQueryResult{Plan: plan, ThresholdRows: threshold})
}
