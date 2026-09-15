package dbmcp

import (
	"context"

	"github.com/google/uuid"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- list_connections (§4.1) ---

type listConnectionsArgs struct{}

// listConnections returns every connection with mcp_enabled true — deny by default (§6.1): a
// connection the user has not exposed is absent entirely, not listed-and-denied, since its
// existence is not the AI client's business.
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
		view := connectionView{ID: c.ID, Name: c.Name, Kind: c.Kind, ReadOnly: c.ReadOnly, Status: state.Status}
		if state.ServerVersion != nil {
			view.ServerVersion = state.ServerVersion
		}
		if caps, ok := capsOf(state); ok {
			view.Capabilities = &connectionCapabilities{Query: caps.SQL, Describe: caps.Describe, SchemaColumns: caps.SchemaColumns}
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
	if _, err := s.resolveEnabled(args.ConnectionID); err != nil {
		return errResult(err.Error())
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
	if _, err := s.resolveEnabled(args.ConnectionID); err != nil {
		return errResult(err.Error())
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
	if _, err := s.resolveEnabled(args.ConnectionID); err != nil {
		return errResult(err.Error())
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
func (s *Server) runQuery(ctx context.Context, _ *mcp.CallToolRequest, args runQueryArgs) (*mcp.CallToolResult, any, error) {
	if _, err := s.resolveEnabled(args.ConnectionID); err != nil {
		return errResult(err.Error())
	}

	maxRows := args.MaxRows
	if maxRows <= 0 {
		maxRows = runQueryDefaultMaxRows
	}
	if maxRows > runQueryMaxMaxRows {
		maxRows = runQueryMaxMaxRows
	}

	if _, err := s.connectForQuery(args.ConnectionID); err != nil {
		return toolError(err)
	}

	resp, err := s.cfg.Query.Execute(ctx, adapterhost.ExecuteRequestWire{
		OpID:         uuid.NewString(),
		ConnectionID: args.ConnectionID,
		Path:         args.Path,
		Statements:   []string{args.SQL},
	})
	if err != nil {
		return toolError(err)
	}
	if len(resp.Pages) == 0 {
		return jsonResult(map[string]any{"kind": "empty", "rowCount": 0, "returned": 0})
	}
	rendered, err := renderPage(resp.Pages[0], maxRows)
	if err != nil {
		return nil, nil, err
	}
	return jsonResult(rendered)
}
