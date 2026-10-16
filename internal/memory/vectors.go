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

// vecCache holds the decoded vectors of one model, ascending by seq, in one flat slice. Valid while
// the model's row count and highest seq are unchanged: embeddings are only appended, and a model
// change overwrites under a new model id.
type vecCache struct {
	model  string
	dim    int
	count  int64
	maxSeq int64
	seqs   []int64
	flat   []float32
}

// vectors returns the decoded vectors of model, rebuilding when rows were added. Why a cache: an
// exact scan decoding every blob took about 250 ms at 20k facts; a decoded scan is a tight dot loop.
func (s *Store) vectors(ctx context.Context, model string, dim int) (*vecCache, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	var count, maxSeq int64
	if err := db.QueryRowContext(ctx, `SELECT count(*), coalesce(max(seq), 0) FROM memory_embeddings WHERE model = ?`,
		model).Scan(&count, &maxSeq); err != nil {
		return nil, fmt.Errorf("memory: vector stamp: %w", err)
	}
	s.vecMu.Lock()
	defer s.vecMu.Unlock()
	if c := s.vecs; c != nil && c.model == model && c.dim == dim && c.count == count && c.maxSeq == maxSeq {
		return c, nil
	}
	rows, err := db.QueryContext(ctx, `SELECT seq, vec FROM memory_embeddings WHERE model = ? ORDER BY seq`, model)
	if err != nil {
		return nil, fmt.Errorf("memory: vector load: %w", err)
	}
	defer rows.Close()
	c := &vecCache{model: model, dim: dim, count: count, maxSeq: maxSeq,
		seqs: make([]int64, 0, count), flat: make([]float32, 0, int(count)*dim)}
	buf := make([]float32, dim)
	for rows.Next() {
		var seq int64
		var blob []byte
		if err := rows.Scan(&seq, &blob); err != nil {
			return nil, err
		}
		if err := embed.DecodeInto(buf, blob); err != nil {
			if warnedBadVector.CompareAndSwap(false, true) {
				slog.Warn("memory: skipping malformed embedding", "scope", "memory", "seq", seq, "err", err)
			}
			continue
		}
		c.seqs = append(c.seqs, seq)
		c.flat = append(c.flat, buf...)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	s.vecs = c
	return c, nil
}

// vectorTopK scans the vectors of model whose memory passes f and returns the k best by dot product
// (cosine) with q, best first. A row whose length does not match q is skipped and logged once.
func (s *Store) vectorTopK(ctx context.Context, model string, q []float32, k int, f filter) ([]scored, error) {
	c, err := s.vectors(ctx, model, len(q))
	if err != nil {
		return nil, err
	}
	return s.scanVectors(ctx, c, q, k, f)
}

// scanVectors is vectorTopK over an already loaded cache.
func (s *Store) scanVectors(ctx context.Context, c *vecCache, q []float32, k int, f filter) ([]scored, error) {
	if len(q) != c.dim {
		return nil, fmt.Errorf("memory: query vector has %d dims, cache %d", len(q), c.dim)
	}
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	where, args := f.where()
	rows, err := db.QueryContext(ctx, `SELECT m.seq FROM memories m WHERE 1 = 1`+where+` ORDER BY m.seq`, args...)
	if err != nil {
		return nil, fmt.Errorf("memory: vector filter: %w", err)
	}
	defer rows.Close()
	h := make(minHeap, 0, k+1)
	i, dim := 0, c.dim
	for rows.Next() {
		var seq int64
		if err := rows.Scan(&seq); err != nil {
			return nil, err
		}
		for i < len(c.seqs) && c.seqs[i] < seq {
			i++
		}
		if i == len(c.seqs) {
			break
		}
		if c.seqs[i] != seq {
			continue
		}
		sc := embed.Dot(q, c.flat[i*dim:(i+1)*dim])
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
	ms, err := collect(rows)
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

// groupStat is a result's group signals: other result lineages sharing a group with it, and other
// current facts across its groups. Session groups mix topics and never count.
type groupStat struct{ peers, context int }

// groupStats computes groupStat for each lineage of a result list in two aggregate queries.
func (s *Store) groupStats(ctx context.Context, lineages []string) (map[string]groupStat, error) {
	out := make(map[string]groupStat, len(lineages))
	if len(lineages) == 0 {
		return out, nil
	}
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	in := `(?` + strings.Repeat(",?", len(lineages)-1) + `)`
	args := make([]any, len(lineages))
	for i, l := range lineages {
		args[i] = l
	}
	rows, err := db.QueryContext(ctx, `SELECT gm.lineage_id, gm.group_id FROM memory_group_members gm
		JOIN memory_groups g ON g.id = gm.group_id
		WHERE g.kind <> 'session' AND gm.lineage_id IN `+in, args...)
	if err != nil {
		return nil, fmt.Errorf("memory: group stats: %w", err)
	}
	byGroup := map[string][]string{}
	groupsOf := map[string][]string{}
	for rows.Next() {
		var lineage, group string
		if err := rows.Scan(&lineage, &group); err != nil {
			_ = rows.Close()
			return nil, err
		}
		byGroup[group] = append(byGroup[group], lineage)
		groupsOf[lineage] = append(groupsOf[lineage], group)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()
	for lineage, groups := range groupsOf {
		peers := map[string]struct{}{}
		for _, g := range groups {
			for _, p := range byGroup[g] {
				if p != lineage {
					peers[p] = struct{}{}
				}
			}
		}
		out[lineage] = groupStat{peers: len(peers)}
	}
	crows, err := db.QueryContext(ctx, `SELECT gm.lineage_id, count(DISTINCT x.lineage_id)
		FROM memory_group_members gm JOIN memory_groups g ON g.id = gm.group_id
		JOIN memory_group_members x ON x.group_id = gm.group_id AND x.lineage_id <> gm.lineage_id
		JOIN memories xm ON xm.lineage_id = x.lineage_id AND xm.status = 'current'
		WHERE g.kind <> 'session' AND gm.lineage_id IN `+in+` GROUP BY gm.lineage_id`, args...)
	if err != nil {
		return nil, fmt.Errorf("memory: group context: %w", err)
	}
	defer crows.Close()
	for crows.Next() {
		var lineage string
		var n int
		if err := crows.Scan(&lineage, &n); err != nil {
			return nil, err
		}
		st := out[lineage]
		st.context = n
		out[lineage] = st
	}
	return out, crows.Err()
}
