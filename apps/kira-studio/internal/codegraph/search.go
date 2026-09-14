package codegraph

import (
	"context"
	"sort"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codeindex"
)

const (
	defaultSearchLimit = 50
	maxSearchLimit     = 200
)

// escapeLike escapes a user-supplied SQL LIKE pattern's own special characters, matched back via
// `ESCAPE '\'` in codeindex's own query text — §4.3's "bounded LIKE scan," never a fuzzy-match
// dependency.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, "%", `\%`)
	s = strings.ReplaceAll(s, "_", `\_`)
	return s
}

func clampLimit(limit int) int {
	if limit <= 0 {
		return defaultSearchLimit
	}
	if limit > maxSearchLimit {
		return maxSearchLimit
	}
	return limit
}

// SearchSymbols runs s.Text as a prefix match (or, with Substring, a substring match) against
// every symbol name in the repository, optionally narrowed to Kinds/Languages, ranked in Go: exact
// match first, then prefix, then earliest match offset, then shorter name, then path (§4.3).
func (g *Graph) SearchSymbols(ctx context.Context, s SymbolSearch) ([]Target, error) {
	limit := clampLimit(s.Limit)
	pattern := escapeLike(s.Text)
	if s.Substring {
		pattern = "%" + pattern + "%"
	} else {
		pattern += "%"
	}

	pathPattern := ""
	if s.PathPrefix != "" {
		pathPattern = escapeLike(s.PathPrefix) + "%"
	}

	// Overfetch ahead of Go-side ranking: SQL's own ORDER BY (name, path, start_byte) is not the
	// rank this function promises, so the candidate set feeding that rank needs to be wider than
	// the final limit.
	hits, err := g.store.SearchSymbols(ctx, g.repoID, pattern, s.Kinds, s.Languages, pathPattern, limit*5)
	if err != nil {
		return nil, err
	}

	needle := strings.ToLower(s.Text)
	sort.SliceStable(hits, func(i, j int) bool { return less(hits[i], hits[j], needle) })
	if len(hits) > limit {
		hits = hits[:limit]
	}

	out := make([]Target, len(hits))
	for i, hit := range hits {
		container, err := g.containerChain(ctx, hit.SymbolRow)
		if err != nil {
			return nil, err
		}
		out[i] = Target{
			SymbolID:   hit.ID,
			Path:       hit.Path,
			Language:   hit.Language,
			Kind:       hit.Kind,
			Name:       hit.Name,
			Container:  container,
			Span:       symbolSpan(hit.SymbolRow),
			NameSpan:   symbolNameSpan(hit.SymbolRow),
			Rule:       "search",
			Confidence: Exact,
		}
	}
	return out, nil
}

func less(a, b codeindex.SymbolHit, needle string) bool {
	aLower, bLower := strings.ToLower(a.Name), strings.ToLower(b.Name)
	if (aLower == needle) != (bLower == needle) {
		return aLower == needle
	}
	if strings.HasPrefix(aLower, needle) != strings.HasPrefix(bLower, needle) {
		return strings.HasPrefix(aLower, needle)
	}
	aIdx, bIdx := strings.Index(aLower, needle), strings.Index(bLower, needle)
	if aIdx != bIdx {
		return aIdx < bIdx
	}
	if len(a.Name) != len(b.Name) {
		return len(a.Name) < len(b.Name)
	}
	return a.Path < b.Path
}

// SearchFiles runs s.Text as a substring match over the repository's own file paths, ranked by
// earliest match offset, then shorter path, then path itself.
func (g *Graph) SearchFiles(ctx context.Context, s FileSearch) ([]FileHit, error) {
	limit := clampLimit(s.Limit)
	pattern := "%" + escapeLike(s.Text) + "%"
	pathPattern := ""
	if s.PathPrefix != "" {
		pathPattern = escapeLike(s.PathPrefix) + "%"
	}

	rows, err := g.store.SearchFiles(ctx, g.repoID, pattern, pathPattern, limit*5)
	if err != nil {
		return nil, err
	}

	needle := strings.ToLower(s.Text)
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := strings.ToLower(rows[i].Path), strings.ToLower(rows[j].Path)
		aIdx, bIdx := strings.Index(a, needle), strings.Index(b, needle)
		if aIdx != bIdx {
			return aIdx < bIdx
		}
		if len(a) != len(b) {
			return len(a) < len(b)
		}
		return a < b
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}

	out := make([]FileHit, len(rows))
	for i, r := range rows {
		out[i] = FileHit{Path: r.Path, Language: r.Language, LineCount: r.LineCount}
	}
	return out, nil
}
