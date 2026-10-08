package memory

import (
	"container/heap"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"

	"github.com/kirathecat/kira-studio/internal/kiratime"
	"github.com/kirathecat/kira-studio/internal/memory/embed"
)

type scored struct {
	seq   int64
	score float32
}

// minHeap keeps the k best scores: the root is the worst kept entry.
type minHeap []scored

func (h minHeap) Len() int           { return len(h) }
func (h minHeap) Less(i, j int) bool { return h[i].score < h[j].score }
func (h minHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x any)        { *h = append(*h, x.(scored)) }
func (h *minHeap) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

var warnedBadVector atomic.Bool

// vectorTopK scans every stored vector of model and returns the k best by dot product with q,
// best first. A row whose length does not match q is skipped and logged once.
func (s *Store) vectorTopK(ctx context.Context, model string, q []float32, includeHistory bool, k int) ([]scored, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT e.seq, e.vec FROM memory_embeddings e JOIN memories m ON m.seq = e.seq
		WHERE e.model = ?1 AND (?2 OR m.status = 'current')`, model, includeHistory)
	if err != nil {
		return nil, fmt.Errorf("memory: vector scan: %w", err)
	}
	defer rows.Close()
	buf := make([]float32, len(q))
	h := make(minHeap, 0, k+1)
	for rows.Next() {
		var seq int64
		var blob []byte
		if err := rows.Scan(&seq, &blob); err != nil {
			return nil, err
		}
		if err := embed.DecodeInto(buf, blob); err != nil {
			if warnedBadVector.CompareAndSwap(false, true) {
				slog.Warn("memory: skipping malformed embedding", "seq", seq, "err", err)
			}
			continue
		}
		sc := embed.Dot(q, buf)
		switch {
		case len(h) < k:
			heap.Push(&h, scored{seq, sc})
		case sc > h[0].score:
			h[0] = scored{seq, sc}
			heap.Fix(&h, 0)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]scored, len(h))
	for i := len(out) - 1; i >= 0; i-- {
		out[i] = heap.Pop(&h).(scored)
	}
	return out, nil
}

// memoriesBySeq loads memories by seq; the map is keyed by seq.
func (s *Store) memoriesBySeq(ctx context.Context, seqs []int64) (map[int64]Memory, error) {
	out := make(map[int64]Memory, len(seqs))
	if len(seqs) == 0 {
		return out, nil
	}
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	args := make([]any, len(seqs))
	for i, q := range seqs {
		args[i] = q
	}
	rows, err := db.QueryContext(ctx, `SELECT `+memoryColumns+` FROM memories m WHERE m.seq IN (?`+
		strings.Repeat(",?", len(seqs)-1)+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("memory: load by seq: %w", err)
	}
	ms, err := collect(rows, false)
	if err != nil {
		return nil, err
	}
	for _, m := range ms {
		out[m.seq] = m
	}
	return out, nil
}

type pendingEmbed struct {
	seq  int64
	fact string
	vec  []byte
}

// missingEmbeddings lists up to n memories lacking a vector for model, current ones first.
func (s *Store) missingEmbeddings(ctx context.Context, model string, n int) ([]pendingEmbed, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, `SELECT m.seq, m.fact FROM memories m
		LEFT JOIN memory_embeddings e ON e.seq = m.seq AND e.model = ?1
		WHERE e.seq IS NULL ORDER BY (m.status = 'current') DESC, m.seq DESC LIMIT ?2`, model, n)
	if err != nil {
		return nil, fmt.Errorf("memory: missing embeddings: %w", err)
	}
	defer rows.Close()
	var out []pendingEmbed
	for rows.Next() {
		var p pendingEmbed
		if err := rows.Scan(&p.seq, &p.fact); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// putEmbeddings writes vectors in one transaction. It leaves memory_revision alone: a vector is
// not memory content.
func (s *Store) putEmbeddings(ctx context.Context, model string, rows []pendingEmbed) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("memory: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	now := kiratime.NowISO()
	for _, r := range rows {
		if _, err := tx.ExecContext(ctx, `INSERT OR REPLACE INTO memory_embeddings (seq, model, vec, created_at)
			VALUES (?, ?, ?, ?)`, r.seq, model, r.vec, now); err != nil {
			return fmt.Errorf("memory: put embedding: %w", err)
		}
	}
	return tx.Commit()
}

// embeddingCounts reports memories with a vector for model, and all memories.
func (s *Store) embeddingCounts(ctx context.Context, model string) (have, total int64, err error) {
	db, err := s.conn()
	if err != nil {
		return 0, 0, err
	}
	err = db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM memory_embeddings WHERE model = ?1), (SELECT count(*) FROM memories)`, model).Scan(&have, &total)
	if err != nil {
		return 0, 0, fmt.Errorf("memory: embedding counts: %w", err)
	}
	return have, total, nil
}
