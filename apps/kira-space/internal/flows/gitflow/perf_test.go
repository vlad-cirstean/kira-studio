package gitflow_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/flowharness"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
)

// Opt-in probes over the native git stream: numbers logged, nothing asserted, since a hard
// threshold would flake on shared hardware.

func skipUnlessPerf(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("short mode")
	}
	if os.Getenv("KIRA_GIT_PERF") != "1" {
		t.Skip("set KIRA_GIT_PERF=1 to run the perf probe")
	}
}

type streamStats struct {
	firstChunk, total time.Duration
	chunks, bytes     int
	sizes             []int
}

func streamOnce(t *testing.T, gs *flowharness.GitStream, params any, credit int) streamStats {
	t.Helper()
	var s streamStats
	start := time.Now()
	call := gs.Stream("graph.stream", params, credit)
	for {
		c, ok, err := call.Next()
		if err != nil {
			t.Fatalf("stream ended with error: %v", err)
		}
		if !ok {
			break
		}
		if s.chunks == 0 {
			s.firstChunk = time.Since(start)
		}
		s.chunks++
		s.bytes += len(c.Blob)
		s.sizes = append(s.sizes, len(c.Blob))
	}
	s.total = time.Since(start)
	return s
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	return sorted[int(p*float64(len(sorted)-1))]
}

func meanOf(ds []time.Duration) time.Duration {
	var sum time.Duration
	for _, d := range ds {
		sum += d
	}
	return sum / time.Duration(len(ds))
}

// concurrently runs streamOnce on each connection at once and returns per-connection stats and wall time.
func concurrently(t *testing.T, conns []*flowharness.GitStream, ids []string, credit int) ([]streamStats, time.Duration) {
	t.Helper()
	out := make([]streamStats, len(conns))
	var wg sync.WaitGroup
	start := time.Now()
	for i := range conns {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out[i] = streamOnce(t, conns[i], m{"repoId": ids[i]}, credit)
		}()
	}
	wg.Wait()
	return out, time.Since(start)
}

func TestGraphStreamPerf(t *testing.T) {
	skipUnlessPerf(t)
	const n = 20000
	r := newRig(t)
	repo := r.app.NewHistory("perf", flowharness.HistorySpec{Commits: n, Branches: 1})
	id := r.open(repo.Dir).RepoID
	s := streamOnce(t, r.gs, m{"repoId": id}, n/500+10)
	mean := 0
	if s.chunks > 0 {
		mean = s.bytes / s.chunks
	}
	t.Logf("TestGraphStreamPerf: n=%d chunks=%d firstChunk=%s total=%s meanBytesPerChunk=%d totalBytes=%d",
		n, s.chunks, s.firstChunk, s.total, mean, s.bytes)
}

func TestG8PerfBaseline(t *testing.T) {
	skipUnlessPerf(t)

	t.Run("P-b_TwoConnectionsOneRepo", func(t *testing.T) {
		const n = 20000
		r := newRig(t)
		repo := r.app.NewHistory("perf", flowharness.HistorySpec{Commits: n, Branches: 1})
		second := r.app.OpenGitStream()
		id := r.open(repo.Dir).RepoID
		openOn(t, second, repo.Dir)
		res, wall := concurrently(t, []*flowharness.GitStream{r.gs, second}, []string{id, id}, n/500+10)
		t.Logf("P-b_TwoConnectionsOneRepo: n=%d A.firstChunk=%s A.total=%s B.firstChunk=%s B.total=%s wall=%s",
			n, res[0].firstChunk, res[0].total, res[1].firstChunk, res[1].total, wall)
	})

	t.Run("P-c_TwoConnectionsTwoRepos", func(t *testing.T) {
		const n = 8000
		r := newRig(t)
		second := r.app.OpenGitStream()
		idA := r.open(r.app.NewHistory("perf-a", flowharness.HistorySpec{Commits: n, Branches: 1}).Dir).RepoID
		idB := openOn(t, second, r.app.NewHistory("perf-b", flowharness.HistorySpec{Commits: n + 1, Branches: 1}).Dir).RepoID
		res, wall := concurrently(t, []*flowharness.GitStream{r.gs, second}, []string{idA, idB}, n/500+10)
		t.Logf("P-c_TwoConnectionsTwoRepos: n=%d A.firstChunk=%s A.total=%s B.firstChunk=%s B.total=%s wall=%s",
			n, res[0].firstChunk, res[0].total, res[1].firstChunk, res[1].total, wall)
	})

	t.Run("P-d_CommitDetailOneVsTwoConnections", func(t *testing.T) {
		const rows = 50
		r := newRig(t)
		repo := r.app.NewHistory("perf", flowharness.HistorySpec{Commits: rows, Branches: 1})
		shaList := repo.RevList("--all")
		id := r.open(repo.Dir).RepoID
		measure := func(gs *flowharness.GitStream, shaSet []string) []time.Duration {
			lat := make([]time.Duration, 0, len(shaSet))
			for _, sha := range shaSet {
				start := time.Now()
				gs.MustRequest("commit.detail", gitrpc.CommitDetailParams{RepoID: id, SHA: sha}, nil)
				lat = append(lat, time.Since(start))
			}
			return lat
		}
		solo := measure(r.gs, shaList)
		sort.Slice(solo, func(i, j int) bool { return solo[i] < solo[j] })
		t.Logf("P-d_CommitDetailOneVsTwoConnections: mode=solo rows=%d mean=%s p95=%s", rows, meanOf(solo), percentile(solo, 0.95))

		a, b := r.app.OpenGitStream(), r.app.OpenGitStream()
		openOn(t, a, repo.Dir)
		openOn(t, b, repo.Dir)
		half := len(shaList) / 2
		lat := make(chan []time.Duration, 2)
		go func() { lat <- measure(a, shaList[:half]) }()
		go func() { lat <- measure(b, shaList[half:]) }()
		two := append(<-lat, <-lat...)
		sort.Slice(two, func(i, j int) bool { return two[i] < two[j] })
		t.Logf("P-d_CommitDetailOneVsTwoConnections: mode=two-connections rows=%d mean=%s p95=%s", rows, meanOf(two), percentile(two, 0.95))
	})

	t.Run("P-e_LargePatchAndBlobBytes", func(t *testing.T) {
		r := newRig(t)
		repo := r.app.NewRepo("perf")
		var blob strings.Builder
		for i := 0; i < 40000; i++ {
			fmt.Fprintf(&blob, "line %06d payload payload payload\n", i)
		}
		base := repo.Commit("base big file", map[string]string{"big.txt": blob.String()})
		changed := strings.Split(blob.String(), "\n")
		for i := 0; i < len(changed); i += 2 {
			changed[i] += " CHANGED"
		}
		head := repo.Commit("large patch", map[string]string{"big.txt": strings.Join(changed, "\n")})
		id := r.open(repo.Dir).RepoID

		var diff, read json.RawMessage
		start := time.Now()
		r.gs.MustRequest("commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: id, SHA: head, Path: "big.txt"}, &diff)
		t.Logf("P-e_LargePatchAndBlobBytes: commit.fileDiff encodedBytes=%d elapsed=%s", len(diff), time.Since(start))
		start = time.Now()
		r.gs.MustRequest("file.read", gitrpc.FileReadParams{RepoID: id, Rev: base, Path: "big.txt"}, &read)
		t.Logf("P-e_LargePatchAndBlobBytes: file.read encodedBytes=%d rawBytes=%d elapsed=%s", len(read), blob.Len(), time.Since(start))
	})

	t.Run("P-f_RangedWalk200Commits", func(t *testing.T) {
		const n = 200
		r := newRig(t)
		repo := r.app.NewHistory("perf", flowharness.HistorySpec{Commits: n + 1, Branches: 1})
		root := repo.RevList("--max-parents=0", "HEAD")[0]
		id := r.open(repo.Dir).RepoID
		s := streamOnce(t, r.gs, m{"repoId": id, "range": m{"base": root, "branch": "main"}}, n/500+10)
		t.Logf("P-f_RangedWalk200Commits: n=%d chunks=%d firstChunk=%s total=%s totalBytes=%d (upstream budget <=300ms)",
			n, s.chunks, s.firstChunk, s.total, s.bytes)
	})

	t.Run("P-g_ChunkSizeDistribution", func(t *testing.T) {
		const n = 20000
		r := newRig(t)
		repo := r.app.NewHistory("perf", flowharness.HistorySpec{Commits: n, Branches: 1})
		id := r.open(repo.Dir).RepoID
		s := streamOnce(t, r.gs, m{"repoId": id}, n/500+10)
		if len(s.sizes) == 0 {
			t.Fatal("no chunks streamed")
		}
		sort.Ints(s.sizes)
		t.Logf("P-g_ChunkSizeDistribution: n=%d chunks=%d minBytes=%d meanBytes=%d maxBytes=%d p99Bytes=%d",
			n, len(s.sizes), s.sizes[0], s.bytes/len(s.sizes), s.sizes[len(s.sizes)-1], s.sizes[int(0.99*float64(len(s.sizes)-1))])
	})

	t.Run("P-h_WatcherFanoutLatency", func(t *testing.T) {
		for _, n := range []int{1, 2, 8} {
			r := newRig(t)
			repo := r.app.NewRepo(fmt.Sprintf("perf-%d", n))
			repo.Commit("first", map[string]string{"a.txt": "a\n"})
			conns := []*flowharness.GitStream{r.gs}
			for len(conns) < n {
				conns = append(conns, r.app.OpenGitStream())
			}
			for _, gs := range conns {
				openOn(t, gs, repo.Dir)
			}
			start := time.Now()
			repo.Git("commit", "--allow-empty", "-q", "-m", "fanout probe")
			var maxLat time.Duration
			for _, gs := range conns {
				gs.WaitEvent("repo.changed", nil, wait)
				maxLat = max(maxLat, time.Since(start))
			}
			t.Logf("P-h_WatcherFanoutLatency: connections=%d maxLatency=%s", n, maxLat)
		}
	})

	t.Run("P-i_InotifyWatchCountAt2000LooseRefs", func(t *testing.T) {
		if runtime.GOOS != "linux" {
			t.Skip("Linux-only inotify proxy")
		}
		r := newRig(t)
		repo := r.app.NewRepo("perf")
		repo.Commit("first", map[string]string{"a.txt": "a\n"})
		const refCount = 2000
		for i := 0; i < refCount; i++ {
			repo.Git("branch", fmt.Sprintf("perf-branch-%d", i))
		}
		before := inotifyWatchCount(t)
		r.open(repo.Dir)
		after := inotifyWatchCount(t)
		t.Logf("P-i_InotifyWatchCountAt2000LooseRefs: looseRefs=%d watchesBefore=%d watchesAfter=%d watchesAdded=%d",
			refCount, before, after, after-before)
	})
}

// inotifyWatchCount counts this process's inotify watches across every instance (Linux only).
func inotifyWatchCount(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatalf("readdir /proc/self/fd: %v", err)
	}
	total := 0
	for _, entry := range entries {
		fd := entry.Name()
		if target, err := os.Readlink(filepath.Join("/proc/self/fd", fd)); err != nil || target != "anon_inode:inotify" {
			continue
		}
		info, err := os.ReadFile(filepath.Join("/proc/self/fdinfo", fd))
		if err != nil {
			continue
		}
		total += strings.Count(string(info), "inotify wd:")
	}
	return total
}
