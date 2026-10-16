package docker

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
)

const (
	eventsDebounce  = 250 * time.Millisecond
	eventsRetryWait = 2 * time.Second
)

var allKinds = []string{"container", "image", "network", "volume"}

// ChangedEvent is ChannelChanged's payload: which resource kinds to refetch.
type ChangedEvent struct {
	Kinds []string `json:"kinds"`
}

// noisyActions fire constantly while a terminal or log view is open and change nothing listed.
func noisyAction(action string) bool {
	return strings.HasPrefix(action, "exec_") || action == "attach" || action == "detach" ||
		action == "resize" || action == "top" || action == "copy" || action == "export"
}

// eventsWatcher runs one engine /events stream while at least one window watches.
type eventsWatcher struct {
	m *Manager

	mu      sync.Mutex
	windows map[string]struct{}
	stop    context.CancelFunc // ends the whole loop
	kick    context.CancelFunc // ends the current stream so the loop reconnects
}

func newEventsWatcher(m *Manager) *eventsWatcher {
	return &eventsWatcher{m: m, windows: map[string]struct{}{}}
}

func (w *eventsWatcher) watch(windowKey string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.windows[windowKey] = struct{}{}
	if w.stop != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	w.stop = cancel
	go w.run(ctx)
}

func (w *eventsWatcher) unwatch(windowKey string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.windows, windowKey)
	if len(w.windows) == 0 && w.stop != nil {
		w.stop()
		w.stop, w.kick = nil, nil
	}
}

func (w *eventsWatcher) shutdown() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.windows = map[string]struct{}{}
	if w.stop != nil {
		w.stop()
		w.stop, w.kick = nil, nil
	}
}

// restart drops the current stream; the loop reconnects against the (possibly new) client.
func (w *eventsWatcher) restart() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.kick != nil {
		w.kick()
	}
}

func (w *eventsWatcher) run(ctx context.Context) {
	failed := false
	for ctx.Err() == nil {
		if failed {
			st := w.m.status(ctx, false)
			w.m.Emit.Emit(ChannelStatus, st)
			if st.State != "ok" {
				sleepCtx(ctx, eventsRetryWait)
				continue
			}
			w.m.Emit.Emit(ChannelChanged, ChangedEvent{Kinds: allKinds})
			failed = false
		}
		err := w.stream(ctx)
		if ctx.Err() != nil {
			return
		}
		if errors.Is(err, context.Canceled) {
			continue
		}
		failed = true
		w.m.Emit.Emit(ChannelStatus, w.m.status(ctx, false))
		sleepCtx(ctx, eventsRetryWait)
	}
}

func sleepCtx(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// stream forwards debounced change events until the engine stream ends or is kicked.
func (w *eventsWatcher) stream(ctx context.Context) error {
	cli, _, err := w.m.client()
	if err != nil {
		return err
	}
	ictx, cancel := context.WithCancel(ctx)
	defer cancel()
	w.mu.Lock()
	w.kick = cancel
	w.mu.Unlock()

	res := cli.Events(ictx, client.EventsListOptions{Filters: client.Filters{}.Add("type", "container", "image", "volume", "network")})
	pending := map[string]struct{}{}
	var tick <-chan time.Time
	flush := func() {
		if len(pending) == 0 {
			return
		}
		kinds := make([]string, 0, len(pending))
		for k := range pending {
			kinds = append(kinds, k)
		}
		sort.Strings(kinds)
		pending = map[string]struct{}{}
		w.m.Emit.Emit(ChannelChanged, ChangedEvent{Kinds: kinds})
	}
	for {
		select {
		case msg := <-res.Messages:
			if noisyAction(string(msg.Action)) {
				continue
			}
			pending[string(msg.Type)] = struct{}{}
			if tick == nil {
				tick = time.After(eventsDebounce)
			}
		case <-tick:
			tick = nil
			flush()
		case err := <-res.Err:
			flush()
			return err
		}
	}
}
