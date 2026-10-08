package bridge

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

type launchEmitter struct {
	mu   sync.Mutex
	keys []string
	sent chan MobileOpenLaunchEvent
}

func (e *launchEmitter) Emit(string, any)        {}
func (e *launchEmitter) EmitFocused(string, any) {}
func (e *launchEmitter) EmitTo(key, name string, data any) {
	e.mu.Lock()
	e.keys = append(e.keys, key+"|"+name)
	e.mu.Unlock()
	e.sent <- data.(MobileOpenLaunchEvent)
}

func newLaunches(window bool) (*MobileLaunches, *launchEmitter) {
	em := &launchEmitter{sent: make(chan MobileOpenLaunchEvent, 1)}
	return &MobileLaunches{Emit: em, Window: func() (string, bool) { return "w1", window }}, em
}

func openAsync(m *MobileLaunches, ctx context.Context) chan error {
	done := make(chan error, 1)
	go func() { done <- m.Open(ctx, adewire.Launch{TerminalID: "t1"}, "task", "branch") }()
	return done
}

func errCodeOf(t *testing.T, err error) string {
	t.Helper()
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		t.Fatalf("not an ipcerr: %v", err)
	}
	return ie.Code
}

func TestMobileLaunches_AckResolvesOpen(t *testing.T) {
	t.Parallel()
	m, em := newLaunches(true)
	done := openAsync(m, context.Background())
	ev := <-em.sent
	if ev.Launch.TerminalID != "t1" || ev.TaskID != "task" {
		t.Fatalf("event %+v", ev)
	}
	m.Ack("t1", "")
	if err := <-done; err != nil {
		t.Fatalf("Open = %v", err)
	}
	if em.keys[0] != "w1|"+ChannelMobileOpenLaunch {
		t.Errorf("sent to %q, want window w1 on the desktop-only channel", em.keys[0])
	}
}

func TestMobileLaunches_WindowFailureAndNoWindow(t *testing.T) {
	t.Parallel()
	m, em := newLaunches(true)
	done := openAsync(m, context.Background())
	<-em.sent
	m.Ack("t1", "launch failed")
	if code := errCodeOf(t, <-done); code != "E_INVALID" {
		t.Errorf("window error maps to %s", code)
	}
	none, _ := newLaunches(false)
	if code := errCodeOf(t, none.Open(context.Background(), adewire.Launch{TerminalID: "t2"}, "", "")); code != "E_NO_WINDOW" {
		t.Errorf("no window maps to %s", code)
	}
	m.Ack("late", "") // an ack nobody waits for is a no-op
}

func TestMobileLaunches_TimeoutAndCancelledContext(t *testing.T) {
	t.Parallel()
	slow, slowEm := newLaunches(true)
	slow.Timeout = 30 * time.Millisecond
	done := openAsync(slow, context.Background())
	<-slowEm.sent
	if code := errCodeOf(t, <-done); code != "E_LAUNCH_TIMEOUT" {
		t.Errorf("unanswered launch maps to %s", code)
	}

	m, em := newLaunches(true)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done = openAsync(m, ctx)
	<-em.sent
	if err := <-done; !errors.Is(err, context.DeadlineExceeded) {
		t.Errorf("Open = %v, want the context's error", err)
	}
}
