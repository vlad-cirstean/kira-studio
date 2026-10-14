package mcpserver

import (
	"context"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

// Distiller is the read-only core of the distill tool: importer.Distiller.
type Distiller interface {
	Distill(context.Context, importer.DistillRequest) (importer.DistillResult, error)
}

type distillInput struct {
	Text string `json:"text,omitempty"`
	Path string `json:"path,omitempty"`
	Mode string `json:"mode,omitempty"`
}

// distillOutput is the structured result: the lines only.
type distillOutput struct {
	Lines []string `json:"lines"`
}

func distillSchema(src llmprompts.Source) *jsonschema.Schema {
	sch := llmprompts.InputSchema[distillInput](src, llmprompts.MemoryToolDistill.ID(), map[string]any{
		"text": llmprompts.MaxVars{Max: importer.MaxDistillRunes},
	})
	sch.Properties["mode"].Enum = []any{importer.ModeFacts, importer.ModeInstructions}
	return sch
}

func addDistillTool(srv *mcp.Server, opts Options) {
	src := opts.Prompts
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "distill",
		Description: llmprompts.MemoryToolDistill.Text(src, llmprompts.NoVars{}),
		InputSchema: distillSchema(src),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("distill", func(ctx context.Context, _ *mcp.CallToolRequest, in distillInput) (*mcp.CallToolResult, distillOutput, error) {
		res, err := opts.Distill.Distill(ctx, importer.DistillRequest{Text: in.Text, Path: in.Path, Mode: in.Mode})
		if err != nil {
			return nil, distillOutput{}, err
		}
		lines := res.Lines
		if lines == nil {
			lines = []string{}
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: strings.Join(lines, "\n")}}}, distillOutput{Lines: lines}, nil
	}))
}
