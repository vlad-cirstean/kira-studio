package bridge

import (
	"context"
	"sync"
	"time"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appcore"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge/adewire"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
)

// launchAckTimeout bounds how long a phone request waits for the desktop window to open a launch.
const launchAckTimeout = 20 * time.Second

// MobileOpenLaunchEvent asks one desktop window to open a launch's terminal the way a desktop
// click would. PTYs belong to a window and close with it, so the server never opens one itself.
type MobileOpenLaunchEvent struct {
	Launch   adewire.Launch `json:"launch"`
	TaskID   string         `json:"taskId"`
	BranchID string         `json:"branchId"`
}

// MobileLaunches is the rendezvous between a phone-started launch and the desktop window that
// opens its terminal: Open emits to one window and waits for that window's Ack.
type MobileLaunches struct {
	Emit appcore.Emitter
	// Window picks the window that opens the terminal; false means none is open.
	Window func() (string, bool)
	// Timeout overrides launchAckTimeout (tests).
	Timeout time.Duration

	mu      sync.Mutex
	waiters map[string]chan string
}

// Open sends the launch to a window and waits for its ack. A non-empty ack is the window's own
// failure text.
func (m *MobileLaunches) Open(ctx context.Context, launch adewire.Launch, taskID, branchID string) error {
	key, ok := m.Window()
	if !ok {
		return ipcerr.New("E_NO_WINDOW", "Open Kira Space on the computer first, then try again.")
	}
	ch := make(chan string, 1)
	m.mu.Lock()
	if m.waiters == nil {
		m.waiters = map[string]chan string{}
	}
	m.waiters[launch.TerminalID] = ch
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.waiters, launch.TerminalID)
		m.mu.Unlock()
	}()

	m.Emit.EmitTo(key, ChannelMobileOpenLaunch, MobileOpenLaunchEvent{Launch: launch, TaskID: taskID, BranchID: branchID})
	wait := m.Timeout
	if wait == 0 {
		wait = launchAckTimeout
	}
	timeout := time.NewTimer(wait)
	defer timeout.Stop()
	select {
	case msg := <-ch:
		if msg != "" {
			return ipcerr.New("E_INVALID", msg)
		}
		return nil
	case <-timeout.C:
		return ipcerr.New("E_LAUNCH_TIMEOUT", "The computer did not open the terminal in time.")
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Ack resolves the waiter for terminalID; an unknown id (a late ack) is a no-op.
func (m *MobileLaunches) Ack(terminalID, errText string) {
	m.mu.Lock()
	ch := m.waiters[terminalID]
	m.mu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- errText:
	default:
	}
}
