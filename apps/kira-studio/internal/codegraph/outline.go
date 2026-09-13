package codegraph

import (
	"context"
	"sort"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

// Outline returns path's definition tree — a parent-id walk over rows C1 already linked, no file
// bytes read. Root-level nodes (ParentID nil) come first, each ordered by StartByte; every level
// below is ordered the same way.
func (g *Graph) Outline(ctx context.Context, path string) ([]Node, error) {
	file, ok, err := g.store.GetFile(ctx, g.repoID, path)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, nil
	}
	symbols, err := g.store.SymbolsInFile(ctx, file.ID)
	if err != nil {
		return nil, err
	}
	return buildOutline(symbols), nil
}

func buildOutline(symbols []codeindex.SymbolRow) []Node {
	children := map[int64][]codeindex.SymbolRow{}
	var roots []codeindex.SymbolRow
	for _, s := range symbols {
		if s.ParentID == nil {
			roots = append(roots, s)
			continue
		}
		children[*s.ParentID] = append(children[*s.ParentID], s)
	}

	var build func([]codeindex.SymbolRow) []Node
	build = func(syms []codeindex.SymbolRow) []Node {
		if len(syms) == 0 {
			return nil
		}
		sort.Slice(syms, func(i, j int) bool { return syms[i].StartByte < syms[j].StartByte })
		nodes := make([]Node, len(syms))
		for i, s := range syms {
			nodes[i] = Node{
				SymbolID: s.ID,
				Kind:     s.Kind,
				Name:     s.Name,
				Span:     symbolSpan(s),
				NameSpan: symbolNameSpan(s),
				Children: build(children[s.ID]),
			}
		}
		return nodes
	}
	return build(roots)
}
