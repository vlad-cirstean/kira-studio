package repomap

import (
	"context"
	"fmt"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// textResult wraps text as a successful *mcp.CallToolResult (§6.3: text only, no structured
// content — Out is any everywhere in this file, so the SDK emits no output schema and the second
// return value is always nil).
func textResult(text string) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}}, nil, nil
}

// errResult wraps text as a caller-correctable failure (§6.3: "IsError: true for caller-correctable
// conditions... A Go error only for a genuine internal fault").
func errResult(text string) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
		IsError: true,
	}, nil, nil
}

// notReadyResult is §4.2's own "never an empty result while the index is still building" message.
func (inst *repoInstance) notReadyResult(err error) (*mcp.CallToolResult, any, error) {
	return errResult(fmt.Sprintf("repo-map index for %s: %s", inst.root, err.Error()))
}

// indexNotice is P67f §2.4: W1's own surfacing (a failed initial or later full Sync leaves the
// gate open on a partial index, with nowhere else a caller could see it). Empty — the normal case —
// costs a caller nothing.
func (inst *repoInstance) indexNotice() string {
	st := inst.idx.SyncState()
	if st.LastErr == nil {
		return ""
	}
	return fmt.Sprintf("index degraded: the last full sync of %s failed (%s); results may be incomplete.", inst.root, st.LastErr)
}

// text is textResult with §2.4's degraded notice prepended when one stands — on every response
// while degraded, not only empty ones, since a partial index also returns incomplete non-empty
// answers that would otherwise read as complete.
func (inst *repoInstance) text(body string) (*mcp.CallToolResult, any, error) {
	if n := inst.indexNotice(); n != "" {
		body = n + "\n" + body
	}
	return textResult(body)
}

// errText is errResult with §2.4's degraded notice prepended, mirroring text — for the rare
// errResult answer that is itself an index-derived claim (P68b's absent-file message), so a
// degraded or partial index never presents "no indexed file at X" as a settled fact. Every other
// errResult caller is pure argument validation, where the index state is irrelevant.
func (inst *repoInstance) errText(body string) (*mcp.CallToolResult, any, error) {
	if n := inst.indexNotice(); n != "" {
		body = n + "\n" + body
	}
	return errResult(body)
}

// repoField is embedded in every navigation/search tool's own input struct (P67d §3.4): which
// attached repository to query. Omit when only one is attached — Server.pick (attach.go) resolves
// the rest.
type repoField struct {
	Repo string `json:"repo,omitempty" jsonschema:"Which attached repository to query. Omit when only one is attached. Call list_repos to see the names."`
}

// locatorFields is embedded in every navigation tool's own input struct — §6.1's shared file/
// line/column/symbol trio, one struct tag source (jsonschema derives from these) rather than four
// separately-typed copies.
type locatorFields struct {
	File   string `json:"file,omitempty" jsonschema:"Repository-relative (or absolute) path to the file. Combine with line, or with symbol, to disambiguate; omit and give symbol alone to search by name."`
	Line   int    `json:"line,omitempty" jsonschema:"1-based line number within file."`
	Column int    `json:"column,omitempty" jsonschema:"1-based BYTE column within line (not a character or UTF-16 column). Defaults to 1."`
	Symbol string `json:"symbol,omitempty" jsonschema:"Symbol name — a hint alongside file, or, alone, resolved by searching the index for an exact name match."`
	// Languages is P64 §2.5: narrows a symbol-alone lookup (no effect when file is given) — the
	// same field name/type/semantics as search_symbols' own Languages, so a caller that resolves
	// an ambiguity there already knows the vocabulary here.
	Languages []string `json:"languages,omitempty" jsonschema:"Restrict a symbol-alone lookup to these languages, e.g. to pick the TypeScript side of a cross-language name collision without a second call. No effect when file is given."`
	// OmitSource is C8 plan D8's opt-out: zero value (false) means "include" — every hit keeps
	// its own source-line continuation.
	OmitSource bool `json:"omitSource,omitempty" jsonschema:"Omit the source line printed under each hit. Default false — each hit is followed by its own line of code, indented."`
}

func (f locatorFields) args() locateArgs {
	return locateArgs{File: f.File, Line: f.Line, Column: f.Column, Symbol: f.Symbol, Languages: f.Languages}
}

// resolve runs §6.1's locate against this instance's own graph/root, translating locateResult into
// one of: a Query to proceed with, or an already-final *mcp.CallToolResult (ambiguous candidates,
// an empty result rendered in the caller's own voice, or a caller-correctable error) — cutting
// every navigation handler down to "resolve, then call the one Graph method it owns."
func (inst *repoInstance) resolve(ctx context.Context, f locatorFields, emptyMsg func() string) (codegraph.Query, *mcp.CallToolResult, error) {
	res, err := locate(ctx, inst.graph, inst.root, f.args())
	if err != nil {
		return codegraph.Query{}, nil, err
	}
	switch {
	case res.msg != "":
		result, _, _ := errResult(res.msg)
		return codegraph.Query{}, result, nil
	case res.ambiguous != nil:
		src := inst.sourceForTargets(ctx, f.OmitSource, res.ambiguous)
		result, _, _ := inst.text(renderAmbiguous(f.Symbol, res.ambiguous, src))
		return codegraph.Query{}, result, nil
	case res.empty:
		result, _, _ := inst.text(emptyMsg())
		return codegraph.Query{}, result, nil
	default:
		return res.query, nil, nil
	}
}

// --- find_definition ---

type findDefinitionArgs struct {
	locatorFields
	repoField
}

func (s *Server) findDefinition(ctx context.Context, _ *mcp.CallToolRequest, in findDefinitionArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	q, early, err := inst.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no symbol named %q found", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := inst.graph.DefinitionOf(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	name := q.Name
	if name == "" && len(targets) > 0 {
		name = targets[0].Name
	}
	resolvedFrom := ""
	if q.Point != nil {
		resolvedFrom = position(q.Path, codegraph.Point{Row: q.Point.Row, Column: q.Point.Column})
	}
	src := inst.sourceForTargets(ctx, in.OmitSource, targets)
	return inst.text(renderDefinitions(name, resolvedFrom, targets, src))
}

// --- find_references ---

type findReferencesArgs struct {
	locatorFields
	repoField
	Mode              string   `json:"mode,omitempty" jsonschema:"'resolved' (default, precise — runs the resolver) or 'name_only' (cheaper, unresolved — every reference sharing the name, grep-shaped recall over precision)."`
	Kinds             []string `json:"kinds,omitempty" jsonschema:"Restrict to these reference kinds, e.g. call, import."`
	IncludeDefinition bool     `json:"includeDefinition,omitempty" jsonschema:"Include the definition's own location as a Site alongside its uses."`
	Limit             int      `json:"limit,omitempty" jsonschema:"Max references returned. Default 100, max 500."`
}

const (
	findReferencesDefaultLimit = 100
	findReferencesMaxLimit     = 500
)

func (s *Server) findReferences(ctx context.Context, _ *mcp.CallToolRequest, in findReferencesArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	q, early, err := inst.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no references found for %q", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}

	mode := codegraph.Resolved
	if in.Mode == string(codegraph.NameOnly) {
		mode = codegraph.NameOnly
	}
	limit := in.Limit
	if limit <= 0 {
		limit = findReferencesDefaultLimit
	}
	if limit > findReferencesMaxLimit {
		limit = findReferencesMaxLimit
	}

	refs, err := inst.graph.ReferencesTo(ctx, q, codegraph.RefOpts{
		Mode: mode, Kinds: in.Kinds, IncludeDefinition: in.IncludeDefinition, Limit: limit,
	})
	if err != nil {
		return nil, nil, err
	}
	name := q.Name
	if name == "" && in.Symbol != "" {
		name = in.Symbol
	}
	if name == "" && len(refs.Sites) > 0 {
		name = refs.Sites[0].Name
	}
	src := inst.sourceForSites(ctx, in.OmitSource, refs.Sites)
	return inst.text(renderReferences(name, refs.Sites, refs.Total, refs.Truncated, src))
}

// --- find_implementations ---

type findImplementationsArgs struct {
	locatorFields
	repoField
}

func (s *Server) findImplementations(ctx context.Context, _ *mcp.CallToolRequest, in findImplementationsArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	q, early, err := inst.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no implementations found for %q", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := inst.graph.ImplementationsOf(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	name := q.Name
	if name == "" {
		name = in.Symbol
	}
	language := ""
	if file, ok, err := inst.store.GetFile(ctx, inst.repoID, q.Path); err == nil && ok {
		language = file.Language
	}
	src := inst.sourceForTargets(ctx, in.OmitSource, targets)
	return inst.text(renderImplementations(name, language, targets, src))
}

// --- read_symbol ---

type readSymbolArgs struct {
	locatorFields
	repoField
	OmitDoc  bool `json:"omitDoc,omitempty" jsonschema:"Omit the doc comment preceding the declaration. Default false — included when present."`
	MaxLines int  `json:"maxLines,omitempty" jsonschema:"Max body lines returned per target. Default 400, max 1000."`
}

const (
	readSymbolDefaultMaxLines = 400
	readSymbolMaxMaxLines     = 1000
	// readSymbolDocLookback is P64 §3.4's own 40-line half of the doc-comment walk's stop
	// condition — the window readSymbolRows fetches before docCommentLines trims it down.
	readSymbolDocLookback = 40
)

func (s *Server) readSymbol(ctx context.Context, _ *mcp.CallToolRequest, in readSymbolArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	q, early, err := inst.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no symbol named %q found", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := inst.graph.DefinitionOf(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	if len(targets) == 0 {
		name := q.Name
		if name == "" {
			name = in.Symbol
		}
		return inst.text(fmt.Sprintf("no definitions found for %q", name))
	}

	maxLines := clamp(in.MaxLines, readSymbolDefaultMaxLines, readSymbolMaxMaxLines)
	docLookback := readSymbolDocLookback
	if in.OmitDoc {
		docLookback = 0
	}
	bodies := make([]symbolSource, len(targets))
	for i, t := range targets {
		startRow, endRow := t.Span.Start.Row, t.Span.End.Row
		cappedEnd := endRow
		if fullLines := endRow - startRow + 1; fullLines > maxLines {
			cappedEnd = startRow + maxLines - 1
		}
		body := inst.readSymbolRows(ctx, t.Path, startRow, cappedEnd, docLookback)
		if cappedEnd < endRow && body.Note == "" {
			body.Truncated = true
		}
		bodies[i] = body
	}
	return inst.text(renderSymbolSource(targets, bodies))
}

// --- search_symbols ---

type searchSymbolsArgs struct {
	repoField
	Query      string   `json:"query" jsonschema:"Symbol name to search for (prefix match by default)."`
	Substring  bool     `json:"substring,omitempty" jsonschema:"Match query anywhere in the name, not just as a prefix."`
	Kinds      []string `json:"kinds,omitempty" jsonschema:"Restrict to these symbol kinds, e.g. function, method, class."`
	Languages  []string `json:"languages,omitempty" jsonschema:"Restrict to these languages."`
	PathPrefix string   `json:"pathPrefix,omitempty" jsonschema:"Restrict to files whose path starts with this — narrows a monorepo's several same-language trees that languages alone can't separate."`
	Limit      int      `json:"limit,omitempty" jsonschema:"Max results. Default 30, max 200."`
	OmitSource bool     `json:"omitSource,omitempty" jsonschema:"Omit the source line printed under each hit. Default false — each hit is followed by its own line of code, indented."`
}

const (
	searchSymbolsDefaultLimit = 30
	searchSymbolsMaxLimit     = 200
)

func (s *Server) searchSymbols(ctx context.Context, _ *mcp.CallToolRequest, in searchSymbolsArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	if in.Query == "" {
		return errResult("query is required")
	}
	limit := clamp(in.Limit, searchSymbolsDefaultLimit, searchSymbolsMaxLimit)
	targets, err := inst.graph.SearchSymbols(ctx, codegraph.SymbolSearch{
		Text: in.Query, Substring: in.Substring, Kinds: in.Kinds, Languages: in.Languages,
		PathPrefix: in.PathPrefix, Limit: limit,
	})
	if err != nil {
		return nil, nil, err
	}
	src := inst.sourceForTargets(ctx, in.OmitSource, targets)
	return inst.text(renderSymbolSearch(in.Query, targets, src))
}

// --- search_files ---

type searchFilesArgs struct {
	repoField
	Query      string `json:"query" jsonschema:"Substring to search for in indexed file paths — not a fuzzy finder."`
	PathPrefix string `json:"pathPrefix,omitempty" jsonschema:"Restrict to files whose path starts with this."`
	Limit      int    `json:"limit,omitempty" jsonschema:"Max results. Default 30, max 200."`
}

const (
	searchFilesDefaultLimit = 30
	searchFilesMaxLimit     = 200
)

func (s *Server) searchFiles(ctx context.Context, _ *mcp.CallToolRequest, in searchFilesArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	if in.Query == "" {
		return errResult("query is required")
	}
	limit := clamp(in.Limit, searchFilesDefaultLimit, searchFilesMaxLimit)
	hits, err := inst.graph.SearchFiles(ctx, codegraph.FileSearch{Text: in.Query, PathPrefix: in.PathPrefix, Limit: limit})
	if err != nil {
		return nil, nil, err
	}
	return inst.text(renderFileSearch(in.Query, hits))
}

// --- outline_file ---

type outlineFileArgs struct {
	repoField
	File string `json:"file" jsonschema:"Repository-relative (or absolute) path to the file."`
}

func (s *Server) outlineFile(ctx context.Context, _ *mcp.CallToolRequest, in outlineFileArgs) (*mcp.CallToolResult, any, error) {
	inst, early := s.pick(in.Repo)
	if early != nil {
		return early, nil, nil
	}
	defer inst.inflight.Done()
	if err := inst.waitReady(ctx); err != nil {
		return inst.notReadyResult(err)
	}
	if in.File == "" {
		return errResult("file is required")
	}
	rel, err := relFile(inst.root, in.File)
	if err != nil {
		return errResult(err.Error())
	}
	nodes, indexed, err := inst.graph.Outline(ctx, rel)
	if err != nil {
		return nil, nil, err
	}
	if !indexed {
		return inst.errText(absentFileReason(inst.root, rel))
	}
	return inst.text(renderOutline(rel, nodes))
}

// --- list_repos ---

type listReposArgs struct{}

// listRepos is the eighth tool (P67d §3.5): dynamic `instructions` isn't an option (fixed at
// mcp.NewServer time, server.go), while the attached set changes while the server runs, so this
// is a cheap per-call listing instead. An empty list renders the identical sentence pick's own
// "none attached" case uses.
func (s *Server) listRepos(_ context.Context, _ *mcp.CallToolRequest, _ listReposArgs) (*mcp.CallToolResult, any, error) {
	repos := s.Repos() // already attach order
	if len(repos) == 0 {
		return textResult("no repositories are shared with this server — grant one in Kira Studio's Settings → Code intelligence.")
	}
	var b strings.Builder
	for _, r := range repos {
		state := "ready"
		switch {
		case r.Degraded != "":
			state = "degraded: " + r.Degraded
		case !r.Ready:
			state = "indexing"
		}
		fmt.Fprintf(&b, "%s\t%s\t%s\n", r.Key, r.Root, state)
	}
	return textResult(strings.TrimRight(b.String(), "\n"))
}

func clamp(v, def, max int) int {
	if v <= 0 {
		return def
	}
	if v > max {
		return max
	}
	return v
}
