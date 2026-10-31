package agentmcp

import (
	"context"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// ToolCall identifies one tools/call for Options.OnToolCall. Args is the raw arguments JSON.
type ToolCall struct {
	Tool, RunID, TaskID string
	Args                []byte
}

// recordCalls adds the one receiving middleware that reports every tools/call, so no tool wraps
// itself.
func (s *Server) recordCalls(srv *mcp.Server) {
	if s.onCall == nil {
		return
	}
	srv.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			cr, ok := req.(*mcp.CallToolRequest)
			if method != "tools/call" || !ok || cr.Params == nil {
				return next(ctx, method, req)
			}
			var g Grant
			if cr.Extra != nil {
				g, _ = s.grant(cr.Extra.TokenInfo)
			}
			ctx, done := s.onCall(ctx, ToolCall{Tool: cr.Params.Name, Args: cr.Params.Arguments, RunID: g.RunID, TaskID: g.TaskID})
			res, err := next(ctx, method, req)
			isErr, text := false, ""
			if tr, ok := res.(*mcp.CallToolResult); ok && tr != nil {
				isErr = tr.IsError
				var b strings.Builder
				for _, c := range tr.Content {
					if tc, ok := c.(*mcp.TextContent); ok {
						b.WriteString(tc.Text)
					}
				}
				text = b.String()
			}
			done(isErr, text, err)
			return res, err
		}
	})
}
