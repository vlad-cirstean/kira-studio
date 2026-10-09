//go:build darwin && !server

package agentnotify

import (
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// WailsSink posts through the Wails v3 notifications service (UNUserNotificationCenter).
type WailsSink struct {
	svc *notifications.NotificationService

	mu     sync.Mutex
	asked  bool
	denied bool
}

func NewWailsSink(svc *notifications.NotificationService) *WailsSink { return &WailsSink{svc: svc} }

// authorized asks the OS once; the OS shows its own permission prompt on the first request.
func (s *WailsSink) authorized() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.denied {
		return false
	}
	if s.asked {
		return true
	}
	ok, err := s.svc.CheckNotificationAuthorization()
	if err == nil && !ok {
		ok, err = s.svc.RequestNotificationAuthorization()
	}
	if err != nil || !ok {
		s.denied = true
		slog.Info("desktop notifications unavailable", "scope", "notify", "err", err)
		return false
	}
	s.asked = true
	return true
}

func (s *WailsSink) Send(n Note) error {
	if !s.authorized() {
		return nil
	}
	return s.svc.SendNotification(notifications.NotificationOptions{
		ID: n.ID, Title: n.Title, Body: n.Body, ThreadID: "kira-agents",
		Data: map[string]interface{}{
			"terminalId": n.TerminalID, "windowKey": n.WindowKey, "recordId": n.RecordID,
			"taskId": n.TaskID, "kind": string(n.Kind),
		},
	})
}
