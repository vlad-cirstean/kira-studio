// Package metrics is the Go analogue of Electron's app.getAppMetrics(): it sums memory and CPU
// across the app's whole process set on a timer (P52 §8.4), and it is also the instrument gate
// G1 (§3.3) is measured with. The memory figure is RSS everywhere except darwin, where it is
// ri_phys_footprint (proc_pid_rusage(RUSAGE_INFO_V2)) — the figure Activity Monitor's own "Memory"
// column shows, which excludes shared system pages RSS double-counts across this app's own
// multi-process set (P7 F1/D2). cmd/g1measure, this package's own throwaway RSS-only measurement
// tool, is unaffected — see its own header comment.
//
// The process set is not obvious and getting it wrong invalidates any measurement built on this
// package: a native webview's helper processes (WebKitGTK's WebProcess/NetworkProcess on Linux,
// WKWebView's com.apple.WebKit.* helpers on macOS) are not children of this process in the ppid
// sense, so Sum matches by executable path substring rather than walking the pid tree.
package metrics

import (
	"log/slog"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// Sample mirrors packages/shared/protocol/events.ts's AppMetricsSample shape. CPUPercent is
// normalized to the machine's whole capacity (0-100, occasionally a hair over from measurement
// jitter), not the per-core-sum a tool like `top` reports per process (which can read e.g. 350% on
// a busy quad-core machine) — StatusBar.vue renders it as a plain "N%" with no further context or
// clamping (and reserves only 4 characters of layout width for it, "100%"), so a raw per-core-sum
// would both mean the wrong thing to a reader and overflow that reserved width (P2 R1). MemoryBytes
// is RSS everywhere except darwin, where it is phys_footprint — see this package's own doc comment
// (P7 D2). LogicalCPUs and ProcessCount exist so a renderer can state what CPUPercent is a
// percentage *of* and how many processes MemoryBytes covers, rather than leaving a reader to take
// either figure on faith (P7 F6, D6) — ProcessCount is the number of pids that actually answered
// the probe this tick (the ones MemoryBytes is summed over), not the number discovered.
type Sample struct {
	CPUPercent   float64 `json:"cpuPercent"`
	MemoryBytes  uint64  `json:"memoryBytes"`
	LogicalCPUs  int     `json:"logicalCPUs"`
	ProcessCount int     `json:"processCount"`
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

// procSample is one probe's answer for a single pid: the process-identity tag (createTime, same
// role as cpuState's) plus the two readings Sample needs from it. Sampler.probe is the seam every
// platform's syscalls sit behind, so Sample itself, cpuDeltaPercent and CachedPIDs never call an
// OS API directly — see probe_darwin.go/probe_other.go (D3).
type procSample struct {
	cpuSeconds float64
	memBytes   uint64
	createTime int64
}

// cpuSanityThresholdPercent is cpuDeltaPercent's own sanity bound: a normalized reading above this
// before clamping means an accounting bug (a stale-baseline spike, a bad probe read), not
// measurement jitter, and is worth a log line even though the emitted sample still gets clamped to
// a displayable range (F3).
const cpuSanityThresholdPercent = 110

// Sampler keeps the previous CPU-time sample so CPUPercent reports a live delta (matching
// today's cpu.percentCPUUsage semantics) rather than gopsutil's own cumulative-since-start
// figure, normalized by the machine's own logical core count so it lands in the same 0-100 range
// regardless of how many cores the process set is spread across (P2 R1).
type Sampler struct {
	pids        func() ([]int32, error)
	probe       func(pid int32) (procSample, bool)
	prevCPU     map[int32]cpuState
	prevAt      time.Time
	logicalCPUs int
}

// NewSampler takes a pid-discovery function so the caller decides how the process set is found —
// see Sum below for the bundle-matching implementation this app actually uses. The per-process
// probe itself is always defaultProbe (platform-selected, see probe_darwin.go/probe_other.go) —
// there is no production caller that needs a different one, so it is not part of this signature.
func NewSampler(pids func() ([]int32, error)) *Sampler {
	return &Sampler{pids: pids, probe: defaultProbe, prevCPU: map[int32]cpuState{}, logicalCPUs: runtime.NumCPU()}
}

func (s *Sampler) Sample() (Sample, error) {
	ids, err := s.pids()
	if err != nil {
		return Sample{}, err
	}

	var totalMem uint64
	var processCount int
	cpuNow := make(map[int32]cpuState, len(ids))
	for _, pid := range ids {
		ps, ok := s.probe(pid)
		if !ok {
			// A failed probe drops this pid from both readings for the tick rather than
			// contributing a zero: cpuState.time is cumulative, so a zero fed into next tick's
			// delta would read as this pid's entire lifetime CPU usage in one window (F2, D7).
			continue
		}
		totalMem += ps.memBytes
		processCount++
		cpuNow[pid] = cpuState{time: ps.cpuSeconds, createTime: ps.createTime}
	}

	now := time.Now()
	var cpuPercent float64
	if !s.prevAt.IsZero() {
		cpuPercent = cpuDeltaPercent(s.prevCPU, cpuNow, now.Sub(s.prevAt).Seconds(), s.logicalCPUs)
	}
	s.prevCPU = cpuNow
	s.prevAt = now

	return Sample{
		CPUPercent:   cpuPercent,
		MemoryBytes:  totalMem,
		LogicalCPUs:  s.logicalCPUs,
		ProcessCount: processCount,
	}, nil
}

// cpuDeltaPercent is Sample's own delta math, pulled out as a pure function so the pid-reuse
// guard and the core-count normalization are both unit-testable without a real OS process: a pid
// only contributes if it named the same process (matching createTime) in both snapshots — a pid
// missing from prev (a genuinely new process, including one whose probe failed last tick — see
// Sample's D7 handling above) or whose createTime changed (an exited process's pid reused by an
// unrelated new one) contributes nothing for this tick, rather than a delta computed against a
// stranger's cumulative CPU time. A per-pid delta that goes backwards (a non-monotonic read) is
// clamped to 0 rather than subtracted from the other pids' genuine usage, and the normalized
// result is clamped to [0, 100] — a raw value above cpuSanityThresholdPercent is logged once with
// the pids that produced it, since that means an accounting bug worth seeing rather than jitter to
// round away silently (F3).
func cpuDeltaPercent(prev, cur map[int32]cpuState, elapsedSeconds float64, logicalCPUs int) float64 {
	if elapsedSeconds <= 0 || logicalCPUs <= 0 {
		return 0
	}
	var deltaSum float64
	var contributors []int32
	for pid, c := range cur {
		p, ok := prev[pid]
		if !ok || p.createTime != c.createTime {
			continue
		}
		delta := (c.time - p.time) / elapsedSeconds
		if delta < 0 {
			delta = 0
		}
		deltaSum += delta
		if delta > 0 {
			contributors = append(contributors, pid)
		}
	}

	raw := deltaSum * 100 / float64(logicalCPUs)
	if raw > cpuSanityThresholdPercent {
		slog.Warn("cpu sample exceeded sanity threshold, clamping", "scope", "metrics", "percent", raw, "pids", contributors)
	}
	switch {
	case raw < 0:
		return 0
	case raw > 100:
		return 100
	default:
		return raw
	}
}

// procEntry is one listProcesses result: a pid paired with its executable path. Kept
// platform-independent so listProcesses.go/processlist_other.go's darwin/other split is only about
// *how* the process table is enumerated — AppProcessSet's own matching loop below never changes.
type procEntry struct {
	pid int32
	exe string
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
//
// listProcesses is platform-selected (processlist_darwin.go's proc_listpids+proc_pidpath, or
// processlist_other.go's gopsutil process.Processes()+Exe() — P7 F8): the matching rule below is
// unaffected by which one supplied procEntry's pid/exe pairs.
func AppProcessSet(anchorNeedles, helperNeedles []string) ([]int32, error) {
	entries, err := listProcesses()
	if err != nil {
		return nil, err
	}

	var anchors, helpers []int32
	for _, e := range entries {
		if e.exe == "" {
			continue
		}
		switch {
		case containsAny(e.exe, anchorNeedles):
			anchors = append(anchors, e.pid)
		case containsAny(e.exe, helperNeedles):
			helpers = append(helpers, e.pid)
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

// processCreateTime reads createTime off the same probe Sampler uses (rather than its own
// NewProcess/CreateTime lookup), so CachedPIDs' idea of "the same process" and cpuState's can
// never diverge — the create-time tag both use to detect pid reuse always comes from one place.
// defaultProbe is platform-selected: probe_darwin.go (native, requires cgo) or probe_other.go
// (gopsutil, every other build) — see D3.
func processCreateTime(pid int32) (int64, bool) {
	ps, ok := defaultProbe(pid)
	if !ok {
		return 0, false
	}
	return ps.createTime, true
}

// gopsutilProbe is the gopsutil-based per-process probe: NewProcess (an existing-pid check),
// MemoryInfo (RSS) and Times (cumulative CPU seconds), folded into one pass/fail result rather than
// letting the memory and CPU reads fail independently. probe_other.go's defaultProbe is this
// unchanged, on every platform without a native footprint syscall (or without cgo to reach the one
// that exists); probe_darwin.go's EPERM fallback also calls gopsutilCreateTime below for its
// identity tag, since struct proc_taskinfo has no start-time field of its own (D3).
func gopsutilProbe(pid int32) (procSample, bool) {
	p, err := process.NewProcess(pid)
	if err != nil {
		return procSample{}, false
	}
	mi, err := p.MemoryInfo()
	if err != nil || mi == nil {
		return procSample{}, false
	}
	times, err := p.Times()
	if err != nil {
		return procSample{}, false
	}
	createTime, err := p.CreateTime()
	if err != nil {
		return procSample{}, false
	}
	return procSample{cpuSeconds: times.User + times.System, memBytes: mi.RSS, createTime: createTime}, true
}

// gopsutilCreateTime is process-creation-time alone (gopsutil's CreateTime, a sysctl kern.proc.pid
// on darwin) — probe_darwin.go's EPERM-fallback identity tag, kept separate from gopsutilProbe so
// that fallback isn't tied to gopsutil's own unchecked-return MemoryInfo/Times reads (the exact
// pattern F2 flags as a bug) when all it actually needs is the creation timestamp.
func gopsutilCreateTime(pid int32) (int64, bool) {
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
