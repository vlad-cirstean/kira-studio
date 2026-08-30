package metrics

import (
	"log/slog"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/shell/internal/notify"
)

// AnchorNeedles/HelperNeedles are AppProcessSet's own needles, given one home both main.go's
// metrics ticker and cmd/g1measure's flag defaults read instead of each duplicating them as
// string literals (P52 §15: a bad needle match was one of the three real bugs found getting G1
// measured).
var (
	// "Kira Studio" is the shipping executable name (P57 D11: shell/Taskfile.yml's APP_NAME,
	// matched here since AppProcessSet finds this app's own process by executable path substring,
	// not by pid tree — see sampler.go's header comment).
	AnchorNeedles = []string{"Kira Studio", "runtime/node/bin/node"}
	HelperNeedles = []string{"com.apple.WebKit", "webkitgtk", "bwrap"}
)

const Interval = 5 * time.Second

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
