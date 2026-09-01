# P7 — CPU/memory status readout

> **The phase, in SPEC.md's own words** (`docs/v1.1/SPEC.md`, P7 row): *"Fix the app's own
> CPU/memory status-bar readout (`internal/metrics`) — the current figure is suspected inefficient
> and not correct, with CPU in particular reading far higher than expected. Mac-first app: use
> Activity Monitor's own approach to process CPU/memory accounting as the reference model."* Why:
> *"user-reported: the status bar's own numbers are not trusted, on the one platform this app ships
> on."*
>
> **The headline, in one line: both numbers over-read against Activity Monitor, for two different
> structural reasons — the CPU one was already fixed four hours after this phase was written and
> nobody has said so, and the memory one is still live and is the bigger of the two.**
>
> **CPU.** The complaint is real and its cause is identified: until `f03e42d` (`P2 R1 fix:
> status-bar CPU% is unlabeled unnormalized per-core sum`, 2026-08-31 23:17 UTC) `Sample.CPUPercent`
> was a raw per-core sum, so an app using 1.2 cores on a 10-core M-series read **"120%"** into a
> 4-character slot. The P7 SPEC row was written at **2026-08-31 19:22 UTC** (`8f5af65`) — *before*
> that fix. So the headline symptom the phase was opened for is already addressed in the tree this
> plan is written against, and P7's honest job on the CPU side is (a) to say that plainly, (b) to
> get it confirmed on a real Mac, and (c) to fix the four *smaller* CPU defects that survive
> `f03e42d`, none of which is a 10x error but two of which can produce a transient one.
>
> **Memory is the finding that is still wrong.** `Sample.MemoryBytes` is a **sum of per-process
> RSS** (`sampler.go:70-72`). Activity Monitor's "Memory" column is not RSS — it is
> **`ri_phys_footprint`** from `proc_pid_rusage(RUSAGE_INFO_V2+)`, a ledger figure that *includes*
> compressed and swapped pages and *excludes* shared system components. Summing RSS across this
> app's five-process set (Go host + three `com.apple.WebKit.*` helpers) counts the dyld shared
> cache and the WebKit framework text **once per process**. `docs/PERF.md` §2.4's own real-Mac
> table is the evidence: 103.1 + 71.9 + 30.4 + 15.2 MB of RSS, summed to **261.7 MB** — which is
> the number the status bar shows today, and which a user comparing against Activity Monitor's
> Memory column has every reason to disbelieve.
>
> **The fix is one API call.** `proc_pid_rusage(pid, RUSAGE_INFO_V2, &ri)` returns
> `ri_user_time`, `ri_system_time`, `ri_phys_footprint`, `ri_resident_size` **and**
> `ri_proc_start_abstime` in a single syscall — every field `Sampler.Sample()` needs, from the
> API Activity Monitor itself reads, replacing today's four-syscalls-per-pid-per-tick
> (`NewProcess` → `PidExists` + `kern.proc.pid` sysctl, then `MemoryInfo`, then `Times`, each
> its own `proc_pidinfo`).
>
> **And the sampler measures the whole machine to report on four processes.** A full rescan
> (`sampler.go:137-169`, every 60 s) walks `process.Processes()` and calls `Exe()` on **every
> process on the Mac** — roughly four syscalls each (`os.FindProcess`, `stat("/proc")`,
> `kill(pid,0)`, `sysctl kern.proc.pid`, then `proc_pidpath`) for ~600 processes, to find ~5 pids.
> `proc_listpids` + `proc_pidpath` into one reused buffer is 1 + N syscalls with no per-process
> allocation, and it is what the phase brief means by "suspected inefficient".
>
> **What this plan cannot do, and says so throughout:** this sandbox is Linux. `internal/metrics`'
> darwin build **does not compile here at all** — verified, §1.4 — so every macOS-specific claim
> below is either cited to a source or explicitly flagged as needing a real-Mac confirmation, and
> the fix is deliberately shaped so that all of the arithmetic lands in shared, Linux-compilable,
> unit-testable code and the platform-specific part is one thin probe function.

---

## 0. What this phase is, and what it is not

### 0.1 Baseline

The tree as of `01c3521` (`docs(architecture): record the P6 Vue Vapor mode decision`), branch
`claude/feature-v1-1-p5-onwards-2isfzt`. P1-P6 and P11 have landed.

Three prior commits already touched this package and this plan builds on them rather than
rediscovering them:

| Commit | Date (UTC) | What it changed |
|---|---|---|
| `a956e83` | pre-v1.1 | `fix(metrics): scan the process table once per tick, not once per needle` — `AppProcessSet` replaced `MatchingPIDs`' one-full-scan-per-needle with one scan checked against every needle. |
| `21796b9` | 2026-08-31 23:13 | `P2 R1 fix: metrics sampler` — three fixes: the pid-reuse guard (`cpuState.createTime`), `includeHelper`'s fail-**closed** darwin filter (the old `resp == -1 \|\| anchorSet[resp]` included exactly the case the mechanism exists to exclude), and `CachedPIDs` (a full process-table resolve every `RescanEvery` ticks instead of every tick). |
| `f03e42d` | 2026-08-31 23:17 | `P2 R1 fix: status-bar CPU% is unlabeled unnormalized per-core sum` — `cpuDeltaPercent` now divides by `runtime.NumCPU()`. |

`docs/PERF.md` §2.3/§2.4 are the standing record of what `internal/metrics` has actually measured
on real hardware, and this phase **adds** to them. §2.4's 261.7 MB is an RSS number produced by
`cmd/g1measure`; nothing in this plan retroactively changes it (see D4).

### 0.2 Scope

1. Establish, with citations, what "correct" per-process CPU and memory accounting is on macOS,
   and which of the two conventions Activity Monitor offers this status bar should follow (§2).
2. Fix the memory figure: `phys_footprint`, not summed RSS (F1, C2).
3. Fix the four surviving CPU defects (F2-F5) and the one that is a *presentation* defect (F6).
4. Collapse the per-tick and per-rescan syscall cost (F7, F8) — the "inefficient" half of the row.
5. Give the readout a tooltip that states its own convention, since "the numbers are not trusted"
   is the actual reported symptom (F6, C5).
6. Land a calibration test that proves the CPU time-unit conversion on a real Mac (C6), and a
   written real-Mac verification procedure a human runs once (§7.2), since this box cannot.

### 0.3 Not in this phase

- **Per-process breakdown in the UI.** The status bar has one 4ch + 9ch slot pair and the phase
  asks for a correct app-wide figure, not a process table.
- **GPU / energy / network columns.** Activity Monitor has them; the status bar does not, and the
  SPEC row names CPU and memory only.
- **Multi-window behaviour of the metrics event.** `bridge/events.go:80-81` emits on one channel
  to whatever windows exist; that is P8's subject, not this one.
- **Frequency-aware CPU accounting.** Activity Monitor itself does not do it (§2.3), so neither
  does this. The limitation gets one documented line, not an implementation.
- **Replacing `gopsutil`.** It stays as the non-darwin implementation and as `cmd/g1measure`'s
  RSS source. Only the darwin sampling path gains a native probe.
- **Changing `cmd/g1measure`'s headline number.** See D4.

### 0.4 Ground rules

- **Evidence or a flag, never a guess.** Every macOS claim below is marked **[verified]** with a
  source, or **[unverified]** with what would settle it. AGENTS.md's "evidence-based plans, not
  hypothetical ones" is the reason F9 exists as an open question rather than a finding.
- **The platform-specific surface stays as small as it can be.** Everything that can be arithmetic
  in a shared file is arithmetic in a shared file, because §1.4 proves nothing darwin-specific in
  this package can be compiled, vetted, or tested from this sandbox.
- **Tests only where AGENTS.md's bar is met.** Two earn their keep here (C1's clamp/monotonicity
  rules and C6's unit calibration) and each carries the one-line comment naming the rule it
  guards. Nothing else in this phase gets a test.

---

## 1. What the code does today

### 1.1 The sampling loop, end to end

`apps/kira-studio/main.go:134-139` is the only production wiring:

```go
processSet := metrics.NewCachedPIDs(
    func() ([]int32, error) { return metrics.AppProcessSet(metrics.AnchorNeedles, metrics.HelperNeedles) },
    metrics.RescanEvery,
)
metricsTicker := metrics.NewTicker(processSet.PIDs, metrics.Interval)
metricsTicker.Start()
```

- `internal/metrics/ticker.go:24` — `Interval = 5 * time.Second`.
- `internal/metrics/ticker.go:30` — `RescanEvery = 12`, i.e. a full process-table resolve every 60 s.
- `internal/metrics/ticker.go:20-21` — `AnchorNeedles = ["Kira Studio"]`,
  `HelperNeedles = ["com.apple.WebKit", "webkitgtk", "bwrap"]`.
- `internal/metrics/ticker.go:68-88` — one goroutine, `time.NewTicker`, `Sample()` then
  `samples.Emit(sample)`; a sample error is logged and skipped.
- `internal/bridge/events.go:80-81` — every sample is emitted on `kira:app:metrics`.
- `frontend/src/state/appMetrics.ts` → `frontend/src/workbench/StatusBar.vue:16-22` — rendered as
  `` `${Math.round(sample.cpuPercent)}%` `` and `formatBytes(sample.memoryBytes)`.

### 1.2 `Sample()` — `internal/metrics/sampler.go:57-89`

Per tick, for each pid in the set:

```go
p, err := process.NewProcess(pid)        // :66
if mi, err := p.MemoryInfo(); err == nil && mi != nil {
    totalRSS += mi.RSS                   // :70-72
}
times, timesErr := p.Times()             // :73
createTime, createErr := p.CreateTime()  // :74
```

then, once:

```go
cpuPercent = cpuDeltaPercent(s.prevCPU, cpuNow, now.Sub(s.prevAt).Seconds(), s.logicalCPUs)  // :83
```

and `cpuDeltaPercent` (`:99-110`):

```go
for pid, c := range cur {
    if p, ok := prev[pid]; ok && p.createTime == c.createTime {
        deltaSum += (c.time - p.time) / elapsedSeconds
    }
}
return deltaSum * 100 / float64(logicalCPUs)
```

So: **memory = Σ RSS**, **CPU = (Σ per-process CPU-second deltas / wall seconds) × 100 / logical
core count**, with a create-time tag guarding pid reuse (`21796b9`) and a core-count divisor
(`f03e42d`).

### 1.3 What each `gopsutil` call actually does on darwin

Read from the pinned module source (`go.mod:19`, `github.com/shirou/gopsutil/v4 v4.26.7`) at
`$(go env GOPATH)/pkg/mod/github.com/shirou/gopsutil/v4@v4.26.7/`, per AGENTS.md's "read the
installed module source" rule:

| Call | darwin implementation | Cost |
|---|---|---|
| `process.NewProcess(pid)` | `process.go:219-233` → `PidExistsWithContext` (`process_posix.go:103-128`: `os.FindProcess` + `isMount("/proc")` `stat` + `kill(pid,0)`) then `CreateTimeWithContext` → `process_darwin.go:88-94`, a `sysctl kern.proc.pid` | ~4 syscalls |
| `p.MemoryInfo()` | `process_darwin.go:544-559` — `proc_pidinfo(PROC_PIDTASKINFO)`, returns `pti_resident_size` as `RSS` | 1 syscall |
| `p.Times()` | `process_darwin.go:525-542` — a **second** `proc_pidinfo(PROC_PIDTASKINFO)`, `pti_total_user`/`pti_total_system` × `mach_timebase_info` numer/denom ÷ 1e9 | 1 syscall |
| `p.CreateTime()` | cached on the `Process` value by `NewProcess` (`process.go:317-324`) | free |
| `p.Exe()` | `process_darwin.go:369-384` — `proc_pidpath` into a fresh 1024-byte buffer | 1 syscall + 1 KB alloc |
| `process.Processes()` | `process_darwin.go:276-292` — one `sysctl kern.proc.all` (a `kinfo_proc` per process, ~648 B each), then `NewProcess` per pid | 1 + 4N syscalls |

Two things fall straight out of that table and are findings F7/F8 below: the same
`proc_pidinfo(PROC_PIDTASKINFO)` is issued **twice per pid per tick** for two halves of one struct,
and a full rescan is **~5 syscalls and ~1.6 KB of allocation per process on the machine** to find
five pids.

A third falls out and is F2 — `gopsutil` **discards `proc_pidinfo`'s return value** in exactly
these two functions:

```
process_darwin.go:532-533
	var ti ProcTaskInfo
	funcs.lib.ProcPidInfo(p.Pid, common.PROC_PIDTASKINFO, 0, unsafe.Pointer(&ti), int32(unsafe.Sizeof(ti)))
process_darwin.go:551-552
	var ti ProcTaskInfo
	funcs.lib.ProcPidInfo(p.Pid, common.PROC_PIDTASKINFO, 0, unsafe.Pointer(&ti), int32(unsafe.Sizeof(ti)))
```

(For contrast, the same file *does* check it at `:409` and `:596`.) A failed call leaves `ti`
zeroed and both functions return `(value, nil)` — a **zero CPU-second reading indistinguishable
from a real one**, with `err == nil`, which `sampler.go:75`'s `timesErr == nil` guard therefore
cannot catch.

### 1.4 What this sandbox can and cannot do — verified, not assumed

```
$ CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build ./apps/kira-studio/internal/metrics/
apps/kira-studio/internal/metrics/sampler.go:164:20: undefined: responsibilityTracked
apps/kira-studio/internal/metrics/sampler.go:164:53: undefined: responsiblePID

$ CGO_ENABLED=1 GOOS=darwin GOARCH=arm64 go build ./apps/kira-studio/internal/metrics/
# runtime/cgo
clang: error: unsupported option '-arch' for target 'x86_64-pc-linux-gnu'

$ GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/metrics/
vet: apps/kira-studio/internal/metrics/sampler.go:164:20: undefined: responsibilityTracked
```

**The darwin build of this package cannot be compiled, vetted, or type-checked from this
container** — `responsible_darwin.go` is a cgo file (`:5-9`), `CGO_ENABLED=0` drops it and leaves
`sampler.go:164` dangling, and `CGO_ENABLED=1` has no macOS toolchain. `go test
./apps/kira-studio/internal/metrics/...` passes here (`ok … 0.317s`) but it is compiling
`responsible_other.go` and `gopsutil`'s Linux path.

Consequences this plan is built around:

- Every line of new darwin code is **unreviewable by the compiler in this sandbox**. It must
  therefore be minimal, mechanical, and separated from anything with logic in it.
- All accounting arithmetic must live in a shared `//go:build`-free file so the Linux test run
  actually covers it.
- One incidental gap worth closing while here: there is no `//go:build darwin && !cgo` companion,
  which is *why* the `CGO_ENABLED=0 GOOS=darwin` vet above fails. See D5.

---

## 2. What macOS actually does — the reference model

### 2.1 Memory: Activity Monitor's "Memory" column is `ri_phys_footprint` **[verified]**

Activity Monitor shows two distinct memory metrics, from two distinct APIs:

- **"Real Memory"** — `proc_pidinfo(PROC_PIDTASKINFO)`'s `proc_taskinfo::resident_size`, i.e. RSS.
- **"Memory"** (the default, sorted-on column) — `proc_pid_rusage()`'s
  `rusage_info_v2::ri_phys_footprint`.

Source: [Activity Monitor Anatomy, bazhenov.me](https://www.bazhenov.me/posts/activity-monitor-anatomy/),
which traces it through `libsysmon`/`sysmond`, and notes both are readable for processes running
under the same user with no special entitlement. Apple's own framing in
[WWDC22 "Profile and optimize your game's memory"](https://developer.apple.com/videos/play/wwdc2022/10106/)
is that **memory footprint is "the primary and universal metric on Apple platforms to determine
actual memory use"**, containing dirty, compressed and swapped pages, and excluding shared system
components. The command-line equivalent of the column is `footprint(1)`.

The struct is confirmed against Apple's own header
([`xnu/bsd/sys/resource.h`](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/resource.h)):
`rusage_info_v0` already carries `ri_user_time`, `ri_system_time`, `ri_resident_size`,
`ri_phys_footprint`, `ri_proc_start_abstime` and `ri_proc_exit_abstime`; `v1` adds the `ri_child_*`
fields; `v2` adds `ri_diskio_bytesread`/`_byteswritten`. `RUSAGE_INFO_V0`…`V6` exist, with
`RUSAGE_INFO_CURRENT == RUSAGE_INFO_V6`.

`gopsutil` already has this struct laid out and already calls the function — but only for disk I/O
(`process_darwin.go:183-202` `rusageInfoV2`, `:213-244` `IOCountersWithContext`). `PhysFootprint`
is declared at `:192` and **never read**. It is in `internal/common`, so not importable; the field
we need is one syscall away and unreachable through the dependency.

**Why summed RSS is specifically wrong for *this* app, not merely different:** each of the five
processes maps the dyld shared cache and (for the three `com.apple.WebKit.*` helpers) the WebKit
framework text. RSS counts those pages in every process that maps them, so the sum multiplies them.
`phys_footprint` is a per-task ledger of pages charged to that task, which is why Apple treats it
as the number that means something.

### 2.2 CPU: Activity Monitor's `% CPU` column is a **per-core sum** **[verified]**

Per [The Eclectic Light Company, "Explainer: % CPU in Activity Monitor" (2026-02-14)](https://eclecticlight.co/2026/02/14/explainer-cpu-in-activity-monitor/):
`% CPU` is the total of active residency across all cores, **not normalized** — an 8-core Mac at
full load reads **800%**, and a process pinning two cores reads 200%. Sampling is over "brief
periods", displayed for the last period, **updated every 1-5 s** and user-selectable in
View ▸ Update Frequency.

So macOS itself offers two conventions and Activity Monitor shows both in one window: the
**per-process `% CPU` column** (0…100×N) and the **CPU-load pane / graph** (normalized to 100%).
This matters directly to F6 and D1: the status bar currently follows the *second* convention
without saying so, having followed the first until `f03e42d`.

### 2.3 The Apple silicon caveat, which no implementation can fix **[verified]**

The same source: `% CPU` is active residency and **ignores core frequency and P/E asymmetry
entirely**. "An M4 chip's CPU cores could show a total of 400% CPU when all four E cores are
running at 1,020 MHz […] or when four of its P cores are running at 4,512 MHz […] yet the P cores
would have an effective throughput of as much as six times that of the E cores."

Consequence for this app: **a core-count-normalized figure is a share of total core-seconds, not a
share of compute capability.** That is exactly what Activity Monitor reports too, so matching it is
correct — but it should be stated in `docs/ARCHITECTURE.md` rather than implied to be more precise
than it is (C7).

### 2.4 CPU time units: the conversion `gopsutil` does is right in principle **[partly verified]**

Apple's header
([`xnu/bsd/sys/proc_info.h`](https://raw.githubusercontent.com/apple-oss-distributions/xnu/main/bsd/sys/proc_info.h))
documents `pti_total_user` as nothing more than `/* total time */`:

```c
struct proc_taskinfo {
	uint64_t	pti_virtual_size;	/* virtual memory size (bytes) */
	uint64_t	pti_resident_size;	/* resident memory size (bytes) */
	uint64_t	pti_total_user;		/* total time */
	uint64_t	pti_total_system;
	uint64_t	pti_threads_user;	/* existing threads only */
	…
```

**The header states no unit.** The accepted answer, from secondary sources rather than Apple, is
mach absolute time: `mach_timebase_info` returns `1/1` on x86_64 (units already nanoseconds) and
`125/3` (≈41.667) on arm64, and `pti_total_user × numer/denom` is nanoseconds. The kernel path is
`proc_pidinfo` → `fill_taskprocinfo` → `TASK_ABSOLUTETIME_INFO` (the flavor name itself being the
strongest available hint). That is precisely what `gopsutil` does
(`process_darwin.go:357-362, 535-539`), so **there is no evidence of a units bug today** and this
plan does not claim one.

**[unverified, and it matters]** Whether `rusage_info`'s `ri_user_time`/`ri_system_time` carry the
*same* units as `pti_total_user`. The header comments nothing, and the fix in C2 switches to those
fields. **This is the single highest-risk assumption in the plan**, and C6 exists to settle it
rather than assume it: `syscall.Getrusage(syscall.RUSAGE_SELF, …)` returns `Utime`/`Stime` as a
`Timeval` — seconds and microseconds, unambiguous, POSIX, no cgo — so a darwin-only test that
burns a known amount of CPU and compares the two readings settles the question on any real Mac in
one `go test`, including under Rosetta.

**[unverified]** A radar (`FB9546856`, "Rosetta 2 error: incorrect value for values reported by
libproc") appears in search results and would bear on the x86_64 slice of a
`darwin:package:universal` build running on Apple silicon. **The page could not be fetched** (the
openradar host served only `robots.txt`), so its contents are not represented here as fact. The
shipping path is `darwin:package` → `build:native` with `GOARCH: '{{.ARCH | default ARCH}}'`
(`apps/kira-studio/build/darwin/Taskfile.yml:52`), i.e. the host's own architecture, so Rosetta is
not the default ship path; `build:universal` (`:88-100`) exists and would be. C6 covers it if a
human runs the test under Rosetta (§7.2, item 5).

---

## 3. Findings

### F1 — The memory figure is summed RSS, and Activity Monitor's is footprint

**Evidence:** `sampler.go:63,70-72,88`:

```go
var totalRSS uint64
…
if mi, err := p.MemoryInfo(); err == nil && mi != nil {
    totalRSS += mi.RSS
}
…
return Sample{CPUPercent: cpuPercent, MemoryBytes: totalRSS}, nil
```

`p.MemoryInfo()` on darwin is `pti_resident_size` (`process_darwin.go:544-559`), i.e. "Real
Memory", not "Memory" (§2.1).

**Magnitude, from this repo's own real-Mac measurement** (`docs/PERF.md` §2.4, config 2): the
five-process set summed to **261.7 MB** of RSS — Go host 103.1, vendored `node` 40.6 (since
deleted by P58f), WebContent 71.9, GPU 30.4, Networking 15.2. Every one of those four surviving
numbers includes that process's own mapping of the dyld shared cache, and the three WebKit numbers
each include the WebKit framework text.

**[unverified]** The size of the gap between that sum and the footprint sum. It cannot be measured
from Linux and this plan will not invent a number; §7.2 item 2 is the human step that produces it,
and C8 records it in `docs/PERF.md`.

**Severity: high.** It is the half of the readout nobody has ever corrected, it is the half a user
can trivially cross-check against Activity Monitor, and it over-reads.

### F2 — A failed `proc_pidinfo` becomes a silent zero, and a zero in a monotonic counter is a spike

**Evidence:** `process_darwin.go:532-533` and `:551-552` discard `ProcPidInfo`'s return value
(quoted in §1.3); both functions return `err == nil` regardless. `sampler.go:73-77` gates on
`timesErr == nil`, which is therefore never false for this failure mode:

```go
times, timesErr := p.Times()
createTime, createErr := p.CreateTime()
if timesErr == nil && createErr == nil {
    cpuNow[pid] = cpuState{time: times.User + times.System, createTime: createTime}
}
```

`cpuState.time` is a **cumulative, monotonic** counter and `cpuDeltaPercent` subtracts consecutive
readings. A single failed read therefore does one of two things:

- **tick N reads 0, tick N+1 reads the truth** → that pid contributes its *entire lifetime* CPU
  time over one 5 s window. A process that has used 300 s of CPU contributes `300/5 = 60`, i.e.
  **6000% pre-normalization, 600% on a 10-core Mac** — one tick of exactly the symptom this phase
  is named for.
- **tick N reads the truth, tick N+1 reads 0** → a large negative contribution which, being
  unclamped (F3), *subtracts* from the other processes' genuine usage.

**[unverified]** How often `proc_pidinfo(PROC_PIDTASKINFO)` actually fails for this app's own
process set on a real Mac. `docs/PERF.md` §2.4 shows it succeeding for all three
`com.apple.WebKit.*` helpers, so this may be rare in practice. **It is a defect regardless** — an
unchecked syscall return feeding a delta is not something to leave in place on the grounds that it
probably does not fire, per AGENTS.md's "no shortcuts".

### F3 — Nothing clamps the result, in either direction

**Evidence:** `cpuDeltaPercent` (`:99-110`) sums raw quotients and returns
`deltaSum * 100 / float64(logicalCPUs)` with no bound at either end. The renderer
(`StatusBar.vue:16-19`) does `Math.round` and appends `%` with no clamp either, into a slot the CSS
reserves 4 characters for (`:132-134`, `min-width: 4ch; /* "100%" */`).

Two consequences: a negative contribution (F2, or any non-monotonic reading) silently *reduces* a
genuine reading rather than being rejected; and a spike renders as `"600%"` and pushes the layout.
A per-pid `max(0, …)` and a whole-sample clamp to `[0, 100]` are both one line and both
unit-testable on Linux.

### F4 — The first emitted sample always reports 0% CPU

**Evidence:** `Sampler.prevAt` starts zero, so `sampler.go:82-84` skips the delta on the first
call; `ticker.go:70-77` only samples on the *first tick*, i.e. at `t = 5 s`. The status bar's
segment is `v-if`-gated on the sample existing (`StatusBar.vue:52`), so the sequence a user sees is:
5 s of nothing, then **`0%`** (a real memory figure beside a fake CPU one), then a real reading at
10 s.

"Shows 0% when the app is visibly busy starting up" is a direct contributor to "the numbers are not
trusted". Priming the baseline with one throwaway sample inside `Start()` makes the first *emitted*
sample a genuine 5 s delta.

### F5 — The rescan tick's own cost lands inside the window it is measuring

**Evidence:** `Sample()` calls `s.pids()` first (`:58`), and on one tick in twelve that is a full
`AppProcessSet` walk of the machine (`ticker.go:30`, `RescanEvery = 12`). The CPU-time readings for
this app's own pids are taken *after* that walk (`:65-78`), and `now` is taken after those
(`:80`) — so the walk's CPU cost is charged to the very sample it enables, and only to one tick in
twelve.

**[unverified]** The magnitude. On the order of ~5 syscalls × ~600 processes (§1.3), so plausibly
tens of milliseconds of CPU once a minute — a fraction of a percent after normalization, i.e. not
the reported symptom. It is listed because F8 removes most of it anyway, and because a
self-measuring sampler whose measurement is dominated by the act of measuring is worth not having.

### F6 — The readout does not say which of macOS's two CPU conventions it follows

**Evidence:** `StatusBar.vue:55` — `v-tooltip="'CPU and memory across all app processes, updated
every 5s'"`. `:16-19` — `` `${Math.round(sample.cpuPercent)}%` ``.

Three problems:

1. §2.2 established that Activity Monitor shows a **per-core sum** in its `% CPU` column. Ours is
   normalized. A user cross-checking against that column sees a figure **N× smaller** and concludes
   the status bar is broken — which is the reported complaint, arriving from the opposite
   direction now that `f03e42d` has landed.
2. `Math.round` on a normalized app-wide figure means an idle app reads `0%` and a moderately busy
   one reads `0%` too: 0.4% of ten cores is 4% of one core, and rounds away.
3. The comment above it (`:11-14`) is Electron-era and false: *"Summed across every OS process the
   app owns (browser, renderer, GPU, utility) … (main/index.ts's own `APP_METRICS_INTERVAL_MS`)"* —
   there is no `main/index.ts` and no such constant in this tree.

### F7 — Two syscalls fetch two halves of one struct, and a third fetches what the first two already have

**Evidence:** `sampler.go:66,70,73` call `NewProcess` → `MemoryInfo` → `Times` per pid per tick.
Per §1.3 that is ~4 syscalls (`NewProcess`) + 1 (`MemoryInfo`) + 1 (`Times`) = **~6 syscalls per
pid per tick**, where `MemoryInfo` and `Times` are literally the same
`proc_pidinfo(PROC_PIDTASKINFO)` call reading different fields of the same returned struct.

One `proc_pid_rusage(pid, RUSAGE_INFO_V2, &ri)` returns `ri_user_time`, `ri_system_time`,
`ri_phys_footprint`, `ri_resident_size` **and** `ri_proc_start_abstime` — CPU, memory *and* the
process-identity tag `cpuState.createTime` needs — in **one** syscall. Six down to one, and the
resulting figure is the one Activity Monitor shows (§2.1).

### F8 — A full rescan interrogates every process on the machine to find five

**Evidence:** `sampler.go:137-155`:

```go
procs, err := process.Processes()
…
for _, p := range procs {
    exe, err := p.Exe()
```

`process.Processes()` is `sysctl kern.proc.all` + `NewProcess` per pid (≈4 syscalls each), and
`Exe()` adds `proc_pidpath` plus a fresh 1024-byte buffer each (`process_darwin.go:369-384`,
`common.NewCStr(common.PROC_PIDPATHINFO_MAXSIZE)`). On a Mac with ~600 processes that is roughly
**3 000 syscalls and ~1.6 MB of allocation, once a minute, for the life of the app** — and the only
information actually wanted from it is which pids have `"Kira Studio"` or `"com.apple.WebKit"` in
their executable path.

`proc_listpids(PROC_ALL_PIDS, 0, buf, size)` returns the whole pid array in one syscall; a single
reused path buffer plus one `proc_pidpath` per pid brings the rescan to **1 + N syscalls and one
allocation total**. The `PidExists`/`kern.proc.pid`/`stat("/proc")` work `NewProcess` does is not
needed at all here — `proc_pidpath` failing *is* the liveness answer.

Note that `a956e83` and `21796b9` already took the two easy wins on this path (one scan per tick
instead of one per needle; then one scan per 12 ticks instead of per tick). What is left is the
per-process cost *within* a scan, which neither commit touched.

### F9 — Documentation drift that would otherwise outlive the fix

- `docs/ARCHITECTURE.md:768-773` — *"matched in one system-wide scan per 5 s tick"*. False since
  `21796b9` introduced `CachedPIDs`; it is one scan per **60 s**, with cheap create-time
  revalidation in between. The same paragraph is titled "App-wide CPU/**RSS** metrics", which C2
  makes wrong in a second way.
- `StatusBar.vue:11-14` — the Electron-era comment quoted in F6.
- `packages/shared/protocol/events.ts:27-35` — `AppMetricsSample`'s doc comment describes the
  aggregation but not the *convention* (normalized vs per-core sum, footprint vs RSS), which is the
  fact a future reader will need.

---

## 4. Checked, and not fired

Recorded so a later pass does not re-derive them:

- **The core-count normalization itself is correct and stays.** `f03e42d` divides by
  `runtime.NumCPU()`, which on darwin is the logical core count — the same denominator Activity
  Monitor's CPU-load pane uses. D1 keeps it.
- **The pid-reuse guard (`21796b9`) is correct.** `cpuState.createTime` and the
  `p.createTime == c.createTime` test at `sampler.go:105` are exactly right, and `sampler_test.go`
  covers both directions. C1 preserves the rule verbatim; only the *source* of `createTime` changes
  (F7).
- **`includeHelper`'s fail-closed darwin rule is correct** (`sampler.go:180-185`,
  `responsible_darwin.go:22-24`), and `docs/PERF.md` §2.4's bug 3 is the measured evidence for why:
  a naive substring match added ~87 MB of *other apps'* idle WebKit helpers. Not touched.
- **`CachedPIDs` is correct**, including the deliberate refusal to reuse a `*process.Process`
  handle across ticks (`sampler.go:206-210` — `gopsutil` caches `CreateTime` on the value forever).
  Its structure survives; only `processCreateTime`'s implementation moves onto the new probe so
  both halves agree on what "the same process" means.
- **`Interval = 5 s` is fine.** Activity Monitor's own range is 1-5 s (§2.2) and 5 s is its
  "Normally" setting. Not changed.
- **`RescanEvery = 12` is fine.** F8 makes a rescan cheap enough that it *could* drop, but changing
  a behavioural constant with no evidence that 60 s of lag matters is not this phase's business.
- **The `Ticker`'s concurrency is fine.** One goroutine, `stopOnce`, `done` channel
  (`ticker.go:64-95`); `Sampler` is only ever touched from `run()`.
- **`bridge/events.go:80-89`'s subscribe/unsubscribe pairing is correct.** Untouched.
- **The anchor/helper needles are right for the shipped app.** `"Kira Studio"` matches the bundle
  executable and nothing else plausible; `"webkitgtk"`/`"bwrap"` are Linux-only and inert on
  darwin.

---

## 5. Decisions

**D1 — Keep the normalized 0-100 CPU figure; make it say so.** Activity Monitor offers both
conventions (§2.2) and the phase brief names it as the reference model for *accounting*, not for
presentation. A status bar's one-number CPU readout should answer "how much of this Mac is the app
using", which is the normalized figure and matches Activity Monitor's CPU-load pane; the per-core
sum needs up to 4 digits, does not fit `min-width: 4ch`, and is the exact thing `f03e42d` removed
for being unreadable. The fix for the mismatch is therefore **labelling, not renumbering** (C5).

**D2 — Memory becomes `phys_footprint` on darwin and stays RSS elsewhere.** §2.1. The field name in
the protocol stays `memoryBytes` (it is still bytes of memory); the *meaning* is documented in the
tooltip, `AppMetricsSample`'s comment and `docs/ARCHITECTURE.md`.

**D3 — One darwin probe, one syscall, everything else shared.** A single injected
`probe func(int32) (procSample, bool)` where `procSample{cpuSeconds, memBytes, createTime}`. darwin
implements it with `proc_pid_rusage(RUSAGE_INFO_V2)`; every other platform keeps today's `gopsutil`
calls. Forced by §1.4: what cannot be compiled here must not contain logic.

**D4 — `cmd/g1measure` keeps RSS as its headline number.** `docs/PERF.md` §2.3/§2.4 are a gate
record whose comparability matters; silently redefining the instrument invalidates them. It gains a
footprint column *alongside* RSS so the two can be compared once, and §2.4's numbers keep meaning
what they meant.

**D5 — Add the missing `darwin && !cgo` companion.** So that `CGO_ENABLED=0 GOOS=darwin go vet`
type-checks the shared file from Linux (§1.4). The stub returns `-1` with
`responsibilityTracked = true`, i.e. it fails **closed** exactly as the real one does on an
unresolved pid — under-counting rather than over-counting — and carries a comment saying the app
never ships `CGO_ENABLED=0` (`build/darwin/Taskfile.yml:51`).

**D6 — `AppMetricsSample` gains `logicalCPUs` and `processCount`.** Two integers, so the tooltip can
say *what* the percentage is a percentage of and *how many* processes the memory figure covers. The
reported problem is that the numbers are not trusted; a number that explains itself is the cheapest
available fix for that, and both values are already known at the sampling site
(`Sampler.logicalCPUs`, `len(ids)`).

**D7 — A degraded probe is reported, not silently zeroed.** When the probe fails for a pid, that
pid contributes nothing *and* its stale previous reading is dropped, so the next tick treats it as
new rather than differencing against a stale baseline. This is the structural fix for F2 and it is
platform-independent, hence unit-testable here.

---

## 6. Implementation order

One Sonnet subagent, sequentially — every commit touches `internal/metrics`, so there is nothing
genuinely parallelizable here (AGENTS.md's default).

### C1 — `refactor(metrics): a per-process probe seam, with the delta rules made explicit`

Shared code only; compiles and is tested on Linux.

- Introduce `procSample{cpuSeconds float64; memBytes uint64; createTime int64}` and
  `Sampler.probe func(int32) (procSample, bool)`, injected by `NewSampler`.
- `Sample()` (`sampler.go:57-89`) loops over the probe instead of
  `NewProcess`/`MemoryInfo`/`Times`/`CreateTime`. A `false` result drops the pid from **both**
  `cpuNow` and the memory sum for this tick (D7).
- `cpuDeltaPercent` gains the two clamps (F3): each per-pid delta contributes `max(0, …)`, and the
  normalized result is clamped to `[0, 100]`. A raw pre-clamp value above ~110 is
  `slog.Warn`-ed once with the pid set, because that means an accounting bug rather than jitter and
  should not be silently rounded away.
- `CachedPIDs.processCreateTime` (`sampler.go:266-276`) moves onto the same probe, so
  `CachedPIDs`' idea of process identity and `cpuState`'s cannot diverge.
- `NewSampler`'s existing signature keeps working for non-darwin/tests by defaulting to the
  `gopsutil` probe.

**Test (earns its keep, per AGENTS.md — a subtle rule nothing else catches):** extend
`sampler_test.go` with the monotonicity/clamp rules — a backwards-going counter contributes 0 and
does not subtract from another pid's genuine delta; a pid the probe failed on last tick does not
produce a lifetime-sized spike when it succeeds this tick; the normalized result never leaves
`[0, 100]`. One comment above the block naming the rule. Every existing test in that file must
still pass unchanged.

### C2 — `feat(metrics): sample CPU and memory the way Activity Monitor does, on darwin`

- New `probe_darwin.go` (`//go:build darwin && cgo`): one cgo call to
  `proc_pid_rusage(pid, RUSAGE_INFO_V2, &ri)`, checking the return value (**F2**), mapping
  `ri_user_time + ri_system_time` → `cpuSeconds` (via `mach_timebase_info`, unless C6 shows the
  fields are already nanoseconds), `ri_phys_footprint` → `memBytes`, `ri_proc_start_abstime` →
  `createTime`. `ri_child_user_time`/`ri_child_system_time` are **not** added — child processes are
  counted as their own pids.
- `probe_other.go` (`//go:build !darwin || !cgo`): today's `gopsutil` behaviour, unchanged, RSS.
- **Fallback, not a silent zero:** if `proc_pid_rusage` returns `EPERM` for a pid, fall back to
  `proc_pidinfo(PROC_PIDTASKINFO)` for that pid (RSS + task times, both return-checked) and log it
  once per pid. This is deliberate: §7.2 item 3 flags that `proc_pid_rusage`'s success on
  `com.apple.WebKit.*` helpers is **unverified**, and the app must degrade to today's numbers
  rather than to zero if it fails.
- Keep the file mechanical — no branching beyond the fallback, no arithmetic that C1's shared code
  could hold instead (§1.4).

### C3 — `perf(metrics): find the app's process set with one pid enumeration, not a machine walk`

- `AppProcessSet` (`sampler.go:137-169`) keeps its matching *rule* exactly as it is, but takes an
  injected `list func() ([]procEntry, error)` (`procEntry{pid int32; exe string}`).
- darwin: `proc_listpids(PROC_ALL_PIDS, …)` once, then `proc_pidpath` per pid into **one reused
  buffer**; a pid whose path cannot be read is skipped, exactly as `:146-148` does today.
- Other platforms: today's `process.Processes()` + `Exe()`, unchanged.
- The anchor/helper/responsibility rule (`:149-167`, `includeHelper`) does not move and is
  unit-tested on Linux exactly as it is now.

### C4 — `fix(metrics): the first emitted sample is a real CPU delta, not a placeholder 0%`

`Ticker.Start()` takes one priming `Sample()` before entering the loop and discards it, so the
sample emitted at `t = Interval` differences against a baseline `Interval` seconds old (F4). A
priming failure is logged and ignored — the next tick recovers on its own, as it does today
(`ticker.go:78-84`).

### C5 — `feat(status-bar): the CPU/memory readout says what it is measuring`

- `metrics.Sample` and `packages/shared/protocol/events.ts`'s `AppMetricsSample` gain
  `logicalCPUs` and `processCount` (D6). No generated binding carries this type
  (`events.ts:27-31`), so it is a hand-edited pair.
- `StatusBar.vue:16-19`: one decimal below 10% (`0.4%`), integer at or above it (`23%`), so an idle
  reading stops rounding to a flat `0%`.
- `StatusBar.vue:55`: a tooltip that states the convention, e.g. *"3.2% of 10 CPU cores · 187.4 MB
  memory footprint across 4 processes · updated every 5s"*, and — since this is the exact
  cross-check a user will make — that Activity Monitor's per-process `% CPU` column uses the
  per-core-sum convention and will read up to 10x higher for the same load.
- Replace the Electron-era comment at `:11-14` (F6.3).
- `min-width: 4ch` (`:132-134`) still fits `100%` and `9.9%`; confirm `0.4%` right-aligns in the
  same slot.

### C6 — `test(metrics): prove the darwin CPU-time unit conversion against getrusage`

A darwin-only (`//go:build darwin`) test that burns a known amount of CPU in the current process
and asserts the probe's `cpuSeconds` delta agrees with `syscall.Getrusage(syscall.RUSAGE_SELF, …)`'s
`Utime`+`Stime` delta (a `Timeval` — seconds and microseconds, unambiguous) to within a loose
tolerance.

**This clears AGENTS.md's bar and the comment above it must say why:** the mach-timebase conversion
is the one thing in this package that can be wrong by a factor of ~41.7 on Apple silicon while
looking entirely plausible, no other test can see it, and §2.4 records that Apple's own header
documents no unit for these fields. It is also the check that would catch a Rosetta-slice
discrepancy if `build:universal` is ever what ships.

**Cannot run in this sandbox** (§1.4). It must be run by a human on a real Mac before the phase is
called done (§7.2 item 4).

### C7 — `docs(architecture): what the status-bar CPU/memory numbers actually measure`

- Fix `docs/ARCHITECTURE.md:768-773`: the scan is once per 60 s, not once per 5 s tick; the section
  is CPU/**footprint**, not CPU/RSS; name `proc_pid_rusage(RUSAGE_INFO_V2)` and
  `ri_phys_footprint` as the source and Activity Monitor's Memory column as the reference.
- Record §2.2's two-conventions fact and §2.3's frequency/P-E caveat in one short paragraph each —
  they are facts about the platform, which is what that file is for, and they are what stops a
  future round from "fixing" the normalization back and forth.
- Update `AppMetricsSample`'s doc comment (`events.ts:27-35`) to state the convention.

### C8 — `docs(perf): the P7 status-readout measurements` — **gated on §7.2**

Written only once a human has run §7.2 on a real Mac. Adds a `docs/PERF.md` section recording: the
footprint sum next to §2.4's RSS sum for the same idle scenario, the idle CPU reading against
Activity Monitor's CPU-load pane, and the C6 calibration result (including the observed
`mach_timebase_info` numer/denom). **If the measurement does not happen, this commit does not
happen** and the phase closes with it named as an open item — a plan that reports numbers it did
not take would be exactly the thing AGENTS.md forbids.

---

## 7. Verification

### 7.1 What this sandbox can actually prove

| Check | Command | Covers |
|---|---|---|
| Shared accounting arithmetic | `go test ./apps/kira-studio/internal/metrics/...` | C1's clamp/monotonicity/probe-failure rules, the untouched pid-reuse and `includeHelper` rules, `CachedPIDs` |
| Nothing else regressed | `go build ./apps/kira-studio/internal/...` and `go test ./apps/kira-studio/internal/...` | the package's callers |
| The shared file type-checks for darwin | `CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go vet ./apps/kira-studio/internal/metrics/` | **only after D5's stub lands** — today this fails (§1.4) |
| Frontend | `bun run check` (biome + vue-tsc) and `bun run test:ui` | C5's `AppMetricsSample` field addition and the label change |
| Linux end-to-end | `node node_modules/.bin/playwright test --project=e2e-real` | that the ticker still emits and the status bar still renders (on the `gopsutil` probe, i.e. **not** the code path that ships) |

**What none of it proves:** anything in `probe_darwin.go` or C3's `proc_listpids` path. Neither
file will have been compiled by anything, anywhere, at the point the Linux suite goes green
(§1.4). That is the reason C2 and C3 are specified as mechanical and logic-free.

### 7.2 What a human must run on a real Mac, once

The phase is not done until these are recorded in `docs/PERF.md` (C8). Build with
`bun run package` (which is `darwin:package` → `build:native`, native arch, `CGO_ENABLED=1`) and
launch the signed bundle the way `docs/PERF.md` §2.4's methodology note describes.

1. **CPU, normalized.** With the app idle, compare the status bar against Activity Monitor's
   CPU-load pane. Expect a small fraction of a percent. Then load one grid tab hard and compare
   again while `top -pid <each pid> -stats cpu` runs; the status bar should be
   `Σ top's per-pid % ÷ ncpu`, within sampling jitter.
2. **CPU, per-core sum.** Confirm the status bar reads ≈`1/ncpu` of Activity Monitor's per-process
   `% CPU` column for the same process set — i.e. that the mismatch is the documented convention
   difference (§2.2) and nothing else.
3. **Memory.** Compare the status bar against `footprint -p <pid>` summed over the process set, and
   against Activity Monitor's Memory column for the same processes. Record the RSS sum alongside
   (`cmd/g1measure`, D4) so §2.4 stays comparable. **Confirm `proc_pid_rusage` does not `EPERM` on
   the `com.apple.WebKit.*` helpers** — if it does, C2's fallback is what is running and that fact
   belongs in the record.
4. **Units.** `go test ./apps/kira-studio/internal/metrics/...` on the Mac, so C6 actually runs.
   Record the machine's `mach_timebase_info` numer/denom.
5. **[optional, only if `build:universal` ever ships]** Repeat 4 against the x86_64 slice under
   Rosetta 2, which is the case §2.4's unverified radar would bear on.
6. **Sampler cost.** With the app idle, watch the status bar across a full minute spanning a rescan
   tick and confirm there is no visible once-a-minute bump (F5, F8).

### 7.3 What must not regress

- `internal/metrics`' existing tests, all of which encode `21796b9`/`f03e42d` rules that stay true.
- `cmd/g1measure`'s RSS output and its `-anchor`/`-helper` flags (D4).
- `docs/PERF.md` §2.3/§2.4's numbers and their meaning.
- The `kira:app:metrics` channel name and emission cadence; `AppMetricsSample` gains fields and
  removes none.

---

## 8. Acceptance checklist

- [ ] `Sample.MemoryBytes` is `phys_footprint` on darwin, RSS elsewhere, and both are documented.
- [ ] Every `proc_pid_rusage`/`proc_pidinfo` return value the app depends on is checked, and a
      failed read drops that pid for the tick instead of contributing a zero (F2, D7).
- [ ] A per-pid CPU delta cannot be negative and a sample cannot leave `[0, 100]`; a raw value
      above the sanity threshold is logged, not silently rounded (F3).
- [ ] The first emitted sample carries a real CPU delta (F4).
- [ ] One `proc_pid_rusage` per pid per tick replaces the previous ~6 syscalls (F7).
- [ ] A full rescan is one `proc_listpids` plus one `proc_pidpath` per pid, one reused buffer (F8).
- [ ] The tooltip states the convention, the core count and the process count; the reading shows a
      decimal below 10% (F6, D6).
- [ ] `CGO_ENABLED=0 GOOS=darwin go vet ./apps/kira-studio/internal/metrics/` succeeds (D5).
- [ ] `docs/ARCHITECTURE.md`'s metrics paragraph, `StatusBar.vue`'s header comment and
      `AppMetricsSample`'s doc comment are all true again (F9).
- [ ] Exactly two new tests exist (C1's rules, C6's calibration), each with the comment naming the
      rule it guards; nothing else gained a test.
- [ ] §7.1 is green.
- [ ] §7.2 has been run by a human and C8 records the result — **or** the phase closes with §7.2
      named as an open item and C8 unwritten.

---

## 9. Open questions, handed forward

- **OQ-1 — Are `ri_user_time`/`ri_system_time` in mach absolute time?** §2.4. C6 settles it on the
  first real-Mac run. If they turn out to be nanoseconds already, C2's conversion drops a
  multiplication and nothing else changes — but shipping the wrong answer would be a ~41.7x error
  on Apple silicon, which is why it is a test and not a comment.
- **OQ-2 — Does summing `phys_footprint` across our own process set double-count anything?**
  Footprint is a per-task ledger and Apple's guidance is per-process; **no authoritative source was
  found** for how memory shared *between two of our own tasks* (e.g. an IOSurface shared between
  WebContent and the GPU helper) is charged. §7.2 item 3's `footprint -p` cross-check is the
  practical answer; if the sum diverges materially from what Activity Monitor implies for the app,
  P12's review round should look again.
- **OQ-3 — Should the status bar offer the per-core-sum convention at all?** D1 says no. If real
  users keep comparing against Activity Monitor's `% CPU` column despite C5's tooltip, a settings
  toggle is the obvious follow-up and belongs to whichever phase owns settings next, not here.
- **OQ-4 — `RescanEvery` after F8.** A rescan becomes roughly an order of magnitude cheaper;
  whether the 60 s lag before a newly spawned helper appears in the reading is worth shortening is
  a question for a real-machine observation, not a guess (§4).
