package memory

import (
	"context"
	"log/slog"
	"math"
	"time"

	"github.com/kirathecat/kira-studio/internal/memory/embed"
)

const (
	matchKeyword  = "keyword"
	matchSemantic = "semantic"
	matchBoth     = "both"

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

// semanticPool is the vector candidates of a query with the model's cosine band. ok is false when
// semantic search is unavailable; an embedder failure is not a search failure, the caller falls back
// to keyword matches.
func (s *Service) semanticPool(ctx context.Context, a SearchArgs, f filter, pool int) (top []scored, spec embed.Spec, ok bool, err error) {
	emb := s.opts.Embedder
	if emb == nil || emb.Status().State != embed.StateReady {
		return nil, spec, false, nil
	}
	spec = emb.Spec()
	have, _, err := s.store.embeddingCounts(ctx, spec.ID)
	if err != nil || have == 0 {
		return nil, spec, false, err
	}
	qctx, cancel := context.WithTimeout(ctx, queryEmbedTimeout)
	defer cancel()
	vecs, err := emb.Embed(qctx, []string{a.Query}, true)
	if err != nil || len(vecs) != 1 {
		if ctx.Err() != nil {
			return nil, spec, false, ctx.Err()
		}
		slog.Debug("memory: query embedding failed; keyword results only", "scope", "memory", "err", err)
		return nil, spec, false, nil
	}
	top, err = s.store.vectorTopK(ctx, spec.ID, vecs[0], pool, f)
	return top, spec, err == nil, err
}

// checkSearchArgs rejects values outside the closed sets.
func checkSearchArgs(a SearchArgs) error {
	for _, sc := range a.Scopes {
		if sc != ScopeCompany && sc != ScopeProject && sc != ScopePersonal {
			return invalid("scopes: %q is not company, project or personal", sc)
		}
	}
	for _, o := range a.Origins {
		if GradeOf(o) == 0 {
			return invalid("origins: %q is not user, agent or external", o)
		}
	}
	if a.Project != "" {
		return checkProject(a.Project)
	}
	return nil
}

type candidate struct {
	m      Memory
	inKW   bool
	bm25   float64
	inSem  bool
	cosine float32
}

// Search is recall-first: keyword matches (bm25) and semantic matches (cosine) from wide candidate
// pools, scored per source, fused, boosted by provenance and cut to the limit. Semantic search is
// skipped when the embedding model is not ready.
func (s *Service) Search(ctx context.Context, a SearchArgs) ([]Memory, error) {
	terms := matchTerms(a.Query)
	if len(terms) == 0 {
		return []Memory{}, nil
	}
	if err := checkSearchArgs(a); err != nil {
		return nil, err
	}
	match, _ := BuildMatch(a.Query)
	limit := clampLimit(a.Limit)
	pool := poolSize(limit)
	f := a.filter()
	ftsRows, err := s.store.searchFTSRows(ctx, match, f, pool)
	if err != nil {
		return nil, err
	}
	defer s.kickBackfill()
	vecTop, spec, semantic, err := s.semanticPool(ctx, a, f, pool)
	if err != nil {
		return nil, err
	}

	semantic = semantic && len(vecTop) > 0
	cands := make(map[int64]*candidate, len(ftsRows)+len(vecTop))
	best := 0.0
	for _, r := range ftsRows {
		cands[r.seq] = &candidate{m: r.Memory, inKW: true, bm25: r.bm25}
		best = math.Max(best, r.bm25)
	}
	var missing []int64
	for _, v := range vecTop {
		c := cands[v.seq]
		if c == nil {
			c = &candidate{}
			cands[v.seq] = c
			missing = append(missing, v.seq)
		}
		c.inSem, c.cosine = true, v.score
	}
	loaded, err := s.store.memoriesBySeq(ctx, missing)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	ranked := make([]rankedMemory, 0, len(cands))
	for seq, c := range cands {
		if !c.inKW {
			m, ok := loaded[seq]
			if !ok {
				continue
			}
			c.m = m
		}
		var kw, sem float64
		if c.inKW {
			kw = keywordPart(c.bm25, best, coverage(terms, c.m))
		}
		if c.inSem {
			sem = semanticPart(c.cosine, spec.QueryFloor, spec.QueryCeil)
		}
		if !c.inKW && sem == 0 {
			continue
		}
		m := c.m
		switch {
		case c.inKW && sem > 0:
			m.Match = matchBoth
		case c.inKW:
			m.Match = matchKeyword
		default:
			m.Match = matchSemantic
		}
		ranked = append(ranked, rankedMemory{Memory: m, score: newScore(m, kw, sem, semantic, a.Project, now)})
	}
	sortRanked(ranked)
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	return s.finishRanking(ctx, ranked)
}

// finishRanking applies the group boost over the cut list, re-sorts and attaches scores.
func (s *Service) finishRanking(ctx context.Context, ranked []rankedMemory) ([]Memory, error) {
	lineages := make([]string, len(ranked))
	for i, r := range ranked {
		lineages[i] = r.LineageID
	}
	stats, err := s.store.groupStats(ctx, lineages)
	if err != nil {
		return nil, err
	}
	for i := range ranked {
		st := stats[ranked[i].LineageID]
		ranked[i].score.applyGroup(st.peers)
		ranked[i].ContextCount = st.context
	}
	sortRanked(ranked)
	out := make([]Memory, len(ranked))
	for i, r := range ranked {
		sc := r.score
		r.Memory.Score = &sc
		out[i] = r.Memory
	}
	return out, nil
}
