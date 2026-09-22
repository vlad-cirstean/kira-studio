// Package appshell is Kira Space's own residue of the app-shell composition (P103 Part 3): the
// generic half (window/menu/quit/close-flush machinery, the deferred Wails adapters) is repo-root
// internal/shell, shared with Kira Studio; this package is everything left over that is genuinely
// this app's own — its own menu content, its own dialog request-struct adapter and its own stream
// registration. A distinct package name (not "shell") so one main.go can import both repo-root
// internal/shell and this package with no alias.
package appshell

import (
	"github.com/kirathecat/kira-studio/internal/shell"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// BuildTemplate is Kira Space's own minimal menu: the standard macOS App/Edit/Window sections
// every Wails app needs, no Studio-specific commands (connections, requests, panels, tabs — none
// of which this app has). Part 2 adds a View section (and any Window-menu git commands) once
// there is a frontend to route them to.
func BuildTemplate(appName string) []shell.Section {
	appSection := shell.Section{
		Label: appName,
		Items: []shell.Item{
			{Kind: shell.ItemRole, Role: application.About},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.ServicesMenu},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Hide},
			{Kind: shell.ItemRole, Role: application.HideOthers},
			{Kind: shell.ItemRole, Role: application.ShowAll},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemQuit, Label: "Quit " + appName, Accelerator: "CmdOrCtrl+Q"},
		},
	}

	editSection := shell.Section{
		Label: "Edit",
		Items: []shell.Item{
			{Kind: shell.ItemRole, Role: application.Undo},
			{Kind: shell.ItemRole, Role: application.Redo},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Cut},
			{Kind: shell.ItemRole, Role: application.Copy},
			{Kind: shell.ItemRole, Role: application.Paste},
			{Kind: shell.ItemRole, Role: application.SelectAll},
		},
	}

	windowSection := shell.Section{
		Label: "Window",
		Items: []shell.Item{
			{Kind: shell.ItemNewWindow, Label: "New Window", Accelerator: "CmdOrCtrl+Shift+N"},
			{Kind: shell.ItemSeparator},
			{Kind: shell.ItemRole, Role: application.Minimise},
			{Kind: shell.ItemRole, Role: application.Zoom},
			// role: 'close' defaults to CmdOrCtrl+W — no "Close Tab" here to collide with (Kira
			// Studio's own re-accelerate-to-Shift+W reason, menu.ts:120-122, does not apply), so
			// this stays the plain role default with no Accelerator override.
			{Kind: shell.ItemRole, Role: application.CloseWindow},
		},
	}

	return []shell.Section{appSection, editSection, windowSection}
}
