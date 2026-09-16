package codegraph

import (
	"context"
	"sort"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// maxCandidates is §5.1 step 4's own cap on a resolved result.
const maxCandidates = 16

// kindCompatibility is §5.4 rule 1's closed table: a candidate whose own kind isn't listed for the
// reference's kind is demoted, never dropped — the kind vocabulary is uneven across languages (Go
// has no "struct" kind, Rust files a struct under "class"), so dropping would turn that unevenness
// into a missing answer.
var kindCompatibility = map[string]map[string]bool{
	"call":           {"function": true, "method": true, "constructor": true, "macro": true, "class": true},
	"type":           {"class": true, "interface": true, "struct": true, "enum": true, "type": true, "module": true},
	"class":          {"class": true, "struct": true, "type": true, "interface": true},
	"implementation": {"interface": true, "class": true, "type": true},
	// P78 §3.2: both new Go reference kinds name a type the same way "type" itself does (a
	// receiver's own type, an embedded interface/struct field's own type) — same candidate set, or
	// the demotion "type" already gets is silently lost for these two instead (kindCompatible's own
	// unrecognized-kind branch treats a missing entry as "compatible with everything").
	"receiver": {"class": true, "interface": true, "struct": true, "enum": true, "type": true, "module": true},
	"embed":    {"class": true, "interface": true, "struct": true, "enum": true, "type": true, "module": true},
}

func kindCompatible(refKind, symKind string) bool {
	m, ok := kindCompatibility[refKind]
	if !ok {
		// An empty/unrecognized reference kind (a bare-Name query with no reference row at all)
		// has no compatibility basis to demote anything on.
		return true
	}
	return m[symKind]
}

// candidate is one resolve() result before ranking — a symbol row plus its own file row (needed
// for the directory/basename/test-path rules) and its place in §5.2/§5.4's own ordering.
type candidate struct {
	sym          codeindex.SymbolRow
	file         codeindex.FileRow
	tier         int // 0 same file, 1 same directory, 2 repository-wide
	sameFileRank int // tier 0 only: 0 enclosing, 1 sibling (shared parent), 2 other
	rule         string
}

// tierOf is §5.2: same file is tier 0, same directory is tier 1 (which is what makes "the same
// directory" scope unit and the JS family's "same file, then same directory" Tier 1 rule the same
// underlying membership test — same-file candidates are simply reclassified into tier 0 first, and
// never reach the tier-1 bucket at all), anything else is tier 2.
func tierOf(candidateFile, refFile codeindex.FileRow) int {
	if candidateFile.Path == refFile.Path {
		return 0
	}
	if dirOf(candidateFile.Path) == dirOf(refFile.Path) {
		return 1
	}
	return 2
}

func dirOf(path string) string {
	if idx := strings.LastIndexByte(path, '/'); idx >= 0 {
		return path[:idx]
	}
	return ""
}

// isUnexportedGoName is §5.3's Go extra rule: an identifier whose first rune is lower-case is
// package-private and never reaches tier 2.
func isUnexportedGoName(name string) bool {
	r, _ := utf8.DecodeRuneInString(name)
	return unicode.IsLower(r)
}

// innermostEnclosingSymbol finds the smallest-span symbol in symbols whose range contains
// [start, end) — the reference site's own innermost enclosing definition, for tier 0's sibling
// rule below.
func innermostEnclosingSymbol(symbols []codeindex.SymbolRow, start, end int) *codeindex.SymbolRow {
	var best *codeindex.SymbolRow
	for i := range symbols {
		s := &symbols[i]
		if s.StartByte <= start && s.EndByte >= end {
			if best == nil || (s.EndByte-s.StartByte) < (best.EndByte-best.StartByte) {
				best = s
			}
		}
	}
	return best
}

// sameParent reports whether a and b are the same symbol-id pointer value (both nil, meaning
// top-level, or both set and equal).
func sameParent(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func fileBasenameNoExt(path string) string {
	base := path
	if idx := strings.LastIndexByte(base, '/'); idx >= 0 {
		base = base[idx+1:]
	}
	if idx := strings.IndexByte(base, '.'); idx >= 0 {
		base = base[:idx]
	}
	return base
}

// basenameMatches is §5.3's per-language basename rule (§5.4 rule 2): Java requires it for a
// public type reference, and only for type/class/implementation kinds; the JS family's default-
// export convention applies to every reference kind, "index" excluded (nearly every module has
// one, so it would otherwise match almost anything). Every other language has no basename rule.
func basenameMatches(language, refKind string, c candidate) bool {
	switch language {
	case "java":
		if refKind != "type" && refKind != "class" && refKind != "implementation" {
			return false
		}
		return fileBasenameNoExt(c.file.Path) == c.sym.Name
	case "javascript", "typescript", "tsx", "vue", "svelte":
		base := fileBasenameNoExt(c.file.Path)
		if base == "" || strings.EqualFold(base, "index") {
			return false
		}
		return base == c.sym.Name
	default:
		return false
	}
}

// isTestPath is §5.4 rule 4's closed set.
func isTestPath(path string) bool {
	base := path
	if idx := strings.LastIndexByte(base, '/'); idx >= 0 {
		base = base[idx+1:]
	}
	if strings.HasSuffix(base, "_test.go") {
		return true
	}
	if strings.Contains(base, ".test.") || strings.Contains(base, ".spec.") {
		return true
	}
	if strings.HasSuffix(base, "Test.java") || strings.HasSuffix(base, "Tests.java") {
		return true
	}
	for _, seg := range strings.Split(path, "/") {
		switch seg {
		case "test", "tests", "__tests__", "testdata":
			return true
		}
	}
	return false
}

// commonPrefixLen is §5.4 rule 3, computed over the two full paths rather than just their
// directory component: a same-file candidate then shares the longest possible prefix (its whole
// path), a same-directory-different-file candidate shares up to the last separator, and anything
// further away shares less — one generic rule that reproduces the JS family's own "same file, then
// same directory" preference with no separate special case.
func commonPrefixLen(a, b string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	i := 0
	for i < n && a[i] == b[i] {
		i++
	}
	return i
}

// languageFamily groups languages that can genuinely define one another's names (P64 §2.4). A name
// shared across two families is a collision, not a resolution — rank the referring file's own
// family first rather than letting commonPrefixLen decide by directory accident.
var languageFamily = map[string]string{
	"javascript": "js", "typescript": "js", "tsx": "js", "vue": "js", "svelte": "js", "html": "js",
	"go": "go", "java": "java", "python": "python", "rust": "rust",
}

// sameLanguageFamily reports whether candidateLanguage is in the same family as refLanguage. A
// no-op (always true) when refLanguage is absent from languageFamily (css/json and the like), so
// nothing outside the symbol-bearing language set changes behaviour.
func sameLanguageFamily(refLanguage, candidateLanguage string) bool {
	refFamily, ok := languageFamily[refLanguage]
	if !ok {
		return true
	}
	return languageFamily[candidateLanguage] == refFamily
}

func minTier(cands []candidate) int {
	best := 2
	for _, c := range cands {
		if c.tier < best {
			best = c.tier
		}
	}
	return best
}

func filterTier(cands []candidate, tier int) []candidate {
	var out []candidate
	for _, c := range cands {
		if c.tier == tier {
			out = append(out, c)
		}
	}
	return out
}

func filterTierAtMost(cands []candidate, maxTier int) []candidate {
	var out []candidate
	for _, c := range cands {
		if c.tier <= maxTier {
			out = append(out, c)
		}
	}
	return out
}

// sortCandidates orders cands in place: tier 0's own same-file rank first (§5.2), then §5.4's six
// ranking rules in order, each a tiebreak for the one above.
func sortCandidates(cands []candidate, refKind, language, refPath string) {
	sort.SliceStable(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if a.tier == 0 && b.tier == 0 && a.sameFileRank != b.sameFileRank {
			return a.sameFileRank < b.sameFileRank
		}
		if ka, kb := kindCompatible(refKind, a.sym.Kind), kindCompatible(refKind, b.sym.Kind); ka != kb {
			return ka
		}
		// P64 §2.4: a same-family candidate ranks ahead of a cross-language name collision — a
		// demotion, never a filter (both candidates still come back), placed below kindCompatible
		// (what a reference syntactically *is* outranks which half of a polyglot repo it lives in)
		// and above basenameMatches/commonPrefixLen (path heuristics, not a hard language fact).
		if fa, fb := sameLanguageFamily(language, a.file.Language), sameLanguageFamily(language, b.file.Language); fa != fb {
			return fa
		}
		if ba, bb := basenameMatches(language, refKind, a), basenameMatches(language, refKind, b); ba != bb {
			return ba
		}
		if pa, pb := commonPrefixLen(a.file.Path, refPath), commonPrefixLen(b.file.Path, refPath); pa != pb {
			return pa > pb
		}
		if ta, tb := isTestPath(a.file.Path), isTestPath(b.file.Path); ta != tb {
			return !ta
		}
		if a.file.HasError != b.file.HasError {
			return !a.file.HasError
		}
		if a.file.Path != b.file.Path {
			return a.file.Path < b.file.Path
		}
		return a.sym.StartByte < b.sym.StartByte
	})
}

func ruleFor(tier, sameFileRank int) string {
	switch tier {
	case 0:
		switch sameFileRank {
		case 0:
			return "sameFile.enclosing"
		case 1:
			return "sameFile.sibling"
		default:
			return "sameFile.other"
		}
	case 1:
		return "sameDirectory"
	default:
		return "repoWide"
	}
}

// resolveSite is one reference occurrence's own coordinates, as needed by resolveName. StartByte
// is -1 for a bare-Name query with no real reference row (§4.3 step 4) — self-drop and tier 0's
// enclosing/sibling ordering both need a real site to compare against and are skipped without one.
type resolveSite struct {
	File                   codeindex.FileRow
	Kind                   string
	StartByte, EndByte     int
	NameStartByte, NameEnd int
}

// resolveName runs §5.1-§5.4 for one name, returning the winning tier's ranked, capped candidates
// and the confidence for the whole result. An empty result (nil, "") is a real "no definition
// found" answer, not an error — including Go's own deliberate empty result for an unexported name
// with no same-package candidate (§5.3).
func (g *Graph) resolveName(ctx context.Context, name string, refSymbols []codeindex.SymbolRow, site resolveSite) ([]candidate, Confidence, error) {
	rows, err := g.store.FindSymbolsByName(ctx, g.repoID, name)
	if err != nil {
		return nil, "", err
	}
	if len(rows) == 0 {
		return nil, "", nil
	}

	fileIDs := make([]int64, 0, len(rows))
	for _, r := range rows {
		fileIDs = append(fileIDs, r.FileID)
	}
	files, err := g.store.FilesByIDs(ctx, fileIDs)
	if err != nil {
		return nil, "", err
	}
	filesByID := make(map[int64]codeindex.FileRow, len(files))
	for _, f := range files {
		filesByID[f.ID] = f
	}

	var enclosing *codeindex.SymbolRow
	if site.StartByte >= 0 {
		enclosing = innermostEnclosingSymbol(refSymbols, site.StartByte, site.EndByte)
	}

	var candidates []candidate
	for _, row := range rows {
		f, ok := filesByID[row.FileID]
		if !ok {
			continue // a symbol whose file vanished between the two reads — skip rather than fail.
		}
		if site.StartByte >= 0 && f.Path == site.File.Path &&
			row.NameStartByte == site.NameStartByte && row.NameEndByte == site.NameEnd {
			continue // self-reference drop (§5.1 step 2).
		}
		tier := tierOf(f, site.File)
		rank := 2
		if tier == 0 {
			switch {
			case row.StartByte <= site.StartByte && row.EndByte >= site.EndByte:
				// The candidate's own span contains the reference — a recursive/self call.
				rank = 0
			case enclosing != nil && sameParent(row.ParentID, enclosing.ParentID):
				// The candidate and the reference's innermost enclosing definition share the
				// same parent — a sibling method in the same class, or another top-level
				// function in the same file (both have a nil parent).
				rank = 1
			}
		}
		candidates = append(candidates, candidate{sym: row, file: f, tier: tier, sameFileRank: rank})
	}
	if len(candidates) == 0 {
		return nil, "", nil
	}

	// P69b: a bare-identifier "read" reference (an argument, a binary operand, a slice bound) carries
	// no import or qualification evidence, so a name-based resolver genuinely can't tell a local from
	// a distant module-level constant sharing its name. Clamp to same-file-or-same-directory before
	// the Go rule below — every read site this phase indexes is already tier <= 1 by construction (a
	// package-level constant is read inside its own package), so this loses no real capability and
	// closes the cross-directory false positives a raw capture would otherwise return.
	if site.Kind == "read" {
		candidates = filterTierAtMost(candidates, 1)
		if len(candidates) == 0 {
			return nil, "", nil
		}
	}

	if site.File.Language == "go" && isUnexportedGoName(name) {
		candidates = filterTierAtMost(candidates, 1)
		if len(candidates) == 0 {
			return nil, "", nil
		}
	}

	bestTier := minTier(candidates)
	candidates = filterTier(candidates, bestTier)

	sortCandidates(candidates, site.Kind, site.File.Language, site.File.Path)
	if len(candidates) > maxCandidates {
		candidates = candidates[:maxCandidates]
	}

	confidence := RepoWide
	if bestTier <= 1 {
		if len(candidates) == 1 {
			confidence = Exact
		} else {
			confidence = Scoped
		}
	}
	for i := range candidates {
		candidates[i].rule = ruleFor(candidates[i].tier, candidates[i].sameFileRank)
	}
	return candidates, confidence, nil
}

// DefinitionOf resolves q to the definition(s) its name refers to. A cursor already on a
// definition's own name resolves to that definition itself (rule "self"); otherwise it runs
// §5.1-§5.4 for the resolved reference/name. An empty, nil-error result means "no definition
// found" — including Go's own deliberate empty answer for an unexported name outside its package.
func (g *Graph) DefinitionOf(ctx context.Context, q Query) ([]Target, error) {
	file, symbols, _, hit, err := g.locate(ctx, q)
	if err != nil {
		return nil, err
	}
	if !hit.Ok {
		return nil, nil
	}

	if hit.Sym != nil {
		t, err := g.targetFromSymbol(ctx, *hit.Sym, file, "self", Exact)
		if err != nil {
			return nil, err
		}
		return []Target{t}, nil
	}

	site := resolveSite{File: file, StartByte: -1, EndByte: -1, NameStartByte: -1, NameEnd: -1}
	if hit.Ref != nil {
		site.Kind = hit.Ref.Kind
		site.StartByte, site.EndByte = hit.Ref.StartByte, hit.Ref.EndByte
		site.NameStartByte, site.NameEnd = hit.Ref.NameStartByte, hit.Ref.NameEndByte
	}

	candidates, confidence, err := g.resolveName(ctx, hit.Name, symbols, site)
	if err != nil {
		return nil, err
	}
	targets := make([]Target, len(candidates))
	for i, c := range candidates {
		t, err := g.targetFromSymbol(ctx, c.sym, c.file, c.rule, confidence)
		if err != nil {
			return nil, err
		}
		targets[i] = t
	}
	return targets, nil
}
