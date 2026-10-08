package memory

import (
	"slices"
	"testing"
)

func seqs(hs []hit) []int64 {
	out := []int64{}
	for _, h := range hs {
		out = append(out, h.seq)
	}
	return out
}

func TestFuse(t *testing.T) {
	hits := func(s ...int64) []hit {
		out := make([]hit, len(s))
		for i, q := range s {
			out[i] = hit{seq: q}
		}
		return out
	}
	cases := []struct {
		name     string
		fts, vec []hit
		limit    int
		want     []int64
		match    map[int64]string
	}{
		{"both lists boost a shared hit", hits(1, 2), hits(3, 2), 10, []int64{2, 1, 3},
			map[int64]string{1: matchKeyword, 2: matchBoth, 3: matchSemantic}},
		{"equal scores alternate, keyword rank wins the tie", hits(1, 2), hits(3, 4), 10, []int64{1, 3, 2, 4}, nil},
		{"swapped ranks tie, keyword rank wins", hits(1, 2), hits(2, 1), 10, []int64{1, 2}, nil},
		{"truncates to limit", hits(1, 2, 3), hits(4, 5, 6), 2, []int64{1, 4}, nil},
		{"one empty list", hits(5, 6), nil, 10, []int64{5, 6}, map[int64]string{5: matchKeyword, 6: matchKeyword}},
	}
	for _, c := range cases {
		got := fuse(c.fts, c.vec, c.limit)
		if !slices.Equal(seqs(got), c.want) {
			t.Errorf("%s: got %v, want %v", c.name, seqs(got), c.want)
		}
		for _, h := range got {
			if want, ok := c.match[h.seq]; ok && h.match != want {
				t.Errorf("%s: seq %d match = %q, want %q", c.name, h.seq, h.match, want)
			}
		}
	}
}
