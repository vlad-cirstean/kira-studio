package memory

import (
	"cmp"
	"context"
	"log/slog"
	"slices"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory/embed"
)

const (
	matchKeyword  = "keyword"
	matchSemantic = "semantic"
	matchBoth     = "both"

	rrfK = 60

	queryEmbedTimeout = 5 * time.Second
	docEmbedTimeout   = 10 * time.Second

	reconcileVectorCandidates = 5
)

// Embedder is embed.Client's seam. A nil Embedder turns semantic search off.
type Embedder interface {
	Spec() embed.Spec
	Embed(ctx context.Context, texts []string, query bool) ([][]float32, error)
	Status() embed.Status
}

type hit struct {
	seq   int64
	match string
}

// fuse merges two ranked lists (best first) by reciprocal rank fusion over their union. Ties go to
// the better keyword rank; the newer memory only keeps the order deterministic. No score cutoff: recall-first.
func fuse(fts, vec []hit, limit int) []hit {
	type entry struct {
		hit
		score   float64
		ftsRank int
	}
	byseq := map[int64]*entry{}
	add := func(list []hit, kw bool) {
		for i, h := range list {
			e := byseq[h.seq]
			if e == nil {
				e = &entry{hit: hit{seq: h.seq}, ftsRank: len(fts) + 1}
				byseq[h.seq] = e
			}
			e.score += 1 / float64(rrfK+i+1)
			switch {
			case kw:
				e.ftsRank = i
				e.match = matchKeyword
			case e.match == matchKeyword:
				e.match = matchBoth
			default:
				e.match = matchSemantic
			}
		}
	}
	add(fts, true)
	add(vec, false)
	all := make([]*entry, 0, len(byseq))
	for _, e := range byseq {
		all = append(all, e)
	}
	slices.SortFunc(all, func(a, b *entry) int {
		return cmp.Or(cmp.Compare(b.score, a.score), cmp.Compare(a.ftsRank, b.ftsRank), cmp.Compare(b.seq, a.seq))
	})
	if len(all) > limit {
		all = all[:limit]
	}
	out := make([]hit, len(all))
	for i, e := range all {
		out[i] = e.hit
	}
	return out
}

// Search is recall-first: keyword matches (bm25) fused with semantic matches (vector similarity)
// when the embedding model is ready, keyword matches alone otherwise.
func (s *Service) Search(ctx context.Context, a SearchArgs) ([]Memory, error) {
	if _, ok := BuildMatch(a.Query); !ok {
		return []Memory{}, nil
	}
	limit := clampLimit(a.Limit)
	ftsMems, err := s.store.searchFTS(ctx, SearchArgs{Query: a.Query, IncludeHistory: a.IncludeHistory, Limit: limit})
	if err != nil {
		return nil, err
	}
	defer s.kickBackfill()

	vecHits, err := s.semanticHits(ctx, a, limit)
	if err != nil {
		return nil, err
	}
	if len(vecHits) == 0 {
		for i := range ftsMems {
			ftsMems[i].Match = matchKeyword
		}
		return ftsMems, nil
	}

	have := make(map[int64]Memory, len(ftsMems))
	ftsHits := make([]hit, len(ftsMems))
	for i, m := range ftsMems {
		have[m.seq] = m
		ftsHits[i] = hit{seq: m.seq}
	}
	fused := fuse(ftsHits, vecHits, limit)
	var missing []int64
	for _, h := range fused {
		if _, ok := have[h.seq]; !ok {
			missing = append(missing, h.seq)
		}
	}
	loaded, err := s.store.memoriesBySeq(ctx, missing)
	if err != nil {
		return nil, err
	}
	out := make([]Memory, 0, len(fused))
	for _, h := range fused {
		m, ok := have[h.seq]
		if !ok {
			if m, ok = loaded[h.seq]; !ok {
				continue
			}
		}
		m.Match = h.match
		out = append(out, m)
	}
	return out, nil
}

// semanticHits is the vector list for a query, empty when semantic search is unavailable. An
// embedder failure is not a search failure: the caller falls back to keyword matches.
func (s *Service) semanticHits(ctx context.Context, a SearchArgs, limit int) ([]hit, error) {
	emb := s.opts.Embedder
	if emb == nil || emb.Status().State != embed.StateReady {
		return nil, nil
	}
	model := emb.Spec().ID
	have, _, err := s.store.embeddingCounts(ctx, model)
	if err != nil || have == 0 {
		return nil, err
	}
	qctx, cancel := context.WithTimeout(ctx, queryEmbedTimeout)
	defer cancel()
	vecs, err := emb.Embed(qctx, []string{a.Query}, true)
	if err != nil || len(vecs) != 1 {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		slog.Debug("memory: query embedding failed; keyword results only", "err", err)
		return nil, nil
	}
	top, err := s.store.vectorTopK(ctx, model, vecs[0], a.IncludeHistory, limit)
	if err != nil {
		return nil, err
	}
	out := make([]hit, len(top))
	for i, t := range top {
		out[i] = hit{seq: t.seq}
	}
	return out, nil
}
