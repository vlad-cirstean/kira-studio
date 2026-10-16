package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/kirathecat/kira-studio/internal/llmprompts"
	"github.com/kirathecat/kira-studio/internal/memory"
	"github.com/kirathecat/kira-studio/internal/memory/importer"
)

// Ingestor is the control side of the import runner: the importer.Engine.
type Ingestor interface {
	Create(importer.CreateArgs) (importer.Job, error)
	JobWithFacts(id string) (importer.JobDetail, error)
}

const maxIngestPaths = 100

type ingestInput struct {
	Paths     []string          `json:"paths"`
	Origin    string            `json:"origin"`
	SourceTag string            `json:"sourceTag,omitempty"`
	Scope     string            `json:"scope"`
	Project   string            `json:"project,omitempty"`
	Groups    []memory.GroupRef `json:"groups,omitempty"`
	WriteDoc  bool              `json:"writeDoc,omitempty"`
	Session   string            `json:"session,omitempty"`
}

type ingestOutput struct {
	JobID  string `json:"jobId"`
	State  string `json:"state"`
	Reason string `json:"reason"`
}

type ingestStatusInput struct {
	ID string `json:"id"`
}

func ingestSchema(src llmprompts.Source) *jsonschema.Schema {
	sch := llmprompts.InputSchema[ingestInput](src, llmprompts.MemoryToolIngestFiles.ID(), map[string]any{
		"paths":  llmprompts.MaxVars{Max: maxIngestPaths},
		"groups": llmprompts.MaxVars{Max: memory.MaxGroups - 1},
	})
	enum := func(prop *jsonschema.Schema, values ...string) {
		for _, v := range values {
			prop.Enum = append(prop.Enum, v)
		}
	}
	enum(sch.Properties["origin"], memory.OriginUser, memory.OriginAgent, memory.OriginExternal)
	enum(sch.Properties["scope"], memory.ScopeCompany, memory.ScopeProject, memory.ScopePersonal)
	enum(sch.Properties["groups"].Items.Properties["kind"], memory.GroupTask, memory.GroupThread)
	return sch
}

func addIngestTools(srv *mcp.Server, opts Options) {
	src := opts.Prompts
	f := false
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "ingest_files",
		Description: llmprompts.MemoryToolIngestFiles.Text(src, llmprompts.NoVars{}),
		InputSchema: ingestSchema(src),
		Annotations: &mcp.ToolAnnotations{DestructiveHint: &f, IdempotentHint: true},
	}, recovering("ingest_files", func(ctx context.Context, _ *mcp.CallToolRequest, in ingestInput) (*mcp.CallToolResult, ingestOutput, error) {
		return ingestFiles(ctx, opts, in)
	}))
	mcp.AddTool(srv, &mcp.Tool{
		Name:        "ingest_status",
		Description: llmprompts.MemoryToolIngestStatus.Text(src, llmprompts.NoVars{}),
		InputSchema: llmprompts.InputSchema[ingestStatusInput](src, llmprompts.MemoryToolIngestStatus.ID(), nil),
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true},
	}, recovering("ingest_status", func(_ context.Context, _ *mcp.CallToolRequest, in ingestStatusInput) (*mcp.CallToolResult, importer.JobDetail, error) {
		d, err := opts.Ingest.JobWithFacts(in.ID)
		if err != nil {
			return nil, importer.JobDetail{}, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderIngestStatus(d)}}}, d, nil
	}))
}

func badIngest(format string, a ...any) error {
	return fmt.Errorf("%w: %s", memory.ErrInvalid, fmt.Sprintf(format, a...))
}

func ingestFiles(ctx context.Context, opts Options, in ingestInput) (*mcp.CallToolResult, ingestOutput, error) {
	if n := len(in.Paths); n < 1 || n > maxIngestPaths {
		return nil, ingestOutput{}, badIngest("send 1 to %d paths", maxIngestPaths)
	}
	for _, p := range in.Paths {
		if !filepath.IsAbs(p) {
			return nil, ingestOutput{}, badIngest("path must be absolute: %s", p)
		}
		if _, err := os.Stat(p); err != nil {
			return nil, ingestOutput{}, badIngest("path not found or unreadable: %s", p)
		}
	}
	for _, g := range in.Groups {
		if g.Kind != memory.GroupTask && g.Kind != memory.GroupThread {
			return nil, ingestOutput{}, badIngest("group kind must be %q or %q", memory.GroupTask, memory.GroupThread)
		}
	}
	prov := importer.Provenance{Origin: in.Origin, SourceTag: strings.ToLower(strings.TrimSpace(in.SourceTag)),
		Scope: in.Scope, Project: strings.TrimSpace(in.Project), Session: in.Session}
	if prov.Session == "" {
		prov.Session = opts.SessionID
	}
	if prov.Scope == memory.ScopeProject && prov.Project == "" {
		key, err := projectOf(ctx, in.Paths[0], opts.Project)
		if err != nil {
			return nil, ingestOutput{}, badIngest("project of %s: %v", in.Paths[0], err)
		}
		prov.Project = key
	}
	job, err := opts.Ingest.Create(importer.CreateArgs{Paths: in.Paths, Channel: importer.ChannelMCP, Provenance: prov,
		Groups: in.Groups, AutoStart: true, WriteDoc: in.WriteDoc})
	if err != nil {
		return nil, ingestOutput{}, err
	}
	text := fmt.Sprintf("job %s %s\n", job.ID, job.State)
	if job.State == importer.JobAwaiting && job.Reason != "" {
		text += llmprompts.MemoryIngestAwaiting.Text(opts.Prompts, llmprompts.CauseVars{Cause: job.Reason})
	} else {
		text += llmprompts.MemoryIngestStarted.Text(opts.Prompts, llmprompts.NoVars{})
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, ingestOutput{JobID: job.ID, State: job.State, Reason: job.Reason}, nil
}

// projectOf is the project key of the first path's directory. Outside a git repository it falls
// back to the server's own project; an unusable key is an error, never a silent fallback.
func projectOf(ctx context.Context, first, fallback string) (string, error) {
	dir := first
	if info, err := os.Stat(first); err == nil && !info.IsDir() {
		dir = filepath.Dir(first)
	}
	key, err := memory.DetectProject(ctx, dir)
	if errors.Is(err, memory.ErrNotGitRepo) {
		return fallback, nil
	}
	return key, err
}

const maxStatusFiles = 100

// renderIngestStatus is one job line, then one line per file; fields repeat the grep-first grammar.
func renderIngestStatus(d importer.JobDetail) string {
	j := d.Job
	var b strings.Builder
	fmt.Fprintf(&b, "job %s %s files %d/%d chunks %d/%d added %d updated %d noop %d dropped %d unresolved %d failed %d skipped %d cost %.2f\n",
		j.ID, j.State, j.Progress.FilesDone, j.Progress.FilesTotal, j.Progress.ChunksDone, j.Progress.ChunksTotal,
		j.Totals.Added, j.Totals.Updated, j.Totals.Noop, j.Totals.Dropped, j.Totals.Unresolved, j.Totals.FailedFiles, j.Totals.SkippedFiles, j.CostUSD)
	if j.Reason != "" {
		fmt.Fprintf(&b, "reason: %s\n", oneLine(j.Reason))
	}
	for i, f := range d.Files {
		if i == maxStatusFiles {
			fmt.Fprintf(&b, "and %d more files\n", len(d.Files)-maxStatusFiles)
			break
		}
		fmt.Fprintf(&b, "%s %s %s", f.RelPath, f.State, f.Kind)
		if f.GroupID != "" {
			fmt.Fprintf(&b, " group %s", f.GroupID)
		}
		fmt.Fprintf(&b, " added %d updated %d noop %d verified %d dropped %d unresolved %d", f.Added, f.Updated, f.Noop, f.Verified, len(f.Dropped), len(f.Unresolved))
		if f.DocPath != "" {
			fmt.Fprintf(&b, " doc %s", f.DocPath)
		}
		if f.DocError != "" {
			fmt.Fprintf(&b, " doc-error: %s", oneLine(f.DocError))
		}
		if f.Reason != "" {
			fmt.Fprintf(&b, " reason: %s", oneLine(f.Reason))
		}
		b.WriteString("\n")
	}
	return b.String()
}
