package desknotify

import (
	"errors"
	"log/slog"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// Notifier is the slice of *notifications.NotificationService the sink uses.
type Notifier interface {
	CheckNotificationAuthorization() (bool, error)
	RequestNotificationAuthorization() (bool, error)
	SendNotification(notifications.NotificationOptions) error
	RemoveDeliveredNotification(id string) error
	RemovePendingNotification(id string) error
}

// WailsSink posts through the Wails v3 notifications service (UNUserNotificationCenter).
type WailsSink struct {
	svc Notifier

	mu     sync.Mutex
	asked  bool
	denied bool
}

func NewWailsSink(svc Notifier) *WailsSink { return &WailsSink{svc: svc} }

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
	data := make(map[string]interface{}, len(n.Data))
	for k, v := range n.Data {
		data[k] = v
	}
	return s.svc.SendNotification(notifications.NotificationOptions{
		ID: n.ID, Title: n.Title, Body: n.Body, ThreadID: n.Thread, Data: data,
	})
}

func (s *WailsSink) Remove(id string) error {
	if !s.authorized() {
		return nil
	}
	return errors.Join(s.svc.RemoveDeliveredNotification(id), s.svc.RemovePendingNotification(id))
}
