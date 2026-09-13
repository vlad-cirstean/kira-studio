package codeparse

import (
	"embed"
	"fmt"
	"sync"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

//go:embed queries/java/tags.scm queries/python/tags.scm queries/python/c2_implements.scm queries/javascript/tags.scm queries/javascript/c2_implements.scm queries/typescript/tags.scm queries/typescript/c2_implements.scm queries/tsx/c2_implements.scm queries/go/tags.scm queries/rust/tags.scm
var queryFS embed.FS

// QuerySource is one query file's provenance (§4.1/NOTICES.md): a future license or version audit
// reads this table instead of re-deriving it from go.mod and file paths. A repo-authored row
// (UpstreamModule == thisRepo, C2 §2.3) is not a NOTICES.md entry — it vendors nothing — but is
// listed here anyway so "what produced this capture" has one answer regardless of origin.
type QuerySource struct {
	Language       ID
	UpstreamModule string
	UpstreamPath   string
	ModuleVersion  string
}

// thisRepo marks a QuerySource as this repository's own hand-written query (§2.3's deliberate,
// narrow exception to "no hand-written queries") rather than something vendored from upstream.
const thisRepo = "kira-studio (hand-written, C2)"

// Provenance lists every query file's provenance (§4.1/NOTICES.md). TSX has no *vendored* row of
// its own — it compiles TypeScript's tags.scm against the TSX language (§3.1: "TypeScript and TSX"
// share one upstream grammar module), never a second vendored query file — but does get its own
// repo-authored c2_implements.scm row, since that file's node kinds are verified against TSX's own
// node-types.json independently of TypeScript's.
var Provenance = []QuerySource{
	{Java, "github.com/tree-sitter/tree-sitter-java", "queries/tags.scm", "v0.23.5"},
	{Python, "github.com/tree-sitter/tree-sitter-python", "queries/tags.scm", "v0.25.0"},
	{JavaScript, "github.com/tree-sitter/tree-sitter-javascript", "queries/tags.scm", "v0.25.0"},
	{TypeScript, "github.com/tree-sitter/tree-sitter-typescript", "queries/tags.scm", "v0.23.2"},
	{Go, "github.com/tree-sitter/tree-sitter-go", "queries/tags.scm", "v0.25.0"},
	{Rust, "github.com/tree-sitter/tree-sitter-rust", "queries/tags.scm", "v0.24.2"},

	// C2-authored `implements`/`extends` queries (§2.3) — see thisRepo's own doc comment.
	{TypeScript, thisRepo, "queries/typescript/c2_implements.scm", ""},
	{TSX, thisRepo, "queries/tsx/c2_implements.scm", ""},
	{JavaScript, thisRepo, "queries/javascript/c2_implements.scm", ""},
	{Python, thisRepo, "queries/python/c2_implements.scm", ""},
}

// querySourcePaths maps a symbol-bearing language id to every embedded query file compiled into
// its one *sitter.Query, in composition order. TypeScript and TSX compile javascript's tags.scm
// ahead of typescript's own (§2.1): upstream ships the TypeScript file as an *addition* to the
// JavaScript one (only signature/abstract/interface patterns, no `; inherits:` header — editors
// supply that themselves), so typescript's file alone indexes almost nothing. Each language's own
// c2_implements.scm (§2.3) rides along at the end — same *sitter.Query, same @reference.implementation
// capture, no schema or extract.go change needed.
var querySourcePaths = map[ID][]string{
	Java:       {"queries/java/tags.scm"},
	Python:     {"queries/python/tags.scm", "queries/python/c2_implements.scm"},
	JavaScript: {"queries/javascript/tags.scm", "queries/javascript/c2_implements.scm"},
	TypeScript: {"queries/javascript/tags.scm", "queries/typescript/tags.scm", "queries/typescript/c2_implements.scm"},
	TSX:        {"queries/javascript/tags.scm", "queries/typescript/tags.scm", "queries/tsx/c2_implements.scm"},
	Go:         {"queries/go/tags.scm"},
	Rust:       {"queries/rust/tags.scm"},
}

type compiledQuery struct {
	query *sitter.Query
	names []string // CaptureNames(), indexed by QueryCapture.Index
}

var (
	queryCacheMu sync.Mutex
	queryCache   = map[ID]*compiledQuery{}
)

// queryFor compiles id's composed query text (its own querySourcePaths entries, concatenated in
// order) against id's own *sitter.Language exactly once. TypeScript and TSX are two distinct
// languages sharing overlapping source text, so each gets its own compiled *sitter.Query (a Query
// is compiled against one specific Language, never reusable across two — §4.1's own predicate note
// applies identically to both compiles).
func queryFor(id ID) (*sitter.Query, []string, error) {
	queryCacheMu.Lock()
	defer queryCacheMu.Unlock()

	if cq, ok := queryCache[id]; ok {
		return cq.query, cq.names, nil
	}

	paths, ok := querySourcePaths[id]
	if !ok || len(paths) == 0 {
		return nil, nil, fmt.Errorf("codeparse: no tags.scm for language %q", id)
	}
	var src []byte
	for _, path := range paths {
		b, err := queryFS.ReadFile(path)
		if err != nil {
			return nil, nil, fmt.Errorf("codeparse: read %s: %w", path, err)
		}
		src = append(src, b...)
		src = append(src, '\n')
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
