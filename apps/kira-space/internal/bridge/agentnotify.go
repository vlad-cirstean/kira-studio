package bridge

import (
	"fmt"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentnotify"
)

const maxNotifyIDBytes = 128

// AgentNotifyService is the renderer's side of desktop agent notifications (P238): each window
// reports what it shows, and the settings pane sends a test note.
type AgentNotifyService struct{ N *agentnotify.Notifier }

type ReportFocusArgs struct {
	WindowKey        string `json:"windowKey"`
	Focused          bool   `json:"focused"`
	Module           string `json:"module"`
	ActiveTerminalID string `json:"activeTerminalId"`
	AdeTaskID        string `json:"adeTaskId"`
}

func (s *AgentNotifyService) ReportFocus(a ReportFocusArgs) error {
	if a.WindowKey == "" {
		return fmt.Errorf("agentnotify: windowKey is required")
	}
	for name, v := range map[string]string{
		"windowKey": a.WindowKey, "module": a.Module, "activeTerminalId": a.ActiveTerminalID, "adeTaskId": a.AdeTaskID,
	} {
		if len(v) > maxNotifyIDBytes {
			return fmt.Errorf("agentnotify: %s exceeds %d bytes", name, maxNotifyIDBytes)
		}
	}
	s.N.ReportFocus(agentnotify.FocusState(a))
	return nil
}

// SendTest posts a test notification; nothing happens while notifications are off.
func (s *AgentNotifyService) SendTest() error {
	s.N.SendTest()
	return nil
}
