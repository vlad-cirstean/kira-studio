package codeparse

import (
	"container/list"
	"context"
	"errors"
	"sync"

	sitter "github.com/tree-sitter/go-tree-sitter"
)

// errParseFailed marks a nil tree that came back from the parser with ctx still live — parsing
// failed for a reason other than the caller's own cancellation. Parse/Reparse must never turn
// this into a silent (Result{}, nil) success (Group 0's second-order bug: a poisoned nil-error
// return reads to codeindex as StatusOK with zero symbols, which isStale then treats as
// permanently fresh — the file goes silently and permanently unindexed).
var errParseFailed = errors.New("codeparse: parse returned no tree")

// Range is a plain file-coordinate byte+point range — Tree.ChangedRanges' own output shape,
// carried out of the package as data (§1.4: never a *sitter.Node).
type Range struct {
	StartByte, EndByte   int
	StartPoint, EndPoint Point
}

// Result is one file's parse output — the only thing Session ever hands a caller. No
// *tree_sitter.Tree or *tree_sitter.Node is reachable from it (§1.4).
type Result struct {
	Language      ID
	HasError      bool // root node HasError(): parsed, with ERROR nodes in it
	LineCount     int
	Symbols       []Symbol
	References    []Reference
	Blocks        []Block
	ChangedRanges []Range // set by Reparse only; nil on a fresh Parse
}

// maxResidentFiles/maxResidentBytes are §7.3's bounds on the resident-tree cache: at most 64
// files and at most 16 MiB of resident source, whichever binds first.
const (
	maxResidentFiles = 64
	maxResidentBytes = 16 * 1024 * 1024
)

type residentEntry struct {
	path    string
	content []byte
	tree    *sitter.Tree
	lang    ID
}

// Session is the parser pool plus the bounded resident-tree cache (§7.3) that makes a Reparse
// incremental. A *sitter.Parser is not safe for concurrent use (§8), so parsers are pooled per
// grammar rather than shared; Close releases every pooled parser and every resident tree's C
// memory — the local cache's own job, not enginecache.ByteLru's (§7.3's own reasoning: eviction
// here must Close a C-allocated value, which a silent generic evictor cannot be made to do without
// widening a shared adapter-host type for this one caller).
type Session struct {
	parserMu sync.Mutex
	parsers  map[ID][]*sitter.Parser // idle parsers, a free list per grammar (container-resolved).

	cacheMu       sync.Mutex
	lru           *list.List // front = most recently parsed; back = least.
	index         map[string]*list.Element
	residentBytes int
}

// NewSession returns an empty Session. Callers must Close it once done.
func NewSession() *Session {
	return &Session{
		parsers: map[ID][]*sitter.Parser{},
		lru:     list.New(),
		index:   map[string]*list.Element{},
	}
}

// Close releases every pooled parser and Closes every resident tree. Not safe to call
// concurrently with an in-flight Parse/Reparse on the same Session.
func (s *Session) Close() {
	s.cacheMu.Lock()
	for el := s.lru.Front(); el != nil; el = el.Next() {
		el.Value.(*residentEntry).tree.Close()
	}
	s.lru = list.New()
	s.index = map[string]*list.Element{}
	s.residentBytes = 0
	s.cacheMu.Unlock()

	s.parserMu.Lock()
	for _, pool := range s.parsers {
		for _, p := range pool {
			p.Close()
		}
	}
	s.parsers = map[ID][]*sitter.Parser{}
	s.parserMu.Unlock()
}

// Forget drops path's resident entry, if any, Closing its tree — codeindex's own job when a file
// leaves enumeration (deleted or renamed) so a stale tree never lingers for a path that no longer
// exists.
func (s *Session) Forget(path string) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.removeLocked(path)
}

func (s *Session) removeLocked(path string) {
	el, ok := s.index[path]
	if !ok {
		return
	}
	entry := el.Value.(*residentEntry)
	entry.tree.Close()
	s.residentBytes -= len(entry.content)
	s.lru.Remove(el)
	delete(s.index, path)
}

// cachePut inserts or replaces path's resident entry and evicts least-recently-parsed entries
// (Closing their trees) until back under budget — except the entry just inserted, so a single
// file alone exceeding the byte budget is kept rather than evicted the instant it is cached
// (§7.3: "whichever binds first" bounds total residency, not any one file's own size — S5's own
// 2 MiB per-file cap keeps this from ever being extreme).
func (s *Session) cachePut(path string, content []byte, tree *sitter.Tree, lang ID) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()

	s.removeLocked(path)
	entry := &residentEntry{path: path, content: content, tree: tree, lang: lang}
	el := s.lru.PushFront(entry)
	s.index[path] = el
	s.residentBytes += len(content)

	for s.lru.Len() > 0 && (s.lru.Len() > maxResidentFiles || s.residentBytes > maxResidentBytes) {
		back := s.lru.Back()
		if back == el {
			break
		}
		e := back.Value.(*residentEntry)
		e.tree.Close()
		s.residentBytes -= len(e.content)
		s.lru.Remove(back)
		delete(s.index, e.path)
	}
}

// cacheTake removes and returns path's resident entry without Closing its tree — the caller takes
// ownership (Reparse either hands the tree back via cachePut or, on error, Closes it itself).
func (s *Session) cacheTake(path string) (*residentEntry, bool) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	el, ok := s.index[path]
	if !ok {
		return nil, false
	}
	entry := el.Value.(*residentEntry)
	s.lru.Remove(el)
	delete(s.index, path)
	s.residentBytes -= len(entry.content)
	return entry, true
}

func (s *Session) checkoutParser(grammar ID) (*sitter.Parser, error) {
	s.parserMu.Lock()
	if pool := s.parsers[grammar]; len(pool) > 0 {
		p := pool[len(pool)-1]
		s.parsers[grammar] = pool[:len(pool)-1]
		s.parserMu.Unlock()
		return p, nil
	}
	s.parserMu.Unlock()

	lang, err := languageFor(grammar)
	if err != nil {
		return nil, err
	}
	p := sitter.NewParser()
	if err := p.SetLanguage(lang); err != nil {
		p.Close()
		return nil, err
	}
	return p, nil
}

func (s *Session) checkinParser(grammar ID, p *sitter.Parser) {
	p.Reset() // clears any cancellation flag left over from a cancelled parse before reuse.
	s.parserMu.Lock()
	s.parsers[grammar] = append(s.parsers[grammar], p)
	s.parserMu.Unlock()
}

// Parse parses content fresh (no resident tree, no incremental edit) and caches the result's tree
// for a future Reparse.
func (s *Session) Parse(ctx context.Context, path string, content []byte, lang ID) (Result, error) {
	container := containerOf(lang)
	parser, err := s.checkoutParser(container)
	if err != nil {
		return Result{}, err
	}
	defer s.checkinParser(container, parser)

	tree, err := parseWithOptions(ctx, parser, content, nil)
	if err != nil {
		return Result{}, err
	}

	result, err := s.extract(tree, content, lang)
	if err != nil {
		tree.Close()
		return Result{}, err
	}
	s.cachePut(path, content, tree, lang)
	return result, nil
}

// Reparse derives an edit from path's resident content and newContent (§7.2), applies it to the
// resident tree, and reparses incrementally — falling back to a fresh Parse when no resident tree
// exists for path at all. Re-splitting an SFC/HTML container is itself incremental, since the
// container-level tree is what this cache holds and reuses; each block's own parse is always
// fresh either way (§7.3's own scoping — a block is typically small next to its container, so the
// container-level incremental reparse is where the reuse actually pays for itself).
func (s *Session) Reparse(ctx context.Context, path string, newContent []byte, lang ID) (Result, error) {
	entry, ok := s.cacheTake(path)
	if !ok {
		return s.Parse(ctx, path, newContent, lang)
	}

	container := containerOf(lang)
	parser, err := s.checkoutParser(container)
	if err != nil {
		entry.tree.Close()
		return Result{}, err
	}
	defer s.checkinParser(container, parser)

	edit, hasEdit := DeriveEdit(entry.content, newContent)
	if !hasEdit {
		// Byte-identical content: nothing to reparse (§7.2 names this explicitly — "an
		// unchanged file" produces no edit at all). Re-cache as-is and return its extraction.
		result, err := s.extract(entry.tree, newContent, lang)
		if err != nil {
			entry.tree.Close()
			return Result{}, err
		}
		s.cachePut(path, newContent, entry.tree, lang)
		return result, nil
	}

	entry.tree.Edit(&edit)
	newTree, err := parseWithOptions(ctx, parser, newContent, entry.tree)
	if err != nil {
		entry.tree.Close()
		return Result{}, err
	}
	changedRanges := toRanges(entry.tree.ChangedRanges(newTree))
	entry.tree.Close()

	result, err := s.extract(newTree, newContent, lang)
	if err != nil {
		newTree.Close()
		return Result{}, err
	}
	result.ChangedRanges = changedRanges
	s.cachePut(path, newContent, newTree, lang)
	return result, nil
}

// parseWithOptions parses content (oldTree nil for a fresh Parse, or the resident tree for an
// incremental Reparse) via the non-deprecated ParseWithOptions/ProgressCallback API rather than
// the deprecated ParseCtx (Group 0): ParseCtx spawns a goroutine that writes to
// Parser.CancellationFlag() on ctx cancellation, but that pointer is NULL unless
// ts_parser_set_cancellation_flag was explicitly called — which nothing here does — so a
// cancellation mid-parse is a guaranteed nil-pointer SIGSEGV in an orphan goroutine no caller can
// recover from. ProgressCallback runs synchronously inside the parse call itself instead, so no
// goroutine outlives it and there is nothing left to write to after the parse returns.
//
// Returns a real error whenever tree comes back nil: ctx's own error if ctx was actually
// cancelled, or errParseFailed otherwise — never (nil, nil). A nil tree with a nil error would
// read to Parse/Reparse's own callers as success (see errParseFailed's doc).
func parseWithOptions(ctx context.Context, parser *sitter.Parser, content []byte, oldTree *sitter.Tree) (*sitter.Tree, error) {
	tree := parser.ParseWithOptions(func(i int, _ sitter.Point) []byte {
		if i < len(content) {
			return content[i:]
		}
		return nil
	}, oldTree, &sitter.ParseOptions{
		ProgressCallback: func(sitter.ParseState) bool {
			return ctx.Err() != nil
		},
	})
	if tree == nil {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return nil, errParseFailed
	}
	return tree, nil
}

// extract runs the right symbol/reference/block pipeline for lang over tree's own root: Inject
// for a container language (§3.2), Extract directly otherwise. tree is read, never Closed —
// Parse/Reparse own that.
func (s *Session) extract(tree *sitter.Tree, content []byte, lang ID) (Result, error) {
	root := tree.RootNode()
	result := Result{
		Language:  lang,
		HasError:  root.HasError(),
		LineCount: countLines(content),
	}

	if IsContainer(lang) {
		blocks, symbols, references, err := injectBlocks(tree, content, lang)
		if err != nil {
			return Result{}, err
		}
		result.Blocks = blocks
		result.Symbols = symbols
		result.References = references
		return result, nil
	}

	symbols, references, err := extractSymbols(root, content, lang)
	if err != nil {
		return Result{}, err
	}
	result.Symbols = symbols
	result.References = references
	return result, nil
}

func toRanges(rs []sitter.Range) []Range {
	if len(rs) == 0 {
		return nil
	}
	out := make([]Range, len(rs))
	for i, r := range rs {
		out[i] = Range{
			StartByte: int(r.StartByte), EndByte: int(r.EndByte),
			StartPoint: pointOf(r.StartPoint), EndPoint: pointOf(r.EndPoint),
		}
	}
	return out
}

// countLines counts newline-terminated lines, plus one more for a final line with no trailing
// newline — an empty file has 0 lines.
func countLines(content []byte) int {
	if len(content) == 0 {
		return 0
	}
	lines := 1
	for _, b := range content {
		if b == '\n' {
			lines++
		}
	}
	return lines
}
