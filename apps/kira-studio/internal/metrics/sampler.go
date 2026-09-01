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
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// Sample mirrors src/shared/protocol/ipc.ts's AppMetricsSample shape. CPUPercent is normalized to
// the machine's whole capacity (0-100, occasionally a hair over from measurement jitter), not the
// per-core-sum a tool like `top` reports per process (which can read e.g. 350% on a busy
// quad-core machine) — StatusBar.vue renders it as a plain "N%" with no further context or
// clamping (and reserves only 4 characters of layout width for it, "100%"), so a raw per-core-sum
// would both mean the wrong thing to a reader and overflow that reserved width (P2 R1).
type Sample struct {
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryBytes uint64  `json:"memoryBytes"`
}

// cpuState is one pid's cumulative CPU time, tagged with the OS process-creation time it was read
// from — the tag is what lets two samples of "the same pid" be told apart from two samples of two
// different processes that happen to share a pid number (P2 R1): a short-lived helper can exit and
// have its pid recycled to an unrelated new process well within one sample interval, and comparing
// cumulative times across that boundary produces a meaningless (often negative) delta.
type cpuState struct {
	time       float64
	createTime int64
}

// Sampler keeps the previous CPU-time sample so CPUPercent reports a live delta (matching
// today's cpu.percentCPUUsage semantics) rather than gopsutil's own cumulative-since-start
// figure, normalized by the machine's own logical core count so it lands in the same 0-100 range
// regardless of how many cores the process set is spread across (P2 R1).
type Sampler struct {
	pids        func() ([]int32, error)
	prevCPU     map[int32]cpuState
	prevAt      time.Time
	logicalCPUs int
}

// NewSampler takes a pid-discovery function so the caller decides how the process set is found —
// see Sum below for the bundle-matching implementation this app actually uses.
func NewSampler(pids func() ([]int32, error)) *Sampler {
	return &Sampler{pids: pids, prevCPU: map[int32]cpuState{}, logicalCPUs: runtime.NumCPU()}
}

func (s *Sampler) Sample() (Sample, error) {
	ids, err := s.pids()
	if err != nil {
		return Sample{}, err
	}

	var totalRSS uint64
	cpuNow := make(map[int32]cpuState, len(ids))
	for _, pid := range ids {
		p, err := process.NewProcess(pid)
		if err != nil {
			continue // exited between discovery and sampling — not this process's problem.
		}
		if mi, err := p.MemoryInfo(); err == nil && mi != nil {
			totalRSS += mi.RSS
		}
		times, timesErr := p.Times()
		createTime, createErr := p.CreateTime()
		if timesErr == nil && createErr == nil {
			cpuNow[pid] = cpuState{time: times.User + times.System, createTime: createTime}
		}
	}

	now := time.Now()
	var cpuPercent float64
	if !s.prevAt.IsZero() {
		cpuPercent = cpuDeltaPercent(s.prevCPU, cpuNow, now.Sub(s.prevAt).Seconds(), s.logicalCPUs)
	}
	s.prevCPU = cpuNow
	s.prevAt = now

	return Sample{CPUPercent: cpuPercent, MemoryBytes: totalRSS}, nil
}

// cpuDeltaPercent is Sample's own delta math, pulled out as a pure function so the pid-reuse
// guard and the core-count normalization are both unit-testable without a real OS process: a pid
// only contributes if it named the same process (matching createTime) in both snapshots — a pid
// missing from prev (a genuinely new process) or whose createTime changed (an exited process's
// pid reused by an unrelated new one) contributes nothing for this tick, rather than a delta
// computed against a stranger's cumulative CPU time. The raw per-core-sum (which alone can exceed
// 100 on a machine with more than one logical core fully busy) is then divided by logicalCPUs so
// the result lands in the same 0-100 range StatusBar.vue's plain "N%" reading assumes (P2 R1).
func cpuDeltaPercent(prev, cur map[int32]cpuState, elapsedSeconds float64, logicalCPUs int) float64 {
	if elapsedSeconds <= 0 || logicalCPUs <= 0 {
		return 0
	}
	var deltaSum float64
	for pid, c := range cur {
		if p, ok := prev[pid]; ok && p.createTime == c.createTime {
			deltaSum += (c.time - p.time) / elapsedSeconds
		}
	}
	return deltaSum * 100 / float64(logicalCPUs)
}

// AppProcessSet finds this app's own process set: pids matching anchorNeedles directly (this
// app's own executable, which lives under a bundle path unique to this app), plus pids matching
// helperNeedles (e.g. "com.apple.WebKit" for WKWebView's XPC helpers) that are actually this app's
// own helpers — not simply every process on the machine whose executable happens to match the
// substring.
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
// AnchorNeedles/HelperNeedles combined. With this app's own needle lists that's several full
// system-wide scans every 5s tick for the life of the process, almost all of it re-deriving the
// exact same process-to-executable-path facts over and over. One scan, checked against every
// needle per process, produces the identical result for a small, fixed syscall cost instead of one
// that scales with the needle count).
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
		if includeHelper(responsibilityTracked, anchorSet[responsiblePID(pid)]) {
			out = append(out, pid)
		}
	}
	return out, nil
}

// includeHelper is AppProcessSet's own inclusion rule, pulled out pure and platform-independent
// (responsibilityTracked is the only thing that varies by platform) so both branches are
// unit-testable everywhere: untracked platforms (every non-darwin build) always include a
// helper-needle match unfiltered, since P52 §2.3 already confirmed those are real ppid children
// with no cross-app over-match risk. A tracked platform (darwin) must fail closed instead: a -1
// "no distinct responsible process" answer from responsiblePID is exactly the
// belongs-to-some-other-app case this whole mechanism exists to exclude (P2 R1 — the previous
// `resp == -1 || anchorSet[resp]` unconditionally included that case too, defeating the check it
// sat right next to).
func includeHelper(tracked, isAnchor bool) bool {
	if !tracked {
		return true
	}
	return isAnchor
}

func containsAny(s string, needles []string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

// CachedPIDs wraps a pid-resolving func (AppProcessSet, in production) so a caller that samples
// on a fixed cadence for the life of the process — main.go's own metrics ticker — doesn't walk
// every process on the machine on every single tick (P2 R1): resolve only runs once every
// rescanEvery calls; between full resolves, the pids it found are kept as long as they still name
// the same OS process (a fresh, targeted process.NewProcess(pid).CreateTime() lookup — cheap
// compared to resolve's own Exe() lookup on every process on the machine — still matches what was
// recorded at the last full resolve). A pid whose process has exited, possibly with the pid number
// already reused by something else entirely, is dropped rather than kept or misattributed, and is
// picked up again (correctly, whatever it now maps to) on the next resolve.
//
// Deliberately never reuses a *process.Process handle across calls to re-check CreateTime:
// gopsutil's own CreateTime caches its answer on the Process value forever after the first
// successful call, so a long-lived handle for an exited pid would keep reporting its old answer
// rather than surfacing that the pid died — only a fresh process.NewProcess(pid) queries the OS
// again.
type CachedPIDs struct {
	resolve     func() ([]int32, error)
	rescanEvery int
	sinceScan   int
	createTimes map[int32]int64
}

// NewCachedPIDs builds a CachedPIDs. rescanEvery must be at least 1 (a full resolve every call —
// pass 1 for that, not 0).
func NewCachedPIDs(resolve func() ([]int32, error), rescanEvery int) *CachedPIDs {
	return &CachedPIDs{resolve: resolve, rescanEvery: rescanEvery, createTimes: map[int32]int64{}}
}

// PIDs is the func a Ticker/Sampler calls each tick.
func (c *CachedPIDs) PIDs() ([]int32, error) {
	if c.sinceScan == 0 {
		if err := c.rescan(); err != nil {
			return nil, err
		}
	} else {
		c.revalidate()
	}
	c.sinceScan = (c.sinceScan + 1) % c.rescanEvery

	out := make([]int32, 0, len(c.createTimes))
	for pid := range c.createTimes {
		out = append(out, pid)
	}
	return out, nil
}

func (c *CachedPIDs) rescan() error {
	pids, err := c.resolve()
	if err != nil {
		return err
	}
	createTimes := make(map[int32]int64, len(pids))
	for _, pid := range pids {
		if ct, ok := processCreateTime(pid); ok {
			createTimes[pid] = ct
		}
	}
	c.createTimes = createTimes
	return nil
}

func (c *CachedPIDs) revalidate() {
	for pid, want := range c.createTimes {
		got, ok := processCreateTime(pid)
		if !ok || got != want {
			delete(c.createTimes, pid)
		}
	}
}

func processCreateTime(pid int32) (int64, bool) {
	p, err := process.NewProcess(pid)
	if err != nil {
		return 0, false
	}
	ct, err := p.CreateTime()
	if err != nil {
		return 0, false
	}
	return ct, true
}
