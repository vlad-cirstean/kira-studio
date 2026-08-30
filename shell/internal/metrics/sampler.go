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
// explicitly too). Exported for a single-needle caller; AppProcessSet below does its own combined
// scan rather than calling this once per needle (see its own comment for why).
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

// AppProcessSet finds this app's own process set: pids matching anchorNeedles directly (this
// app's own executables — e.g. the Go binary and the vendored Node child, which live under a
// bundle path unique to this app), plus pids matching helperNeedles (e.g. "com.apple.WebKit" for
// WKWebView's XPC helpers) that are actually this app's own helpers — not simply every process on
// the machine whose executable happens to match the substring.
//
// Why the helper/anchor split exists: a native webview's helper processes are not children of
// this app in the ppid sense (WKWebView's are reparented to launchd, ppid=1), so a plain substring
// match over-matches — confirmed on a real machine measuring P52 gate G1: "com.apple.WebKit"
// matched Messages' and Notes' own idle WebContent/GPU/Networking helpers too, inflating a 215 MB
// reading to 300 MB. On darwin, macOS itself tracks which process is "responsible" for launching
// each XPC service (the same mechanism Activity Monitor uses to group them visually) via
// responsibility_get_pid_responsible_for_pid, so helper pids are kept only when that resolves to
// one of the anchor pids. On every other platform responsiblePID returns -1 (unknown), so helper
// pids are kept unfiltered — correct there specifically because P52 §2.3 already confirmed
// WebKitGTK's own helpers really are ppid children on Linux, so this over-match risk doesn't arise.
//
// Scans the system's process table exactly once, regardless of how many needles are given (P57
// finding: an earlier version called MatchingPIDs — a full process.Processes() enumeration plus
// an Exe() syscall on every process on the machine — once per needle, i.e. once per *element* of
// AnchorNeedles/HelperNeedles combined. With this app's own needle lists that's 5 full system-wide
// scans every 5s tick for the life of the process, almost all of it re-deriving the exact same
// process-to-executable-path facts five times over. One scan, checked against every needle per
// process, produces the identical result for a small, fixed syscall cost instead of one that scales
// with the needle count).
func AppProcessSet(anchorNeedles, helperNeedles []string) ([]int32, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}

	var anchors, helpers []int32
	for _, p := range procs {
		exe, err := p.Exe()
		if err != nil || exe == "" {
			continue
		}
		switch {
		case containsAny(exe, anchorNeedles):
			anchors = append(anchors, p.Pid)
		case containsAny(exe, helperNeedles):
			helpers = append(helpers, p.Pid)
		}
	}

	anchorSet := make(map[int32]bool, len(anchors))
	for _, pid := range anchors {
		anchorSet[pid] = true
	}

	out := append([]int32{}, anchors...)
	for _, pid := range helpers {
		if resp := responsiblePID(pid); resp == -1 || anchorSet[resp] {
			out = append(out, pid)
		}
	}
	return out, nil
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
