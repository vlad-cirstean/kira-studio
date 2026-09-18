package codegraph

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// namedSymbol pairs a symbol row with its own file row — ImplementationsOf's own result unit,
// before it turns into a Target.
type namedSymbol struct {
	sym  codeindex.SymbolRow
	file codeindex.FileRow
}

// ImplementationsOf answers "which concrete implementations exist for this interface/trait/base
// type," per §6's own per-language semantics — real content differs by language because the
// stored evidence does:
//
//   - Go: method-name-only structural matching (methodsets.go), forward and reverse folded into
//     one call. No signature is stored or compared, so a result is never Exact, only Scoped
//     (§4.3) — honestly weaker evidence than every other language's containment recovery below.
//   - Rust: every "implementation" reference named q's own name IS the answer directly — the
//     reference's own stored range already covers the whole impl_item (trait or inherent), and no
//     row anywhere names the concrete type of a trait impl, so there is nothing to recover by
//     containment. Each becomes its own pseudo-target (SymbolID 0 — no real symbol row backs it).
//   - Everywhere else (Java, TypeScript, TSX, JavaScript, Python): containment recovery in both
//     directions — forward, every "implementation" reference elsewhere named q's own name recovers
//     its innermost enclosing symbol (the implementing class); reverse, every "implementation"
//     reference contained within q's own span names an interface/base type this concrete symbol
//     itself declares, resolved back to a real definition through the ordinary resolver.
func (g *Graph) ImplementationsOf(ctx context.Context, q Query) ([]Target, error) {
	file, symbols, _, hit, err := g.locate(ctx, q)
	if err != nil {
		return nil, err
	}
	if !hit.Ok {
		return nil, nil
	}

	name, cands, err := g.resolveTargets(ctx, file, symbols, hit)
	if err != nil {
		return nil, err
	}
	if name == "" {
		return nil, nil
	}

	var target *namedSymbol
	if len(cands) > 0 {
		target = &namedSymbol{sym: cands[0].sym, file: cands[0].file}
	}

	// The operating language is the resolved target's own (a cross-file query genuinely can
	// resolve into a different language than the caller's own file); with nothing resolved at
	// all, the caller's own file is the only language signal available.
	language := file.Language
	if target != nil {
		language = target.file.Language
	}

	switch language {
	case "go":
		return g.goImplementationsOf(ctx, name)
	case "rust":
		return g.rustImplementationsOf(ctx, name)
	default:
		results, err := g.containmentImplementationsOf(ctx, name, target)
		if err != nil {
			return nil, err
		}
		return g.targetsFromNamedSymbols(ctx, results)
	}
}

// rustImplementationsOf returns every "implementation" reference named name across Rust files,
// each as its own pseudo-target (the impl block's own location) — §6's own Rust behavior, forward
// and reverse folded into one lookup, since a Rust reference's own Name is either the trait name
// (a trait impl) or the type's own name (an inherent impl), both found the same way.
func (g *Graph) rustImplementationsOf(ctx context.Context, name string) ([]Target, error) {
	refs, err := g.store.ReferencesByName(ctx, g.repoID, name)
	if err != nil {
		return nil, err
	}
	files := fileCache{}
	var out []Target
	for _, r := range refs {
		if r.Kind != "implementation" {
			continue
		}
		rf, ok, err := g.cachedFile(ctx, files, r.FileID)
		if err != nil {
			return nil, err
		}
		if !ok || rf.Language != "rust" {
			continue
		}
		out = append(out, Target{
			Path: rf.Path, Language: rf.Language,
			Kind: "implementation", Name: r.Name,
			Span: referenceSpan(r), NameSpan: referenceNameSpan(r),
			Rule: "implementationsOf.implSite", Confidence: Exact,
		})
	}
	return out, nil
}

// containmentImplementationsOf is §6's shared Java/TypeScript/TSX/JavaScript/Python mechanism:
// forward (implementers of an interface/base type) via containment over every matching reference
// elsewhere, reverse (interfaces a concrete type itself declares) via containment the other way,
// resolved back to a real definition.
func (g *Graph) containmentImplementationsOf(ctx context.Context, name string, target *namedSymbol) ([]namedSymbol, error) {
	files := fileCache{}
	syms := symbolCache{}
	var out []namedSymbol
	seen := map[int64]bool{}
	add := func(ns namedSymbol) {
		if seen[ns.sym.ID] {
			return
		}
		seen[ns.sym.ID] = true
		out = append(out, ns)
	}

	if err := g.forwardContainmentImplementations(ctx, name, files, syms, add); err != nil {
		return nil, err
	}
	if err := g.reverseContainmentImplementations(ctx, target, syms, add); err != nil {
		return nil, err
	}
	return out, nil
}

// forwardContainmentImplementations is containmentImplementationsOf's own forward half: an
// "implementation" reference elsewhere named name recovers its own innermost enclosing symbol —
// the implementing/extending class — reported through add.
func (g *Graph) forwardContainmentImplementations(ctx context.Context, name string, files fileCache, syms symbolCache, add func(namedSymbol)) error {
	refs, err := g.store.ReferencesByName(ctx, g.repoID, name)
	if err != nil {
		return err
	}
	for _, r := range refs {
		if r.Kind != "implementation" {
			continue
		}
		rf, ok, err := g.cachedFile(ctx, files, r.FileID)
		if err != nil {
			return err
		}
		if !ok || rf.Language == "go" || rf.Language == "rust" {
			continue
		}
		fileSymbols, err := g.cachedSymbols(ctx, syms, r.FileID)
		if err != nil {
			return err
		}
		if enclosing := innermostEnclosingSymbol(fileSymbols, r.StartByte, r.EndByte); enclosing != nil {
			add(namedSymbol{sym: *enclosing, file: rf})
		}
	}
	return nil
}

// reverseContainmentImplementations is containmentImplementationsOf's own reverse half: an
// "implementation" reference contained within target's own span names an interface/base type
// target itself declares — resolved back to a real definition and reported through add. A nil
// target is a no-op.
func (g *Graph) reverseContainmentImplementations(ctx context.Context, target *namedSymbol, syms symbolCache, add func(namedSymbol)) error {
	if target == nil {
		return nil
	}
	fileSymbols, err := g.cachedSymbols(ctx, syms, target.sym.FileID)
	if err != nil {
		return err
	}
	fileRefs, err := g.store.ReferencesInFile(ctx, target.sym.FileID)
	if err != nil {
		return err
	}
	for _, r := range fileRefs {
		if r.Kind != "implementation" {
			continue
		}
		if r.StartByte < target.sym.StartByte || r.EndByte > target.sym.EndByte {
			continue
		}
		site := resolveSite{
			File: target.file, Kind: "implementation",
			StartByte: r.StartByte, EndByte: r.EndByte,
			NameStartByte: r.NameStartByte, NameEnd: r.NameEndByte,
		}
		declared, _, err := g.resolveName(ctx, r.Name, fileSymbols, site)
		if err != nil {
			return err
		}
		for _, c := range declared {
			add(namedSymbol{sym: c.sym, file: c.file})
		}
	}
	return nil
}

func (g *Graph) targetsFromNamedSymbols(ctx context.Context, results []namedSymbol) ([]Target, error) {
	targets := make([]Target, len(results))
	for i, ns := range results {
		t, err := g.targetFromSymbol(ctx, ns.sym, ns.file, "implementationsOf", Exact)
		if err != nil {
			return nil, err
		}
		targets[i] = t
	}
	return targets, nil
}
