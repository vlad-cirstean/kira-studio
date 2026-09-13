package codegraph

import (
	"context"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

const (
	defaultRefLimit = 500
	maxRefLimit     = 2000
)

// resolveTargets returns the definition(s) q's own position/name refers to, plus the resolved
// name itself — DefinitionOf's own first half, reused by ReferencesTo and ImplementationsOf so
// all three start from the identical resolution.
func (g *Graph) resolveTargets(ctx context.Context, file codeindex.FileRow, symbols []codeindex.SymbolRow, hit queryHit) (string, []candidate, error) {
	if hit.Sym != nil {
		return hit.Sym.Name, []candidate{{sym: *hit.Sym, file: file, tier: 0, rule: "self"}}, nil
	}
	site := resolveSite{File: file, StartByte: -1, EndByte: -1, NameStartByte: -1, NameEnd: -1}
	if hit.Ref != nil {
		site.Kind = hit.Ref.Kind
		site.StartByte, site.EndByte = hit.Ref.StartByte, hit.Ref.EndByte
		site.NameStartByte, site.NameEnd = hit.Ref.NameStartByte, hit.Ref.NameEndByte
	}
	cands, _, err := g.resolveName(ctx, hit.Name, symbols, site)
	return hit.Name, cands, err
}

// fileCache/symbolCache spare a second round trip for a file or its symbols already read once in
// this call — ReferencesTo and ImplementationsOf both revisit the same handful of files across
// many reference rows.
type fileCache map[int64]codeindex.FileRow
type symbolCache map[int64][]codeindex.SymbolRow

func (g *Graph) cachedFile(ctx context.Context, cache fileCache, fileID int64) (codeindex.FileRow, bool, error) {
	if f, ok := cache[fileID]; ok {
		return f, true, nil
	}
	f, ok, err := g.store.FileByID(ctx, fileID)
	if err != nil || !ok {
		return codeindex.FileRow{}, false, err
	}
	cache[fileID] = f
	return f, true, nil
}

func (g *Graph) cachedSymbols(ctx context.Context, cache symbolCache, fileID int64) ([]codeindex.SymbolRow, error) {
	if s, ok := cache[fileID]; ok {
		return s, nil
	}
	s, err := g.store.SymbolsInFile(ctx, fileID)
	if err != nil {
		return nil, err
	}
	cache[fileID] = s
	return s, nil
}

func clampRefLimit(limit int) int {
	if limit <= 0 {
		return defaultRefLimit
	}
	if limit > maxRefLimit {
		return maxRefLimit
	}
	return limit
}

// isSelfSite reports whether ref is one of targets' own self-covering occurrence — e.g. Go's
// (type_identifier) @name @reference.type, which makes a type definition's own name also a
// reference to itself. Excluded from ReferencesTo's own Sites regardless of mode; IncludeDefinition
// adds the same location back deliberately, as the definition's own NameSpan rather than a "use."
func isSelfSite(ref codeindex.ReferenceRow, refFile codeindex.FileRow, targets []candidate) bool {
	for _, t := range targets {
		if t.file.Path == refFile.Path &&
			ref.NameStartByte == t.sym.NameStartByte && ref.NameEndByte == t.sym.NameEndByte {
			return true
		}
	}
	return false
}

// ReferencesTo finds occurrences of q's own name (§5.5). Resolved (the default) runs the resolver
// for every candidate reference sharing the name and keeps the ones whose own winning target set
// intersects q's target, memoized per directory of the referring file (within one call, name is
// already fixed and tier membership never depends on the reference's own kind — only ranking
// does) — so a name used many times across few directories costs one resolution per directory, not
// one per occurrence. NameOnly skips resolution entirely, trading precision for recall (a
// grep-shaped caller). IncludeDefinition adds the target's own NameSpan as a Site.
func (g *Graph) ReferencesTo(ctx context.Context, q Query, opt RefOpts) (Refs, error) {
	file, symbols, _, hit, err := g.locate(ctx, q)
	if err != nil {
		return Refs{}, err
	}
	if !hit.Ok {
		return Refs{}, nil
	}

	name, targets, err := g.resolveTargets(ctx, file, symbols, hit)
	if err != nil {
		return Refs{}, err
	}
	if name == "" {
		return Refs{}, nil
	}

	mode := opt.Mode
	if mode == "" {
		mode = Resolved
	}
	limit := clampRefLimit(opt.Limit)

	kindSet := map[string]bool{}
	for _, k := range opt.Kinds {
		kindSet[k] = true
	}

	refRows, err := g.store.ReferencesByName(ctx, g.repoID, name)
	if err != nil {
		return Refs{}, err
	}

	files := fileCache{}
	symbolsByFile := symbolCache{}
	// groupTargets memoizes, per directory, the set of symbol ids a reference to name from some
	// file in that directory would resolve to (§5.5). Tier membership never depends on the
	// reference's own kind (only ranking does, and ranking doesn't matter for "does this
	// reference's own winning set intersect the target" — a boolean question), so the memo needs
	// no kind dimension at all despite name/kind together bounding what counts as a "candidate
	// reference" in the first place (the kindSet filter above, and r.Kind on each returned Site).
	groupTargets := map[string]map[int64]bool{}

	targetIDs := make(map[int64]bool, len(targets))
	for _, t := range targets {
		targetIDs[t.sym.ID] = true
	}

	var sites []Site
	total := 0
	for _, r := range refRows {
		if len(kindSet) > 0 && !kindSet[r.Kind] {
			continue
		}
		rf, ok, err := g.cachedFile(ctx, files, r.FileID)
		if err != nil {
			return Refs{}, err
		}
		if !ok || isSelfSite(r, rf, targets) {
			continue
		}

		included := mode == NameOnly
		if !included {
			dir := dirOf(rf.Path)
			ids, ok := groupTargets[dir]
			if !ok {
				ids, err = g.groupResolutionTargets(ctx, dir, name)
				if err != nil {
					return Refs{}, err
				}
				groupTargets[dir] = ids
			}
			for id := range targetIDs {
				if ids[id] {
					included = true
					break
				}
			}
		}
		if !included {
			continue
		}

		total++
		if len(sites) >= limit {
			continue
		}
		fileSymbols, err := g.cachedSymbols(ctx, symbolsByFile, r.FileID)
		if err != nil {
			return Refs{}, err
		}
		enclosingName := ""
		if enc := innermostEnclosingSymbol(fileSymbols, r.StartByte, r.EndByte); enc != nil {
			enclosingName = enc.Name
		}
		sites = append(sites, Site{
			Path: rf.Path, Language: rf.Language,
			Kind: r.Kind, Name: r.Name,
			Span: referenceSpan(r), NameSpan: referenceNameSpan(r),
			Enclosing: enclosingName,
		})
	}

	if opt.IncludeDefinition {
		for _, t := range targets {
			enclosingName := ""
			if t.sym.ParentID != nil {
				if parent, ok, err := g.store.SymbolByID(ctx, *t.sym.ParentID); err == nil && ok {
					enclosingName = parent.Name
				}
			}
			total++
			if len(sites) < limit {
				sites = append(sites, Site{
					Path: t.file.Path, Language: t.file.Language,
					Kind: t.sym.Kind, Name: t.sym.Name,
					Span: symbolSpan(t.sym), NameSpan: symbolNameSpan(t.sym),
					Enclosing: enclosingName,
				})
			}
		}
	}

	return Refs{Sites: sites, Total: total, Truncated: total > len(sites)}, nil
}

// groupResolutionTargets is ReferencesTo's own memoized computation: which symbols (by id) would a
// reference to name, sitting somewhere in directory dir, resolve to? Implemented as one resolveName
// call against a synthetic file path inside dir that matches no real file — so no candidate can
// ever land in tier 0 relative to it, modeling "some file in this directory, exact file
// unspecified" directly: a same-directory candidate lands in tier 1, everything else in tier 2,
// exactly the two tiers the memo key itself is defined over.
func (g *Graph) groupResolutionTargets(ctx context.Context, dir, name string) (map[int64]bool, error) {
	sentinel := codeindex.FileRow{Path: dir + "/\x00"}
	site := resolveSite{File: sentinel, StartByte: -1, EndByte: -1, NameStartByte: -1, NameEnd: -1}
	cands, _, err := g.resolveName(ctx, name, nil, site)
	if err != nil {
		return nil, err
	}
	ids := make(map[int64]bool, len(cands))
	for _, c := range cands {
		ids[c.sym.ID] = true
	}
	return ids, nil
}
