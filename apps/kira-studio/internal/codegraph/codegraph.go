// Package codegraph answers go-to-definition, go-to-implementation and find-references over
// internal/codeindex's stored rows (docs/v1.5/plans/C2-code-graph.md). The graph is computed live
// from symbol/reference rows on every call — no edge table, ever (§3: an edge table is derived
// cross-file state, and keeping it correct under a repository-wide fallback would mean
// recomputing far more than the changed file on every save).
//
// Graph is constructed from a *codeindex.Store plus a repo_id, never from a codeindex.Index — a
// C3 MCP server process has no gitclient.Runner and no watcher, and opens the very same
// codeindex.db a running Studio instance writes (WAL is what makes that safe). This package never
// imports database/sql: every SQL statement this phase needs lives in codeindex/read.go (D1).
package codegraph

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// Point is a zero-based row/column position — codeparse's own convention (Column is a byte
// column; a UTF-16 conversion, if a caller needs one, is that caller's job, same as codeparse).
type Point struct {
	Row    int
	Column int
}

// Span is a byte range plus its row/column endpoints. For a Symbol row both endpoints are exact
// (the schema stores start and end row/column). For a Reference row only the start point is
// stored (§3's migration adds the identifier's own range, not a second end point) — End is then
// derived assuming the span stays on Start's own line, exact for a name span (an identifier never
// spans a line in any language in scope) and a reasonable approximation for a reference's whole
// node span when that span is itself single-line, which every kind in this phase's scope
// overwhelmingly is. StartByte/EndByte are always exact either way; a caller already holding the
// file's own content (C5/Monaco) can re-derive a precise multi-line end point from those two bytes
// directly.
type Span struct {
	StartByte, EndByte int
	Start, End         Point
}

// Confidence is §4.2/§5.1's three-value scale: how many candidates survived resolution, and from
// which tier.
type Confidence string

const (
	// Exact is one candidate, inside the reference's own file or scope unit.
	Exact Confidence = "exact"
	// Scoped is several candidates, all inside the scope unit.
	Scoped Confidence = "scoped"
	// RepoWide is no scoped candidate — a repository-wide name match.
	RepoWide Confidence = "repoWide"
)

// Target is one definition — the result shape for DefinitionOf, ImplementationsOf and search.
type Target struct {
	SymbolID   int64
	Path       string // repository-relative, git's own bytes
	Language   string
	Kind, Name string
	Container  string // parent chain, joined with "."
	Span       Span   // the whole definition
	NameSpan   Span   // the identifier: what a jump targets
	Rule       string // which rule placed it, e.g. "sameFile.enclosing", "samePackage"
	Confidence Confidence
}

// Site is one reference occurrence — ReferencesTo's own result shape.
type Site struct {
	Path, Language string
	Kind, Name     string
	Span, NameSpan Span
	Enclosing      string // innermost enclosing definition's name, "" at file top level
	// Confidence is this site's own resolved confidence (§7.1): the group's own resolveName result
	// in Resolved mode, Exact for an IncludeDefinition site (the definition's own name span is not
	// a guess), RepoWide for a NameOnly site (nothing was resolved, so a repository-wide name match
	// is literally what the row is).
	Confidence Confidence
}

// Query names a position (or a bare name) to resolve against. Byte is -1 when unset; Point is an
// alternative to Byte; Name is required when neither is set, and is otherwise the caller's
// word-under-cursor hint for §7's template-fallback path.
type Query struct {
	Path  string
	Byte  int
	Point *Point
	Name  string
}

// RefMode selects ReferencesTo's own cost/precision tradeoff (§5.5).
type RefMode string

const (
	// Resolved runs the resolver for every candidate reference and keeps the ones whose winning
	// target set intersects the query's own target — precise, memoized per (directory, name, kind).
	Resolved RefMode = "resolved"
	// NameOnly returns every reference row sharing the query's name, unresolved — cheaper, and the
	// right mode for a grep-shaped caller that wants recall over precision.
	NameOnly RefMode = "nameOnly"
)

// RefOpts configures ReferencesTo.
type RefOpts struct {
	Mode              RefMode // default Resolved
	Kinds             []string
	IncludeDefinition bool
	Limit             int // default 500, max 2000
}

// Refs is ReferencesTo's own result. Unattributed counts occurrences of the query's own name whose
// referring group (directory, kind, language) resolved RepoWide with more than one candidate —
// name-based resolution genuinely cannot tell which of several repository-wide definitions such an
// occurrence means, so it is reported, not silently folded into Sites under one of them (P69d §A.4
// commit 2).
type Refs struct {
	Sites        []Site
	Total        int
	Truncated    bool
	Unattributed int
}

// SymbolSearch configures SearchSymbols.
type SymbolSearch struct {
	Text      string // prefix match by default; Substring widens it
	Substring bool
	Kinds     []string
	Languages []string
	// PathPrefix additionally narrows to files whose path starts with this (P64 §4.1) — Languages
	// cannot separate a monorepo's several same-language trees; empty means no filter.
	PathPrefix string
	Limit      int // default 50, max 200
}

// FileSearch configures SearchFiles — a substring match over a repository's own file paths.
type FileSearch struct {
	Text string
	// PathPrefix additionally narrows to paths starting with this (P64 §4.1) — empty means no
	// filter.
	PathPrefix string
	Limit      int // default 50, max 200
}

// FileHit is one SearchFiles result.
type FileHit struct {
	Path      string
	Language  string
	LineCount int // P64 §4.2 — printed by renderFileSearch, previously read and discarded
}

// Node is one Outline entry — a file's definition tree without the file's bytes, the
// token-reduction primitive this chapter's own motivation names.
type Node struct {
	SymbolID int64
	Kind     string
	Name     string
	Span     Span
	NameSpan Span
	Children []Node
}

// Graph is one repository's own view over a shared *codeindex.Store. It holds no mutable state:
// every method is safe for concurrent use, and takes the caller's context.Context through to
// database/sql. The shared Store's own connection pool (SetMaxOpenConns(4)) is what bounds
// parallelism, unchanged (§8).
type Graph struct {
	store  *codeindex.Store
	repoID string
}

// New returns a Graph over store, scoped to repoID. No root path, no gitclient.Runner, no file
// reads: every position in and out is derived from stored rows (§4.1).
func New(store *codeindex.Store, repoID string) *Graph {
	return &Graph{store: store, repoID: repoID}
}

// containerChain walks sym's ParentID chain to its root, returning each ancestor's own Name
// joined outer-to-inner with ".". Used wherever a Target needs its own Container and only sym
// itself (not its whole file's symbol set) is already in hand — resolve.go and references.go's
// own cross-file candidates. position.go and outline.go, which already hold a file's complete
// symbol set, build the same chain locally instead of round-tripping per ancestor.
func (g *Graph) containerChain(ctx context.Context, sym codeindex.SymbolRow) (string, error) {
	var chain []string
	cur := sym
	for cur.ParentID != nil {
		parent, ok, err := g.store.SymbolByID(ctx, *cur.ParentID)
		if err != nil {
			return "", err
		}
		if !ok {
			break
		}
		chain = append(chain, parent.Name)
		cur = parent
	}
	return joinReversed(chain), nil
}

func joinReversed(chain []string) string {
	if len(chain) == 0 {
		return ""
	}
	out := make([]string, len(chain))
	for i, name := range chain {
		out[len(chain)-1-i] = name
	}
	return joinDot(out)
}

func joinDot(parts []string) string {
	if len(parts) == 0 {
		return ""
	}
	out := parts[0]
	for _, p := range parts[1:] {
		out += "." + p
	}
	return out
}

// targetFromSymbol builds a Target for sym, whose own file is file — the shared shape resolve.go,
// references.go and search.go all build a Target through.
func (g *Graph) targetFromSymbol(ctx context.Context, sym codeindex.SymbolRow, file codeindex.FileRow, rule string, confidence Confidence) (Target, error) {
	container, err := g.containerChain(ctx, sym)
	if err != nil {
		return Target{}, err
	}
	return Target{
		SymbolID:   sym.ID,
		Path:       file.Path,
		Language:   file.Language,
		Kind:       sym.Kind,
		Name:       sym.Name,
		Container:  container,
		Span:       symbolSpan(sym),
		NameSpan:   symbolNameSpan(sym),
		Rule:       rule,
		Confidence: confidence,
	}, nil
}
