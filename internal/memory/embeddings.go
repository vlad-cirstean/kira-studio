package memory

import (
	"context"
	"log/slog"

	"github.com/kirathecat/kira-studio/internal/memory/embed"
)

const backfillBatch = embed.MaxBatch

// Semantic states reported by SemanticStatus. The bridge adds "downloading" while an install runs.
const (
	SemanticOff          = "off"
	SemanticNotInstalled = "notInstalled"
	SemanticUnavailable  = "unavailable"
	SemanticIndexing     = "indexing"
	SemanticReady        = "ready"
	SemanticDownloading  = "downloading"
)

// SemanticStatus describes semantic search for the UI and the MCP server. Done and Total are
// memory counts (vectors stored vs memories); the bridge reuses them for bytes while downloading.
type SemanticStatus struct {
	State   string `json:"state"`
	Message string `json:"message"`
	Model   string `json:"model"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
}

func (s *Service) SemanticStatus(ctx context.Context) (SemanticStatus, error) {
	emb := s.opts.Embedder
	if emb == nil {
		return SemanticStatus{State: SemanticOff}, nil
	}
	spec := emb.Spec()
	out := SemanticStatus{Model: spec.ID}
	st := emb.Status()
	switch st.State {
	case embed.StateNotInstalled:
		out.State = SemanticNotInstalled
		return out, nil
	case embed.StateUnavailable:
		out.State, out.Message = SemanticUnavailable, st.Message
		return out, nil
	}
	have, total, err := s.store.embeddingCounts(ctx, spec.ID)
	if err != nil {
		return SemanticStatus{}, err
	}
	out.State, out.Done, out.Total = SemanticReady, have, total
	if have < total {
		out.State = SemanticIndexing
	}
	return out, nil
}

// embedDoc embeds one fact, best effort: nil when semantic search is off or the embedder fails.
func (s *Service) embedDoc(ctx context.Context, fact string) []float32 {
	emb := s.opts.Embedder
	if emb == nil || emb.Status().State != embed.StateReady {
		return nil
	}
	dctx, cancel := context.WithTimeout(ctx, docEmbedTimeout)
	defer cancel()
	vecs, err := emb.Embed(dctx, []string{fact}, false)
	if err != nil || len(vecs) != 1 {
		slog.Debug("memory: fact embedding failed; backfill will retry", "err", err)
		return nil
	}
	return vecs[0]
}

// vectorFor returns the encoded embedding and model for the work's decided fact, nil when none.
// An add embeds in prepare already; an update embeds its rewritten fact once across retries.
func (s *Service) vectorFor(ctx context.Context, w *work) ([]byte, string) {
	if s.opts.Embedder == nil || w.dec.Action == ActionNoop || w.dec.Err != nil {
		return nil, ""
	}
	v := w.vec
	if w.dec.Fact != "" && w.dec.Fact != w.Fact {
		if w.mergedFact != w.dec.Fact {
			w.mergedFact, w.mergedVec = w.dec.Fact, s.embedDoc(ctx, w.dec.Fact)
		}
		v = w.mergedVec
	}
	if v == nil {
		return nil, ""
	}
	return embed.Encode(v), s.opts.Embedder.Spec().ID
}

// StartBackfill embeds every memory that lacks a vector, in the background.
func (s *Service) StartBackfill() { s.kickBackfill() }

// kickBackfill starts at most one backfill goroutine. Batches commit independently, so a process
// that exits mid-run loses nothing; two processes racing write identical rows.
func (s *Service) kickBackfill() {
	emb := s.opts.Embedder
	if emb == nil || s.ctx.Err() != nil || emb.Status().State != embed.StateReady {
		return
	}
	if !s.backfilling.CompareAndSwap(false, true) {
		return
	}
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer s.backfilling.Store(false)
		for s.backfillOnce(s.ctx) {
		}
	}()
}

// backfillOnce embeds one batch and reports whether more may remain.
func (s *Service) backfillOnce(ctx context.Context) bool {
	emb := s.opts.Embedder
	model := emb.Spec().ID
	pending, err := s.store.missingEmbeddings(ctx, model, backfillBatch)
	if err != nil || len(pending) == 0 {
		if err != nil && ctx.Err() == nil {
			slog.Debug("memory: backfill lookup failed", "err", err)
		}
		return false
	}
	facts := make([]string, len(pending))
	for i, p := range pending {
		facts[i] = p.fact
	}
	vecs, err := emb.Embed(ctx, facts, false)
	if err != nil || len(vecs) != len(pending) {
		if ctx.Err() == nil {
			slog.Debug("memory: backfill embed failed", "err", err)
		}
		return false
	}
	for i := range pending {
		pending[i].vec = embed.Encode(vecs[i])
	}
	if err := s.store.putEmbeddings(ctx, model, pending); err != nil {
		slog.Debug("memory: backfill write failed", "err", err)
		return false
	}
	if s.opts.OnSemantic != nil {
		s.opts.OnSemantic()
	}
	return true
}
