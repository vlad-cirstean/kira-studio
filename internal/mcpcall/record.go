// Package mcpcall records every tools/call of an MCP server through one receiving middleware.
package mcpcall

import (
	"context"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Call identifies one tools/call. Args is the raw arguments JSON.
type Call struct {
	Tool  string
	Args  []byte
	Extra *mcp.RequestExtra
}

// Hook runs before a tool call. It returns the ctx the handler runs under and a done func that
// receives the verdict: the result's IsError flag and joined text, and the handler error.
type Hook func(ctx context.Context, c Call) (context.Context, func(isError bool, text string, err error))

// Record adds the one middleware that reports every tools/call to hook, so no tool wraps itself.
// A nil hook adds nothing.
func Record(srv *mcp.Server, hook Hook) {
	if hook == nil {
		return
	}
	srv.AddReceivingMiddleware(func(next mcp.MethodHandler) mcp.MethodHandler {
		return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
			cr, ok := req.(*mcp.CallToolRequest)
			if method != "tools/call" || !ok || cr.Params == nil {
				return next(ctx, method, req)
			}
			ctx, done := hook(ctx, Call{Tool: cr.Params.Name, Args: cr.Params.Arguments, Extra: cr.Extra})
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
