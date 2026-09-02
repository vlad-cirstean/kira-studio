package metrics

import (
	"log/slog"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/notify"
)

// AnchorNeedles/HelperNeedles are AppProcessSet's own needles, given one home both main.go's
// metrics ticker and cmd/g1measure's flag defaults read instead of each duplicating them as
// string literals (P52 §15: a bad needle match was one of the three real bugs found getting G1
// measured).
var (
	// "Kira Studio" is the shipping executable name (P57 D11: apps/kira-studio/Taskfile.yml's APP_NAME,
	// matched here since AppProcessSet finds this app's own process by executable path substring,
	// not by pid tree — see sampler.go's header comment). P58f: no vendored Node child needle any
	// more — every adapter is served in-process by this binary.
	AnchorNeedles = []string{"Kira Studio"}
	HelperNeedles = []string{"com.apple.WebKit", "webkitgtk", "bwrap"}
)

const Interval = 5 * time.Second

// RescanEvery is how many Interval ticks pass between CachedPIDs' full process-table resolves.
//
// One, i.e. every tick. P2 R1 originally set this to 12 (60s) to avoid "walking every process on
// the machine every single tick for the life of the app", and traded a rescan interval's worth of
// staleness for it. That trade was a bad one in both directions, and the staleness was not
// cosmetic:
//
//   - CachedPIDs.revalidate only ever *drops* pids — it cannot add one. So a process that appears
//     after a resolve is invisible until the next resolve, up to RescanEvery ticks later.
//   - Ticker.run's own priming sample forces the first resolve at startup, which on macOS is
//     before WKWebView has spawned com.apple.WebKit.{WebContent,Networking,GPU} at all. The
//     status bar therefore reported the Go process alone — one process, ~38 MB, no webview — for
//     the first minute of every run, which is exactly the window someone launching the app looks
//     at. The same hole reopens whenever a WebContent process is replaced.
//
// The cost it was buying is not real: a full AppProcessSet resolve over a 472-process machine
// measures 1.9 ms, against an Interval of 5 s — a 0.04% duty cycle. Rescanning every tick makes
// the reading correct within one Interval in every case, at a cost that does not register.
const RescanEvery = 1

// Ticker samples on a fixed cadence and fans each Sample out to every OnSample subscriber. P52
// §8.4's measurement (Sampler, AppProcessSet) is done; this is only the cadence P55 §6.1 adds —
// main.go starts it with no subscriber yet, which is a complete behaviour (D15), not a stub.
// Emitting to the renderer (`app.Event.Emit`) and stopping it on quit are both P56.
type Ticker struct {
	sampler  *Sampler
	interval time.Duration

	samples notify.Emitter[Sample]

	stopOnce sync.Once
	stop     chan struct{}
	done     chan struct{}
}

// NewTicker takes a pid-discovery function, exactly as NewSampler does — the caller decides how
// the process set is found (AppProcessSet(AnchorNeedles, HelperNeedles), in production).
func NewTicker(pids func() ([]int32, error), interval time.Duration) *Ticker {
	return &Ticker{
		sampler:  NewSampler(pids),
		interval: interval,
		stop:     make(chan struct{}),
		done:     make(chan struct{}),
	}
}

// OnSample registers fn for every sample. It returns an unsubscribe func.
func (t *Ticker) OnSample(fn func(Sample)) (unsubscribe func()) {
	return t.samples.Subscribe(fn)
}

// Start begins sampling on its own goroutine. Call it at most once.
func (t *Ticker) Start() {
	go t.run()
}

func (t *Ticker) run() {
	defer close(t.done)

	// A priming sample establishes Sampler.prevAt/prevCPU before the loop's first real tick, so the
	// first *emitted* sample differences against an Interval-old baseline instead of skipping the
	// delta (prevAt.IsZero()) and reporting a placeholder 0% CPU no matter how busy the app actually
	// is at startup (F4). The result itself is discarded — only the side effect matters — and a
	// failure here is not fatal: the first real tick below recovers on its own, same as any other
	// sample failure.
	if _, err := t.sampler.Sample(); err != nil {
		slog.Warn("priming sample failed", "scope", "metrics", "err", err)
	}

	ticker := time.NewTicker(t.interval)
	defer ticker.Stop()
	for {
		select {
		case <-t.stop:
			return
		case <-ticker.C:
			sample, err := t.sampler.Sample()
			if err != nil {
				// A sample failure is not fatal — the pid set is re-discovered fresh next tick,
				// so a process that raced its own exit between discovery and sampling recovers
				// on its own.
				slog.Warn("sample failed", "scope", "metrics", "err", err)
				continue
			}
			t.samples.Emit(sample)
		}
	}
}

// Stop ends the sampling goroutine and waits for it to exit. Idempotent. Must only be called
// after Start.
func (t *Ticker) Stop() {
	t.stopOnce.Do(func() { close(t.stop) })
	<-t.done
}
