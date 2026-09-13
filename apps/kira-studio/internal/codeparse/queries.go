package codeparse

import (
	"embed"
	"fmt"
	"sync"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

//go:embed queries/java/tags.scm queries/python/tags.scm queries/javascript/tags.scm queries/typescript/tags.scm queries/go/tags.scm queries/rust/tags.scm
var queryFS embed.FS

// QuerySource is one vendored tags.scm's provenance (§4.1): a future license or version audit
// reads this table instead of re-deriving it from go.mod and file paths.
type QuerySource struct {
	Language      ID
	UpstreamModule string
	UpstreamPath   string
	ModuleVersion  string
}

// Provenance lists every vendored query (§4.1/NOTICES.md). TSX has no row of its own — it
// compiles TypeScript's tags.scm against the TSX language (§3.1: "TypeScript and TSX" share one
// upstream grammar module), never a second query file.
var Provenance = []QuerySource{
	{Java, "github.com/tree-sitter/tree-sitter-java", "queries/tags.scm", "v0.23.5"},
	{Python, "github.com/tree-sitter/tree-sitter-python", "queries/tags.scm", "v0.25.0"},
	{JavaScript, "github.com/tree-sitter/tree-sitter-javascript", "queries/tags.scm", "v0.25.0"},
	{TypeScript, "github.com/tree-sitter/tree-sitter-typescript", "queries/tags.scm", "v0.23.2"},
	{Go, "github.com/tree-sitter/tree-sitter-go", "queries/tags.scm", "v0.25.0"},
	{Rust, "github.com/tree-sitter/tree-sitter-rust", "queries/tags.scm", "v0.24.2"},
}

// querySourcePaths maps a symbol-bearing language id to its embedded tags.scm — TSX reuses
// TypeScript's file since the upstream module ships exactly one query source for both dialects
// (verified against the module: only one queries/tags.scm exists there).
var querySourcePaths = map[ID]string{
	Java:       "queries/java/tags.scm",
	Python:     "queries/python/tags.scm",
	JavaScript: "queries/javascript/tags.scm",
	TypeScript: "queries/typescript/tags.scm",
	TSX:        "queries/typescript/tags.scm",
	Go:         "queries/go/tags.scm",
	Rust:       "queries/rust/tags.scm",
}

type compiledQuery struct {
	query *sitter.Query
	names []string // CaptureNames(), indexed by QueryCapture.Index
}

var (
	queryCacheMu sync.Mutex
	queryCache   = map[ID]*compiledQuery{}
)

// queryFor compiles id's tags.scm against id's own *sitter.Language exactly once. TypeScript and
// TSX are two distinct languages sharing one query source text, so each gets its own compiled
// *sitter.Query (a Query is compiled against one specific Language, never reusable across two —
// §4.1's own predicate note applies identically to both compiles).
func queryFor(id ID) (*sitter.Query, []string, error) {
	queryCacheMu.Lock()
	defer queryCacheMu.Unlock()

	if cq, ok := queryCache[id]; ok {
		return cq.query, cq.names, nil
	}

	path, ok := querySourcePaths[id]
	if !ok {
		return nil, nil, fmt.Errorf("codeparse: no tags.scm for language %q", id)
	}
	src, err := queryFS.ReadFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("codeparse: read %s: %w", path, err)
	}
	lang, err := languageFor(id)
	if err != nil {
		return nil, nil, err
	}
	query, qerr := sitter.NewQuery(lang, string(src))
	if qerr != nil {
		return nil, nil, fmt.Errorf("codeparse: compile %s query: %w", id, *qerr)
	}

	cq := &compiledQuery{query: query, names: query.CaptureNames()}
	queryCache[id] = cq
	return cq.query, cq.names, nil
}
