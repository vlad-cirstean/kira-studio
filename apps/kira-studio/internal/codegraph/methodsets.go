package codegraph

import (
	"context"
	"sort"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// maxEmbedDepth caps methodSet's own promotion recursion (an interface's type_elem embed, a
// struct's own embedded field, P78 §3.1) at 8 — deeper embedding exists in no real Go code, and an
// unbounded walk over an index that can contain a parse error (a malformed or mid-edit tree) is not
// defensible (§4.1).
const maxEmbedDepth = 8

// referenceCache spares a second round trip for a file's references already read once in this call
// — fileCache/symbolCache's own counterpart (references.go). receiverTypeOf is reused by both this
// file's own goImplementationsOf and resolve.go's receiver ranking tiebreak (§5), each building its
// own cache rather than sharing goTypes' whole apparatus.
type referenceCache map[int64][]codeindex.ReferenceRow

func (g *Graph) cachedReferences(ctx context.Context, cache referenceCache, fileID int64) ([]codeindex.ReferenceRow, error) {
	if r, ok := cache[fileID]; ok {
		return r, nil
	}
	r, err := g.store.ReferencesInFile(ctx, fileID)
	if err != nil {
		return nil, err
	}
	cache[fileID] = r
	return r, nil
}

// receiverTypeOf returns methodSym's own receiver type name — the "receiver" reference in its own
// file whose span contains the method's own span (both are the identical method_declaration node,
// so containment is exact-or-equal, P78 §3.1's own capture shape). "" when methodSym has no
// receiver at all: a plain function, or an interface's own method_elem symbol, which is never
// wrapped in a method_declaration in the first place.
func (g *Graph) receiverTypeOf(ctx context.Context, cache referenceCache, methodSym codeindex.SymbolRow) (string, error) {
	refs, err := g.cachedReferences(ctx, cache, methodSym.FileID)
	if err != nil {
		return "", err
	}
	for _, r := range refs {
		if r.Kind == "receiver" && r.StartByte <= methodSym.StartByte && r.EndByte >= methodSym.EndByte {
			return r.Name, nil
		}
	}
	return "", nil
}

// findGoType returns typeName's own Go "type" symbol (a struct or interface declaration — Go has
// no separate "struct"/"interface" symbol kind, C1's own choice, §2.1) and its file. False when no
// such symbol exists in this repository. Name-only and unqualified, the same assumption every other
// rule in resolve.go already makes (§9): a same-named type in two Go packages resolves to whichever
// row this query happens to see first.
func (g *Graph) findGoType(ctx context.Context, typeName string) (codeindex.SymbolRow, codeindex.FileRow, bool, error) {
	rows, err := g.store.FindSymbolsByName(ctx, g.repoID, typeName)
	if err != nil {
		return codeindex.SymbolRow{}, codeindex.FileRow{}, false, err
	}
	for _, row := range rows {
		if row.Kind != "type" {
			continue
		}
		f, ok, err := g.store.FileByID(ctx, row.FileID)
		if err != nil {
			return codeindex.SymbolRow{}, codeindex.FileRow{}, false, err
		}
		if ok && f.Language == "go" {
			return row, f, true, nil
		}
	}
	return codeindex.SymbolRow{}, codeindex.FileRow{}, false, nil
}

// typeLookup is cachedGoType's own memoized entry — findGoType's result (including a real "not
// found") for one type name.
type typeLookup struct {
	sym  codeindex.SymbolRow
	file codeindex.FileRow
	ok   bool
}

// typeCache spares a repeated FindSymbolsByName+FileByID round trip for the same Go type name
// within one call — fileCache/symbolCache/referenceCache's own counterpart. methodSet and
// goConcreteTypesSatisfying both resolve the same typeName moments apart within one call; findGoType
// itself stays uncached so a caller that genuinely wants a fresh lookup still can.
type typeCache map[string]typeLookup

func (g *Graph) cachedGoType(ctx context.Context, cache typeCache, typeName string) (codeindex.SymbolRow, codeindex.FileRow, bool, error) {
	if v, ok := cache[typeName]; ok {
		return v.sym, v.file, v.ok, nil
	}
	sym, file, ok, err := g.findGoType(ctx, typeName)
	if err != nil {
		return codeindex.SymbolRow{}, codeindex.FileRow{}, false, err
	}
	cache[typeName] = typeLookup{sym: sym, file: file, ok: ok}
	return sym, file, ok, nil
}

// methodSetResult is goTypes' own memoized entry — the method set plus whether embedding
// contributed at least one of its names (§4.3's own ".promoted" rule suffix).
type methodSetResult struct {
	methods  map[string]bool
	promoted bool
}

// goTypes is methodSet's own per-call scratch state — never persisted (codegraph.go's own "no edge
// table, ever" rule): a method set is derived cross-file state, recomputed on every call.
type goTypes struct {
	g       *Graph
	files   fileCache
	syms    symbolCache
	refs    referenceCache
	types   typeCache
	memo    map[string]methodSetResult
	direct  map[string]map[string]bool // directGoMethods' own per-call memo
	walking map[string]bool            // embedding cycle guard
}

func newGoTypes(g *Graph) *goTypes {
	return &goTypes{
		g: g, files: fileCache{}, syms: symbolCache{}, refs: referenceCache{}, types: typeCache{},
		memo: map[string]methodSetResult{}, direct: map[string]map[string]bool{}, walking: map[string]bool{},
	}
}

// directGoMethods is methodSet's own first source (§4.1 step 1): every "receiver" reference named
// typeName recovers its own innermost enclosing symbol — the method_declaration itself (the
// receiver reference's own span IS the method_declaration, so containment is exact) — the identical
// containment recovery containmentImplementationsOf already performs for TypeScript and Java.
//
// Reused standalone by goImplementationsOf to tell a concrete type from an interface with no stored
// kind to ask (§2.1): typeName is used as a receiver somewhere if and only if it is concrete — an
// interface's own method_elem is never wrapped in a method_declaration with a receiver at all.
// Memoized per call (ix.direct): goImplementationsOf's own standalone call and methodSet's first
// step both ask for the same typeName moments apart.
func (ix *goTypes) directGoMethods(ctx context.Context, typeName string) (map[string]bool, error) {
	if cached, ok := ix.direct[typeName]; ok {
		return cached, nil
	}
	refs, err := ix.g.store.ReferencesByName(ctx, ix.g.repoID, typeName)
	if err != nil {
		return nil, err
	}
	set := map[string]bool{}
	for _, r := range refs {
		if r.Kind != "receiver" {
			continue
		}
		f, ok, err := ix.g.cachedFile(ctx, ix.files, r.FileID)
		if err != nil {
			return nil, err
		}
		if !ok || f.Language != "go" {
			continue
		}
		fileSymbols, err := ix.g.cachedSymbols(ctx, ix.syms, r.FileID)
		if err != nil {
			return nil, err
		}
		if m := innermostEnclosingSymbol(fileSymbols, r.StartByte, r.EndByte); m != nil && m.Kind == "method" {
			set[m.Name] = true
		}
	}
	ix.direct[typeName] = set
	return set, nil
}

// methodSet is §4.1's own union of three sources — one function for interfaces and concrete types
// alike: (1) directGoMethods above, (2) typeName's own symbol's direct "method" children (an
// interface's own method_elem rows, P78 §3.1), (3) every embedded type's own method set, recursed.
// depth caps promotion at maxEmbedDepth; ix.walking refuses a name already on the stack, so a
// malformed or mid-edit tree that embeds itself terminates instead of recursing forever.
//
// The third return, truncated, is true when THIS call — or any embedded type it recursed into —
// hit the depth cap or the cycle guard rather than completing a real walk. A truncated result is
// still returned to its own caller (so the walk terminates and produces something), but is never
// written to ix.memo: memoizing it would let a later, unrelated top-level lookup for the same type
// name reuse an incomplete set instead of recomputing it fully (P79 review) — memoization itself
// stays per call only, never persisted, per this file's own "no edge table" discipline.
func (ix *goTypes) methodSet(ctx context.Context, typeName string, depth int) (map[string]bool, bool, bool, error) {
	if cached, ok := ix.memo[typeName]; ok {
		return cached.methods, cached.promoted, false, nil
	}
	if depth > maxEmbedDepth || ix.walking[typeName] {
		return map[string]bool{}, false, true, nil
	}
	ix.walking[typeName] = true
	defer delete(ix.walking, typeName)

	direct, err := ix.directGoMethods(ctx, typeName)
	if err != nil {
		return nil, false, false, err
	}
	set := map[string]bool{}
	for m := range direct {
		set[m] = true
	}

	typeSym, _, ok, err := ix.g.cachedGoType(ctx, ix.types, typeName)
	if err != nil {
		return nil, false, false, err
	}
	if !ok {
		// No Go symbol named typeName at all (an embedded stdlib/third-party type this index never
		// saw, or a plain identifier that isn't a type) — direct is everything there is.
		result := methodSetResult{methods: set, promoted: false}
		ix.memo[typeName] = result
		return result.methods, result.promoted, false, nil
	}

	fileSymbols, err := ix.g.cachedSymbols(ctx, ix.syms, typeSym.FileID)
	if err != nil {
		return nil, false, false, err
	}
	for i := range fileSymbols {
		s := &fileSymbols[i]
		if s.Kind == "method" && s.ParentID != nil && *s.ParentID == typeSym.ID {
			set[s.Name] = true
		}
	}

	fileRefs, err := ix.g.cachedReferences(ctx, ix.refs, typeSym.FileID)
	if err != nil {
		return nil, false, false, err
	}
	promoted := false
	truncated := false
	for _, r := range fileRefs {
		if r.Kind != "embed" {
			continue
		}
		if r.StartByte < typeSym.StartByte || r.EndByte > typeSym.EndByte {
			continue // not embedded by typeSym itself — some other type's own embed reference.
		}
		embedded, _, childTruncated, err := ix.methodSet(ctx, r.Name, depth+1)
		if err != nil {
			return nil, false, false, err
		}
		if childTruncated {
			truncated = true
		}
		for m := range embedded {
			if !set[m] {
				promoted = true
			}
			set[m] = true
		}
	}

	if !truncated {
		result := methodSetResult{methods: set, promoted: promoted}
		ix.memo[typeName] = result
	}
	return set, promoted, truncated, nil
}

// supersetOf reports whether have contains every name in want — the structural satisfaction test
// itself (§4.2), method names only: no signature is stored or compared (§4.3), so this is never
// dressed up as more certain than it is.
func supersetOf(have, want map[string]bool) bool {
	for m := range want {
		if !have[m] {
			return false
		}
	}
	return true
}

// rarestGoMethodName picks the member of want with the fewest FindSymbolsByName rows — what keeps a
// one-method interface's own search bounded to that one method's own occurrences, never a
// repository-wide scan (§4.2). Ties break on name, so two equally-rare names never make this
// non-deterministic across runs — correctness never depends on which is picked (every genuine
// implementer has every name in want, the seed included), only how much work finding it costs.
func (g *Graph) rarestGoMethodName(ctx context.Context, want map[string]bool) (string, []codeindex.SymbolRow, error) {
	var best string
	var bestSyms []codeindex.SymbolRow
	for m := range want {
		syms, err := g.store.FindSymbolsByName(ctx, g.repoID, m)
		if err != nil {
			return "", nil, err
		}
		if best == "" || len(syms) < len(bestSyms) || (len(syms) == len(bestSyms) && m < best) {
			best, bestSyms = m, syms
		}
	}
	return best, bestSyms, nil
}

// goMethodSetRule is §4.3's own honest rule string — "the match" is method-name comparison only,
// never signature-aware, so this is what travels with every result through render.go/navigation.ts
// rather than living only in a doc comment.
func goMethodSetRule(promoted bool) string {
	if promoted {
		return "implementationsOf.goMethodSet.promoted"
	}
	return "implementationsOf.goMethodSet"
}

// goConcreteTypesSatisfying is goImplementationsOf's forward direction (§4.2): the cursor resolved
// to an interface (or a bare name with no receiver anywhere), want is its own method set. Seeds
// from want's rarest method name — every FindSymbolsByName row for it that is NOT an interface's
// own method_elem child (ParentID nil, so it has a real receiver) names a concrete candidate; kept
// when that candidate's own full method set is a superset of want.
//
// Known limitation (P79 review, docs/ARCHITECTURE.md's own "Known open items"): a type satisfying
// want purely through promoted/embedded methods, with no method of its own literally named in
// want, is never found. Candidates come only from a literal method declaration named after one of
// want's members (the seed above) — type T struct { io.ReadCloser } satisfying
// interface{ Read; Close } is invisible to this search, since T declares neither Read nor Close
// itself. Extending discovery to promoted-only satisfiers needs a materially different (and more
// expensive) strategy, out of scope for a review fix pass, and constrained by this file's own "no
// edge table" rule (codegraph.go) on top of that.
func (g *Graph) goConcreteTypesSatisfying(ctx context.Context, ix *goTypes, want map[string]bool) ([]Target, error) {
	seed, seedSyms, err := g.rarestGoMethodName(ctx, want)
	if err != nil || seed == "" {
		return nil, err
	}

	seenType := map[string]bool{}
	var out []Target
	for _, s := range seedSyms {
		if s.Kind != "method" || s.ParentID != nil {
			continue // an interface's own method_elem child — never a receiver, never a candidate.
		}
		f, ok, err := g.cachedFile(ctx, ix.files, s.FileID)
		if err != nil {
			return nil, err
		}
		if !ok || f.Language != "go" {
			continue
		}
		typeName, err := g.receiverTypeOf(ctx, ix.refs, s)
		if err != nil {
			return nil, err
		}
		if typeName == "" || seenType[typeName] {
			continue
		}
		seenType[typeName] = true

		have, promoted, _, err := ix.methodSet(ctx, typeName, 0)
		if err != nil {
			return nil, err
		}
		if !supersetOf(have, want) {
			continue
		}
		typeSym, typeFile, ok, err := g.cachedGoType(ctx, ix.types, typeName)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		t, err := g.targetFromSymbol(ctx, typeSym, typeFile, goMethodSetRule(promoted), Scoped)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// goInterfacesSatisfiedBy is goImplementationsOf's reverse direction (§4.2): the cursor resolved to
// a concrete type (or one of its methods, via its receiver), have is its own method set. Unlike the
// forward direction, a single rarest-name seed is NOT sound here: an interface only needs a SUBSET
// of have's names, so seeding from one name misses every interface that doesn't happen to declare
// that specific name (e.g. have = {Read, Close, Shutdown}, Reader{Read} — if Close is globally
// rarest, seeding from Close alone never visits Reader at all). Candidates are instead the UNION
// over every name in have: every FindSymbolsByName row for it that IS an interface's own
// method_elem child (ParentID set) names a candidate interface, deduplicated by interface name;
// kept when have is a superset of that interface's own method set. This issues one
// FindSymbolsByName per name in have rather than one total — inherent to correctness here, not a
// regression (§4.4 already bounds this by have's own size, never a repository-wide scan).
func (g *Graph) goInterfacesSatisfiedBy(ctx context.Context, ix *goTypes, have map[string]bool) ([]Target, error) {
	if len(have) == 0 {
		return nil, nil
	}

	// Sorted for deterministic candidate order across runs — map iteration order isn't.
	names := make([]string, 0, len(have))
	for m := range have {
		names = append(names, m)
	}
	sort.Strings(names)

	seenType := map[string]bool{}
	var out []Target
	for _, m := range names {
		syms, err := g.store.FindSymbolsByName(ctx, g.repoID, m)
		if err != nil {
			return nil, err
		}
		for _, s := range syms {
			if s.Kind != "method" || s.ParentID == nil {
				continue // a concrete, receiver-based method — never an interface candidate.
			}
			parent, ok, err := g.store.SymbolByID(ctx, *s.ParentID)
			if err != nil {
				return nil, err
			}
			if !ok || seenType[parent.Name] {
				continue
			}
			seenType[parent.Name] = true

			want, promoted, _, err := ix.methodSet(ctx, parent.Name, 0)
			if err != nil {
				return nil, err
			}
			if !supersetOf(have, want) {
				continue
			}
			parentFile, ok, err := g.cachedFile(ctx, ix.files, parent.FileID)
			if err != nil {
				return nil, err
			}
			if !ok {
				continue
			}
			t, err := g.targetFromSymbol(ctx, parent, parentFile, goMethodSetRule(promoted), Scoped)
			if err != nil {
				return nil, err
			}
			out = append(out, t)
		}
	}
	return out, nil
}

// goImplementationsOf is ImplementationsOf's own Go case (§4.2/§4.3): method-name-only structural
// matching — the index stores no signature, so this is not type inference and Confidence is always
// Scoped, never Exact, for every result either direction returns.
//
// Direction is decided by whether name has any receiver-based method of its own (directGoMethods):
// non-empty means name is concrete (an interface's own method_elem is never receiver-based), so the
// reverse direction runs — which interfaces does it itself satisfy? Empty means name is
// interface-like (or has no Go method set at all, caught below by the forward branch's own
// len(want)==0 check) — the forward direction runs — which concrete types satisfy it?
func (g *Graph) goImplementationsOf(ctx context.Context, name string) ([]Target, error) {
	ix := newGoTypes(g)

	direct, err := ix.directGoMethods(ctx, name)
	if err != nil {
		return nil, err
	}
	if len(direct) > 0 {
		have, _, _, err := ix.methodSet(ctx, name, 0)
		if err != nil {
			return nil, err
		}
		return g.goInterfacesSatisfiedBy(ctx, ix, have)
	}

	want, _, _, err := ix.methodSet(ctx, name, 0)
	if err != nil {
		return nil, err
	}
	if len(want) == 0 {
		// `any`/`interface{}` (or an unindexed name): every type satisfies an empty method set, and
		// answering "every type" is noise, not an answer (§4.2).
		return nil, nil
	}
	return g.goConcreteTypesSatisfying(ctx, ix, want)
}
