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

// Distiller is the no-store core of ingest_files with distill true: importer.Distiller.
type Distiller interface {
	Distill(context.Context, importer.DistillRequest) (importer.DistillResult, error)
}

// Ingestor is the control side of the import runner: the importer.Engine.
type Ingestor interface {
	Create(importer.CreateArgs) (importer.Job, error)
	JobWithFacts(id string) (importer.JobDetail, error)
}

const maxIngestPaths = 100

// ingestInput holds no required property: storing needs paths, origin and scope, distilling needs
// text or one path, and Go checks which applies.
type ingestInput struct {
	Paths     []string          `json:"paths,omitempty"`
	Text      string            `json:"text,omitempty"`
	Distill   bool              `json:"distill,omitempty"`
	Origin    string            `json:"origin,omitempty"`
	SourceTag string            `json:"sourceTag,omitempty"`
	Scope     string            `json:"scope,omitempty"`
	Project   string            `json:"project,omitempty"`
	Groups    []memory.GroupRef `json:"groups,omitempty"`
	WriteDoc  bool              `json:"writeDoc,omitempty"`
	Session   string            `json:"session,omitempty"`
}

// ingestOutput is a job (jobId, state, reason) when storing, or the merged lines (lines, unresolved,
// costUsd) when distilling.
type ingestOutput struct {
	JobID      string                    `json:"jobId,omitempty"`
	State      string                    `json:"state,omitempty"`
	Reason     string                    `json:"reason,omitempty"`
	Lines      []importer.Line           `json:"lines,omitempty"`
	Unresolved []importer.UnresolvedFact `json:"unresolved,omitempty"`
	CostUSD    float64                   `json:"costUsd,omitempty"`
}

type ingestStatusInput struct {
	ID string `json:"id"`
}

func ingestSchema(src llmprompts.Source) *jsonschema.Schema {
	sch := llmprompts.InputSchema[ingestInput](src, llmprompts.MemoryToolIngestFiles.ID(), map[string]any{
		"paths":  llmprompts.MaxVars{Max: maxIngestPaths},
		"text":   llmprompts.MaxVars{Max: importer.MaxDistillRunes},
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
	if in.Distill {
		return distillInput(ctx, opts, in)
	}
	switch {
	case in.Text != "":
		return nil, ingestOutput{}, badIngest("to store text call store_memory, or save it to a file and ingest that")
	case in.Origin == "" || in.Scope == "":
		return nil, ingestOutput{}, badIngest("origin and scope are required")
	}
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

// distillInput runs ingest_files with distill true: text or one file in, merged lines out, nothing
// stored and no job created.
func distillInput(ctx context.Context, opts Options, in ingestInput) (*mcp.CallToolResult, ingestOutput, error) {
	if opts.Distill == nil {
		return nil, ingestOutput{}, badIngest("distill is not available in this server")
	}
	if in.Origin != "" || in.SourceTag != "" || in.Scope != "" || in.Project != "" || len(in.Groups) > 0 || in.WriteDoc || in.Session != "" {
		return nil, ingestOutput{}, badIngest("distill takes text or one file path only; it stores nothing")
	}
	req := importer.DistillRequest{Text: in.Text}
	switch {
	case (in.Text != "") == (len(in.Paths) > 0):
		return nil, ingestOutput{}, badIngest("distill takes exactly one of text and one file path")
	case len(in.Paths) > 1:
		return nil, ingestOutput{}, badIngest("distill takes one file path, got %d", len(in.Paths))
	case len(in.Paths) == 1:
		p := in.Paths[0]
		if !filepath.IsAbs(p) {
			return nil, ingestOutput{}, badIngest("path must be absolute: %s", p)
		}
		info, err := os.Stat(p)
		switch {
		case err != nil:
			return nil, ingestOutput{}, badIngest("path not found or unreadable: %s", p)
		case info.IsDir():
			return nil, ingestOutput{}, badIngest("distill takes a file, not a folder: %s", p)
		}
		req.Path = p
	}
	res, err := opts.Distill.Distill(ctx, req)
	if err != nil {
		return nil, ingestOutput{}, err
	}
	out := ingestOutput{Lines: res.Lines, Unresolved: res.Unresolved, CostUSD: res.CostUSD}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: renderDistill(res)}}}, out, nil
}

// renderDistill is the lines in source order, one per line with no kind prefix, then a blank line and
// one "unresolved: <fact> | <questions>" line per fact the input leaves open.
func renderDistill(res importer.DistillResult) string {
	lines := make([]string, len(res.Lines))
	for i, l := range res.Lines {
		lines[i] = l.Text
	}
	text := strings.Join(lines, "\n")
	if len(res.Unresolved) == 0 {
		return text
	}
	notes := make([]string, len(res.Unresolved))
	for i, u := range res.Unresolved {
		notes[i] = fmt.Sprintf("unresolved: %s | %s", oneLine(u.Fact), oneLine(strings.Join(u.Questions, " ")))
	}
	if text == "" {
		return strings.Join(notes, "\n")
	}
	return text + "\n\n" + strings.Join(notes, "\n")
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
