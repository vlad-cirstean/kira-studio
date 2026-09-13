// Package codeparse is the only package in this repo that imports tree-sitter (C1, docs/v1.5/
// plans/C1-tree-sitter-sqlite-cache.md). It parses source files with the upstream cgo binding
// (github.com/tree-sitter/go-tree-sitter) plus ten upstream grammar modules, and extracts plain Go
// structs (Symbol, Reference, Block) from the result — never a *tree_sitter.Tree or
// *tree_sitter.Node, which never leave this package (§1.4). internal/codeindex, and everything
// above it, is free of tree-sitter's C memory-ownership rules entirely.
package codeparse

import (
	"fmt"
	"sync"
	"unsafe"

	sitter "github.com/tree-sitter/go-tree-sitter"
	tssvelte "github.com/tree-sitter-grammars/tree-sitter-svelte/bindings/go"
	tscss "github.com/tree-sitter/tree-sitter-css/bindings/go"
	tsgo "github.com/tree-sitter/tree-sitter-go/bindings/go"
	tshtml "github.com/tree-sitter/tree-sitter-html/bindings/go"
	tsjava "github.com/tree-sitter/tree-sitter-java/bindings/go"
	tsjavascript "github.com/tree-sitter/tree-sitter-javascript/bindings/go"
	tsjson "github.com/tree-sitter/tree-sitter-json/bindings/go"
	tspython "github.com/tree-sitter/tree-sitter-python/bindings/go"
	tsrust "github.com/tree-sitter/tree-sitter-rust/bindings/go"
	tstypescript "github.com/tree-sitter/tree-sitter-typescript/bindings/go"
)

// ID identifies a language this package knows about (§3.1's extension table). Vue has no grammar
// of its own — it is parsed as an HTML container with injected blocks (§3.2) — but still gets its
// own ID, since callers (and stored rows) need to name it distinctly from plain HTML.
type ID string

const (
	Java       ID = "java"
	Python     ID = "python"
	JavaScript ID = "javascript"
	TypeScript ID = "typescript"
	TSX        ID = "tsx"
	Go         ID = "go"
	Rust       ID = "rust"
	HTML       ID = "html"
	CSS        ID = "css"
	JSON       ID = "json"
	Vue        ID = "vue"
	Svelte     ID = "svelte"
)

// grammarCtor returns the raw grammar pointer a bindings/go package exposes. Kept private to this
// file: sitter.NewLanguage(ptr) turns it into a *sitter.Language, itself never exported past this
// package (§1.4 covers Tree/Node explicitly; Language gets the same treatment for the same reason
// — no tree-sitter C-backed type crosses the package boundary).
var grammarCtors = map[ID]func() unsafe.Pointer{
	Java:       tsjava.Language,
	Python:     tspython.Language,
	JavaScript: tsjavascript.Language,
	TypeScript: tstypescript.LanguageTypescript,
	TSX:        tstypescript.LanguageTSX,
	Go:         tsgo.Language,
	Rust:       tsrust.Language,
	HTML:       tshtml.Language,
	CSS:        tscss.Language,
	JSON:       tsjson.Language,
	Svelte:     tssvelte.Language,
	// Vue deliberately absent (§1.2): no upstream Go module exists. containerOf resolves it to
	// HTML instead of adding an entry here.
}

// containerOf is the grammar that actually parses id's top level (§3.2). Every language parses
// with its own grammar except Vue, which has none and is parsed as an HTML container.
func containerOf(id ID) ID {
	if id == Vue {
		return HTML
	}
	return id
}

// symbolLanguages is §4.1's closed set: the six languages with a vendored upstream tags.scm.
// html, css, json and svelte get file/file_block rows and no symbols — not a gap, a CSS selector
// or a JSON key is not a definition anything resolves to.
var symbolLanguages = map[ID]bool{
	Java: true, Python: true, JavaScript: true, TypeScript: true, TSX: true, Go: true, Rust: true,
}

// HasSymbolQuery reports whether id has a vendored tags.scm (§4.1).
func HasSymbolQuery(id ID) bool { return symbolLanguages[id] }

// IsContainer reports whether id is parsed as an SFC/HTML container with injected blocks (§3.2).
func IsContainer(id ID) bool { return id == Vue || id == Svelte || id == HTML }

// minABI/maxABI are go-tree-sitter v0.25.0's own compatible range (api.h:
// TREE_SITTER_LANGUAGE_VERSION 15, TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION 13, §1.1).
const (
	minABI = sitter.MIN_COMPATIBLE_LANGUAGE_VERSION
	maxABI = sitter.LANGUAGE_VERSION
)

// languageCache lazily constructs and ABI-checks each grammar's *sitter.Language exactly once —
// every grammar's C parse tables are static, so one Language per process serves every Parser.
var (
	languageCacheMu sync.Mutex
	languageCache   = map[ID]*sitter.Language{}
)

// languageFor returns id's own *sitter.Language (container-resolved for Vue), constructing and
// ABI-checking it on first use. The ABI check is what makes "which grammar versions are in range"
// a fact this binary verifies at startup rather than something only ever reasoned about in a plan
// document.
func languageFor(id ID) (*sitter.Language, error) {
	container := containerOf(id)

	languageCacheMu.Lock()
	defer languageCacheMu.Unlock()

	if lang, ok := languageCache[container]; ok {
		return lang, nil
	}

	ctor, ok := grammarCtors[container]
	if !ok {
		return nil, fmt.Errorf("codeparse: no grammar registered for language %q", container)
	}
	lang := sitter.NewLanguage(ctor())
	if abi := lang.AbiVersion(); abi < minABI || abi > maxABI {
		return nil, fmt.Errorf("codeparse: grammar %q reports ABI %d, outside this binding's "+
			"compatible range [%d, %d]", container, abi, minABI, maxABI)
	}
	languageCache[container] = lang
	return lang, nil
}
