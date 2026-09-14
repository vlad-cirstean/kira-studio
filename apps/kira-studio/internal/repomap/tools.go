package repomap

import (
	"context"
	"fmt"

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
func (s *Server) notReadyResult(err error) (*mcp.CallToolResult, any, error) {
	return errResult(fmt.Sprintf("repo-map index for %s: %s", s.root, err.Error()))
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

// resolve runs §6.1's locate against this Server's own graph/root, translating locateResult into
// one of: a Query to proceed with, or an already-final *mcp.CallToolResult (ambiguous candidates,
// an empty result rendered in the caller's own voice, or a caller-correctable error) — cutting
// every navigation handler down to "resolve, then call the one Graph method it owns."
func (s *Server) resolve(ctx context.Context, f locatorFields, emptyMsg func() string) (codegraph.Query, *mcp.CallToolResult, error) {
	res, err := locate(ctx, s.graph, s.root, f.args())
	if err != nil {
		return codegraph.Query{}, nil, err
	}
	switch {
	case res.msg != "":
		result, _, _ := errResult(res.msg)
		return codegraph.Query{}, result, nil
	case res.ambiguous != nil:
		src := s.sourceForTargets(ctx, f.OmitSource, res.ambiguous)
		result, _, _ := textResult(renderAmbiguous(f.Symbol, res.ambiguous, src))
		return codegraph.Query{}, result, nil
	case res.empty:
		result, _, _ := textResult(emptyMsg())
		return codegraph.Query{}, result, nil
	default:
		return res.query, nil, nil
	}
}

// --- find_definition ---

type findDefinitionArgs struct {
	locatorFields
}

func (s *Server) findDefinition(ctx context.Context, _ *mcp.CallToolRequest, in findDefinitionArgs) (*mcp.CallToolResult, any, error) {
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	q, early, err := s.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no symbol named %q found", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := s.graph.DefinitionOf(ctx, q)
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
	src := s.sourceForTargets(ctx, in.OmitSource, targets)
	return textResult(renderDefinitions(name, resolvedFrom, targets, src))
}

// --- find_references ---

type findReferencesArgs struct {
	locatorFields
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
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	q, early, err := s.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no references found for %q", in.Symbol) })
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

	refs, err := s.graph.ReferencesTo(ctx, q, codegraph.RefOpts{
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
	src := s.sourceForSites(ctx, in.OmitSource, refs.Sites)
	return textResult(renderReferences(name, refs.Sites, refs.Total, refs.Truncated, src))
}

// --- find_implementations ---

type findImplementationsArgs struct {
	locatorFields
}

func (s *Server) findImplementations(ctx context.Context, _ *mcp.CallToolRequest, in findImplementationsArgs) (*mcp.CallToolResult, any, error) {
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	q, early, err := s.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no implementations found for %q", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := s.graph.ImplementationsOf(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	name := q.Name
	if name == "" {
		name = in.Symbol
	}
	language := ""
	if file, ok, err := s.store.GetFile(ctx, s.repoID, q.Path); err == nil && ok {
		language = file.Language
	}
	src := s.sourceForTargets(ctx, in.OmitSource, targets)
	return textResult(renderImplementations(name, language, targets, src))
}

// --- read_symbol ---

type readSymbolArgs struct {
	locatorFields
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
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	q, early, err := s.resolve(ctx, in.locatorFields, func() string { return fmt.Sprintf("no symbol named %q found", in.Symbol) })
	if err != nil {
		return nil, nil, err
	}
	if early != nil {
		return early, nil, nil
	}
	targets, err := s.graph.DefinitionOf(ctx, q)
	if err != nil {
		return nil, nil, err
	}
	if len(targets) == 0 {
		name := q.Name
		if name == "" {
			name = in.Symbol
		}
		return textResult(fmt.Sprintf("no definitions found for %q", name))
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
		body := s.readSymbolRows(ctx, t.Path, startRow, cappedEnd, docLookback)
		if cappedEnd < endRow && body.Note == "" {
			body.Truncated = true
		}
		bodies[i] = body
	}
	return textResult(renderSymbolSource(targets, bodies))
}

// --- search_symbols ---

type searchSymbolsArgs struct {
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
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	if in.Query == "" {
		return errResult("query is required")
	}
	limit := clamp(in.Limit, searchSymbolsDefaultLimit, searchSymbolsMaxLimit)
	targets, err := s.graph.SearchSymbols(ctx, codegraph.SymbolSearch{
		Text: in.Query, Substring: in.Substring, Kinds: in.Kinds, Languages: in.Languages,
		PathPrefix: in.PathPrefix, Limit: limit,
	})
	if err != nil {
		return nil, nil, err
	}
	src := s.sourceForTargets(ctx, in.OmitSource, targets)
	return textResult(renderSymbolSearch(in.Query, targets, src))
}

// --- search_files ---

type searchFilesArgs struct {
	Query      string `json:"query" jsonschema:"Substring to search for in indexed file paths — not a fuzzy finder."`
	PathPrefix string `json:"pathPrefix,omitempty" jsonschema:"Restrict to files whose path starts with this."`
	Limit      int    `json:"limit,omitempty" jsonschema:"Max results. Default 30, max 200."`
}

const (
	searchFilesDefaultLimit = 30
	searchFilesMaxLimit     = 200
)

func (s *Server) searchFiles(ctx context.Context, _ *mcp.CallToolRequest, in searchFilesArgs) (*mcp.CallToolResult, any, error) {
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	if in.Query == "" {
		return errResult("query is required")
	}
	limit := clamp(in.Limit, searchFilesDefaultLimit, searchFilesMaxLimit)
	hits, err := s.graph.SearchFiles(ctx, codegraph.FileSearch{Text: in.Query, PathPrefix: in.PathPrefix, Limit: limit})
	if err != nil {
		return nil, nil, err
	}
	return textResult(renderFileSearch(in.Query, hits))
}

// --- outline_file ---

type outlineFileArgs struct {
	File string `json:"file" jsonschema:"Repository-relative (or absolute) path to the file."`
}

func (s *Server) outlineFile(ctx context.Context, _ *mcp.CallToolRequest, in outlineFileArgs) (*mcp.CallToolResult, any, error) {
	if err := s.waitReady(ctx); err != nil {
		return s.notReadyResult(err)
	}
	if in.File == "" {
		return errResult("file is required")
	}
	rel, err := relFile(s.root, in.File)
	if err != nil {
		return errResult(err.Error())
	}
	nodes, err := s.graph.Outline(ctx, rel)
	if err != nil {
		return nil, nil, err
	}
	return textResult(renderOutline(rel, nodes))
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
