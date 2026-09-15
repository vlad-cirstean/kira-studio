package codegraph

import (
	"context"
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// spanFromBytes builds a Span whose End point is derived from Start assuming the range stays on
// Start's own line — see Span's own doc comment for why (no end row/column is stored for a
// reference row at all).
func spanFromBytes(startByte, endByte int, start Point) Span {
	return Span{
		StartByte: startByte,
		EndByte:   endByte,
		Start:     start,
		End:       Point{Row: start.Row, Column: start.Column + (endByte - startByte)},
	}
}

func symbolSpan(sym codeindex.SymbolRow) Span {
	return Span{
		StartByte: sym.StartByte,
		EndByte:   sym.EndByte,
		Start:     Point{Row: sym.StartRow, Column: sym.StartColumn},
		End:       Point{Row: sym.EndRow, Column: sym.EndColumn},
	}
}

// symbolNameSpan is exact, not approximate: an identifier never spans a line in any language in
// scope (§4.3), so spanFromBytes' same-line assumption always holds here.
func symbolNameSpan(sym codeindex.SymbolRow) Span {
	return spanFromBytes(sym.NameStartByte, sym.NameEndByte, Point{Row: sym.NameStartRow, Column: sym.NameStartColumn})
}

func referenceSpan(ref codeindex.ReferenceRow) Span {
	return spanFromBytes(ref.StartByte, ref.EndByte, Point{Row: ref.StartRow, Column: ref.StartColumn})
}

// referenceNameSpan is exact, same reasoning as symbolNameSpan.
func referenceNameSpan(ref codeindex.ReferenceRow) Span {
	return spanFromBytes(ref.NameStartByte, ref.NameEndByte, Point{Row: ref.NameStartRow, Column: ref.NameStartColumn})
}

// queryHit is what a Query resolved to (§4.3): a reference's own name, a symbol's own name (the
// cursor landed on a definition's own identifier), or a bare name with neither — §7's
// template-fallback path, and the Name-only Query shape ReferencesTo/DefinitionOf accept directly.
type queryHit struct {
	Name string
	Ref  *codeindex.ReferenceRow
	Sym  *codeindex.SymbolRow
	Ok   bool
}

// resolveHit runs §4.3's numbered steps 2-4 over one file's already-loaded symbols/references. A
// symbol match at the exact query position always wins over a reference match there: a symbol row
// only ever exists at a genuine declaration site, so it's strictly more specific than a
// same-position reference — and some languages' tags.scm deliberately double-capture a
// declaration's own name node as both (e.g. Go's blanket `(type_identifier) @name @reference.type`
// alongside `type_spec`'s own `@definition.type`, so a type's own name is also stored as a
// self-referencing reference row at the identical span; see isSelfSite in references.go for the
// same quirk handled on the ReferencesTo path). Checking symbols first here is what lets a Point/
// Byte query landing on a declaration's own name resolve as a definition (hit.Sym) instead of
// spuriously chasing "what does this reference refer to" and finding nothing.
func resolveHit(q Query, symbols []codeindex.SymbolRow, references []codeindex.ReferenceRow) queryHit {
	switch {
	case q.Point != nil:
		if sym := symbolByNamePoint(symbols, *q.Point); sym != nil {
			return queryHit{Name: sym.Name, Sym: sym, Ok: true}
		}
		if ref := referenceByNamePoint(references, *q.Point); ref != nil {
			return queryHit{Name: ref.Name, Ref: ref, Ok: true}
		}
		// Neither point lookup hit — the common case for a caller-supplied line with no real byte
		// column (repomap/locator.go defaults one to 1, which rarely lands inside an identifier's
		// own name span). Fall back to the row itself: the leftmost symbol/reference whose name
		// starts on q.Point.Row, pinned to q.Name when the caller gave one. Symbols before
		// references, same precedence as the point path above and for the same reason
		// (symbolByNamePoint's own doc comment).
		if sym := symbolOnRow(symbols, q.Point.Row, q.Name); sym != nil {
			return queryHit{Name: sym.Name, Sym: sym, Ok: true}
		}
		if ref := referenceOnRow(references, q.Point.Row, q.Name); ref != nil {
			return queryHit{Name: ref.Name, Ref: ref, Ok: true}
		}
	case q.Byte >= 0:
		if sym := symbolByNameByte(symbols, q.Byte); sym != nil {
			return queryHit{Name: sym.Name, Sym: sym, Ok: true}
		}
		if ref := referenceByNameByte(references, q.Byte); ref != nil {
			return queryHit{Name: ref.Name, Ref: ref, Ok: true}
		}
		if ref := innermostReferenceNode(references, q.Byte); ref != nil {
			return queryHit{Name: ref.Name, Ref: ref, Ok: true}
		}
	}
	if q.Name != "" {
		return queryHit{Name: q.Name, Ok: true}
	}
	return queryHit{}
}

// referenceByNamePoint/symbolByNamePoint/referenceByNameByte/innermostReferenceNode/
// symbolByNameByte each pick the innermost (largest StartByte) match among candidates whose own
// range contains the query position — §4.3's own tie-break for "innermost," applied uniformly to
// both Point and Byte lookups even though only the Byte case states it explicitly.

func referenceByNamePoint(refs []codeindex.ReferenceRow, p Point) *codeindex.ReferenceRow {
	var best *codeindex.ReferenceRow
	for i := range refs {
		r := &refs[i]
		if r.NameStartRow != p.Row {
			continue
		}
		length := r.NameEndByte - r.NameStartByte
		if p.Column >= r.NameStartColumn && p.Column < r.NameStartColumn+length {
			if best == nil || r.StartByte > best.StartByte {
				best = r
			}
		}
	}
	return best
}

func symbolByNamePoint(syms []codeindex.SymbolRow, p Point) *codeindex.SymbolRow {
	var best *codeindex.SymbolRow
	for i := range syms {
		s := &syms[i]
		if s.NameStartRow != p.Row {
			continue
		}
		length := s.NameEndByte - s.NameStartByte
		if p.Column >= s.NameStartColumn && p.Column < s.NameStartColumn+length {
			if best == nil || s.StartByte > best.StartByte {
				best = s
			}
		}
	}
	return best
}

func referenceByNameByte(refs []codeindex.ReferenceRow, b int) *codeindex.ReferenceRow {
	var best *codeindex.ReferenceRow
	for i := range refs {
		r := &refs[i]
		if b >= r.NameStartByte && b < r.NameEndByte {
			if best == nil || r.StartByte > best.StartByte {
				best = r
			}
		}
	}
	return best
}

// innermostReferenceNode falls back to a reference's own (wider) node span when b lands outside
// every reference's name span but still inside a reference node — e.g. Java's method_invocation,
// whose stored range starts at the receiver, before the method name.
func innermostReferenceNode(refs []codeindex.ReferenceRow, b int) *codeindex.ReferenceRow {
	var best *codeindex.ReferenceRow
	for i := range refs {
		r := &refs[i]
		if b >= r.StartByte && b < r.EndByte {
			if best == nil || r.StartByte > best.StartByte {
				best = r
			}
		}
	}
	return best
}

// symbolOnRow/referenceOnRow are resolveHit's own row-scoped fallback (repomap/locator.go's
// file+line locator has no real byte column to pin a point lookup to): every symbol/reference
// whose name starts on row, filtered to name when the caller gave one, leftmost (smallest
// NameStartByte) among the rest — the same "several matches, pick one" shape symbolByNamePoint
// already resolves via innermost, applied here to "same row" instead of "same point."

func symbolOnRow(syms []codeindex.SymbolRow, row int, name string) *codeindex.SymbolRow {
	var best *codeindex.SymbolRow
	for i := range syms {
		s := &syms[i]
		if s.NameStartRow != row {
			continue
		}
		if name != "" && s.Name != name {
			continue
		}
		if best == nil || s.NameStartByte < best.NameStartByte {
			best = s
		}
	}
	return best
}

func referenceOnRow(refs []codeindex.ReferenceRow, row int, name string) *codeindex.ReferenceRow {
	var best *codeindex.ReferenceRow
	for i := range refs {
		r := &refs[i]
		if r.NameStartRow != row {
			continue
		}
		if name != "" && r.Name != name {
			continue
		}
		if best == nil || r.NameStartByte < best.NameStartByte {
			best = r
		}
	}
	return best
}

func symbolByNameByte(syms []codeindex.SymbolRow, b int) *codeindex.SymbolRow {
	var best *codeindex.SymbolRow
	for i := range syms {
		s := &syms[i]
		if b >= s.NameStartByte && b < s.NameEndByte {
			if best == nil || s.StartByte > best.StartByte {
				best = s
			}
		}
	}
	return best
}

// loadFile resolves q.Path to its file/symbol/reference rows — every Graph method that starts
// from a path opens with this (§4.3 step 1: "two indexed reads").
func (g *Graph) loadFile(ctx context.Context, path string) (codeindex.FileRow, []codeindex.SymbolRow, []codeindex.ReferenceRow, error) {
	file, ok, err := g.store.GetFile(ctx, g.repoID, path)
	if err != nil {
		return codeindex.FileRow{}, nil, nil, err
	}
	if !ok {
		return codeindex.FileRow{}, nil, nil, fmt.Errorf("codegraph: no file %q in repo %q", path, g.repoID)
	}
	symbols, err := g.store.SymbolsInFile(ctx, file.ID)
	if err != nil {
		return codeindex.FileRow{}, nil, nil, err
	}
	references, err := g.store.ReferencesInFile(ctx, file.ID)
	if err != nil {
		return codeindex.FileRow{}, nil, nil, err
	}
	return file, symbols, references, nil
}

// locate is loadFile plus resolveHit — what DefinitionOf/ImplementationsOf/ReferencesTo/SymbolAt
// all start from when given a path-scoped Query.
func (g *Graph) locate(ctx context.Context, q Query) (codeindex.FileRow, []codeindex.SymbolRow, []codeindex.ReferenceRow, queryHit, error) {
	file, symbols, references, err := g.loadFile(ctx, q.Path)
	if err != nil {
		return codeindex.FileRow{}, nil, nil, queryHit{}, err
	}
	return file, symbols, references, resolveHit(q, symbols, references), nil
}

// symbolsByID indexes a file's own symbol set by id — containerFromSymbols' own lookup table when
// the caller already holds the whole file's symbols (position.go, outline.go), sparing a
// round trip to containerChain per ancestor.
func symbolsByID(symbols []codeindex.SymbolRow) map[int64]codeindex.SymbolRow {
	byID := make(map[int64]codeindex.SymbolRow, len(symbols))
	for _, s := range symbols {
		byID[s.ID] = s
	}
	return byID
}

func containerFromSymbols(sym codeindex.SymbolRow, byID map[int64]codeindex.SymbolRow) string {
	var chain []string
	cur := sym
	for cur.ParentID != nil {
		parent, ok := byID[*cur.ParentID]
		if !ok {
			break
		}
		chain = append(chain, parent.Name)
		cur = parent
	}
	return joinReversed(chain)
}

// SymbolAt reports the definition whose own name the query's position lands on — nothing when the
// position lands on a reference (use DefinitionOf for "what does this name refer to") or on
// neither.
func (g *Graph) SymbolAt(ctx context.Context, q Query) (Target, bool, error) {
	file, symbols, _, hit, err := g.locate(ctx, q)
	if err != nil {
		return Target{}, false, err
	}
	if !hit.Ok || hit.Sym == nil {
		return Target{}, false, nil
	}
	byID := symbolsByID(symbols)
	return Target{
		SymbolID:   hit.Sym.ID,
		Path:       file.Path,
		Language:   file.Language,
		Kind:       hit.Sym.Kind,
		Name:       hit.Sym.Name,
		Container:  containerFromSymbols(*hit.Sym, byID),
		Span:       symbolSpan(*hit.Sym),
		NameSpan:   symbolNameSpan(*hit.Sym),
		Rule:       "position",
		Confidence: Exact,
	}, true, nil
}
