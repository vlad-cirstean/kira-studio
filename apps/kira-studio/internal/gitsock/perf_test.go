package gitsock

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitrpc"
)

// §3.9's own perf re-baseline (D12), extending G3's TestGraphStreamPerf (which stays where it is,
// unchanged, as this file's own control — F12). Same gating throughout: testing.Short() skip,
// KIRA_GIT_PERF=1, and git on PATH. Every subtest t.Logf's a single `key=value` line in G3's own
// shape and asserts NOTHING (D12) — SPEC's own note is "re-measurement, not re-derivation", and a
// hard assertion in a suite that also runs on real macOS hardware would be flaky in exactly the way
// that note warns against. Numbers are recorded a second time in C10's own commit message and in
// this plan's §12.

func skipUnlessPerf(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("short mode")
	}
	if os.Getenv("KIRA_GIT_PERF") != "1" {
		t.Skip("set KIRA_GIT_PERF=1 to run the perf probe")
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not on PATH")
	}
}

// streamOnce drains one graph.stream to completion (granting enough credit up front to never
// stall) and reports its own first-chunk/total timings and byte totals.
func streamOnce(t *testing.T, c *testClient, params gitrpc.GraphStreamParams, creditN int) (firstChunk, total time.Duration, chunks, totalBytes int) {
	t.Helper()
	start := time.Now()
	id := c.openStream("graph.stream", params)
	c.sendCredit(id, creditN)
	for {
		f := c.readStreamFrame()
		if f.Body.T == "end" {
			if f.Body.Error != nil {
				t.Fatalf("stream ended with error: %+v", f.Body.Error)
			}
			break
		}
		if chunks == 0 {
			firstChunk = time.Since(start)
		}
		chunks++
		totalBytes += len(f.Blob)
	}
	total = time.Since(start)
	return firstChunk, total, chunks, totalBytes
}

func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(p * float64(len(sorted)-1))
	return sorted[idx]
}

func TestG8PerfBaseline(t *testing.T) {
	skipUnlessPerf(t)

	// --- P-a: graph.stream, one connection -- G3's own number, re-taken on today's tree as the
	// control every other probe below is measured against.
	t.Run("P-a_OneConnection", func(t *testing.T) {
		const n = 20000
		server, sockPath, _, _ := newIntegrationServer(t)
		repoDir := buildFastImportRepo(t, n)
		client := pairAndReady(t, server, sockPath, "perf-a")
		repoID := openRepoOK(t, client, repoDir).Repo.RepoID

		firstChunk, total, chunks, totalBytes := streamOnce(t, client, gitrpc.GraphStreamParams{RepoID: repoID}, n/500+10)
		mean := 0
		if chunks > 0 {
			mean = totalBytes / chunks
		}
		t.Logf("P-a_OneConnection: n=%d chunks=%d firstChunk=%s total=%s meanBytesPerChunk=%d totalBytes=%d",
			n, chunks, firstChunk, total, mean, totalBytes)
	})

	// --- P-b: graph.stream, two connections concurrently on ONE repository -- the four-slot read
	// pool under two windows (G4 §10/G5 §10's own question).
	t.Run("P-b_TwoConnectionsOneRepo", func(t *testing.T) {
		const n = 20000
		server, sockPath, _, _ := newIntegrationServer(t)
		repoDir := buildFastImportRepo(t, n)
		clientA := pairAndReady(t, server, sockPath, "perf-b-a")
		clientB := pairAndReady(t, server, sockPath, "perf-b-b")
		repoIDA := openRepoOK(t, clientA, repoDir).Repo.RepoID
		repoIDB := openRepoOK(t, clientB, repoDir).Repo.RepoID

		type outcome struct{ firstChunk, total time.Duration }
		results := make(chan outcome, 2)
		run := func(c *testClient, repoID string) {
			firstChunk, total, _, _ := streamOnce(t, c, gitrpc.GraphStreamParams{RepoID: repoID}, n/500+10)
			results <- outcome{firstChunk, total}
		}
		start := time.Now()
		go run(clientA, repoIDA)
		go run(clientB, repoIDB)
		oA := <-results
		oB := <-results
		wall := time.Since(start)
		t.Logf("P-b_TwoConnectionsOneRepo: n=%d A.firstChunk=%s A.total=%s B.firstChunk=%s B.total=%s wall=%s",
			n, oA.firstChunk, oA.total, oB.firstChunk, oB.total, wall)
	})

	// --- P-c: graph.stream, two connections on TWO different repositories -- independence should
	// be near-total (M3's own perf half).
	t.Run("P-c_TwoConnectionsTwoRepos", func(t *testing.T) {
		const n = 8000
		server, sockPath, _, _ := newIntegrationServer(t)
		repoA := buildFastImportRepo(t, n)
		repoB := buildFastImportRepo(t, n)
		clientA := pairAndReady(t, server, sockPath, "perf-c-a")
		clientB := pairAndReady(t, server, sockPath, "perf-c-b")
		repoIDA := openRepoOK(t, clientA, repoA).Repo.RepoID
		repoIDB := openRepoOK(t, clientB, repoB).Repo.RepoID

		type outcome struct{ firstChunk, total time.Duration }
		results := make(chan outcome, 2)
		run := func(c *testClient, repoID string) {
			firstChunk, total, _, _ := streamOnce(t, c, gitrpc.GraphStreamParams{RepoID: repoID}, n/500+10)
			results <- outcome{firstChunk, total}
		}
		start := time.Now()
		go run(clientA, repoIDA)
		go run(clientB, repoIDB)
		oA := <-results
		oB := <-results
		wall := time.Since(start)
		t.Logf("P-c_TwoConnectionsTwoRepos: n=%d A.firstChunk=%s A.total=%s B.firstChunk=%s B.total=%s wall=%s",
			n, oA.firstChunk, oA.total, oB.firstChunk, oB.total, wall)
	})

	// --- P-d: commit.detail x 50 rows, one connection vs two -- G4 D8 spends three of four read
	// slots on one detail request; this is the number that says whether four is right.
	t.Run("P-d_CommitDetailOneVsTwoConnections", func(t *testing.T) {
		const rows = 50
		repoDir, shas := initFixtureRepoWithCommits(t, rows)
		server, sockPath, _, _ := newIntegrationServer(t)
		client := pairAndReady(t, server, sockPath, "perf-d-solo")
		repoID := openRepoOK(t, client, repoDir).Repo.RepoID

		measure := func(c *testClient, repoID string, shas []string) []time.Duration {
			lat := make([]time.Duration, 0, len(shas))
			for _, sha := range shas {
				start := time.Now()
				requestOK(t, c, "commit.detail", gitrpc.CommitDetailParams{RepoID: repoID, SHA: sha})
				lat = append(lat, time.Since(start))
			}
			return lat
		}

		soloLat := measure(client, repoID, shas)
		sort.Slice(soloLat, func(i, j int) bool { return soloLat[i] < soloLat[j] })
		soloMean := sumDurations(soloLat) / time.Duration(len(soloLat))
		t.Logf("P-d_CommitDetailOneVsTwoConnections: mode=solo rows=%d mean=%s p95=%s", rows, soloMean, percentile(soloLat, 0.95))

		clientA := pairAndReady(t, server, sockPath, "perf-d-a")
		clientB := pairAndReady(t, server, sockPath, "perf-d-b")
		_ = openRepoOK(t, clientA, repoDir)
		_ = openRepoOK(t, clientB, repoDir)
		half := len(shas) / 2
		latCh := make(chan []time.Duration, 2)
		go func() { latCh <- measure(clientA, repoID, shas[:half]) }()
		go func() { latCh <- measure(clientB, repoID, shas[half:]) }()
		twoLat := append(<-latCh, <-latCh...)
		sort.Slice(twoLat, func(i, j int) bool { return twoLat[i] < twoLat[j] })
		twoMean := sumDurations(twoLat) / time.Duration(len(twoLat))
		t.Logf("P-d_CommitDetailOneVsTwoConnections: mode=two-connections rows=%d mean=%s p95=%s", rows, twoMean, percentile(twoLat, 0.95))
	})

	// --- P-e: commit.fileDiff + file.read on a large patch and a large blob -- G4 D1 chose JSON
	// over FlatBuffers with no measurement behind it; this gives the argument real numbers.
	t.Run("P-e_LargePatchAndBlobBytes", func(t *testing.T) {
		dir := t.TempDir()
		run := func(args ...string) {
			cmd := exec.Command("git", args...)
			cmd.Dir = dir
			cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
				"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com")
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("git %v: %v\n%s", args, err, out)
			}
		}
		run("init", "-q", "-b", "main")

		// A large blob (2 MiB of pseudo-random-looking text, line-structured so a diff has real hunks).
		var blobBuilder strings.Builder
		for i := 0; i < 40000; i++ {
			fmt.Fprintf(&blobBuilder, "line %06d payload payload payload\n", i)
		}
		blobContent := blobBuilder.String()
		if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(blobContent), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("add", "big.txt")
		run("-c", "commit.gpgsign=false", "commit", "-q", "-m", "base big file")
		baseSha := trimNewline(runPerfGit(t, dir, "rev-parse", "HEAD"))

		// A large patch: touch every other line.
		lines := strings.Split(blobContent, "\n")
		for i := 0; i < len(lines); i += 2 {
			lines[i] = lines[i] + " CHANGED"
		}
		if err := os.WriteFile(filepath.Join(dir, "big.txt"), []byte(strings.Join(lines, "\n")), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		run("-c", "commit.gpgsign=false", "commit", "-q", "-am", "large patch")
		headSha := trimNewline(runPerfGit(t, dir, "rev-parse", "HEAD"))

		server, sockPath, _, _ := newIntegrationServer(t)
		client := pairAndReady(t, server, sockPath, "perf-e")
		repoID := openRepoOK(t, client, dir).Repo.RepoID

		start := time.Now()
		diffResp := requestOK(t, client, "commit.fileDiff", gitrpc.CommitFileDiffParams{RepoID: repoID, SHA: headSha, Path: "big.txt"})
		diffElapsed := time.Since(start)
		t.Logf("P-e_LargePatchAndBlobBytes: commit.fileDiff encodedBytes=%d elapsed=%s", len(diffResp.Result), diffElapsed)

		start = time.Now()
		blobResp := requestOK(t, client, "file.read", gitrpc.FileReadParams{RepoID: repoID, Rev: baseSha, Path: "big.txt"})
		blobElapsed := time.Since(start)
		t.Logf("P-e_LargePatchAndBlobBytes: file.read encodedBytes=%d rawBytes=%d elapsed=%s", len(blobResp.Result), len(blobContent), blobElapsed)
	})

	// --- P-f: ranged graph.stream over a 200-commit range -- upstream's own ≤300ms budget, on this
	// transport.
	t.Run("P-f_RangedWalk200Commits", func(t *testing.T) {
		const n = 200
		repoDir := buildFastImportRepo(t, n+1)
		rootSha := trimNewline(runPerfGit(t, repoDir, "rev-list", "--max-parents=0", "HEAD"))
		server, sockPath, _, _ := newIntegrationServer(t)
		client := pairAndReady(t, server, sockPath, "perf-f")
		repoID := openRepoOK(t, client, repoDir).Repo.RepoID

		rng := &gitrpc.CommitRangeParams{Base: rootSha, Branch: "main"}
		firstChunk, total, chunks, totalBytes := streamOnce(t, client, gitrpc.GraphStreamParams{RepoID: repoID, Range: rng}, n/500+10)
		t.Logf("P-f_RangedWalk200Commits: n=%d chunks=%d firstChunk=%s total=%s totalBytes=%d (upstream budget <=300ms)",
			n, chunks, firstChunk, total, totalBytes)
	})

	// --- P-g: chunk-size distribution across a full 20k-commit walk -- G3 §10's own hand-forward.
	t.Run("P-g_ChunkSizeDistribution", func(t *testing.T) {
		const n = 20000
		server, sockPath, _, _ := newIntegrationServer(t)
		repoDir := buildFastImportRepo(t, n)
		client := pairAndReady(t, server, sockPath, "perf-g")
		repoID := openRepoOK(t, client, repoDir).Repo.RepoID

		id := client.openStream("graph.stream", gitrpc.GraphStreamParams{RepoID: repoID})
		client.sendCredit(id, n/500+10)
		var sizes []int
		for {
			f := client.readStreamFrame()
			if f.Body.T == "end" {
				if f.Body.Error != nil {
					t.Fatalf("stream ended with error: %+v", f.Body.Error)
				}
				break
			}
			sizes = append(sizes, len(f.Blob))
		}
		if len(sizes) == 0 {
			t.Fatal("no chunks streamed")
		}
		sort.Ints(sizes)
		total := 0
		for _, s := range sizes {
			total += s
		}
		mean := total / len(sizes)
		p99 := sizes[int(0.99*float64(len(sizes)-1))]
		t.Logf("P-g_ChunkSizeDistribution: n=%d chunks=%d minBytes=%d meanBytes=%d maxBytes=%d p99Bytes=%d",
			n, len(sizes), sizes[0], mean, sizes[len(sizes)-1], p99)
	})

	// --- P-h: watcher fan-out latency at 1, 2 and 8 subscribed connections -- does D14's own
	// coalescing fan-out scale past two windows?
	t.Run("P-h_WatcherFanoutLatency", func(t *testing.T) {
		for _, n := range []int{1, 2, 8} {
			repoDir := initFixtureRepo(t)
			server, sockPath, _, _ := newIntegrationServer(t)
			clients := make([]*testClient, n)
			var repoID string
			for i := range clients {
				clients[i] = pairAndReady(t, server, sockPath, fmt.Sprintf("perf-h-%d-%d", n, i))
				r := openRepoOK(t, clients[i], repoDir).Repo.RepoID
				if repoID == "" {
					repoID = r
				}
			}

			start := time.Now()
			runGitIn(t, repoDir, "commit", "--allow-empty", "-q", "-m", "fanout probe")
			latencies := make([]time.Duration, n)
			for i, c := range clients {
				_ = c.recvEvent("repo.changed")
				latencies[i] = time.Since(start)
			}
			maxLat := time.Duration(0)
			for _, l := range latencies {
				if l > maxLat {
					maxLat = l
				}
			}
			t.Logf("P-h_WatcherFanoutLatency: connections=%d maxLatency=%s", n, maxLat)
		}
	})

	// --- P-i: inotify watch count for a repository with 2000 loose refs -- a Linux PROXY for G2
	// §10's macOS fd question (inotify costs per directory, kqueue per file; this records the shape
	// the macOS script compares against, it does not answer the macOS question itself).
	t.Run("P-i_InotifyWatchCountAt2000LooseRefs", func(t *testing.T) {
		if runtime.GOOS != "linux" {
			t.Skip("P-i is a Linux-only inotify proxy")
		}
		repoDir := initFixtureRepo(t)
		const refCount = 2000
		for i := 0; i < refCount; i++ {
			cmd := exec.Command("git", "branch", fmt.Sprintf("perf-branch-%d", i))
			cmd.Dir = repoDir
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("git branch: %v\n%s", err, out)
			}
		}
		looseRefs, err := os.ReadDir(filepath.Join(repoDir, ".git", "refs", "heads"))
		if err != nil {
			t.Fatalf("readdir refs/heads: %v", err)
		}

		before := inotifyWatchCount(t)
		server, sockPath, _, _ := newIntegrationServer(t)
		client := pairAndReady(t, server, sockPath, "perf-i")
		_ = openRepoOK(t, client, repoDir)
		after := inotifyWatchCount(t)

		t.Logf("P-i_InotifyWatchCountAt2000LooseRefs: looseRefFiles=%d watchesBefore=%d watchesAfter=%d watchesAdded=%d",
			len(looseRefs), before, after, after-before)
	})
}

func sumDurations(ds []time.Duration) time.Duration {
	var total time.Duration
	for _, d := range ds {
		total += d
	}
	return total
}

func runPerfGit(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

// inotifyWatchCount counts this PROCESS's own total inotify watch descriptors across every open
// inotify instance -- /proc/self/fd/<n> resolving to "anon_inode:inotify" names the instance;
// /proc/self/fdinfo/<n>'s own "inotify wd:" lines are one per watch held on it (Linux-only, P-i's
// own proxy for G2's macOS fd question).
func inotifyWatchCount(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		t.Fatalf("readdir /proc/self/fd: %v", err)
	}
	total := 0
	for _, entry := range entries {
		fd := entry.Name()
		target, err := os.Readlink(filepath.Join("/proc/self/fd", fd))
		if err != nil || target != "anon_inode:inotify" {
			continue
		}
		info, err := os.ReadFile(filepath.Join("/proc/self/fdinfo", fd))
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(info), "\n") {
			if strings.HasPrefix(line, "inotify wd:") {
				total++
			}
		}
	}
	return total
}
