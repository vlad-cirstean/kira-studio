// Package metrics is the Go analogue of Electron's app.getAppMetrics(): it sums RSS and CPU
// across the app's whole process set on a timer (P52 §8.4), and it is also the instrument gate
// G1 (§3.3) is measured with.
//
// The process set is not obvious and getting it wrong invalidates any measurement built on this
// package: a native webview's helper processes (WebKitGTK's WebProcess/NetworkProcess on Linux,
// WKWebView's com.apple.WebKit.* helpers on macOS) are not children of this process in the ppid
// sense, so Sum matches by executable path substring rather than walking the pid tree.
package metrics

import (
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// Sample mirrors src/shared/protocol/ipc.ts's AppMetricsSample shape.
type Sample struct {
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryBytes uint64  `json:"memoryBytes"`
}

// Sampler keeps the previous CPU-time sample so CPUPercent reports a live delta (matching
// today's cpu.percentCPUUsage semantics) rather than gopsutil's own cumulative-since-start
// figure.
type Sampler struct {
	pids         func() ([]int32, error)
	prevCPUTimes map[int32]float64
	prevAt       time.Time
}

// NewSampler takes a pid-discovery function so the caller decides how the process set is found —
// see Sum below for the bundle-matching implementation this app actually uses.
func NewSampler(pids func() ([]int32, error)) *Sampler {
	return &Sampler{pids: pids, prevCPUTimes: map[int32]float64{}}
}

func (s *Sampler) Sample() (Sample, error) {
	ids, err := s.pids()
	if err != nil {
		return Sample{}, err
	}

	var totalRSS uint64
	cpuTimes := make(map[int32]float64, len(ids))
	for _, pid := range ids {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue // exited between discovery and sampling — not this process's problem.
		}
		if mi, err := p.MemoryInfo(); err == nil && mi != nil {
			totalRSS += mi.RSS
		}
		if times, err := p.Times(); err == nil {
			cpuTimes[pid] = times.User + times.System
		}
	}

	var cpuPercent float64
	now := time.Now()
	if !s.prevAt.IsZero() {
		if elapsed := now.Sub(s.prevAt).Seconds(); elapsed > 0 {
			var deltaSum float64
			for pid, t := range cpuTimes {
				if prev, ok := s.prevCPUTimes[pid]; ok {
					deltaSum += (t - prev) / elapsed
				}
			}
			cpuPercent = deltaSum * 100
		}
	}
	s.prevCPUTimes = cpuTimes
	s.prevAt = now

	return Sample{CPUPercent: cpuPercent, MemoryBytes: totalRSS}, nil
}

// MatchingPIDs finds every running process whose executable path contains needle — the "match on
// the bundle, not the pid tree" rule P52 §3.3/§8.4 both call for — plus any explicitly known
// extra pids (e.g. the engine child, which is a direct child but costs nothing to include
// explicitly too).
func MatchingPIDs(needle string, extra ...int32) ([]int32, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}
	seen := make(map[int32]bool, len(extra))
	out := make([]int32, 0, len(extra))
	for _, pid := range extra {
		if !seen[pid] {
			seen[pid] = true
			out = append(out, pid)
		}
	}
	for _, p := range procs {
		exe, err := p.Exe()
		if err != nil || exe == "" {
			continue
		}
		if !strings.Contains(exe, needle) {
			continue
		}
		pid := p.Pid
		if !seen[pid] {
			seen[pid] = true
			out = append(out, pid)
		}
	}
	return out, nil
}
