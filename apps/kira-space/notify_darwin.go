//go:build darwin && !server

package main

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/agentnotify"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/appwire"
	"github.com/kirathecat/kira-studio/internal/desknotify"
	"github.com/kirathecat/kira-studio/internal/prompts"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// notifyServices registers the native notifications service and points the agent notifier at it.
func notifyServices(wired *appwire.Wired) []application.Service {
	ns := notifications.New()
	ns.OnNotificationResponse(func(r notifications.NotificationResult) {
		if r.Error != nil {
			return
		}
		if r.Response.UserInfo["source"] == "prompt" {
			if kind, ok := r.Response.UserInfo["kind"].(string); ok {
				wired.Prompts.RevealKind(prompts.Kind(kind))
			}
			return
		}
		wired.AgentNotify.Click(r.Response.UserInfo)
	})
	sink := desknotify.NewWailsSink(ns)
	wired.AgentNotify.SetSink(agentnotify.SinkFor(sink))
	wired.Prompts.SetSink(sink)
	return []application.Service{application.NewService(ns)}
}
