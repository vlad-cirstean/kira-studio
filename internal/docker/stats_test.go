package docker

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
)

func TestCPUPercent(t *testing.T) {
	mk := func(cur, pre, curSys, preSys uint64, online uint32, percpu int) container.StatsResponse {
		var s container.StatsResponse
		s.CPUStats.CPUUsage.TotalUsage, s.PreCPUStats.CPUUsage.TotalUsage = cur, pre
		s.CPUStats.SystemUsage, s.PreCPUStats.SystemUsage = curSys, preSys
		s.CPUStats.OnlineCPUs = online
		s.CPUStats.CPUUsage.PercpuUsage = make([]uint64, percpu)
		return s
	}
	tests := []struct {
		name string
		s    container.StatsResponse
		want float64
	}{
		{"two cpus half busy", mk(200, 100, 2000, 1000, 2, 0), 20},
		{"online_cpus zero falls back to percpu length", mk(200, 100, 2000, 1000, 0, 4), 40},
		{"no cpu count at all", mk(200, 100, 2000, 1000, 0, 0), 0},
		{"no previous sample", mk(200, 0, 2000, 0, 2, 0), 0},
		{"zero system delta", mk(200, 100, 1000, 1000, 2, 0), 0},
		{"negative cpu delta", mk(50, 100, 2000, 1000, 2, 0), 0},
		{"idle", mk(100, 100, 2000, 1000, 2, 0), 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := cpuPercent(tc.s); got != tc.want {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}

func TestMemUsage(t *testing.T) {
	mk := func(usage, limit uint64, stats map[string]uint64) container.StatsResponse {
		var s container.StatsResponse
		s.MemoryStats.Usage, s.MemoryStats.Limit, s.MemoryStats.Stats = usage, limit, stats
		return s
	}
	tests := []struct {
		name     string
		s        container.StatsResponse
		wantUsed uint64
	}{
		{"cgroup v1", mk(1000, 4000, map[string]uint64{"total_inactive_file": 300}), 700},
		{"cgroup v2", mk(1000, 4000, map[string]uint64{"inactive_file": 400}), 600},
		{"v1 key wins when both exist", mk(1000, 4000, map[string]uint64{"total_inactive_file": 100, "inactive_file": 400}), 900},
		{"cache above usage clamps to zero", mk(100, 4000, map[string]uint64{"inactive_file": 400}), 0},
		{"no stats", mk(1000, 4000, nil), 1000},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			used, limit := memUsage(tc.s)
			if used != tc.wantUsed || limit != 4000 {
				t.Fatalf("got used=%d limit=%d, want used=%d limit=4000", used, limit, tc.wantUsed)
			}
		})
	}
}

type fakeStats struct {
	mu     sync.Mutex
	opened map[string]int
	open_  map[string]chan struct{} // closed when a stream's ctx ends
}

func newFakeStats() *fakeStats {
	return &fakeStats{opened: map[string]int{}, open_: map[string]chan struct{}{}}
}

func (f *fakeStats) open(ctx context.Context, id string) (io.ReadCloser, error) {
	f.mu.Lock()
	f.opened[id]++
	done := make(chan struct{})
	f.open_[id] = done
	f.mu.Unlock()
	pr, pw := io.Pipe()
	go func() {
		_, _ = pw.Write([]byte(`{"read":"2026-01-01T00:00:00Z","memory_stats":{"usage":10,"limit":100}}` + "\n"))
		<-ctx.Done()
		_ = pw.Close()
		close(done)
	}()
	return pr, nil
}

func (f *fakeStats) openCount(id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.opened[id]
}

func (f *fakeStats) cancelled(id string) bool {
	f.mu.Lock()
	done := f.open_[id]
	f.mu.Unlock()
	select {
	case <-done:
		return true
	case <-time.After(time.Second):
		return false
	}
}

func TestStatsHubSharesAndCancels(t *testing.T) {
	src := newFakeStats()
	var mu sync.Mutex
	got := map[string][]StatsSample{}
	h := newStatsHub(src, func(w string, ev StatsEvent) {
		mu.Lock()
		got[w] = append(got[w], ev.Samples...)
		mu.Unlock()
	}, 10*time.Millisecond)

	h.subscribe("w1", []string{"c1"})
	h.subscribe("w2", []string{"c1"})
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(got["w1"]) > 0 && len(got["w2"]) > 0 })
	if n := src.openCount("c1"); n != 1 {
		t.Fatalf("two windows on one container opened %d streams, want 1", n)
	}
	if s := got["w1"][0]; s.MemUsage != 10 || s.MemLimit != 100 || s.MemPercent != 10 {
		t.Fatalf("unexpected sample %+v", s)
	}

	h.unsubscribe("w1")
	time.Sleep(50 * time.Millisecond)
	if src.openCount("c1") != 1 {
		t.Fatal("stream restarted while another window still subscribes")
	}
	select {
	case <-src.open_["c1"]:
		t.Fatal("stream cancelled while another window still subscribes")
	default:
	}

	h.unsubscribe("w2")
	if !src.cancelled("c1") {
		t.Fatal("stream not cancelled after the last window left")
	}
}

func TestStatsHubReplacesSet(t *testing.T) {
	src := newFakeStats()
	h := newStatsHub(src, func(string, StatsEvent) {}, time.Hour)
	h.subscribe("w", []string{"a", "b"})
	waitFor(t, func() bool { return src.openCount("a") == 1 && src.openCount("b") == 1 })
	h.subscribe("w", []string{"b", "c"})
	if !src.cancelled("a") {
		t.Fatal("dropped container's stream not cancelled")
	}
	waitFor(t, func() bool { return src.openCount("c") == 1 })
	if src.openCount("b") != 1 {
		t.Fatal("kept container's stream reopened")
	}
	h.reset()
	if !src.cancelled("b") || !src.cancelled("c") {
		t.Fatal("reset left streams running")
	}
}

func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met in time")
}
